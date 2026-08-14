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

/**
 * 착지 가능 판정 — 단일 판정 함수 (검토 Item 1). moveOnBoard/placeFromSlot(실제 규칙)과
 * highlights.ts의 buildHighlights(미리보기)가 반드시 이 함수 하나만 호출하게 해, 미리보기가
 * 실제로는 거부될 이동/배치/폭발을 약속하는 일이 구조적으로 불가능해진다.
 * 예외 한 가지: moveOnBoard는 제자리(자기 자신의 현재 칸)로의 이동을 이 함수와 무관하게 별도
 * 가드로 no-op 처리한다(자기 자신과의 "맞교환"은 의미가 없으므로) — canLandAt 자체는 그 칸을
 * 거부하지 않으므로, 이 한 가지 케이스에 한해 "canLandAt이 참이면 실제로 이동이 일어난다"는
 * 보장이 깨진다. 미리보기 쪽은 이를 문제 삼지 않는다(제자리 hover는 애초에 "지금 위치"를 보여줄
 * 뿐 이동 약속이 아니므로).
 *
 * 출발지에 따라 의미가 갈라진다 (게임 규칙 변경 — 점유 칸 맞교환 도입, 사용자 승인):
 * - 트레이의 기물(piece.square === null): canPlaceAt과 동일 — 목적지가 반드시 빈 칸이어야 한다.
 *   배치는 쿨다운 중에도 항상 허용되고(스펙 5.1), 다만 그 자리에서 폭발하지 않을 뿐이다. 트레이에는
 *   "밀려날 상대"가 없으므로 점유 칸을 맞교환 대상으로 허용하지 않는다.
 * - 이미 보드 위인 기물: 목적지가 점유돼 있어도 더 이상 실격 사유가 아니다 — moveOnBoard가 두
 *   기물의 자리를 서로 맞바꾼다. 나이트는 여전히 L자 행마와 이동 쿨다운 게이트를 통과해야 한다.
 */
export function canLandAt(state: GameState, piece: Piece, square: Square): boolean {
  if (piece.square === null) return canPlaceAt(state, square.file, square.rank);
  if (!inLandableBounds(square)) return false;
  if (piece.type === 'knight') {
    if (piece.cooldown > 0) return false;
    if (!isKnightMove(piece.square, square)) return false;
  }
  return true;
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
): boolean {
  const p = findPiece(state, pieceId);
  if (!p || p.square !== null || !interactable(state)) return false;
  if (!canLandAt(state, p, { file, rank })) return false;
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
): boolean {
  const p = findPiece(state, pieceId);
  if (!p || p.square === null || !interactable(state)) return false;
  if (sameSquare(p.square, { file, rank })) return false;   // 제자리 이동 = no-op
  if (!canLandAt(state, p, { file, rank })) return false;
  const from = p.square;
  const occupant = pieceAt(state, file, rank);
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
