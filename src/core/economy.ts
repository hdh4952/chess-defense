import { CONFIG } from '../config';
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
    cooldown: 0, queenBuffCount: 0,
  };
  state.pieces.push(piece);
  return piece;
}

export function sellPrice(type: PieceType): number {
  return CONFIG.pieces[type].cost * CONFIG.economy.sellRatio;
}

/** 보드/슬롯 어디의 기물이든 판매. 확인창 없음 (스펙 7.3) */
export function sellPiece(state: GameState, pieceId: string): boolean {
  if (state.paused || state.phase === 'victory' || state.phase === 'defeat') return false;
  const i = state.pieces.findIndex(p => p.id === pieceId);
  if (i < 0) return false;
  state.gold += sellPrice(state.pieces[i].type);
  state.pieces.splice(i, 1);
  recalcQueenBuffs(state);   // 퀸/버프 대상 판매 대응 (스펙 10.5)
  return true;
}
