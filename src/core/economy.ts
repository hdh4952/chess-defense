import { CONFIG, tierMultiplier } from '../config';
import type { GameState, Piece, PieceType } from '../types';
import { recalcQueenBuffs } from './buff';

export const SLOT_CAPACITY = CONFIG.slots.rows * CONFIG.slots.cols;

let pieceSeq = 0;
export function resetPieceSeq(): void { pieceSeq = 0; }

export function freeSlotIndex(state: GameState): number | null {
  const used = new Set(
    state.pieces.filter(p => p.slotIndex !== null).map(p => p.slotIndex as number),
  );
  for (let i = 0; i < SLOT_CAPACITY; i++) if (!used.has(i)) return i;
  return null;
}

export function canBuy(state: GameState, type: PieceType): boolean {
  return !state.paused
    && (state.phase === 'prepare' || state.phase === 'wave')
    && state.gold >= CONFIG.pieces[type].cost
    && freeSlotIndex(state) !== null;
}

export function buyPiece(state: GameState, type: PieceType): Piece | null {
  if (!canBuy(state, type)) return null;
  const slot = freeSlotIndex(state)!;
  state.gold -= CONFIG.pieces[type].cost;
  const piece: Piece = {
    id: `p-${pieceSeq++}`, type, square: null, slotIndex: slot,
    cooldown: 0, queenBuffCount: 0, tier: 1,
  };
  state.pieces.push(piece);
  return piece;
}

/**
 * 판매가 = 원가 × 강화 단계 × 판매 비율. tier를 곱하지 않으면 합성이 보이지 않는 골드 소각이
 * 된다(룩 2기 1,000G를 합쳐서 팔면 250G만 회수) — 게다가 sellPrice는 type만 받으므로 그 손실이
 * 어떤 테스트에도 걸리지 않는다. tier를 곱하면 "합성 후 판매액 = 합성 전 각각의 판매액 합"이
 * 성립해 sellRatio 0.5 경제가 그대로 유지된다.
 */
export function sellPrice(type: PieceType, tier = 1): number {
  return CONFIG.pieces[type].cost * tierMultiplier(tier) * CONFIG.economy.sellRatio;
}

/** 보드/슬롯 어디의 기물이든 판매. 확인창 없음 (스펙 7.3) */
export function sellPiece(state: GameState, pieceId: string): boolean {
  if (state.paused || state.phase === 'victory' || state.phase === 'defeat') return false;
  const i = state.pieces.findIndex(p => p.id === pieceId);
  if (i < 0) return false;
  state.gold += sellPrice(state.pieces[i].type, state.pieces[i].tier);
  state.pieces.splice(i, 1);
  recalcQueenBuffs(state);   // 퀸/버프 대상 판매 대응 (스펙 10.5)
  return true;
}
