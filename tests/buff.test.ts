import { describe, expect, it } from 'vitest';
import { recalcQueenBuffs } from '../src/core/buff';
import { createInitialState } from '../src/core/state';
import type { Piece, PieceType, Square } from '../src/types';

let seq = 0;
function piece(type: PieceType, square: Square | null, slotIndex: number | null = null): Piece {
  return { id: `p${seq++}`, type, square, slotIndex, cooldown: 0, queenBuffCount: 0 };
}

describe('recalcQueenBuffs (스펙 5.6)', () => {
  it('퀸의 8방향 직선 위 기물이 버프를 받는다', () => {
    const s = createInitialState();
    const rook = piece('rook', { file: 3, rank: 5 });    // 퀸 d1과 같은 파일
    const bishop = piece('bishop', { file: 4, rank: 2 }); // 퀸 d1의 대각선
    const knight = piece('knight', { file: 0, rank: 3 }); // 라인 밖
    s.pieces.push(piece('queen', { file: 3, rank: 1 }), rook, bishop, knight);
    recalcQueenBuffs(s);
    expect(rook.queenBuffCount).toBe(1);
    expect(bishop.queenBuffCount).toBe(1);
    expect(knight.queenBuffCount).toBe(0);
  });
  it('퀸 2개가 겹치면 +2 (×3 배율)', () => {
    const s = createInitialState();
    const rook = piece('rook', { file: 3, rank: 4 });
    s.pieces.push(
      piece('queen', { file: 3, rank: 1 }),  // 같은 파일
      piece('queen', { file: 0, rank: 4 }),  // 같은 랭크
      rook,
    );
    recalcQueenBuffs(s);
    expect(rook.queenBuffCount).toBe(2);
  });
  it('다른 기물이 사이에 있어도 차단되지 않는다 (스펙 5.6)', () => {
    const s = createInitialState();
    const far = piece('rook', { file: 3, rank: 7 });
    s.pieces.push(
      piece('queen', { file: 3, rank: 1 }),
      piece('pawn', { file: 3, rank: 4 }),   // 경로 중간
      far,
    );
    recalcQueenBuffs(s);
    expect(far.queenBuffCount).toBe(1);
  });
  it('재계산 시 이전 값은 리셋되고, 슬롯 기물은 항상 0', () => {
    const s = createInitialState();
    const rook = piece('rook', { file: 3, rank: 4 });
    const slotted = piece('bishop', null, 0);
    slotted.queenBuffCount = 3; // 이전 쓰레기값
    const queen = piece('queen', { file: 3, rank: 1 });
    s.pieces.push(queen, rook, slotted);
    recalcQueenBuffs(s);
    expect(rook.queenBuffCount).toBe(1);
    expect(slotted.queenBuffCount).toBe(0);
    queen.square = null; queen.slotIndex = 1;  // 퀸 회수
    recalcQueenBuffs(s);
    expect(rook.queenBuffCount).toBe(0);
  });
});
