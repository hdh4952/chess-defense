import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { fileLabel, squareKey } from '../src/core/grid';
import {
  attackTargets, bishopTargets, pawnTargets,
  queenLines, rookTargets, slowSquares, slowTargets,
} from '../src/core/patterns';
import type { Square } from '../src/types';

/**
 * L자의 정의 그 자체 — |Δfile|과 |Δrank|가 {1,2}.
 *
 * 구현(patterns.ts의 L_OFFSETS 표)과 **독립인 기준**이어야 아래 전수 테스트가 뜻을 갖는다:
 * 표를 그대로 베껴 오면 표가 틀어져도 기대값이 같이 틀어져 아무것도 못 잡는다.
 */
function isLShaped(a: Square, b: Square): boolean {
  const [near, far] = [Math.abs(a.file - b.file), Math.abs(a.rank - b.rank)].sort((x, y) => x - y);
  return near === 1 && far === 2;
}

/** from에서 L자인 보드 안의 칸 전부 — 감속 범위의 기대값(필터가 inBoard 하나뿐일 때의 모습). */
function lSquaresOnBoard(from: Square): Square[] {
  const out: Square[] = [];
  for (let file = 0; file < CONFIG.board.files; file++) {
    for (let rank = 1; rank <= CONFIG.board.ranks; rank++) {
      if (isLShaped(from, { file, rank })) out.push({ file, rank });
    }
  }
  return out;
}

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
  // 폭발은 발밑을 포함하는 블록이었지만 감속은 L자 오프셋이라 중심에 구멍이 있고,
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
   * ★ 이 스위트의 핵심 불변식. v1.11 이전에는 이 자리에서 slowSquares를 knightMoves(L자 행마)와
   * 나란히 놓고 "감속 ⊇ 행마이고 차집합은 전부 스폰 랭크"를 쟀다. 나이트의 L자 이동 제약이
   * 사라지면서(사용자 결정) 비교 대상이 없어졌지만 **지키던 사실은 그대로 남는다**: 감속의
   * 필터는 `inBoard` 하나뿐이고 랭크 상한이 없다. 그래서 대조군을 함수가 아니라 L자의 수학적
   * 정의로 바꿔 다시 썼다 — 이제 기준이 구현 밖에 있으므로 오프셋 표를 잘못 고쳐도 잡힌다.
   *
   * 한 칸만 짚어 보면 랭크 상한이 슬쩍 들어와도 통과하므로 전 보드를 전수 순회한다. 적은 스폰
   * 랭크에서 내려오기 때문에, 상한이 생기는 순간 판에 들어오는 바로 그 지점에 감속 구멍이 생긴다.
   */
  it('감속 범위 = 보드 안의 L자 칸 전부, 랭크 상한 없음 — 전 보드 전수 (v1.11)', () => {
    const spawnRank = CONFIG.board.ranks;
    let spawnHits = 0;
    for (let file = 0; file < CONFIG.board.files; file++) {
      for (let rank = 1; rank <= CONFIG.board.ranks; rank++) {
        const from = { file, rank };
        const where = `${fileLabel(file)}${rank}`;
        const got = slowSquares(from);
        // ① 모양: 빠진 칸(랭크 상한이 끼어들었다)도 남는 칸(보드 밖이 새어 나왔다)도 없다.
        //    자기 칸 제외와 구석에서의 축소도 여기 함께 걸린다 — 둘 다 정의에서 따라 나온다.
        expect(got.map(squareKey).sort(), where).toEqual(lSquaresOnBoard(from).map(squareKey).sort());
        // ② 같은 칸이 두 번 들어오면 "감속이 겹칠 수도 있다"는 그림이 된다. 중첩 금지는
        //    Enemy.slowed가 boolean이라 규칙 쪽에서는 안전하지만, 범위 자체도 집합이어야 한다.
        expect(new Set(got.map(squareKey)).size, where).toBe(got.length);
        spawnHits += got.filter(s => s.rank === spawnRank).length;
      }
    }
    // ③ 공허 방지. ①은 기대값과 구현이 나란히 스폰 랭크를 잃어도 참이 될 수 있으므로,
    //    "감속은 스폰 랭크를 실제로 덮는다"는 것까지 못박아야 검사된 셈이 된다.
    expect(spawnHits).toBeGreaterThan(0);
  });
  /*
   * 이 테스트의 옛 제목은 "…스폰 랭크 2칸을 덮지만 그리로 이동하지는 못한다"였고 마지막 줄이
   * knightMoves(d6).length === 6이었다. v1.11에서 뒷절이 통째로 사라졌다 — 이동에는 더 이상
   * 나이트 전용 제약이 없고, 남은 8랭크 금지는 모든 기물에 공통이라 여기(패턴)가 아니라
   * 배치 규칙(pieces.ts)의 몫이다. 앞절은 그대로 유효하다: **능력은 기물이 설 수 없는 칸에도
   * 닿는다.** 두 축이 다르다는 이 사실이 slowSquares가 inLandableBounds를 부르지 않는 이유다.
   */
  it('감속 오라: 스폰 랭크 바로 아래 나이트는 스폰 랭크 2칸을 덮는다 (v1.10)', () => {
    const from = { file: 3, rank: CONFIG.board.ranks - 2 };   // d6
    expect(slowSquares(from)).toHaveLength(8);
    expect(slowSquares(from).filter(s => s.rank === CONFIG.board.ranks)).toEqual(
      expect.arrayContaining([
        { file: 4, rank: CONFIG.board.ranks }, { file: 2, rank: CONFIG.board.ranks },
      ]),
    );
    // 7랭크에서도 마찬가지로 2칸이다 — dr=+1 오프셋 둘이 스폰 랭크에 떨어진다.
    expect(
      slowSquares({ file: 3, rank: CONFIG.board.ranks - 1 })
        .filter(s => s.rank === CONFIG.board.ranks),
    ).toHaveLength(2);
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
  /*
   * ⚠️ 여기 있던 "나이트 행마: d4에서 8칸, 8랭크 도착지는 제외 (스펙 5.3)"을 삭제했다.
   * knightMoves가 v1.11에서 사라졌기 때문이다 — 나이트도 다른 기물과 똑같이 아무 칸으로나
   * 재배치된다(사용자 결정). 그 테스트가 지키던 두 사실은 각자 갈 곳이 있어서 소실되지 않는다:
   *   · "L자 8칸"        → 위 감속 오라 테스트들. L자는 이제 이동이 아니라 능력의 모양이다.
   *   · "8랭크 도착지 제외" → 나이트 전용 규칙이 아니라 **전 기물 공통 배치 규칙**이 됐다.
   *                        inLandableBounds에 하나로 모여 있고 pieces.test.ts가 지킨다.
   * patterns.ts에는 이제 이동 규칙이 하나도 남아 있지 않다. 이 파일에 행마 테스트를 다시
   * 들이려는 충동이 들면, 그것은 그 제약이 되살아났다는 뜻이므로 여기가 아니라 결정부터 볼 것.
   */
});
