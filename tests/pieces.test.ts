import { describe, expect, it } from 'vitest';
import { updateCombat } from '../src/core/combat';
import {
  canPlaceAt, isKnightMove, moveOnBoard, pieceAt, placeFromSlot, recallToSlot, reorderSlots,
} from '../src/core/pieces';
import type { GameEvent, GameState, Piece, PieceType } from '../src/types';
import { boardPiece, enemyAt, waveState } from './helpers';

let seq = 0;
function slotPiece(s: GameState, type: PieceType, slotIndex: number): Piece {
  const p: Piece = { id: `sp-${seq++}`, type, square: null, slotIndex, cooldown: 0, queenBuffCount: 0 };
  s.pieces.push(p);
  return p;
}

describe('배치 규칙 (스펙 2.1)', () => {
  it('1~7랭크 빈 칸만 가능, 8랭크·점유 칸 불가', () => {
    const s = waveState();
    s.pieces.push(boardPiece('rook', 3, 4));
    expect(canPlaceAt(s, 0, 1)).toBe(true);
    expect(canPlaceAt(s, 0, 7)).toBe(true);
    expect(canPlaceAt(s, 0, 8)).toBe(false);   // 스폰 구역
    expect(canPlaceAt(s, 3, 4)).toBe(false);   // 점유
    expect(canPlaceAt(s, -1, 3)).toBe(false);
  });
  it('placeFromSlot: 성공 시 슬롯에서 빠지고 보드에 놓인다', () => {
    const s = waveState();
    const p = slotPiece(s, 'pawn', 0);
    expect(placeFromSlot(s, p.id, 2, 3, [])).toBe(true);
    expect(p.square).toEqual({ file: 2, rank: 3 });
    expect(p.slotIndex).toBeNull();
    expect(pieceAt(s, 2, 3)).toBe(p);
  });
  it('일시정지 중 배치/이동/회수 불가 (스펙 7.7)', () => {
    const s = waveState();
    const p = slotPiece(s, 'pawn', 0);
    s.paused = true;
    expect(placeFromSlot(s, p.id, 2, 3, [])).toBe(false);
    s.paused = false;
    placeFromSlot(s, p.id, 2, 3, []);
    s.paused = true;
    expect(moveOnBoard(s, p.id, 2, 4, [])).toBe(false);
    expect(recallToSlot(s, p.id)).toBe(false);
  });
});

describe('이동/회수 — 쿨다운 유지 (스펙 5.1/10.5)', () => {
  it('일반 기물은 아무 빈 칸으로나 자유 이동, 쿨다운 유지', () => {
    const s = waveState();
    const r = boardPiece('rook', 0, 1);
    r.cooldown = 1.7;
    s.pieces.push(r);
    expect(moveOnBoard(s, r.id, 7, 7, [])).toBe(true);
    expect(r.square).toEqual({ file: 7, rank: 7 });
    expect(r.cooldown).toBe(1.7);              // 초기화 금지
  });
  it('회수→재배치에도 쿨다운 유지', () => {
    const s = waveState();
    const p = boardPiece('pawn', 3, 4);
    p.cooldown = 0.4;
    s.pieces.push(p);
    expect(recallToSlot(s, p.id)).toBe(true);
    expect(p.square).toBeNull();
    expect(p.slotIndex).toBe(0);
    expect(placeFromSlot(s, p.id, 5, 5, [])).toBe(true);
    expect(p.cooldown).toBe(0.4);
  });
  it('reorderSlots: 빈칸 이동과 맞교환', () => {
    const s = waveState();
    const a = slotPiece(s, 'pawn', 0);
    const b = slotPiece(s, 'rook', 1);
    expect(reorderSlots(s, a.id, 5)).toBe(true);   // 빈칸으로
    expect(a.slotIndex).toBe(5);
    expect(reorderSlots(s, a.id, 1)).toBe(true);   // b와 맞교환
    expect(a.slotIndex).toBe(1);
    expect(b.slotIndex).toBe(5);
  });
});

describe('퀸 버프 트리거 (스펙 10.5)', () => {
  it('배치/이동/회수 시 버프가 재계산된다', () => {
    const s = waveState();
    const q = slotPiece(s, 'queen', 0);
    const r = boardPiece('rook', 3, 5);
    s.pieces.push(r);
    placeFromSlot(s, q.id, 3, 1, []);          // 같은 파일
    expect(r.queenBuffCount).toBe(1);
    moveOnBoard(s, q.id, 4, 1, []);            // 라인 밖으로
    expect(r.queenBuffCount).toBe(0);
    moveOnBoard(s, q.id, 3, 1, []);
    expect(r.queenBuffCount).toBe(1);
    recallToSlot(s, q.id);
    expect(r.queenBuffCount).toBe(0);
  });
});

describe('나이트 (스펙 5.3 + 검토 노트 3)', () => {
  it('isKnightMove: L자만 허용', () => {
    expect(isKnightMove({ file: 3, rank: 4 }, { file: 4, rank: 6 })).toBe(true);
    expect(isKnightMove({ file: 3, rank: 4 }, { file: 5, rank: 5 })).toBe(true);
    expect(isKnightMove({ file: 3, rank: 4 }, { file: 3, rank: 5 })).toBe(false);
    expect(isKnightMove({ file: 3, rank: 4 }, { file: 5, rank: 6 })).toBe(false);
  });
  it('최초 배치: 9칸 폭발 + 쿨다운 3초 시작', () => {
    const s = waveState();
    const n = slotPiece(s, 'knight', 0);
    const e = enemyAt(1, 4, 5);
    s.enemies.push(e);
    const ev: GameEvent[] = [];
    expect(placeFromSlot(s, n.id, 3, 4, ev)).toBe(true);
    expect(e.hp).toBe(7);                       // 3 데미지
    expect(n.cooldown).toBe(3.0);
    expect(ev.some(x => x.kind === 'knightBlast')).toBe(true);
  });
  it('쿨다운 중 보드 이동 불가, L자 아니면 불가, 점유 칸 불가', () => {
    const s = waveState();
    const n = boardPiece('knight', 3, 4);
    n.cooldown = 1.0;
    s.pieces.push(n, boardPiece('pawn', 4, 6));
    expect(moveOnBoard(s, n.id, 5, 5, [])).toBe(false);  // 쿨다운 중
    n.cooldown = 0;
    expect(moveOnBoard(s, n.id, 3, 5, [])).toBe(false);  // L자 아님
    expect(moveOnBoard(s, n.id, 4, 6, [])).toBe(false);  // 점유 칸
    expect(moveOnBoard(s, n.id, 5, 5, [])).toBe(true);   // 정상 L자
    expect(n.cooldown).toBe(3.0);                        // 이동 후 재시작
  });
  it('이동 완료 시 새 위치에서 폭발', () => {
    const s = waveState();
    const n = boardPiece('knight', 3, 4);
    s.pieces.push(n);
    const e = enemyAt(1, 5, 6);
    s.enemies.push(e);
    moveOnBoard(s, n.id, 5, 5, []);
    expect(e.hp).toBe(7);
  });
  it('회수→재배치로 폭발 반복 불가 (쿨다운 우회 차단, 스펙 5.1)', () => {
    const s = waveState();
    const n = slotPiece(s, 'knight', 0);
    const e = enemyAt(1, 4, 5);
    s.enemies.push(e);
    placeFromSlot(s, n.id, 3, 4, []);           // 폭발 1회, 쿨 3초
    expect(e.hp).toBe(7);
    recallToSlot(s, n.id);
    placeFromSlot(s, n.id, 3, 4, []);           // 쿨다운 중 재배치 — 배치는 허용, 폭발 없음
    expect(e.hp).toBe(7);
    expect(n.square).toEqual({ file: 3, rank: 4 });
    updateCombat(s, 3.0, []);                   // 쿨다운 소진
    recallToSlot(s, n.id);
    placeFromSlot(s, n.id, 3, 4, []);           // 쿨 0 → 다시 폭발
    expect(e.hp).toBe(4);
  });
  it('폭발 데미지는 폭발 시점 버프로 계산 (스펙 5.6)', () => {
    const s = waveState();
    s.pieces.push(boardPiece('queen', 0, 4));   // 4랭크 전체 버프
    const n = slotPiece(s, 'knight', 0);
    const e = enemyAt(1, 4, 5);
    s.enemies.push(e);
    placeFromSlot(s, n.id, 3, 4, []);           // 배치 → 버프 재계산 → 폭발
    expect(e.hp).toBe(4);                       // 3 × 2 = 6 데미지
  });
});
