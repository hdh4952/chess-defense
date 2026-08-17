import { describe, expect, it } from 'vitest';
import { CONFIG, TRAITS, enemyCount, slowMultiplier, slowPercent } from '../src/config';
import { createEnemy, moveEnemies } from '../src/core/enemy';
import { squareKey } from '../src/core/grid';
import { slowSquares, slowTargets } from '../src/core/patterns';
import { canPlaceAt } from '../src/core/pieces';
import { NO_SLOW, slowCoverage, slowFactorAt, slowFieldSquares, updateSlowAura } from '../src/core/slow';
import { createInitialState } from '../src/core/state';
import { stepGame } from '../src/core/step';
import { HIGHLIGHT_COLORS, buildHighlights } from '../src/render/highlights';
import type { GameEvent, PieceType, Square } from '../src/types';
import { boardPiece, enemyAt, waveState } from './helpers';

/**
 * 감속 오라 (v1.13) — 나이트 계열이 L자 8칸의 적을 늦추고, 그 세기가 티어에 따라 커진다.
 *
 * 이 스위트가 따로 있는 이유는 능력이 세 계층에 걸쳐 있기 때문이다: 범위(patterns) · 계수
 * 적용(enemy/slow) · 미리보기(highlights). 어느 기존 파일에도 온전히 들어가지 않는다.
 * traits.test.ts가 TRAITS 표의 성질을 한곳에 모으는 것과 같은 자리다.
 *
 * 이 파일이 지키는 규칙 셋 — 셋 다 사용자가 명시적으로 정한 것이다:
 *   ① 티어별 선형  T1 30% · 단계마다 +5%p · T6 55% (v1.13에서 "티어 무관"이 뒤집혔다)
 *   ② 중첩 없음    겹치면 **가장 높은 티어 하나**만 적용된다. 합도 곱도 아니다
 *   ③ 8랭크 포함   적이 스폰되는 줄에서부터 걸린다 (배치 규칙과 갈라지는 지점)
 *
 * ★ ①과 ②는 서로를 무너뜨리기 쉬운 짝이라 아래 계수 스위트가 둘을 **한 테스트 안에서 나란히**
 * 단언한다. 세기 축이 생기면 "겹치면 더 세지겠지"가 자연스러운 오해가 되고, 반대로 중첩을
 * 막으려다 "먼저 걸린 T1이 나중의 T3를 무효화한다"(약한 쪽이 이긴다)로 잘못 구현되기도 한다.
 * 둘을 다른 테스트에 떼어 놓으면 각각은 초록인데 조합에서만 틀린 구현이 통과한다.
 */

/** T1(구매 직후) 기준 배수. 세기 축과 무관한 테스트는 전부 이 값 하나만 쓴다. */
const M1 = slowMultiplier(1);
const MAX_TIER = CONFIG.merge.maxTier.knight;
const ALL = Object.keys(TRAITS) as PieceType[];
const D4: Square = { file: 3, rank: 4 };
const { files: FILES, ranks: RANKS } = CONFIG.board;

/** 보드 전 칸 — 전수 순회용. 좌표 몇 개만 찍는 테스트는 우연히 맞는 구현을 통과시킨다. */
function allSquares(): Square[] {
  const out: Square[] = [];
  for (let file = 0; file < FILES; file++) for (let rank = 1; rank <= RANKS; rank++) {
    out.push({ file, rank });
  }
  return out;
}

const keys = (sqs: Square[]): string[] => sqs.map(squareKey).sort();

describe('감속 오라 — 범위', () => {
  it('L자 8칸이다 — 3×3 폭발과 완전히 다른 칸 집합이다', () => {
    // 개수만 세면 L자를 3×3의 부분집합(모서리 8칸)으로 잘못 구현해도 통과한다. 폭발이 덮던
    // 인접 칸이 **빠졌다는 것**을 직접 단언해야 교체가 좌표 수준에서 못박힌다.
    expect(slowSquares(D4)).toHaveLength(8);
    expect(keys(slowSquares(D4))).toEqual(keys([
      { file: 4, rank: 6 }, { file: 5, rank: 5 }, { file: 5, rank: 3 }, { file: 4, rank: 2 },
      { file: 2, rank: 2 }, { file: 1, rank: 3 }, { file: 1, rank: 5 }, { file: 2, rank: 6 },
    ]));
    expect(slowSquares(D4)).not.toContainEqual({ file: 3, rank: 5 });   // 바로 위 — 폭발은 덮었다
    expect(slowSquares(D4)).not.toContainEqual({ file: 2, rank: 4 });   // 바로 왼쪽
    expect(slowSquares(D4)).not.toContainEqual(D4);                     // 자기 칸
  });

  it('구석(a1)에서는 2칸만 남는다 — 경계는 자르되 랭크 제약은 걸지 않는다', () => {
    // patterns.test.ts가 knightBlastTargets(a1) = 4칸을 못박던 자리를 이어받는다.
    // 클리핑이 inBoard만 쓰는지(랭크 상한을 몰래 끼워 넣지 않는지) 확인하는 최소 케이스.
    expect(keys(slowSquares({ file: 0, rank: 1 })))
      .toEqual(keys([{ file: 1, rank: 3 }, { file: 2, rank: 2 }]));
  });

  it('★ 8랭크(스폰 구역)를 포함한다 — 기물이 설 수 없는 칸에도 능력은 닿는다', () => {
    // 사용자 결정. 적은 8랭크에서 스폰돼 내려오므로, 빼면 판에 들어오는 바로 그 지점에
    // 감속 구멍이 생긴다.
    //
    // ⚠️ v1.11 이전에는 이 테스트가 knightMoves(L자 착지 후보)와 나란히 비교했다. 그 함수가
    // 사라진 지금 대조군은 **배치 규칙**(canPlaceAt)이다 — 비교의 요지는 그대로다:
    // "기물이 설 수 있는가"와 "능력이 닿는가"는 다른 축이고, 8랭크에서 정확히 갈린다.
    const from: Square = { file: 3, rank: 6 };
    expect(slowSquares(from)).toHaveLength(8);
    expect(slowSquares(from)).toContainEqual({ file: 4, rank: 8 });
    expect(slowSquares(from)).toContainEqual({ file: 2, rank: 8 });

    const s = waveState();
    expect(canPlaceAt(s, 4, 8)).toBe(false);      // 그 칸에 기물을 놓을 수는 없는데
    expect(slowFactorAt({ ...s, pieces: [boardPiece('knight', 3, 6)] }, { file: 4, rank: 8 }))
      .toBe(M1);                                  // 감속은 걸린다
  });

  it('★ 전 보드에서 감속 범위는 랭크 상한을 걸지 않는다 — 필터가 inBoard 하나뿐이다', () => {
    // 전수 순회가 아니면 특정 좌표에서만 우연히 맞는 구현을 통과시킨다. 배치 규칙
    // (rank ≤ 7)을 여기로 끌어오는 회귀가 가장 자연스러운 실수라, 8랭크에 실제로 떨어지는
    // 칸이 몇 개인지를 세어 공허 방지까지 건다.
    const s = waveState();
    let spawnRankHits = 0;
    for (const sq of allSquares()) {
      for (const t of slowSquares(sq)) {
        // 오프셋의 수학적 성질: |Δfile|,|Δrank| 조합이 반드시 {1,2}다
        const df = Math.abs(t.file - sq.file), dr = Math.abs(t.rank - sq.rank);
        expect([df, dr].sort().join(','), `${squareKey(sq)} → ${squareKey(t)}`).toBe('1,2');
        expect(t.rank >= 1 && t.rank <= RANKS).toBe(true);
        if (t.rank === RANKS) {
          spawnRankHits++;
          expect(canPlaceAt(s, t.file, t.rank)).toBe(false);   // 능력은 닿지만 배치는 불가
        }
      }
    }
    expect(spawnRankHits).toBeGreaterThan(0);
  });

  it('slowTargets는 감속 기물에게만 범위를 준다 — 전수', () => {
    for (const type of ALL) {
      expect(slowTargets(type, D4), type).toEqual(TRAITS[type].slow ? slowSquares(D4) : []);
    }
    // ★ 융합 3종도 함께 바뀐다는 사용자 결정을 표 차원에서 못박는다. 나중에 융합물만 조용히
    // 빠지면 여기서 걸린다.
    expect(ALL.filter(t => TRAITS[t].slow).sort())
      .toEqual(['amazon', 'archbishop', 'chancellor', 'knight']);
  });
});

describe('감속 계수 — 티어별 선형 세기 · 중첩 없음(최댓값 하나)', () => {
  it('★ 티어마다 감속이 다르다 — T1 30%에서 단계마다 +5%p, 그래도 중첩은 없다', () => {
    // ⚠️ v1.12까지 이 자리는 정확히 **반대**를 단언했다("T6 나이트도 30%다 — 티어는 감속량에
    // 곱해지지 않는다"). 사용자가 규칙을 바꿨으므로 지우지 않고 뒤집는다 — 지우면 "여기에
    // 규칙이 하나 있었다"는 사실까지 사라져, 누군가 다시 상수로 되돌려도 아무도 모른다.
    //
    // 기대값을 slowPercent()로 유도하지 않고 **표를 바깥에서 못박는 것**이 핵심이다. 전부
    // 유도하면 basePercent/perTierPercent를 잘못 고쳐도 기대값이 함께 움직여 아무것도 지키지
    // 못한다. 아래 두 배열이 사용자가 정한 표 그 자체다.
    const PERCENT = [30, 35, 40, 45, 50, 55];
    // 배수는 근사로 못박는다 — 1 − 55/100은 0.45와 비트가 달라(0.44999999999999996) toBe가
    // 밸런스와 무관하게 깨진다. 정확한 동일성은 아래 slowMultiplier(t)와의 비교가 담당한다.
    const MULT = [0.70, 0.65, 0.60, 0.55, 0.50, 0.45];
    expect(MAX_TIER).toBe(PERCENT.length);        // 상한이 늘면 표도 함께 정해야 한다(공허 방지)
    expect(MULT).toHaveLength(PERCENT.length);

    const target: Square = { file: 2, rank: 4 };
    for (let t = 1; t <= MAX_TIER; t++) {
      expect(slowPercent(t), `T${t}`).toBe(PERCENT[t - 1]);
      expect(slowMultiplier(t), `T${t}`).toBeCloseTo(MULT[t - 1], 12);

      // 판정이 그 배수를 **정확히** 쓴다 — 화면 문구와 물리가 같은 값에서 나온다는 뜻이다.
      const s = waveState();
      s.pieces.push(boardPiece('knight', 0, 3, t));
      expect(slowFactorAt(s, target), `T${t}`).toBe(slowMultiplier(t));

      // ★ 그리고 같은 칸을 한 기가 **더** 덮어도 값은 그대로다. 세기 축이 생겼다는 것과
      // 중첩이 생겼다는 것은 다른 말이다 — 두 규칙을 같은 테스트에서 봐야 하는 이유가 이것이다.
      s.pieces.push(boardPiece('knight', 4, 3, t));
      expect(slowFactorAt(s, target), `T${t}×2`).toBe(slowMultiplier(t));
    }

    // 선형성 — 인접 단계의 차가 전부 같고 0이 아니다. 0이면 v1.12의 "티어 무관"으로 되돌아간
    // 것이고, 그러면 나이트는 다시 "합성이 손해인 유일한 기물"이 된다(CONFIG.slowAura 주석).
    expect(CONFIG.slowAura.perTierPercent).toBeGreaterThan(0);
    for (let t = 2; t <= MAX_TIER; t++) {
      expect(PERCENT[t - 1] - PERCENT[t - 2], `T${t - 1}→T${t}`)
        .toBe(CONFIG.slowAura.perTierPercent);
      expect(slowMultiplier(t)).toBeLessThan(slowMultiplier(t - 1));   // 단조 — 방향까지 못박는다
    }
  });

  it('★ T1과 T3가 같은 칸을 덮으면 T3 단독과 정확히 같다 — 순서도 무관하다', () => {
    // 중첩 방지의 표준 실패 모드는 "덮는 기물 수만큼 곱한다"이다. v1.13에서 실패 모드가 둘
    // 늘었다 — **약한 쪽이 이기는** 구현(나중에 쓴 값이 남거나 최솟값을 고른다)과 **티어를
    // 더하는** 구현(1+3 → T4). 셋 다 not.toBe로 직접 배제한다.
    //
    // 두 기물을 감속 칸이 아닌 자리에 두는 것은 의도적이다 — 기물 자신의 칸이 섞이면 무엇이
    // 덮은 것인지 구분되지 않는다.
    const target: Square = { file: 2, rank: 4 };
    expect(slowSquares({ file: 0, rank: 3 })).toContainEqual(target);
    expect(slowSquares({ file: 4, rank: 3 })).toContainEqual(target);

    const solo = waveState();
    solo.pieces.push(boardPiece('knight', 0, 3, 3));
    const t3 = slowFactorAt(solo, target);
    expect(t3).toBe(slowMultiplier(3));

    // 순서를 바꿔 두 번 잰다. "먼저 걸린 값이 남는다"와 "나중 값이 덮어쓴다"가 각각 한쪽에서만
    // 초록이라, 한 방향만 재면 둘 중 하나가 그대로 통과한다.
    const weakFirst = waveState();
    weakFirst.pieces.push(boardPiece('knight', 0, 3, 1), boardPiece('knight', 4, 3, 3));
    const strongFirst = waveState();
    strongFirst.pieces.push(boardPiece('knight', 0, 3, 3), boardPiece('knight', 4, 3, 1));

    for (const [label, s] of [['T1→T3', weakFirst], ['T3→T1', strongFirst]] as const) {
      expect(slowFactorAt(s, target), label).toBe(t3);                     // 최댓값이 이긴다
      expect(slowFactorAt(s, target), label).not.toBe(slowMultiplier(1));  // 약한 쪽이 아니다
      expect(slowFactorAt(s, target), label).not.toBe(slowMultiplier(4));  // 티어의 합도 아니다
      expect(slowFactorAt(s, target), label)
        .not.toBe(slowMultiplier(1) * slowMultiplier(3));                  // 배수의 곱도 아니다
    }
  });

  it('★ 셋이 겹쳐도 최댓값 하나다 — T1+T2+T3 = T3 단독 (n중첩 일반화)', () => {
    // 2기 케이스만 두면 "곱하되 두 번째 인자가 우연히 1"인 구현도 통과할 수 있다. 셋의 티어를
    // 전부 다르게 두면 합(1+2+3=6)·곱·최솟값이 각각 다른 값을 내므로 한 번에 갈라진다.
    const target: Square = { file: 2, rank: 4 };
    const s = waveState();
    const spots = [[0, 3], [4, 3], [1, 6]] as const;
    spots.forEach(([f, r], i) => {
      expect(slowSquares({ file: f, rank: r })).toContainEqual(target);
      s.pieces.push(boardPiece('knight', f, r, i + 1));      // T1 · T2 · T3
    });
    expect(slowFactorAt(s, target)).toBe(slowMultiplier(3));
    expect(slowFactorAt(s, target)).not.toBe(slowMultiplier(6));           // 티어를 더한 값
    expect(slowFactorAt(s, target))
      .not.toBe(slowMultiplier(1) * slowMultiplier(2) * slowMultiplier(3));  // 배수의 곱
  });

  it('★ 융합 3종도 같은 규칙을 탄다 — 종류로도, 종류 조합으로도 갈라지지 않는다', () => {
    // "중첩 없음"을 같은 종류끼리만 구현하고(나이트 목록만 dedup) 종류가 다르면 곱하는 구현이
    // 실제로 흔하다. v1.13에서 축이 하나 더 붙는다 — 티어를 나이트에서만 읽고 융합물은 T1로
    // 굳히는 구현. 종류·티어 두 축을 동시에 흔들어야 "규칙이 하나다"가 증명된다.
    const target: Square = { file: 2, rank: 4 };
    for (const type of ALL.filter(t => TRAITS[t].slow)) {
      for (const tier of [1, 4] as const) {
        const s = waveState();
        s.pieces.push(boardPiece(type, 0, 3, tier));
        expect(slowFactorAt(s, target), `${type} T${tier}`).toBe(slowMultiplier(tier));
      }
    }
    // 종류가 다른 둘이 겹쳐도 최댓값 하나 — 어느 쪽이 센지에 따라 답이 뒤집히지 않는다.
    const knightHigh = waveState();
    knightHigh.pieces.push(boardPiece('knight', 0, 3, 5), boardPiece('chancellor', 4, 3, 2));
    expect(slowFactorAt(knightHigh, target)).toBe(slowMultiplier(5));

    const fusionHigh = waveState();
    fusionHigh.pieces.push(boardPiece('amazon', 0, 3, 6), boardPiece('knight', 4, 3, 1));
    expect(slowFactorAt(fusionHigh, target)).toBe(slowMultiplier(6));
    // ★ T1 나이트 한 기가 옆에 섰다고 T6 아마존이 30%로 끌려 내려오지 않는다. 이것이 "겹치면
    // 최댓값"을 고른 이유 그 자체다 — 약한 쪽이 이기면 오라를 늘리는 배치가 오히려 손해가 된다.
    expect(slowFactorAt(fusionHigh, target)).not.toBe(slowMultiplier(1));
  });

  it('감속 기물이 아닌 기물은 어떤 칸도 느리게 하지 않는다 — 전수', () => {
    // 티어를 함께 흔든다. 감속을 "티어가 있으면 건다"로 구현하면 게이트(TRAITS[·].slow)가
    // 빠져도 T1에서는 티가 안 나는데, 이 게임의 모든 기물이 티어를 갖는다.
    const s = waveState();
    let n = 0;
    for (const type of ALL.filter(t => !TRAITS[t].slow)) {
      s.pieces.push(boardPiece(type, n % FILES, (n % (RANKS - 1)) + 1, (n % MAX_TIER) + 1));
      n++;
    }
    expect(n).toBeGreaterThan(0);                              // 공허 방지
    for (const sq of allSquares()) expect(slowFactorAt(s, sq), squareKey(sq)).toBe(1);
  });

  // ⚠️ v1.12에서 앞쪽 절반("트레이의 나이트는 오라를 만들지 않는다")을 삭제했다. 기물 보관함이
  // 사라지면서 Piece.square가 널일 수 없게 됐고, 그래서 **판 밖의 나이트라는 상태를 만들 방법이
  // 없다** — 없는 상황은 테스트로 지킬 것이 없다. 그 보장은 이제 타입이 하고, 그 사실은
  // core/slow.ts의 slowCoverage 주석이 같은 자리에서 기록하고 있다.
  // 뒤쪽 절반은 감속 규칙 자체라 규칙이 하나도 안 바뀌었으므로 그대로 남긴다.
  it('나이트 자신이 선 칸은 느려지지 않는다 — L자 오프셋에 자기 칸이 없다', () => {
    // 3×3 폭발(v1.10 이전)은 자기 칸을 덮었다. 그 관성이 남지 않았는지 확인한다.
    const board = waveState();
    board.pieces.push(boardPiece('knight', 3, 4));
    expect(slowFactorAt(board, { file: 3, rank: 4 })).toBe(1);

    // 자기 칸만 콕 집어 재면 "아무 칸도 안 덮는" 구현도 통과한다. 덮는 칸이 실제로 있다는
    // 것까지 나란히 걸어 공허를 막는다.
    const covered = allSquares().filter(sq => slowFactorAt(board, sq) < 1);
    expect(keys(covered)).toEqual(keys(slowSquares({ file: 3, rank: 4 })));
  });

  it('slowCoverage의 except는 그 기물 하나만 없는 셈 친다 — 미리보기가 쓰는 경로', () => {
    // ★ v1.13에서 Map의 값이 좌표가 아니라 **그 칸을 지배하는 티어**가 됐다. 그래서 except가
    // 답하는 질문도 커졌다: 지배자를 빼면 칸이 사라지는 것이 아니라 **다음으로 센 기물의
    // 티어로 내려앉는다.** 드래그 중인 기물을 뺀 화면이 "여기는 이제 −30%"를 그리려면 이
    // 성질이 필요하고, 값이 boolean이었다면 표현할 수 없었다.
    const s = waveState();
    const weak = boardPiece('knight', 0, 3, 1);
    const strong = boardPiece('knight', 4, 3, 3);
    s.pieces.push(weak, strong);
    const target = squareKey({ file: 2, rank: 4 });
    expect(slowCoverage(s).get(target)).toBe(strong.tier);
    // 하나를 빼도 다른 하나가 여전히 덮는다 — 중첩이 없다는 사실이 여기서도 드러난다.
    expect(slowCoverage(s, weak).get(target)).toBe(strong.tier);   // 지배자는 그대로
    expect(slowCoverage(s, strong).get(target)).toBe(weak.tier);   // 지배자를 빼면 내려앉는다
    // 둘 다 없으면 비로소 풀린다(except는 하나만 받으므로 배열을 비워 확인한다).
    s.pieces = [];
    expect(slowCoverage(s).has(target)).toBe(false);
  });
});

describe('오라는 지속형이다', () => {
  /** 한 틱 이동량. Δy로 재면 곱셈 순서에 대한 가정 없이 관측 가능한 양만 본다. */
  function stepDelta(s: ReturnType<typeof waveState>, e: { y: number }, dt: number): number {
    const y0 = e.y;
    updateSlowAura(s, []);
    moveEnemies(s, dt);
    return e.y - y0;
  }

  it('★ 오라 칸에 있는 동안만 느리고, 벗어나면 원래 속도로 돌아온다', () => {
    // 한 번 느려진 뒤 영구히 느린 구현(= speed에 굽는 구현)과, 진입 프레임에만 적용되는
    // 구현을 동시에 배제한다.
    const s = waveState();
    s.pieces.push(boardPiece('knight', 0, 3));      // (2,2)·(2,4)를 덮는다
    const e = enemyAt(1, 2, 5);                     // 감속되지 않는 랭크에서 시작
    s.enemies.push(e);
    const dt = 1 / 60;
    const base = e.speed;

    expect(stepDelta(s, e, dt)).toBeCloseTo(base * dt, 9);

    e.y = enemyAt(1, 2, 4).y;                       // 감속 칸으로 이동
    expect(stepDelta(s, e, dt)).toBeCloseTo(base * M1 * dt, 9);

    e.y = enemyAt(1, 2, 3).y;                       // 오라 밖 — 복구
    expect(stepDelta(s, e, dt)).toBeCloseTo(base * dt, 9);
  });

  it('★ e.speed는 한 번도 변하지 않는다 — 감속은 speed에 굽지 않는다', () => {
    // core/enemy.ts createEnemy의 주석이 못박은 불변식("영구 배수만 speed에 굽는다. 일시적
    // 감속 같은 것이 생기면 speed가 아니라 별도 상태로 둬야 한다")이 정확히 이 기능에 대한
    // 예언이었다. speed를 곱했다 되돌리는 구현은 부동소수 잔차를 남겨, 나이트가 **없는**
    // signals.test.ts의 기준선까지 조용히 흔든다.
    const s = waveState();
    s.pieces.push(boardPiece('knight', 0, 3));
    const e = enemyAt(1, 2, 4);
    s.enemies.push(e);
    const base = e.speed;
    const dt = 1 / 60;

    for (let i = 0; i < 30; i++) {
      stepDelta(s, e, dt);
      expect(e.speed).toBe(base);
    }
    // 나이트를 치우면 즉시 원래 속도다 — 상태가 적이 아니라 판에 달려 있다는 증거다.
    s.pieces = [];
    e.y = enemyAt(1, 2, 4).y;
    expect(stepDelta(s, e, dt)).toBeCloseTo(base * dt, 9);
    expect(e.speed).toBe(base);
  });

  it('★ stepGame 한 틱 안에서도 감속이 적용된다 — 티어까지 실전 경로를 탄다', () => {
    // moveEnemies 단위 테스트만으로는 stepGame의 호출 순서에 감속이 실제로 얹혔는지 알 수
    // 없다. helpers의 transitDamage/fullRun이 전부 stepGame을 타므로 이쪽이 실전 경로다.
    //
    // ★ T3를 쓰는 이유: T1로 재면 "티어를 무시하고 늘 30%"인 구현이 여기서 통과한다. 실제
    // 플레이의 값은 slowFactorAt이 아니라 effectiveSpeed에서 나오므로, 두 경로가 같은 티어를
    // 읽는지는 엔진을 통과시켜야만 확인된다.
    const s = waveState();
    s.wave = 1;
    s.spawnedCount = enemyCount(1);                 // 추가 스폰 차단
    s.pieces.push(boardPiece('knight', 0, 3, 3));
    const e = enemyAt(1, 2, 4);
    s.enemies.push(e);
    const base = e.speed;
    const dt = 1 / 600;                             // 한 칸을 벗어나지 않을 만큼 잘게
    const y0 = e.y;
    for (let i = 0; i < 60; i++) stepGame(s, dt, [], () => 0, () => 0);
    expect(e.y - y0).toBeCloseTo(base * slowMultiplier(3) * dt * 60, 6);
    expect(e.slowTier).toBe(3);
  });

  it('★ 감속 진입은 전이에서 한 번만 알린다 — 다만 **세지면** 그것도 전이다', () => {
    // 중첩 없음이 시간축에서도 보이는 지점이다. 매 틱 발행하면 60fps × 적 수만큼 쏟아져
    // 이펙트도 소리도 쓸 수 없고, 무엇보다 "실제로 일어난 사건의 수"가 아니게 된다.
    //
    // ★ v1.13에서 조건이 `!e.slowed`에서 `now > e.slowTier`로 바뀌었다. 티어가 생기면서 "이미
    // 느린 적이 더 센 오라로 넘어가는 것"이 실제로 일어난 일이 됐기 때문이다 — 안 알리면 화면에
    // 옛 수치(−30%)가 남는다. 약해질 때 알리지 않는 것은 표식의 목적이 "방금 무엇이 걸렸는가"
    // 이지 상태 중계가 아니어서다. 그래서 이 테스트는 부등호의 **양쪽**을 다 밟는다.
    const s = waveState();
    s.pieces.push(boardPiece('knight', 0, 3));      // T1
    const e = enemyAt(1, 2, 4);
    s.enemies.push(e);

    const ev: GameEvent[] = [];
    const slowEvents = (): { tier: number }[] =>
      ev.filter((x): x is Extract<GameEvent, { kind: 'enemySlowed' }> => x.kind === 'enemySlowed');

    updateSlowAura(s, ev);
    expect(slowEvents()).toHaveLength(1);
    expect(slowEvents()[0].tier).toBe(1);           // 라벨이 "−30%"인지 "−40%"인지가 이 값에서 나온다
    updateSlowAura(s, ev);
    updateSlowAura(s, ev);
    expect(slowEvents()).toHaveLength(1);           // 여전히 1

    // 같은 티어가 하나 더 덮어도 새 사건이 아니다 — 정말 아무 일도 일어나지 않았다(최댓값 하나).
    s.pieces.push(boardPiece('knight', 4, 3));
    updateSlowAura(s, ev);
    expect(slowEvents()).toHaveLength(1);

    // ★ 더 센 오라가 덮으면 그때는 새 사건이고, 실린 티어도 새 값이어야 한다.
    s.pieces.push(boardPiece('knight', 1, 6, 3));
    updateSlowAura(s, ev);
    expect(slowEvents()).toHaveLength(2);
    expect(slowEvents()[1].tier).toBe(3);
    expect(e.slowTier).toBe(3);

    // ★ 반대 방향은 사건이 아니다. T3를 치워 T1만 남기면 상태는 즉시 내려앉지만 알리지 않는다.
    s.pieces = s.pieces.filter(p => p.tier === 1);
    updateSlowAura(s, ev);
    expect(e.slowTier).toBe(1);
    expect(slowEvents()).toHaveLength(2);

    // 오라를 완전히 벗어났다 다시 들어오면 그때는 새 사건이다.
    s.pieces = [];
    updateSlowAura(s, ev);
    expect(e.slowTier).toBe(NO_SLOW);
    s.pieces.push(boardPiece('knight', 0, 3));
    updateSlowAura(s, ev);
    expect(slowEvents()).toHaveLength(3);
  });
});

describe('8랭크(스폰 구역)에서의 실제 효과', () => {
  it('★ 7랭크 나이트는 스폰 직후(8랭크)의 적을 실제로 느리게 한다', () => {
    // 범위 함수 단위 테스트와 달리 이것은 **엔진을 통과한** 증거다. 감속 범위 계산이
    // 어딘가에서 canPlaceAt/inLandableBounds를 재사용하면 여기서만 깨지고, 하필 그 칸이
    // 이 기능에서 값이 가장 큰 구간(스폰 직후)이다.
    const s = waveState();
    s.pieces.push(boardPiece('knight', 3, 6));
    const e = createEnemy(1, 4, false, 'spawn');    // y = 0 = 8랭크
    s.enemies.push(e);
    const dt = 1 / 60;
    const y0 = e.y;
    updateSlowAura(s, []);
    moveEnemies(s, dt);
    expect(e.y - y0).toBeCloseTo(e.speed * M1 * dt, 9);

    // 같은 나이트가 그 칸에 **설 수는 없다** — 두 축이 갈라진다는 증거를 나란히 둔다.
    // (v1.11에서 L자 이동 제약이 사라졌지만 8랭크 금지는 전 기물 공통으로 남아 있다.)
    expect(canPlaceAt(s, 4, 8)).toBe(false);
  });
});

describe('페이즈 게이트', () => {
  it('prepare에서는 적이 아예 움직이지 않으므로 감속도 무의미하다', () => {
    const s = createInitialState();                 // phase 'prepare'
    s.pieces.push(boardPiece('knight', 0, 3));
    const e = enemyAt(1, 2, 4);
    s.enemies.push(e);
    const y0 = e.y, base = e.speed;
    moveEnemies(s, 10);
    expect(e.y).toBe(y0);
    expect(e.speed).toBe(base);

    // ★ 그런데 계수 함수 자체는 페이즈와 무관하게 배수를 돌려줘야 한다. 여기 페이즈 게이트를
    // 이중으로 넣으면 미리보기가 prepare 중에 오라를 그리지 못하는데, 준비 시간에 오라
    // 배치를 계획하는 것이 이 기물의 유일한 플레이라 그 회귀는 치명적이다.
    // (v1.13부터 합성으로 세기를 올리는 것도 그 계획의 일부라 값이 더 중요해졌다.)
    expect(slowFactorAt(s, { file: 2, rank: 4 })).toBe(M1);
  });

  it('victory/defeat에서도 적은 움직이지 않는다', () => {
    for (const phase of ['victory', 'defeat'] as const) {
      const s = waveState();
      s.phase = phase;
      s.pieces.push(boardPiece('knight', 0, 3));
      const e = enemyAt(1, 2, 4);
      s.enemies.push(e);
      const y0 = e.y;
      moveEnemies(s, 10);
      expect(e.y, phase).toBe(y0);
    }
  });
});

describe('다른 속도 배수와의 합성', () => {
  const dt = 1 / 60;

  function delta(isBoss: boolean, traits: 'swift' | null, slowed: boolean): number {
    const s = waveState();
    if (slowed) s.pieces.push(boardPiece('knight', 0, 3));
    const e = createEnemy(19, 2, isBoss, `x-${isBoss}-${traits}-${slowed}`, traits ? [traits] : []);
    e.y = enemyAt(1, 2, 4).y;                       // 감속 칸(나이트가 있을 때)
    s.enemies.push(e);
    const y0 = e.y;
    updateSlowAura(s, []);
    moveEnemies(s, dt);
    return e.y - y0;
  }

  it('신속 적도 같은 비율로 느려진다 — 감속은 speed에 곱해진다', () => {
    // 비율로 단언하면 base가 무엇이든 감속만 격리해 측정된다.
    expect(delta(false, 'swift', true) / delta(false, 'swift', false)).toBeCloseTo(M1, 9);
  });

  it('보스도 감속 대상이다 — bossForbidden은 적 유형 전용이지 오라와 무관하다', () => {
    // CONFIG.bossForbidden에 'swift'가 있어 "보스는 속도를 안 건드린다"로 오해하기 쉽다.
    // 감속은 보스에게 유리하지 않고(딜 넣을 시간이 늘어난다) 설계에도 예외가 없다.
    expect(CONFIG.bossForbidden).toContain('swift');
    expect(delta(true, null, true) / delta(true, null, false)).toBeCloseTo(M1, 9);
  });

  it('★ 2배속에서도 감속 비율은 그대로다', () => {
    // 감속을 "틱마다 일정량을 빼는" 식으로 구현하면 1배속과 2배속의 감속량이 달라진다.
    // 배속은 이 게임의 유일한 시간 축 조작이라, 깨지면 2배속 플레이 전체가 다른 게임이 된다.
    const run = (mult: number): number => {
      const s = waveState();
      s.pieces.push(boardPiece('knight', 0, 3));
      const e = enemyAt(1, 2, 4);
      s.enemies.push(e);
      const y0 = e.y;
      for (let i = 0; i < 120; i++) {
        updateSlowAura(s, []);
        moveEnemies(s, (1 / 600) * mult);           // 칸을 벗어나지 않을 만큼 잘게
      }
      return e.y - y0;
    };
    expect(run(2)).toBeCloseTo(run(1) * 2, 9);
  });
});

describe('미리보기와 실제 규칙', () => {
  it('★ 상시 오라가 그리는 집합 = 실제로 느려지는 칸, 세기까지 (같은 순회에서 나온다)', () => {
    // renderer.drawSlowField가 slowFieldSquares(state)를 그대로 칠하고, 그 함수는 판정에 쓰는
    // slowCoverage와 같은 순회에서 나온다. "칠해졌는데 안 느려지는 칸"이 존재할 수 없다는 것이
    // 그 공유에서 나온다 — 이 테스트는 그 공유가 실제로 성립하는지를 좌표 수준에서 확인한다.
    //
    // ★ v1.13에서 확인할 것이 하나 늘었다. 칸마다 **세기**(티어)가 함께 나오고 알파가 그 값을
    // 따르므로, 티어가 어긋나면 화면이 "여기가 더 느리다"고 거짓말한다. 그래서 좌표 집합만이
    // 아니라 칸마다의 티어가 실제 계수와 같은지도 나란히 잰다.
    const s = waveState();
    s.pieces.push(boardPiece('knight', 3, 6, 4));     // 8랭크를 덮는 자리, T4

    const drawn = slowFieldSquares(s);
    const actual = allSquares().filter(sq => slowFactorAt(s, sq) < 1);
    expect(keys(drawn.map(d => d.square))).toEqual(keys(actual));
    for (const d of drawn) {
      expect(slowFactorAt(s, d.square), squareKey(d.square)).toBe(slowMultiplier(d.tier));
    }
    // ★ 이 게임에서 유일하게 새로운 정보 — 스폰 구역도 칠해지고 실제로도 느려진다.
    expect(keys(drawn.map(d => d.square))).toContain(squareKey({ file: 4, rank: 8 }));
    expect(keys(drawn.map(d => d.square))).toContain(squareKey({ file: 2, rank: 8 }));
  });

  it('★ 상시 오라는 칸당 한 번만 그려진다 — 겹쳐 칠하면 "저기가 더 느리다"는 거짓말이 된다', () => {
    // 중첩 금지가 **자료구조로** 보장되는 지점. 칸마다 티어 하나만 담기므로 나이트가 몇 기든
    // 원소가 하나이고, 알파가 두 겹 얹힐 방법이 코드에 존재하지 않는다.
    //
    // ★ v1.13에서 이 성질의 값이 올라갔다. 알파가 티어를 따라 진해지므로, 겹쳐 칠하면 T1 두
    // 겹이 T3 한 겹처럼 보인다 — 규칙은 그 칸을 T1로 치는데 화면만 더 세다고 말하는 셈이다.
    const target = squareKey({ file: 2, rank: 4 });
    const weak = boardPiece('knight', 0, 3, 1);
    const strong = boardPiece('knight', 4, 3, 3);

    // 각자 혼자 덮는 칸 수 — 보드 가장자리라 둘의 개수가 다르다(클리핑). 그래서 합집합을
    // "8+8"이 아니라 **각자의 실측 합**과 비교해야 한다.
    const only = (p: typeof weak): number => {
      const s = waveState(); s.pieces.push(p); return slowCoverage(s).size;
    };
    const sizeWeak = only(weak), sizeStrong = only(strong);

    const s = waveState();
    s.pieces.push(weak, strong);
    const both = slowCoverage(s);
    expect(both.get(target)).toBe(strong.tier);       // 겹친 칸은 센 쪽의 티어
    // 겹친 칸은 합쳐도 원소 하나다 — 그래서 합집합이 각자의 합보다 반드시 작다.
    expect(both.size).toBeLessThan(sizeWeak + sizeStrong);
    // 겹친 칸 수가 0이면 위 단언이 공허해진다 — 실제로 겹치는 배치인지 확인한다.
    expect(sizeWeak + sizeStrong - both.size).toBeGreaterThan(0);

    // 렌더가 실제로 받는 배열에서도 칸이 중복되지 않는다(Map에서 배열로 풀리는 지점이 여기다).
    const drawn = slowFieldSquares(s);
    expect(keys(drawn.map(d => d.square))).toEqual([...both.keys()].sort());
    expect(drawn.filter(d => squareKey(d.square) === target)).toHaveLength(1);
    expect(drawn.find(d => squareKey(d.square) === target)?.tier).toBe(strong.tier);
  });

  it('★ 하버 미리보기는 착지 후의 오라를 보여준다 — 현재 칸 기준이 아니다', () => {
    // 나이트를 선택하고 어느 칸에 hover하면 **거기 섰을 때** 감속될 칸이 얼음색으로 뜬다.
    // 현재 칸의 오라가 아니다(그건 렌더러의 상시 오라가 담당한다) — 여기서 겹쳐 칠하면
    // 같은 칸에 알파가 두 겹 얹혀 중첩처럼 보인다.
    //
    // ⚠️ v1.11에서 초록 이동 후보 표시가 사라졌다. 예전에는 이 테스트가 "얼음 ≠ 초록"을
    // 함께 쟀지만, 모든 기물이 아무 칸으로나 가므로 그릴 후보 자체가 없다.
    const s = waveState();
    const n = boardPiece('knight', 3, 4);
    s.pieces.push(n);
    const dest: Square = { file: 6, rank: 2 };        // L자가 **아닌** 먼 칸 — 이제 갈 수 있다

    const { highlights } = buildHighlights(
      s, { dragging: null, selectedPieceId: n.id, hoverSquare: dest },
    );
    const slow = keys(highlights.filter(h => h.color === HIGHLIGHT_COLORS.slow).map(h => h.square));

    // 얼음 칸은 **hover한 칸 기준**이다 — 현재 칸(3,4) 기준이 아니라는 것이 이 단언의 전부다.
    expect(slow).toEqual(keys(slowSquares(dest)));
    expect(slow).not.toEqual(keys(slowSquares({ file: 3, rank: 4 })));
  });

  it('★ 이동 후보를 그리는 색은 더 이상 없다 — 어떤 기물도 초록 칸을 만들지 않는다', () => {
    // v1.11에서 HIGHLIGHT_COLORS.move가 팔레트에서 사라졌다. 그 색이 답하던 질문("이 기물이
    // 어디로 갈 수 있는가")이 없어졌기 때문이다 — 이제 답은 모든 기물에 대해 "어디로든"이다.
    // 이 단언이 없으면 누군가 종류별 이동 분기를 되살려도 아무도 모른다.
    expect('move' in HIGHLIGHT_COLORS).toBe(false);
    const palette = new Set(Object.values(HIGHLIGHT_COLORS));
    for (const type of ALL) {
      const s = waveState();
      const p = boardPiece(type, 3, 4);
      s.pieces.push(p);
      const { highlights } = buildHighlights(
        s, { dragging: null, selectedPieceId: p.id, hoverSquare: null },
      );
      // 팔레트에 없는 색이 새어 나오지 않는다 = 사라진 채널이 되살아나지 않았다
      for (const h of highlights) expect(palette.has(h.color), `${type}: ${h.color}`).toBe(true);
    }
  });

  it('★ 융합물은 공격 칸(주황)과 감속 칸(얼음)을 둘 다 그린다', () => {
    // previewRange가 두 배열(공격·감속)을 갈라 돌려주는 이유가 여기서 실전이 된다 — 겸업
    // 기물만이 두 축을 동시에 갖는다. (v1.11 이전에는 아치비숍이 slow=true·moveL=false인
    // 유일한 종류라는 것이 근거였는데, moveL 축 자체가 사라져 근거가 더 단순해졌다.)
    const s = waveState();
    const a = boardPiece('archbishop', 3, 4);
    s.pieces.push(a);
    const { highlights } = buildHighlights(
      s, { dragging: null, selectedPieceId: a.id, hoverSquare: { file: 3, rank: 4 } },
    );
    const range = highlights.filter(h => h.color === HIGHLIGHT_COLORS.range);
    const slow = keys(highlights.filter(h => h.color === HIGHLIGHT_COLORS.slow).map(h => h.square));

    expect(range.length).toBeGreaterThan(0);          // 비숍 대각선이 살아 있다
    expect(slow).toEqual(keys(slowSquares({ file: 3, rank: 4 })));
    // 두 집합은 겹치지 않는다 — L자 오프셋은 대각선 위에 없다.
    expect(slow.filter(k => keys(range.map(h => h.square)).includes(k))).toEqual([]);
  });
});

describe('화면 문구는 CONFIG에서 유도된다', () => {
  it('slowPercent(tier)가 판 위에서 실제로 걸리는 감속과 어긋나지 않는다 — 전 티어', () => {
    // 툴팁·시작 화면·진입 라벨이 전부 slowPercent(tier)를 쓰고 물리는 slowMultiplier(tier)를
    // 쓴다. 둘이 갈라지면 화면은 "−40%"라고 말하는데 실제로는 30%만 느려진다. 그 어긋남은
    // 테스트가 아니라 플레이어가 발견한다 — 티어가 생기면서 갈라질 자리가 6배로 늘었다.
    //
    // 유도 사슬의 **끝**에서 잰다: 문구가 아니라 엔진이 돌려준 배수를 백분율로 되돌려 비교하면,
    // 중간의 어느 고리가 끊어져도 여기서 드러난다.
    const target: Square = { file: 2, rank: 4 };
    for (let t = 1; t <= MAX_TIER; t++) {
      const s = waveState();
      s.pieces.push(boardPiece('knight', 0, 3, t));
      expect(Math.round((1 - slowFactorAt(s, target)) * 100), `T${t}`).toBe(slowPercent(t));
      expect(slowPercent(t), `T${t}`).toBeGreaterThan(0);
      expect(slowPercent(t), `T${t}`).toBeLessThan(100);   // 100%면 적이 멈춘다 — 규칙 밖이다
    }
    // 인자 없는 호출은 T1이다. 기물 없이 규칙만 설명하는 자리(시작 화면의 기물 설명)가 그렇게
    // 쓰므로, 기본값이 조용히 바뀌면 그 화면만 다른 숫자를 말하게 된다.
    expect(slowPercent()).toBe(slowPercent(1));
  });
});
