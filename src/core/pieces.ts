import { CONFIG } from '../config';
import type { GameEvent, GameState, Piece, PieceType, Square } from '../types';
import { recalcQueenBuffs } from './buff';
import { freeSlotIndex, SLOT_CAPACITY } from './economy';
import { inBoard, sameSquare } from './grid';
import { fusionResult } from './fusion';

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

/*
 * ⚠️ 여기 있던 isKnightMove()가 v1.11에서 삭제됐다 — 나이트도 다른 기물과 똑같이 아무 칸으로나
 * 재배치된다(사용자 결정). L자를 판정할 이유가 이동 규칙에는 더 이상 없다. L자 자체는
 * patterns.ts의 slowSquares(감속 범위)에 살아 있다.
 */

export type RejectReason =
  | 'outOfBounds'        // 보드 밖 또는 8랭크(스폰 구역)
  // ⚠️ 나이트 전용 거부 사유 둘이 연달아 사라졌다.
  //   v1.10 'knightCooldown' — "미리보기가 약속한 폭발을 실제로도 터뜨리기 위해" 쿨다운 중
  //     이동을 막던 장치. 폭발이 없어져 막을 대상이 사라졌다.
  //   v1.11 'knightPattern'  — L자 행마가 아니면 거부하던 사유. 나이트도 다른 기물과 똑같이
  //     아무 칸으로나 재배치된다(사용자 결정).
  // 그 결과 **보드 위 기물의 이동에는 남은 제약이 하나도 없다** — 8랭크 금지(outOfBounds)만
  // 남았고 그것은 모든 기물에 공통이다.
  | 'typeMismatch'       // 트레이 기물 → 다른 종류가 점유 (밀려날 상대가 없어 맞교환 불가)
  | 'tierMismatch'       // 같은 종류지만 티어가 다르다 (같은 티어끼리만 합쳐진다)
  | 'tierOverflow';      // 같은 종류·같은 티어지만 이미 상한 단계다

/**
 * 착지 판정 결과. kind로 좁히면 occupant/resultTier가 자동으로 non-null이 된다.
 * 'self'는 제자리(자기 자신의 칸) — 거부는 아니지만 아무 일도 일어나지 않는 no-op이다.
 */
export type Landing =
  | { kind: 'place'; occupant: null; resultTier: null }
  // 동종 합성도 resultType을 채운다(= piece.type). 그래야 하류(moveOnBoard/placeFromSlot/
  // highlights)가 이종/동종을 구분할 필요가 아예 없어진다.
  | { kind: 'merge'; occupant: Piece; resultTier: number; resultType: PieceType }
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
 * 게이트 순서가 곧 규칙이다. 합성 분기는 반드시 경계 검사 *뒤*에 온다 — 앞으로 당기면
 * 8랭크(스폰 구역) 금지를 합성 경로가 통째로 우회한다.
 *
 * ⚠️ 예전에는 그 앞에 나이트 전용 게이트 둘(L자 행마·이동 쿨다운)이 더 있었고, 이 문단은
 * "그 셋 뒤에 와야 한다"고 적혀 있었다. 둘 다 사라져(v1.10 쿨다운 → v1.11 L자) **지금 남은
 * 착지 제약은 8랭크 금지 하나뿐이며 그것은 전 기물 공통이다.**
 */
export function resolveLanding(
  state: GameState, piece: Piece, square: Square, allowMerge: boolean,
): Landing {
  if (!inLandableBounds(square)) return reject(null, 'outOfBounds');

  // ⚠️ 여기 있던 보드발 전용 게이트 블록이 통째로 비었다(v1.10 쿨다운 → v1.11 L자). 지금은
  // 출발지가 보드든 트레이든 **같은 규칙**을 탄다 — fromBoard는 아래 맞교환 판정에만 쓰인다.
  const fromBoard = piece.square !== null;

  const occupant = pieceAt(state, square.file, square.rank);
  if (!occupant) return { kind: 'place', occupant: null, resultTier: null };
  if (occupant === piece) return { kind: 'self', occupant, resultTier: null };

  if (allowMerge) {
    // 어느 쪽이든 **같은 티어**여야 한다. 이 제약이 있어야 동종 합성에서 티어가 "흡수한 개수"가
    // 아니라 레벨이 되고, 이종 융합에서도 "T3 재료 둘 → T3 융합물"이라는 등가가 성립한다.
    // 강화된 기물이 약한 기물에 겹쳐 조용히 잡아먹히는 사고도 규칙 차원에서 막힌다.
    const sameType = occupant.type === piece.type;
    const fused = sameType ? null : fusionResult(piece.type, occupant.type);

    if (sameType || fused) {
      if (occupant.tier !== piece.tier) {
        return fromBoard
          ? { kind: 'swap', occupant, resultTier: null }
          : reject(occupant, 'tierMismatch');
      }
      // ⚠️ 여기 있던 점유자 쿨다운 게이트도 사라졌다(v1.10). 그 게이트가 막던 것은 "합성은
      // 성사됐는데 직후 폭발이 조용히 삼켜지는" 경우인데, 합성 직후에 일어나는 일이 이제
      // 없다. 감속은 합성 결과 기물이 그 자리에 서 있다는 사실만으로 다음 틱에 저절로 걸린다.
      // 동종은 티어가 한 단계 오르고, 이종은 **티어가 그대로**다. 융합은 등급 상승이 아니라
      // 정체성 변경이고, 능력치를 재료 합으로 둔 것이 그 등가의 근거다 — 티어까지 올리면
      // 500G 재료로 1,000G짜리가 나와 골드 중립성이 무너진다.
      const resultType = fused ?? piece.type;
      const resultTier = sameType ? piece.tier + 1 : piece.tier;
      if (resultTier > CONFIG.merge.maxTier[resultType]) return reject(occupant, 'tierOverflow');
      return { kind: 'merge', occupant, resultTier, resultType };
    }
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
function commitMerge(
  state: GameState, absorbed: Piece, survivor: Piece,
  resultTier: number, resultType: PieceType, events: GameEvent[],
): void {
  // 쿨다운은 **둘 중 큰 값**을 쓴다. 예전에는 생존자 것을 그대로 뒀는데, 어느 쪽이 생존자가
  // 될지는 플레이어가 어느 쪽을 집느냐로 정해지므로 같은 조합이 드래그 방향에 따라 다른
  // 쿨다운을 가졌다 — 쿨다운 2.9초 남은 룩을 갓 산 룩 위로 끌면 0이 되어 "합성 = 쿨다운
  // 리셋"이 성립했다. max면 방향과 무관해지고 스펙 5.1의 안티파밍이 비로소 온전해진다.
  survivor.cooldown = Math.max(survivor.cooldown, absorbed.cooldown);
  survivor.tier = resultTier;
  survivor.type = resultType;   // Piece.type이 가변이 되는 유일한 지점
  state.pieces.splice(state.pieces.indexOf(absorbed), 1);
  // 흡수된 쪽이 퀸이 아니어도 퀸 라인 위였을 수 있고, 결과가 아마존이면 **새 버퍼가 생긴다**.
  recalcQueenBuffs(state);
  events.push({
    kind: 'merged', square: { ...survivor.square! }, pieceType: survivor.type, tier: survivor.tier,
  });
}

function interactable(state: GameState): boolean {
  return !state.paused && (state.phase === 'prepare' || state.phase === 'wave');
}

/*
 * ⚠️ 여기 있던 tryKnightBlast가 v1.10에서 삭제됐다 (사용자 결정: 폭발 → 감속).
 *
 * 배치·이동·합성 직후 3×3에 피해를 주고 쿨다운을 재시작하던 함수인데, 감속에는 대응하는
 * "순간"이 없다 — 기물이 서 있기만 하면 core/slow.ts가 매 틱 알아서 판정한다. 그래서 아래
 * placeFromSlot·moveOnBoard에서 조작 직후 능력을 발동하는 호출이 통째로 사라졌고, 이 파일은
 * 다시 **조작 규칙만** 다루는 파일이 됐다(피해를 주지 않으므로 combat.ts 의존도 없어졌다).
 */

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
    commitMerge(state, p, landing.occupant, landing.resultTier, landing.resultType, events);
    return true;
  }
  p.square = { file, rank };
  p.slotIndex = null;
  recalcQueenBuffs(state);
  return true;
}

/**
 * 보드 → 보드. **어느 칸으로든, 웨이브 중에도 무제한이다** — 기물 종류에 따른 이동 제약이
 * v1.11에 하나도 남지 않았다(8랭크 금지만 공통으로 걸린다).
 * 목적지가 점유돼 있으면 실격이 아니라 맞교환이다 (게임 규칙 변경, 사용자 승인) — 두 기물의
 * square를 서로 맞바꾼다.
 *
 * ⚠️ 제자리(자기 자신의 현재 칸)로의 이동을 막는 것은 이제 **아래 sameSquare 가드 하나뿐이다.**
 * 예전에는 나이트가 L자 게이트에도 함께 걸려 이중으로 막혔지만 그 겹이 벗겨졌다 — canLandAt은
 * 점유를 실격 사유로 보지 않으므로(맞교환 대상이므로) 이 가드를 지우면 모든 기물이
 * "자기 자신과 맞교환"을 그대로 통과시킨다.
 * 쿨다운은 기물(ID)에 묶여 있지 칸에 묶여 있지 않으므로, 맞교환 자체는 어느 쪽의 cooldown도
 * 건드리지 않는다. 버프는 스왑이 끝난 뒤 정확히 한 번만 재계산한다(양쪽 칸이 모두 바뀌었으므로
 * 재계산 전에 두 square 갱신이 끝나 있어야 한다).
 *
 * ⚠️ v1.10 이전에는 "플레이어가 직접 움직인 기물만 폭발하고 밀려난 기물은 폭발하지 않는다"는
 * 규칙이 여기 있었다. 감속에는 그 구분이 없다 — 밀려난 기물도 새 칸에서 그냥 감속을 건다.
 * 능력이 "누가 움직였는가"가 아니라 "지금 어디 서 있는가"에만 의존하기 때문이고, 그래서
 * 이 함수는 더 이상 이동 자체 외에 아무 부수효과도 갖지 않는다.
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
    // 합성 직후에 발동할 능력이 이제 없다(v1.10). 결과 기물의 감속 범위는 다음 틱의
    // updateSlowAura가 새 종류·새 칸 기준으로 알아서 잡는다 — 여기서 할 일은 없다.
    commitMerge(state, p, landing.occupant, landing.resultTier, landing.resultType, events);
    return true;
  }
  const from = p.square;
  const occupant = landing.kind === 'swap' ? landing.occupant : null;
  p.square = { file, rank };
  if (occupant) occupant.square = from;
  recalcQueenBuffs(state);
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
