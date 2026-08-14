import { CONFIG } from '../config';
import type { GameEvent, GameState, Piece, Square } from '../types';
import { recalcQueenBuffs } from './buff';
import { applyAttack, pieceDamage } from './combat';
import { freeSlotIndex, SLOT_CAPACITY } from './economy';
import { inBoard } from './grid';
import { knightBlastTargets } from './patterns';

export function findPiece(state: GameState, pieceId: string): Piece | undefined {
  return state.pieces.find(p => p.id === pieceId);
}

export function pieceAt(state: GameState, file: number, rank: number): Piece | undefined {
  return state.pieces.find(p => p.square?.file === file && p.square?.rank === rank);
}

/** 배치 가능: 1~7랭크(8랭크 = 스폰 구역 불가) + 빈 칸 (스펙 2.1) */
export function canPlaceAt(state: GameState, file: number, rank: number): boolean {
  return inBoard(file, rank) && rank <= CONFIG.board.ranks - 1 && !pieceAt(state, file, rank);
}

export function isKnightMove(a: Square, b: Square): boolean {
  const df = Math.abs(a.file - b.file);
  const dr = Math.abs(a.rank - b.rank);
  return (df === 1 && dr === 2) || (df === 2 && dr === 1);
}

/**
 * 착지 가능 판정 — canPlaceAt(범위 내 1~7랭크 + 빈 칸) 위에 "이미 보드 위인 나이트"에게만 걸리는
 * L자 행마·이동 쿨다운 게이트를 얹은 단일 판정 (검토 Item 1). moveOnBoard/placeFromSlot(실제 규칙)과
 * highlights.ts의 buildHighlights(미리보기)가 반드시 이 함수 하나만 호출하게 해, 미리보기가
 * 실제로는 거부될 이동/배치/폭발을 약속하는 일이 구조적으로 불가능해진다.
 * 슬롯에서 배치하는 나이트(piece.square === null)에는 L자/쿨다운을 적용하지 않는다 — 배치는
 * 쿨다운 중에도 항상 허용되고(스펙 5.1), 다만 그 자리에서 폭발하지 않을 뿐이다.
 */
export function canLandAt(state: GameState, piece: Piece, square: Square): boolean {
  if (!canPlaceAt(state, square.file, square.rank)) return false;
  if (piece.type === 'knight' && piece.square !== null) {
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

/** 보드 → 보드. 웨이브 중에도 무제한 (나이트만 L자 + 쿨다운, 스펙 5.1/5.3) */
export function moveOnBoard(
  state: GameState, pieceId: string, file: number, rank: number, events: GameEvent[],
): boolean {
  const p = findPiece(state, pieceId);
  if (!p || p.square === null || !interactable(state)) return false;
  if (!canLandAt(state, p, { file, rank })) return false;
  p.square = { file, rank };
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
