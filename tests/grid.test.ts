import { describe, expect, it } from 'vitest';
import {
  BOARD_H, BOARD_W, enemySquare, fileCenterX, fileLabel,
  inBoard, rankToTopY, sameSquare, yToRank,
} from '../src/core/grid';

describe('grid', () => {
  it('보드 크기는 8×80 = 640px', () => {
    expect(BOARD_W).toBe(640);
    expect(BOARD_H).toBe(640);
  });
  it('rank 8이 최상단(y=0), rank 1이 최하단(y=560)', () => {
    expect(rankToTopY(8)).toBe(0);
    expect(rankToTopY(1)).toBe(560);
  });
  it('yToRank: 픽셀 y → 랭크 (경계 포함)', () => {
    expect(yToRank(0)).toBe(8);
    expect(yToRank(79.9)).toBe(8);
    expect(yToRank(80)).toBe(7);
    expect(yToRank(639)).toBe(1);
    expect(yToRank(9999)).toBe(1);   // 클램프
    expect(yToRank(-5)).toBe(8);     // 클램프
  });
  it('fileCenterX', () => {
    expect(fileCenterX(0)).toBe(40);
    expect(fileCenterX(7)).toBe(600);
  });
  it('inBoard 경계', () => {
    expect(inBoard(0, 1)).toBe(true);
    expect(inBoard(7, 8)).toBe(true);
    expect(inBoard(-1, 4)).toBe(false);
    expect(inBoard(8, 4)).toBe(false);
    expect(inBoard(3, 0)).toBe(false);
    expect(inBoard(3, 9)).toBe(false);
  });
  it('enemySquare는 중심 좌표 기준 (스펙 2.2)', () => {
    expect(enemySquare({ file: 2, y: 120 })).toEqual({ file: 2, rank: 7 });
  });
  it('sameSquare / fileLabel', () => {
    expect(sameSquare({ file: 1, rank: 2 }, { file: 1, rank: 2 })).toBe(true);
    expect(sameSquare({ file: 1, rank: 2 }, { file: 2, rank: 1 })).toBe(false);
    expect(fileLabel(0)).toBe('a');
    expect(fileLabel(7)).toBe('h');
  });
});
