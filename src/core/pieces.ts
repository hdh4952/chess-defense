import { CONFIG } from '../config';
import type { GameEvent, GameState, Piece, Square } from '../types';
import { recalcQueenBuffs } from './buff';
import { applyAttack, pieceDamage } from './combat';
import { freeSlotIndex, SLOT_CAPACITY } from './economy';
import { inBoard, sameSquare } from './grid';
import { knightBlastTargets } from './patterns';

export function findPiece(state: GameState, pieceId: string): Piece | undefined {
  return state.pieces.find(p => p.id === pieceId);
}

export function pieceAt(state: GameState, file: number, rank: number): Piece | undefined {
  return state.pieces.find(p => p.square?.file === file && p.square?.rank === rank);
}

function inLandableBounds(square: Square): boolean {
  return inBoard(square.file, square.rank) && square.rank <= CONFIG.board.ranks - 1;
}

/** 배치 가능: 1~7랭크(8랭크 = 스폰 구역 불가) + 빈 칸 (스펙 2.1) — 트레이 → 보드 전용 규칙 */
export function canPlaceAt(state: GameState, file: number, rank: number): boolean {
  return inLandableBounds({ file, rank }) && !pieceAt(state, file, rank);
}

export function isKnightMove(a: Square, b: Square): boolean {
  const df = Math.abs(a.file - b.file);
  const dr = Math.abs(a.rank - b.rank);
  return (df === 1 && dr === 2) || (df === 2 && dr === 1);
}

export type RejectReason =
  | 'outOfBounds'        // 보드 밖 또는 8랭크(스폰 구역)
  | 'knightCooldown'     // 나이트 이동 쿨다운 중 (합성이면 점유자 쪽 쿨다운일 수도 있다)
  | 'knightPattern'      // L자 행마가 아님
  | 'typeMismatch'       // 트레이 기물 → 다른 종류가 점유 (밀려날 상대가 없어 맞교환 불가)
  | 'tierMismatch'       // 같은 종류지만 티어가 다르다 (같은 티어끼리만 합쳐진다)
  | 'tierOverflow';      // 같은 종류·같은 티어지만 이미 상한 단계다

/**
 * 착지 판정 결과. kind로 좁히면 occupant/resultTier가 자동으로 non-null이 된다.
 * 'self'는 제자리(자기 자신의 칸) — 거부는 아니지만 아무 일도 일어나지 않는 no-op이다.
 */
export type Landing =
  | { kind: 'place'; occupant: null; resultTier: null }
  | { kind: 'merge'; occupant: Piece; resultTier: number }
  | { kind: 'swap'; occupant: Piece; resultTier: null }
  | { kind: 'self'; occupant: Piece; resultTier: null }
  | { kind: 'reject'; occupant: Piece | null; resultTier: null; reason: RejectReason };

const reject = (occupant: Piece | null, reason: RejectReason): Landing =>
  ({ kind: 'reject', occupant, resultTier: null, reason });

/**
 * 착지 판정 — 이 코드베이스의 핵심 불변식이 사는 곳. 실제 규칙(moveOnBoard/placeFromSlot)과
 * 미리보기(render/highlights.ts)가 **반드시 이 함수 하나만** 호출한다. 그래야 미리보기가 실제로는
 * 거부될 이동·배치·합성을 약속하는 일이 구조적으로 불가능해진다. 예전 canLandAt(boolean)이 하던
 * 역할을 그대로 물려받되, 합성이 들어오면서 "가능/불가" 2값으로는 표현할 수 없게 됐다 —
 * 같은 칸이 출발지와 제스처에 따라 배치·합성·맞교환·거부 넷 중 하나가 되기 때문이다.
 *
 * allowMerge — 이 제스처가 합성을 일으킬 수 있는가. **합성은 드래그 앤 드롭 전용이다**(사용자
 * 결정): 기물을 직접 집어 같은 기물 위에 겹쳐 놓는 동작만 합성이고, 클릭-투-무브는 예전 그대로
 * 맞교환이다. 합성이 비가역인데 클릭-투-무브에는 "기물을 클릭해 선택을 옮기는" 조작과 구분할
 * 방법이 없어서, 확인창 대신 제스처 자체를 분리했다. 덤으로 같은 종류 기물끼리 자리를 바꾸는
 * 조작(클릭-투-무브)이 합성 도입 후에도 그대로 남는다.
 * highlights는 it.dragging의 유무로, drag.ts는 드래그 경로인지로 같은 값을 넘긴다 — 두 곳이
 * 같은 사실에서 같은 플래그를 유도하므로 미리보기와 실제 결과가 갈라질 수 없다.
 *
 * 게이트 순서가 곧 규칙이다. 특히 합성 분기는 반드시 경계·나이트 게이트 *뒤*에 온다 — 앞으로
 * 당기면 8랭크(스폰 구역) 금지와 나이트 L자/쿨다운 제약을 합성 경로가 통째로 우회한다.
 */
export function resolveLanding(
  state: GameState, piece: Piece, square: Square, allowMerge: boolean,
): Landing {
  if (!inLandableBounds(square)) return reject(null, 'outOfBounds');

  const fromBoard = piece.square !== null;
  if (fromBoard && piece.type === 'knight') {
    if (piece.cooldown > 0) return reject(null, 'knightCooldown');
    if (!isKnightMove(piece.square!, square)) return reject(null, 'knightPattern');
  }

  const occupant = pieceAt(state, square.file, square.rank);
  if (!occupant) return { kind: 'place', occupant: null, resultTier: null };
  if (occupant === piece) return { kind: 'self', occupant, resultTier: null };

  if (allowMerge && occupant.type === piece.type) {
    // 같은 티어끼리만 합쳐진다 (사용자 결정 — 흰+흰=녹, 녹+녹=파 …). 이 제약이 있어야 티어가
    // "흡수한 개수"가 아니라 레벨이 되고, 능력치 배수가 단계마다 정확히 2배로 떨어진다
    // (tierMultiplier). 티어가 다르면 합성이 아니라 맞교환/거부로 흘려보낸다 — 강화된 기물을
    // 약한 기물에 겹쳐서 조용히 잡아먹히는 사고를 규칙 차원에서 막는다.
    if (occupant.tier !== piece.tier) {
      return fromBoard ? { kind: 'swap', occupant, resultTier: null } : reject(occupant, 'tierMismatch');
    }
    // 나이트 합성은 양쪽 쿨다운이 모두 0일 때만 성립한다. 점유자 쪽 쿨다운을 검사하지 않으면
    // 합성은 성사되는데 직후 tryKnightBlast가 `if (cooldown > 0) return`에 걸려 조용히 폭발을
    // 삼킨다 — 미리보기가 그린 3×3이 실제로는 0회가 되는, 이 파일이 막으려는 바로 그 상황이다.
    // 현재 CONFIG.pieces.knight.interval이 0이라 이 게이트는 항상 통과하지만(쿨다운이 늘 0),
    // interval을 되돌리는 순간 코드 변경 없이 그대로 실전화된다.
    if (occupant.type === 'knight' && occupant.cooldown > 0) return reject(occupant, 'knightCooldown');
    const resultTier = piece.tier + 1;
    if (resultTier > CONFIG.merge.maxTier[piece.type]) return reject(occupant, 'tierOverflow');
    return { kind: 'merge', occupant, resultTier };
  }

  // 트레이 기물은 점유 칸에 착지할 수 없다 — 맞교환은 밀려날 기물이 되돌아갈 출발 칸을 필요로
  // 하는데 트레이발에는 그 칸이 없기 때문이다. 합성만은 예외로 허용되는데(위 분기), 합성은
  // 한쪽이 사라지므로 애초에 되돌아갈 자리가 필요 없다.
  if (!fromBoard) return reject(occupant, 'typeMismatch');
  return { kind: 'swap', occupant, resultTier: null };
}

/**
 * 착지 가능 판정 — resolveLanding의 얇은 파생. 합성을 고려하지 않는(allowMerge=false) 관점의
 * "이 칸에 놓을 수 있는가"이므로, 합성 도입 이전과 의미가 정확히 같다. 규칙 설명은 전부
 * resolveLanding 위에 있다.
 */
export function canLandAt(state: GameState, piece: Piece, square: Square): boolean {
  return resolveLanding(state, piece, square, false).kind !== 'reject';
}

/**
 * 합성 커밋 — 합성이 실제로 일어나는 유일한 함수(맞교환이 moveOnBoard 한 곳인 것과 같다).
 *
 * 생존자는 **점유자**(이미 그 칸에 있던 기물)다. 플레이어가 들고 있던 쪽이 사라지므로, 사라지는
 * id는 항상 dragging에 들어 있는 id다 — 드래그가 끝나면 어차피 null로 비우는 값이라 새로운
 * 위험이 되지 않는다.
 *
 * 쿨다운은 생존자 것을 그대로 둔다. 이것이 안티파밍이다: 쿨다운이 2.9초 남은 룩에 갓 산 룩을
 * 합쳐도 남은 쿨다운은 2.9초 그대로다. 승계 규칙을 "둘 중 작은 값"으로 하면 구매→합성이 쿨다운
 * 초기화 버튼이 되어, 쿨다운을 기물 ID에 묶어 둔 스펙 5.1의 의도가 통째로 무너진다.
 *
 * 흡수된 기물은 반드시 state.pieces에서 제거한다(자리만 비우면 안 된다) — pieceAt/pieceUnder/
 * updateSlots/tooltip이 전부 첫 일치만 집으므로, 같은 칸에 두 기물이 남으면 아래 깔린 쪽이
 * 영원히 조작 불가능해진다.
 */
function commitMerge(state: GameState, absorbed: Piece, survivor: Piece, events: GameEvent[]): void {
  survivor.tier += 1;   // 같은 티어끼리만 합쳐지므로 결과는 언제나 한 단계 위다
  state.pieces.splice(state.pieces.indexOf(absorbed), 1);
  recalcQueenBuffs(state);   // 흡수된 쪽이 퀸이 아니어도 퀸 라인 위였을 수 있다
  events.push({
    kind: 'merged', square: { ...survivor.square! }, pieceType: survivor.type, tier: survivor.tier,
  });
}

function interactable(state: GameState): boolean {
  return !state.paused && (state.phase === 'prepare' || state.phase === 'wave');
}

/**
 * 나이트 폭발 — 쿨다운 0일 때만 발동하고 CONFIG.pieces.knight.interval로 쿨다운을 재시작한다
 * (검토 노트 3). 현재 설정값은 0이라(게임 규칙 변경, 사용자 승인) 사실상 매번 발동하고 매번
 * 즉시 재무장한다 — 값을 되돌리면 옛 쿨다운 동작이 코드 변경 없이 복원된다.
 * 호출 전에 recalcQueenBuffs가 끝나 있어야 한다 (폭발 시점 버프, 스펙 5.6).
 */
function tryKnightBlast(state: GameState, piece: Piece, events: GameEvent[]): void {
  if (piece.cooldown > 0) return;
  const targets = knightBlastTargets(piece.square!);
  applyAttack(state, targets, pieceDamage(piece), events);
  events.push({ kind: 'knightBlast', square: { ...piece.square! } });
  piece.cooldown = CONFIG.pieces.knight.interval;
}

/** 슬롯 → 보드. 쿨다운은 유지된다 (스펙 5.1) */
export function placeFromSlot(
  state: GameState, pieceId: string, file: number, rank: number, events: GameEvent[],
  allowMerge = false,
): boolean {
  const p = findPiece(state, pieceId);
  if (!p || p.square !== null || !interactable(state)) return false;
  const landing = resolveLanding(state, p, { file, rank }, allowMerge);
  if (landing.kind === 'reject') return false;
  if (landing.kind === 'merge') {
    // 트레이발 합성이 슬롯을 하나 비워 canBuy를 다시 연다 — 보드가 꽉 찬 후반에도 구매 루프가
    // 계속 돌게 하는 의도된 동작이다. 흡수되는 건 트레이의 p이므로 보드 위 칸 수는 그대로다.
    commitMerge(state, p, landing.occupant, events);
    if (landing.occupant.type === 'knight') tryKnightBlast(state, landing.occupant, events);
    return true;
  }
  p.square = { file, rank };
  p.slotIndex = null;
  recalcQueenBuffs(state);
  if (p.type === 'knight') tryKnightBlast(state, p, events);
  return true;
}

/**
 * 보드 → 보드. 웨이브 중에도 무제한 (나이트만 L자 + 쿨다운, 스펙 5.1/5.3).
 * 목적지가 점유돼 있으면 실격이 아니라 맞교환이다 (게임 규칙 변경, 사용자 승인) — 두 기물의
 * square를 서로 맞바꾼다. 제자리(자기 자신의 현재 칸)로의 이동은 아무 효과가 없는 명시적
 * no-op이다: 나이트는 애초에 L자가 아니라 canLandAt에서 걸러지지만, 그 외 기물은 canLandAt이
 * 점유를 더 이상 실격 사유로 보지 않으므로 별도 가드 없이는 "자기 자신과 맞교환"을 그대로
 * 통과시켜 버린다.
 * 쿨다운은 기물(ID)에 묶여 있지 칸에 묶여 있지 않으므로, 맞교환 자체는 어느 쪽의 cooldown도
 * 건드리지 않는다 — 플레이어가 직접 움직인 기물만(나이트라면) 폭발을 시도하고, 밀려난 기물은
 * 스스로 선택한 이동이 아니므로 나이트여도 폭발하지 않는다. 버프는 스왑이 끝난 뒤 정확히 한 번만
 * 재계산한다(양쪽 칸이 모두 바뀌었으므로 재계산 전에 두 square 갱신이 끝나 있어야 한다).
 */
export function moveOnBoard(
  state: GameState, pieceId: string, file: number, rank: number, events: GameEvent[],
  allowMerge = false,
): boolean {
  const p = findPiece(state, pieceId);
  if (!p || p.square === null || !interactable(state)) return false;
  if (sameSquare(p.square, { file, rank })) return false;   // 제자리 이동 = no-op
  const landing = resolveLanding(state, p, { file, rank }, allowMerge);
  if (landing.kind === 'reject' || landing.kind === 'self') return false;
  if (landing.kind === 'merge') {
    // 합성 후 폭발은 생존자(점유자) 기준으로 정확히 1회다. 흡수된 쪽은 폭발하지 않는데, 이는
    // "플레이어가 직접 움직인 기물만 폭발한다"는 맞교환 규칙과 같은 근거다 — 다만 합성에서는
    // 움직인 쪽이 사라지므로 그 화력이 생존자에게 넘어간다(티어가 갱신된 뒤의 데미지로 터진다).
    commitMerge(state, p, landing.occupant, events);
    if (landing.occupant.type === 'knight') tryKnightBlast(state, landing.occupant, events);
    return true;
  }
  const from = p.square;
  const occupant = landing.kind === 'swap' ? landing.occupant : null;
  p.square = { file, rank };
  if (occupant) occupant.square = from;
  recalcQueenBuffs(state);
  if (p.type === 'knight') tryKnightBlast(state, p, events);
  return true;
}

/** 보드 → 슬롯 회수. 쿨다운 유지 (스펙 5.1/7.2) */
export function recallToSlot(state: GameState, pieceId: string, preferredSlot?: number): boolean {
  const p = findPiece(state, pieceId);
  if (!p || p.square === null || !interactable(state)) return false;
  const occupied = new Set(
    state.pieces.filter(x => x.slotIndex !== null).map(x => x.slotIndex as number),
  );
  const target = preferredSlot !== undefined
    && preferredSlot >= 0 && preferredSlot < SLOT_CAPACITY
    && !occupied.has(preferredSlot)
    ? preferredSlot
    : freeSlotIndex(state);
  if (target === null) return false;
  p.square = null;
  p.slotIndex = target;
  recalcQueenBuffs(state);
  return true;
}

/** 슬롯 내 재정렬 — 빈칸 이동 또는 점유자와 맞교환 (스펙 7.2/7.5) */
export function reorderSlots(state: GameState, pieceId: string, targetIndex: number): boolean {
  const p = findPiece(state, pieceId);
  if (!p || p.slotIndex === null || !interactable(state)) return false;
  if (targetIndex < 0 || targetIndex >= SLOT_CAPACITY) return false;
  const occupant = state.pieces.find(x => x.slotIndex === targetIndex);
  if (occupant) occupant.slotIndex = p.slotIndex;
  p.slotIndex = targetIndex;
  return true;
}
