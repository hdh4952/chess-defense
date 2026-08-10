import { beforeEach, describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { recalcQueenBuffs } from '../src/core/buff';
import {
  buyPiece, canBuy, freeSlotIndex, resetPieceSeq, sellPiece, sellPrice, SLOT_CAPACITY,
} from '../src/core/economy';
import { createInitialState } from '../src/core/state';

beforeEach(() => resetPieceSeq());

describe('구매 (스펙 6/7.2/7.4)', () => {
  it('폰 구매: 골드 300→200, 빈 슬롯 0번에 들어간다', () => {
    const s = createInitialState();
    const p = buyPiece(s, 'pawn')!;
    expect(s.gold).toBe(200);
    expect(p.type).toBe('pawn');
    expect(p.square).toBeNull();
    expect(p.slotIndex).toBe(0);
    expect(p.cooldown).toBe(0);
    expect(s.pieces).toHaveLength(1);
  });
  it('골드 부족 시 구매 불가', () => {
    const s = createInitialState();
    expect(canBuy(s, 'queen')).toBe(false);   // 900 > 300
    expect(buyPiece(s, 'queen')).toBeNull();
    expect(s.gold).toBe(300);
  });
  it('슬롯 16칸 만석이면 구매 불가 (스펙 7.2)', () => {
    const s = createInitialState();
    s.gold = 100000;
    for (let i = 0; i < SLOT_CAPACITY; i++) expect(buyPiece(s, 'pawn')).not.toBeNull();
    expect(canBuy(s, 'pawn')).toBe(false);
    const goldBeforeFailed = s.gold;
    expect(buyPiece(s, 'pawn')).toBeNull();
    // Atomicity: refusal mutated nothing
    expect(s.gold).toBe(goldBeforeFailed);
    expect(s.pieces).toHaveLength(SLOT_CAPACITY);
  });
  it('일시정지·게임 종료 중 구매 불가 (스펙 7.4)', () => {
    const s = createInitialState();
    s.paused = true;
    expect(canBuy(s, 'pawn')).toBe(false);
    s.paused = false;
    s.phase = 'defeat';
    expect(canBuy(s, 'pawn')).toBe(false);
    s.phase = 'victory';
    expect(canBuy(s, 'pawn')).toBe(false);
  });
  it('canBuy 양수 경로: 충분한 금, 빈 슬롯, 미일시정지 상태에서 참 (웨이브 중 구매 열림)', () => {
    const s = createInitialState();
    s.gold = CONFIG.pieces.pawn.cost;
    s.paused = false;
    s.phase = 'wave';  // 웨이브 중 구매 활성화 (스펙 7.4)
    expect(canBuy(s, 'pawn')).toBe(true);
  });
  it('빈 슬롯은 낮은 번호부터 재사용', () => {
    const s = createInitialState();
    s.gold = 10000;
    const a = buyPiece(s, 'pawn')!;
    buyPiece(s, 'pawn');
    sellPiece(s, a.id);                        // 0번 비움
    expect(freeSlotIndex(s)).toBe(0);
  });
});

describe('판매 (스펙 6/7.3)', () => {
  it('환급 50%: 룩 500 → 250', () => {
    expect(sellPrice('rook')).toBe(250);
    const s = createInitialState();
    s.gold = 500;
    const r = buyPiece(s, 'rook')!;
    expect(s.gold).toBe(0);
    expect(sellPiece(s, r.id)).toBe(true);
    expect(s.gold).toBe(250);
    expect(s.pieces).toHaveLength(0);
  });
  it('보드 위 기물도 판매 가능, 퀸 판매 시 버프 즉시 소멸', () => {
    const s = createInitialState();
    s.gold = 2000;
    const q = buyPiece(s, 'queen')!;
    const r = buyPiece(s, 'rook')!;
    q.square = { file: 3, rank: 1 }; q.slotIndex = null;
    r.square = { file: 3, rank: 5 }; r.slotIndex = null;
    recalcQueenBuffs(s);
    expect(r.queenBuffCount).toBe(1);
    sellPiece(s, q.id);
    expect(r.queenBuffCount).toBe(0);
  });
  it('일시정지 중 판매 불가 (스펙 7.7)', () => {
    const s = createInitialState();
    const p = buyPiece(s, 'pawn')!;
    s.paused = true;
    expect(sellPiece(s, p.id)).toBe(false);
    expect(s.pieces).toHaveLength(1);
  });
  it('게임 종료 (victory/defeat) 중 판매 불가', () => {
    const s = createInitialState();
    const p = buyPiece(s, 'pawn')!;
    s.phase = 'victory';
    expect(sellPiece(s, p.id)).toBe(false);
    expect(s.pieces).toHaveLength(1);
  });
});
