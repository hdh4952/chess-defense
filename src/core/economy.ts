import { CONFIG, TRAITS, tierMultiplier } from '../config';
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
  return TRAITS[type].purchasable
    && !state.paused
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
/**
 * 기물 **지급** — 골드를 받지 않고 빈 슬롯에 T1을 만든다. 구매와 공유하는 것은 pieceSeq와
 * freeSlotIndex뿐이고, canBuy의 게이트(페이즈·골드·구매 가능 여부)는 전혀 타지 않는다.
 * pieceSeq가 이 모듈의 private이라 반드시 여기 있어야 한다.
 *
 * 트레이가 꽉 차면 null. 그 처리는 호출부의 몫이다 — 조용히 버리면 무음 실패가 하나 더 는다.
 */
export function grantPiece(state: GameState, type: PieceType): Piece | null {
  const slot = freeSlotIndex(state);
  if (slot === null) return null;
  const piece: Piece = {
    id: `p-${pieceSeq++}`, type, square: null, slotIndex: slot,
    cooldown: 0, queenBuffCount: 0, tier: 1,
  };
  state.pieces.push(piece);
  return piece;
}

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
