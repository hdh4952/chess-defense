import { describe, expect, it } from 'vitest';
import { CONFIG, TRAITS, enemyCount, slowPercent } from '../src/config';
import { createEnemy, moveEnemies } from '../src/core/enemy';
import { squareKey } from '../src/core/grid';
import { slowSquares, slowTargets } from '../src/core/patterns';
import { canPlaceAt } from '../src/core/pieces';
import { slowCoverage, slowFactorAt, updateSlowAura } from '../src/core/slow';
import { createInitialState } from '../src/core/state';
import { stepGame } from '../src/core/step';
import { HIGHLIGHT_COLORS, buildHighlights } from '../src/render/highlights';
import type { GameEvent, PieceType, Square } from '../src/types';
import { boardPiece, enemyAt, waveState } from './helpers';

/**
 * 감속 오라 (v1.10) — 나이트 계열이 L자 8칸의 적을 30% 느리게 만든다.
 *
 * 이 스위트가 따로 있는 이유는 능력이 세 계층에 걸쳐 있기 때문이다: 범위(patterns) · 계수
 * 적용(enemy/slow) · 미리보기(highlights). 어느 기존 파일에도 온전히 들어가지 않는다.
 * traits.test.ts가 TRAITS 표의 성질을 한곳에 모으는 것과 같은 자리다.
 *
 * 이 파일이 지키는 규칙 셋 — 셋 다 사용자가 명시적으로 정한 것이다:
 *   ① 중첩 없음   나이트가 몇 기든 정확히 ×0.7 한 번
 *   ② 티어 무관   T6도 30%
 *   ③ 8랭크 포함  적이 스폰되는 줄에서부터 걸린다 (배치 규칙과 갈라지는 지점)
 */

const M = CONFIG.slowAura.multiplier;
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
      .toBe(M);                                   // 감속은 걸린다
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

describe('감속 계수 — 중첩 없음 · 티어 무관', () => {
  it('★ 나이트 2기가 같은 칸을 덮어도 계수는 정확히 ×0.7 한 번이다', () => {
    // 중첩 방지의 표준 실패 모드는 "덮는 기물 수만큼 곱한다"이다. not.toBe(M*M)을 함께 둬
    // 곱셈 누적을 직접 배제한다. 두 나이트를 감속 칸이 아닌 자리에 두는 것도 의도적이다 —
    // 기물 자신의 칸이 섞이면 무엇이 덮은 것인지 구분되지 않는다.
    const target: Square = { file: 2, rank: 4 };
    expect(slowSquares({ file: 0, rank: 3 })).toContainEqual(target);
    expect(slowSquares({ file: 4, rank: 3 })).toContainEqual(target);

    const s = waveState();
    s.pieces.push(boardPiece('knight', 0, 3));
    const f1 = slowFactorAt(s, target);
    expect(f1).toBe(M);

    s.pieces.push(boardPiece('knight', 4, 3));
    expect(slowFactorAt(s, target)).toBe(M);
    expect(slowFactorAt(s, target)).toBe(f1);
    expect(slowFactorAt(s, target)).not.toBe(M * M);
  });

  it('★ 3기가 겹쳐도 마찬가지다 — n중첩 일반화', () => {
    // 2기 케이스만 두면 "곱하되 두 번째 인자가 우연히 1"인 구현도 통과할 수 있다.
    const target: Square = { file: 2, rank: 4 };
    const s = waveState();
    for (const [f, r] of [[0, 3], [4, 3], [1, 6]] as const) {
      expect(slowSquares({ file: f, rank: r })).toContainEqual(target);
      s.pieces.push(boardPiece('knight', f, r));
    }
    expect(slowFactorAt(s, target)).toBe(M);
    expect(slowFactorAt(s, target)).not.toBe(M ** 3);
  });

  it('★ T6 나이트도 30%다 — 티어는 감속량에 곱해지지 않는다', () => {
    // 이 코드베이스의 다른 모든 능력치는 tierMultiplier를 탄다(공격력·골드·버프·판매가).
    // 그래서 "여기도 곱해야지"가 가장 자연스러운 오류다. 전 티어를 순회한다.
    expect(CONFIG.merge.maxTier.knight).toBeGreaterThan(1);   // 공허 방지
    for (let k = 1; k <= CONFIG.merge.maxTier.knight; k++) {
      const s = waveState();
      s.pieces.push(boardPiece('knight', 0, 3, k));
      expect(slowFactorAt(s, { file: 2, rank: 4 }), `T${k}`).toBe(M);
    }
  });

  it('★ 융합 3종도 같은 계수를 준다 — 종류로도, 종류 조합으로도 갈라지지 않는다', () => {
    // "중첩 없음"을 같은 종류끼리만 구현하고(나이트 목록만 dedup) 종류가 다르면 곱하는
    // 구현이 실제로 흔하다. 티어·종류 두 축을 동시에 흔들어야 "이 값은 상수다"가 증명된다.
    const target: Square = { file: 2, rank: 4 };
    for (const type of ALL.filter(t => TRAITS[t].slow)) {
      const s = waveState();
      s.pieces.push(boardPiece(type, 0, 3));
      expect(slowFactorAt(s, target), type).toBe(M);
    }
    const mixed = waveState();
    mixed.pieces.push(boardPiece('knight', 0, 3), boardPiece('chancellor', 4, 3));
    expect(slowFactorAt(mixed, target)).toBe(M);

    const tiers = waveState();
    tiers.pieces.push(boardPiece('amazon', 0, 3, 6), boardPiece('knight', 4, 3, 1));
    expect(slowFactorAt(tiers, target)).toBe(M);
  });

  it('감속 기물이 아닌 기물은 어떤 칸도 느리게 하지 않는다 — 전수', () => {
    const s = waveState();
    let n = 0;
    for (const type of ALL.filter(t => !TRAITS[t].slow)) {
      s.pieces.push(boardPiece(type, n % FILES, (n % (RANKS - 1)) + 1));
      n++;
    }
    expect(n).toBeGreaterThan(0);                              // 공허 방지
    for (const sq of allSquares()) expect(slowFactorAt(s, sq), squareKey(sq)).toBe(1);
  });

  it('트레이의 나이트는 오라를 만들지 않고, 나이트 자신의 칸도 느려지지 않는다', () => {
    const tray = waveState();
    const p = boardPiece('knight', 3, 4);
    p.square = null; p.slotIndex = 0;
    tray.pieces.push(p);
    for (const sq of allSquares()) expect(slowFactorAt(tray, sq), squareKey(sq)).toBe(1);

    // 자기 칸은 L자 오프셋에 없다 — 3×3 폭발의 관성이 남지 않았는지 확인한다.
    const board = waveState();
    board.pieces.push(boardPiece('knight', 3, 4));
    expect(slowFactorAt(board, { file: 3, rank: 4 })).toBe(1);
  });

  it('slowCoverage의 except는 그 기물 하나만 없는 셈 친다 — 미리보기가 쓰는 경로', () => {
    const s = waveState();
    const a = boardPiece('knight', 0, 3);
    const b = boardPiece('knight', 4, 3);
    s.pieces.push(a, b);
    const target = squareKey({ file: 2, rank: 4 });
    expect(slowCoverage(s).has(target)).toBe(true);
    // 하나를 빼도 다른 하나가 여전히 덮는다 — 중첩이 없다는 사실이 여기서도 드러난다.
    expect(slowCoverage(s, a).has(target)).toBe(true);
    expect(slowCoverage(s, b).has(target)).toBe(true);
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
    expect(stepDelta(s, e, dt)).toBeCloseTo(base * M * dt, 9);

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

  it('★ stepGame 한 틱 안에서도 감속이 적용된다 (실전 경로를 실제로 탄다)', () => {
    // moveEnemies 단위 테스트만으로는 stepGame의 호출 순서에 감속이 실제로 얹혔는지 알 수
    // 없다. helpers의 transitDamage/fullRun이 전부 stepGame을 타므로 이쪽이 실전 경로다.
    const s = waveState();
    s.wave = 1;
    s.spawnedCount = enemyCount(1);                 // 추가 스폰 차단
    s.pieces.push(boardPiece('knight', 0, 3));
    const e = enemyAt(1, 2, 4);
    s.enemies.push(e);
    const base = e.speed;
    const dt = 1 / 600;                             // 한 칸을 벗어나지 않을 만큼 잘게
    const y0 = e.y;
    for (let i = 0; i < 60; i++) stepGame(s, dt, [], () => 0, () => 0);
    expect(e.y - y0).toBeCloseTo(base * M * dt * 60, 6);
  });

  it('★ 감속 진입은 전이에서 한 번만 알린다 — 이미 느린 적은 다시 알리지 않는다', () => {
    // 중첩 없음이 시간축에서도 보이는 지점이다. 매 틱 발행하면 60fps × 적 수만큼 쏟아져
    // 이펙트도 소리도 쓸 수 없고, 무엇보다 "실제로 일어난 사건의 수"가 아니게 된다.
    const s = waveState();
    s.pieces.push(boardPiece('knight', 0, 3));
    const e = enemyAt(1, 2, 4);
    s.enemies.push(e);

    const ev: GameEvent[] = [];
    updateSlowAura(s, ev);
    expect(ev.filter(x => x.kind === 'enemySlowed')).toHaveLength(1);
    updateSlowAura(s, ev);
    updateSlowAura(s, ev);
    expect(ev.filter(x => x.kind === 'enemySlowed')).toHaveLength(1);   // 여전히 1

    // 두 번째 나이트가 같은 적을 덮어도 새 사건이 아니다 — 정말 아무 일도 일어나지 않았다.
    s.pieces.push(boardPiece('knight', 4, 3));
    updateSlowAura(s, ev);
    expect(ev.filter(x => x.kind === 'enemySlowed')).toHaveLength(1);

    // 오라를 벗어났다 다시 들어오면 그때는 새 사건이다.
    s.pieces = [];
    updateSlowAura(s, ev);
    expect(e.slowed).toBe(false);
    s.pieces.push(boardPiece('knight', 0, 3));
    updateSlowAura(s, ev);
    expect(ev.filter(x => x.kind === 'enemySlowed')).toHaveLength(2);
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
    expect(e.y - y0).toBeCloseTo(e.speed * M * dt, 9);

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

    // ★ 그런데 계수 함수 자체는 페이즈와 무관하게 M을 돌려줘야 한다. 여기 페이즈 게이트를
    // 이중으로 넣으면 미리보기가 prepare 중에 오라를 그리지 못하는데, 준비 시간에 오라
    // 배치를 계획하는 것이 이 기물의 유일한 플레이라 그 회귀는 치명적이다.
    expect(slowFactorAt(s, { file: 2, rank: 4 })).toBe(M);
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
    expect(delta(false, 'swift', true) / delta(false, 'swift', false)).toBeCloseTo(M, 9);
  });

  it('보스도 감속 대상이다 — bossForbidden은 적 유형 전용이지 오라와 무관하다', () => {
    // CONFIG.bossForbidden에 'swift'가 있어 "보스는 속도를 안 건드린다"로 오해하기 쉽다.
    // 감속은 보스에게 유리하지 않고(딜 넣을 시간이 늘어난다) 설계에도 예외가 없다.
    expect(CONFIG.bossForbidden).toContain('swift');
    expect(delta(true, null, true) / delta(true, null, false)).toBeCloseTo(M, 9);
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
  it('★ 상시 오라가 읽는 집합 = 실제로 느려지는 칸 (같은 함수 하나)', () => {
    // renderer.drawSlowField가 slowCoverage(state)를 그대로 칠하고, updateSlowAura도 같은
    // 함수로 판정한다. "칠해졌는데 안 느려지는 칸"이 존재할 수 없다는 것이 그 공유에서
    // 나온다 — 이 테스트는 그 공유가 실제로 성립하는지를 좌표 수준에서 확인한다.
    const s = waveState();
    s.pieces.push(boardPiece('knight', 3, 6));        // 8랭크를 덮는 자리

    const drawn = [...slowCoverage(s).values()];
    const actual = allSquares().filter(sq => slowFactorAt(s, sq) < 1);
    expect(keys(drawn)).toEqual(keys(actual));
    // ★ 이 게임에서 유일하게 새로운 정보 — 스폰 구역도 칠해지고 실제로도 느려진다.
    expect(keys(drawn)).toContain(squareKey({ file: 4, rank: 8 }));
    expect(keys(drawn)).toContain(squareKey({ file: 2, rank: 8 }));
  });

  it('★ 상시 오라는 칸당 한 번만 그려진다 — 겹쳐 칠하면 "저기가 더 느리다"는 거짓말이 된다', () => {
    // 중첩 금지가 **자료구조로** 보장되는 지점. drawSlowField의 인자가 Map이라 나이트가
    // 몇 기든 원소가 하나이고, 알파가 두 겹 얹힐 방법이 코드에 존재하지 않는다.
    const target = squareKey({ file: 2, rank: 4 });
    const a = boardPiece('knight', 0, 3);
    const b = boardPiece('knight', 4, 3);

    // 각자 혼자 덮는 칸 수 — 보드 가장자리라 둘의 개수가 다르다(클리핑). 그래서 합집합을
    // "8+8"이 아니라 **각자의 실측 합**과 비교해야 한다.
    const only = (p: typeof a): number => {
      const s = waveState(); s.pieces.push(p); return slowCoverage(s).size;
    };
    const sizeA = only(a), sizeB = only(b);

    const s = waveState();
    s.pieces.push(a, b);
    const both = slowCoverage(s);
    expect(both.has(target)).toBe(true);
    // 겹친 칸은 합쳐도 원소 하나다 — 그래서 합집합이 각자의 합보다 반드시 작다.
    expect(both.size).toBeLessThan(sizeA + sizeB);
    expect([...both.keys()].filter(k => k === target)).toHaveLength(1);
    // 겹친 칸 수가 0이면 위 단언이 공허해진다 — 실제로 겹치는 배치인지 확인한다.
    expect(sizeA + sizeB - both.size).toBeGreaterThan(0);
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
  it('slowPercent()가 multiplier와 어긋나지 않는다', () => {
    // 툴팁·시작 화면·"−30%" 라벨이 전부 이 함수를 쓴다. 리터럴 30을 박으면 multiplier를
    // 바꾸는 순간 셋이 각자 옛 숫자를 말하기 시작하고, 그 어긋남은 테스트가 아니라
    // 플레이어가 발견한다.
    expect(slowPercent()).toBe(Math.round((1 - M) * 100));
    expect(slowPercent()).toBeGreaterThan(0);
    expect(slowPercent()).toBeLessThan(100);
  });
});
