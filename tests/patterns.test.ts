import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { fileLabel, squareKey } from '../src/core/grid';
import {
  attackTargets, bishopTargets, knightMoves, pawnTargets,
  queenLines, rookTargets, slowSquares, slowTargets,
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
  // 이 자리에 있던 "나이트 폭발: 중앙 9칸, 구석 4칸"의 후신이다. 능력이 3×3 폭발에서 L자
  // 감속으로 바뀌었으므로(v1.10) 모양이 통째로 달라졌다 — 특히 **자기 칸이 빠진다.**
  // 폭발은 발밑을 포함하는 블록이었지만 감속은 행마 오프셋이라 중심에 구멍이 있고,
  // 그 구멍은 "나이트 바로 위를 지나는 적은 안 느려진다"는 플레이 상의 사실이다.
  it('감속 오라: d4에서 L자 8칸, 자기 칸 제외, 구석(a1)은 2칸 (v1.10)', () => {
    const t = slowSquares({ file: 3, rank: 4 });
    expect(t).toHaveLength(8);
    expect(t).toEqual(expect.arrayContaining([
      { file: 4, rank: 6 }, { file: 5, rank: 5 }, { file: 5, rank: 3 }, { file: 4, rank: 2 },
      { file: 2, rank: 2 }, { file: 1, rank: 3 }, { file: 1, rank: 5 }, { file: 2, rank: 6 },
    ]));
    expect(t).not.toContainEqual({ file: 3, rank: 4 });   // 발밑은 감속 범위가 아니다
    expect(slowSquares({ file: 0, rank: 1 })).toHaveLength(2);   // a1: 보드 밖 6칸이 잘린다
  });
  /**
   * ★ 이 스위트의 핵심 불변식. slowSquares와 knightMoves는 오프셋 표를 공유하지만 **필터가
   * 다른 별개의 함수**다(patterns.ts 주석): 행마는 착지 후보라 스폰 랭크를 빼고, 감속은 능력
   * 범위라 포함한다. 한 칸만 짚어 보면 둘을 다시 합치는 리팩터링이 통과해 버리므로 전 보드를
   * 전수 순회한다 — 적은 스폰 랭크에서 내려오기 때문에, 잘못 합치는 순간 판에 들어오는 바로
   * 그 지점에 감속 구멍이 생긴다.
   */
  it('감속 범위 ⊇ 행마 도착지이고, 차집합은 전부 스폰 랭크다 — 전 보드 전수 (v1.10)', () => {
    const spawnRank = CONFIG.board.ranks;
    let extraTotal = 0;
    for (let file = 0; file < CONFIG.board.files; file++) {
      for (let rank = 1; rank <= CONFIG.board.ranks; rank++) {
        const from = { file, rank };
        const where = `${fileLabel(file)}${rank}`;
        const slow = slowSquares(from);
        const slowKeys = slow.map(squareKey);
        const moves = knightMoves(from);
        // ① 부분집합: 갈 수 있는 칸은 예외 없이 감속도 된다
        for (const m of moves) expect(slowKeys, where).toContain(squareKey(m));
        // ② 차집합의 정체: 두 함수가 갈리는 축은 스폰 랭크 **하나뿐**이어야 한다.
        //    다른 랭크가 섞여 나오면 오프셋 표가 갈라진 것이다.
        const moveKeys = new Set(moves.map(squareKey));
        const extra = slow.filter(s => !moveKeys.has(squareKey(s)));
        for (const s of extra) expect(s.rank, where).toBe(spawnRank);
        extraTotal += extra.length;
      }
    }
    // ③ 공허 방지. ①②는 두 집합이 항상 같아도 참이므로, 차집합이 실제로 비어 있지 않다는
    //    것까지 못박아야 "감속은 스폰 랭크를 포함한다"가 검사된 셈이 된다.
    expect(extraTotal).toBeGreaterThan(0);
  });
  it('감속 오라: 6랭크 나이트는 스폰 랭크 2칸을 덮지만 그리로 이동하지는 못한다 (v1.10)', () => {
    const from = { file: 3, rank: CONFIG.board.ranks - 2 };   // d6
    expect(slowSquares(from)).toHaveLength(8);
    expect(slowSquares(from)).toEqual(expect.arrayContaining([
      { file: 4, rank: CONFIG.board.ranks }, { file: 2, rank: CONFIG.board.ranks },
    ]));
    expect(knightMoves(from)).toHaveLength(6);
  });
  it('slowTargets: 감속 능력이 있는 기물만 범위를 갖는다 (v1.10)', () => {
    const sq = { file: 3, rank: 4 };
    expect(slowTargets('knight', sq)).toEqual(slowSquares(sq));
    expect(slowTargets('amazon', sq)).toEqual(slowSquares(sq));   // 융합물도 겸업한다
    expect(slowTargets('rook', sq)).toEqual([]);
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
  // 나이트가 빈 배열인 것이 이 테스트의 요점이다. v1.10 이전에는 'none' 폴백이 폭발 범위(3×3)를
  // 사거리인 척 돌려줬고, 그 값이 주황색 사거리 그림으로 새어 나갔다. 나이트는 이제 피해를
  // 전혀 주지 않으므로 사거리도 없어야 하고, 범위가 필요한 호출부는 slowTargets를 부른다.
  it('attackTargets: 공격 수단이 없는 기물(퀸·나이트)은 빈 배열, 나머지는 각 패턴 위임', () => {
    const sq = { file: 3, rank: 4 };
    expect(attackTargets('queen', sq)).toEqual([]);
    expect(attackTargets('knight', sq)).toEqual([]);
    expect(attackTargets('amazon', sq)).toEqual([]);
    expect(attackTargets('pawn', sq)).toHaveLength(2);
    // 감속 범위가 사거리로 새지 않는지 — 두 축이 다시 얽히면 여기서 먼저 걸린다
    expect(attackTargets('knight', sq)).not.toEqual(slowTargets('knight', sq));
  });
  it('나이트 행마: d4에서 8칸, 8랭크 도착지는 제외 (스펙 5.3)', () => {
    expect(knightMoves({ file: 3, rank: 4 })).toHaveLength(8);
    const fromD7 = knightMoves({ file: 3, rank: 7 });
    expect(fromD7).toHaveLength(4);  // (5,8)(1,8)(4,9)(2,9) 등 제외 후 {f6,b6,e5,c5}
    for (const m of fromD7) expect(m.rank).toBeLessThanOrEqual(7);
  });
});
