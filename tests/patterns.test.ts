import { describe, expect, it } from 'vitest';
import {
  attackTargets, bishopTargets, knightBlastTargets, knightMoves,
  pawnTargets, queenLines, rookTargets,
} from '../src/core/patterns';

// d4 = {file:3, rank:4}
describe('patterns', () => {
  it('폰: 전방 대각선 2칸, 가장자리에서는 1칸 (스펙 5.2)', () => {
    expect(pawnTargets({ file: 3, rank: 4 })).toEqual(
      expect.arrayContaining([{ file: 2, rank: 5 }, { file: 4, rank: 5 }]),
    );
    expect(pawnTargets({ file: 3, rank: 4 })).toHaveLength(2);
    expect(pawnTargets({ file: 0, rank: 4 })).toEqual([{ file: 1, rank: 5 }]); // a파일
    expect(pawnTargets({ file: 3, rank: 8 })).toHaveLength(0);                 // 9랭크 없음
  });
  it('나이트 폭발: 중앙 9칸, 구석(a1) 4칸 (스펙 5.3)', () => {
    expect(knightBlastTargets({ file: 3, rank: 4 })).toHaveLength(9);
    expect(knightBlastTargets({ file: 0, rank: 1 })).toHaveLength(4);
  });
  it('비숍: d4에서 자신 포함 14칸, 관통 (스펙 5.4)', () => {
    const t = bishopTargets({ file: 3, rank: 4 });
    expect(t).toHaveLength(14);
    expect(t).toContainEqual({ file: 3, rank: 4 });  // 자신 칸
    expect(t).toContainEqual({ file: 7, rank: 8 });  // h8까지
    expect(t).toContainEqual({ file: 0, rank: 1 });  // a1까지
  });
  it('룩: 자신 포함 15칸 (7+7+1)', () => {
    const t = rookTargets({ file: 3, rank: 4 });
    expect(t).toHaveLength(15);
    expect(t).toContainEqual({ file: 3, rank: 8 });
    expect(t).toContainEqual({ file: 0, rank: 4 });
  });
  it('퀸 라인: d4에서 자신 포함 28칸 (14+13+1)', () => {
    expect(queenLines({ file: 3, rank: 4 })).toHaveLength(28);
  });
  it('attackTargets: 퀸은 빈 배열, 나머지는 각 패턴 위임', () => {
    expect(attackTargets('queen', { file: 3, rank: 4 })).toEqual([]);
    expect(attackTargets('pawn', { file: 3, rank: 4 })).toHaveLength(2);
    expect(attackTargets('knight', { file: 3, rank: 4 })).toHaveLength(9);
  });
  it('나이트 행마: d4에서 8칸, 8랭크 도착지는 제외 (스펙 5.3)', () => {
    expect(knightMoves({ file: 3, rank: 4 })).toHaveLength(8);
    const fromD7 = knightMoves({ file: 3, rank: 7 });
    expect(fromD7).toHaveLength(4);  // (5,8)(1,8)(4,9)(2,9) 등 제외 후 {f6,b6,e5,c5}
    for (const m of fromD7) expect(m.rank).toBeLessThanOrEqual(7);
  });
});
