import { describe, expect, it } from 'vitest';
import { CONFIG, clearBonus, enemyCount, enemyHp } from '../src/config';
import {
  boardPiece, bossTransit, buildCost, chaseWave5Boss, countingRng, cycleRng,
  fullRun, minWinBuild, rooksTwoPerFile, transitDamage,
} from './helpers';
import type { EnemyTrait } from '../src/types';

/**
 * 회귀 신호 (S0) — 개선 시리즈가 밸런스를 건드릴 때 **무엇이 얼마나 움직였는지** 보기 위한 것.
 *
 * 이 파일이 왜 필요한가. 기존 두 신호로는 감시가 되지 않는다.
 *  - §9.5 대조군("룩1/파일이면 누수 0")은 **포화 신호**다. 모든 적을 파일 하나로만 스폰시켜도
 *    w16·w19 누수가 0이라, 화력을 절반으로 깎아도 초록으로 남는다.
 *  - w5 게이트는 단언이 `killed === true` 하나뿐이라 **200G짜리 기물이 통째로 빠져도 초록이다.**
 *
 * 그래서 여기 신호는 전부 **연속량**(총피해·처치 여부·draw 횟수)이고, 각 신호마다 "어느 단계를
 * 감시하는가"를 명시한다. 수치는 전부 CONFIG에서 유도하거나 실측 기준선을 그대로 못박는다.
 *
 * ⚠️ 기준선이 깨졌을 때 먼저 의심할 것: 밸런스 변경이 아니라 **하네스가 달라진 것**이 아닌지.
 *    특히 `minWinBuild`의 배치와 `recalcQueenBuffs` 호출 누락 — 후자는 퀸 12기를 통째로
 *    놀게 만들어 보스 화력을 실제의 1/3로 떨어뜨린다(개발 중 실제로 겪었다).
 */

const FILES = [...Array(CONFIG.board.files).keys()];

describe('N1a — 이론 예산 상한 (감시: 클리어 보너스 단계)', () => {
  function grossKillGold(uptoExclusive: number): number {
    let g = 0;
    for (let w = 1; w < uptoExclusive; w++) {
      const isBoss = w % CONFIG.wave.bossEvery === 0;
      g += enemyCount(w) * enemyHp(w) * (isBoss ? CONFIG.enemy.bossHpMultiplier : 1);
    }
    return g;
  }
  /** 무누수·**전량 처치**·방어비 0을 가정한 상한. 전량 처치 가정이라 보너스는 곡선의 최댓값을
   *  쓴다 — 처치율 연동이 들어간 뒤에도 "상한"의 정의는 바뀌지 않는다. */
  const sumBonus = (uptoInclusive: number): number => {
    let g = 0;
    for (let w = 1; w <= uptoInclusive; w++) g += clearBonus(w);
    return g;
  };
  const ceilingBefore = (w: number): number =>
    CONFIG.player.startGold + grossKillGold(w) + sumBonus(w - 1);

  it('w5 · w11 · 총액 기준선 (곡선 도입으로 갱신)', () => {
    // 정액 300G 시절: 2,108 / 6,426 / 24,702. 곡선이 초반을 32% 열고 총액은 거의 그대로 둔다.
    expect(ceilingBefore(5)).toBe(2788);
    expect(ceilingBefore(11)).toBe(7526);
    expect(ceilingBefore(CONFIG.wave.total + 1)).toBe(24902);
  });

  it('곡선의 모양 — 초반을 열고 후반을 조인다', () => {
    expect(clearBonus(1)).toBe(500);
    expect(clearBonus(10)).toBe(320);
    expect(clearBonus(20)).toBe(120);
    expect(sumBonus(CONFIG.wave.total)).toBe(6200);   // 정액 시절 6,000과 거의 같다
  });

  it('★ 처치율 연동 — 누수 방치에 처음으로 대가가 생긴다', () => {
    // 예전에는 클리어 보너스가 정액이라 "체력만 버틸 수 있다면 누수 방치는 처치 골드만
    // 포기하는 선택지"였다. 곡선은 그 무조건 수입을 1.67배로 키우므로 연동이 함께 와야 한다.
    expect(clearBonus(1, 1)).toBe(500);      // 전멸
    expect(clearBonus(1, 0.5)).toBe(375);
    expect(clearBonus(1, 0)).toBe(250);      // 전량 누수 — 하한 50%가 사망 나선을 막는다
    expect(clearBonus(1, 0)).toBe(clearBonus(1) * CONFIG.wave.clearBonusFloor);
  });
});

describe('N2 — 단일 적 종주 총피해 (감시: 적 유형·융합 단계)', () => {
  // 이 게임의 처치는 계단 함수다. 종주 중 받는 총 피해가 체력을 넘으면 죽고, 못 넘으면 그
  // 피해는 전량 폐기된다. 그래서 "누수 몇 마리"와 달리 이 값은 화력·감산·속도 어느 축을
  // 건드려도 선형으로 반응한다 — 이 파일에서 가장 해상도가 높은 신호다.
  it('T1 룩 1기 = 40 (문턱 w17 47 · w19 55에 못 미친다)', () => {
    const rook1 = () => [boardPiece('rook', 2, 1)];
    // floor(종주 24s / 주기 3.0s) × 공격력 5 = 40. 유도식과 실측이 일치하는지 함께 본다.
    const derived = Math.floor(
      (CONFIG.board.ranks * CONFIG.enemy.secondsPerSquare) / CONFIG.pieces.rook.interval,
    ) * CONFIG.pieces.rook.damage;
    expect(derived).toBe(40);
    expect(transitDamage(17, rook1(), 2)).toBe(40);
    expect(transitDamage(19, rook1(), 2)).toBe(40);
  });

  it('문턱을 넘는 두 방법(룩 2기 / T2 룩 1기)은 같은 결과를 낸다 — 합성 중립성의 종주 판본', () => {
    const spread = () => [boardPiece('rook', 2, 1), boardPiece('rook', 2, 2)];
    const merged = () => [boardPiece('rook', 2, 1, 2)];
    for (const w of [17, 19]) {
      const hp = enemyHp(w);
      expect(transitDamage(w, spread(), 2)).toBe(hp);   // 처치 → maxHp로 클램프
      expect(transitDamage(w, merged(), 2)).toBe(hp);
    }
  });

  it('적 유형이 붙으면 값이 실제로 움직인다 (유형이 적용되고 있다는 증거)', () => {
    // 이 신호가 안 움직이면 유형이 스폰 경로에만 있고 피해 계산에는 닿지 않은 것이다.
    const rook = () => [boardPiece('rook', 2, 1)];
    expect(transitDamage(19, rook(), 2)).toBe(40);
    expect(transitDamage(19, rook(), 2, ['armored'])).toBe(25);
    expect(transitDamage(19, rook(), 2, ['shielded'])).toBe(32);
    expect(transitDamage(19, rook(), 2, ['swift'])).toBe(30);   // 종주가 짧아져 발사 기회가 준다
  });

  it('폰 2기 = 24 · 비숍 1기 = 1 (웨이브 무관 — 화력이 적 체력에 의존하지 않는다)', () => {
    const pawns = () => [boardPiece('pawn', 1, 4), boardPiece('pawn', 3, 4)];
    for (const w of [17, 19]) {
      expect(transitDamage(w, pawns(), 2)).toBe(24);
      expect(transitDamage(w, [boardPiece('bishop', 3, 4)], 3)).toBe(1);
    }
  });
});

describe('N3 — w5 게이트 최소성 (감시: 전 단계)', () => {
  const bossFile = 3;
  const chasePawns = () => [
    boardPiece('pawn', bossFile - 1, 7), boardPiece('pawn', bossFile + 1, 7),
  ];

  it('개별 기여도 기준선', () => {
    expect(chaseWave5Boss(chasePawns()).dealt).toBe(336);
    expect(chaseWave5Boss([], [boardPiece('rook', bossFile, 1)]).dealt).toBe(80);
    expect(chaseWave5Boss([], [boardPiece('bishop', 5, 5)]).dealt).toBe(4);
  });

  it('★ 최소성 — 기물을 하나라도 빼면 실패해야 한다 (하향 감지)', () => {
    // 기존 게이트 테스트의 `killed === true` 하나로는 200G짜리 비숍이 통째로 빠져도 초록이다.
    // "빠지면 깨진다"를 직접 단언해야 화력 하향이 잡힌다.
    const full = () => chaseWave5Boss(chasePawns(), [
      boardPiece('rook', bossFile, 1), boardPiece('bishop', 5, 5),
    ]);
    expect(full().killed).toBe(true);

    const withoutRook = chaseWave5Boss(chasePawns(), [boardPiece('bishop', 5, 5)]);
    expect(withoutRook.killed).toBe(false);

    const withoutOnePawn = chaseWave5Boss([boardPiece('pawn', bossFile - 1, 7)], [
      boardPiece('rook', bossFile, 1), boardPiece('bishop', 5, 5),
    ]);
    expect(withoutOnePawn.killed).toBe(false);
  });

  it('★ 상향 감지 — 비숍 없이도 처치되지만 마지막 틱에 겨우 된다', () => {
    // 이 빌드가 이 게임에서 가장 얇은 마진이다. 화력이 조금이라도 올라가면 killT가 앞당겨지므로,
    // `killed === true`가 아니라 **언제 죽는가**를 봐야 상향이 잡힌다.
    const withoutBishop = chaseWave5Boss(chasePawns(), [boardPiece('rook', bossFile, 1)]);
    expect(withoutBishop.killed).toBe(true);
    const descentSeconds =
      (CONFIG.board.ranks * CONFIG.enemy.secondsPerSquare) / CONFIG.enemy.bossSpeedMultiplier;
    expect(withoutBishop.bossKillT).toBeGreaterThan(descentSeconds - 2);
  });
});

describe('N4 — 합성 골드 중립성 (감시: 적 유형·융합 단계)', () => {
  // ★ 불변식의 형태가 중요하다. "티어 k 피해 ÷ 2^(k−1)이 일정"은 **곱셈 효과에만** 성립하고
  // 보호막처럼 총량에서 한 번 빼는 효과에는 성립하지 않는다(풀은 기물 수와 무관하게 한 번만
  // 소모되므로). 실제로 지켜야 할 것은 "**같은 골드**에서 T1 둘과 T2 하나가 같은 결과"다.
  const TRAIT_CASES: EnemyTrait[][] = [
    [], ['armored'], ['shielded'], ['swift'], ['armored', 'shielded'],
  ];

  it('T1 둘 = T2 하나 — 모든 적 유형 조합에서', () => {
    for (const traits of TRAIT_CASES) {
      const spread = transitDamage(20, [boardPiece('rook', 2, 1), boardPiece('rook', 2, 2)], 2, traits);
      const merged = transitDamage(20, [boardPiece('rook', 2, 1, 2)], 2, traits);
      expect(merged, JSON.stringify(traits)).toBe(spread);
    }
  });

  it('장갑은 비율이라 티어에 같은 배수가 걸린다', () => {
    // 고정 감산(−2)이면 여기가 깨진다 — 티어마다 다른 비율로 깎이기 때문이다.
    // 이 단언 하나가 "장갑은 비율 감산" 결정을 영구히 강제한다.
    const armor = CONFIG.traitDefs.armored.damageMultiplier!;
    for (let k = 1; k <= CONFIG.merge.maxTier.bishop; k++) {
      const plain = transitDamage(20, [boardPiece('bishop', 3, 4, k)], 3);
      const armored = transitDamage(20, [boardPiece('bishop', 3, 4, k)], 3, ['armored']);
      expect(armored).toBe(plain * armor);
    }
  });
});

describe('N6 — 엔진 무결성 풀런 (감시: 전 단계)', () => {
  /** "이 웨이브를 전멸시켰는가"를 주면 총 수입을 CONFIG에서 유도한다. 처치 골드와 클리어
   *  보너스(처치율 연동 포함) 둘 다 계산하므로, 수입 규칙이 바뀌면 여기서 한 번에 드러난다. */
  function earnedFor(cleared: (wave: number) => boolean): number {
    let g = 0;
    for (let w = 1; w <= CONFIG.wave.total; w++) {
      const isBoss = w % CONFIG.wave.bossEvery === 0;
      const ratio = cleared(w) ? 1 : 0;
      g += ratio * enemyCount(w) * enemyHp(w) * (isBoss ? CONFIG.enemy.bossHpMultiplier : 1);
      g += clearBonus(w, ratio);
    }
    return g;
  }

  // rng 감시 역할은 없다. 8파일 대칭 빌드에서는 스폰 파일이 결과에 영향을 주지 않아
  // `() => 0`(전부 파일 0)으로 돌려도 같은 값이 나온다. rng는 N8이 본다.
  it('룩 2기/파일: 일반 적 전멸 · 보스 4마리 전부 누수', () => {
    const r = fullRun(rooksTwoPerFile(), cycleRng());
    expect(r.phase).toBe('victory');
    expect(r.kills).toBe(448);
    expect(r.leaks).toBe(4);
    expect(r.bossLeaks).toBe(4);
    // 수입을 유도로 확인한다 — 이 빌드는 일반 적을 전멸시키고 보스 4마리를 전부 놓치므로
    // 보스 웨이브의 처치율은 0이고 보너스가 하한(50%)까지 깎인다.
    expect(r.earned).toBe(earnedFor(w => w % CONFIG.wave.bossEvery !== 0));

    // ★ 이 빌드가 이 시리즈의 전제를 한 줄로 보여준다 — 일반 웨이브 누수가 0인데도
    //   보스 누수 4회 × 5 = 20 > 시작 체력 10이라 실제로는 패배 빌드다.
    expect(r.bossLeaks * CONFIG.player.hpLossBoss).toBeGreaterThan(CONFIG.player.startHp);
  });

  it('최소 승리 빌드: w20 보스 하나만 놓친다', () => {
    // 적 유형 도입 전에는 무누수(452킬)였다. 지금은 w20 보스를 놓친다 — w20은 놓쳐도 이기는
    // 보스이므로(체력 10 → −5 → 5 > 0) 이것이 의도된 상태다. 그 보스를 잡으려면 더 사야 한다
    // (실측: 룩 8기 +4,000G면 w20이 6/8이 된다).
    const r = fullRun(minWinBuild(), cycleRng());
    expect(r.phase).toBe('victory');
    expect(r.kills).toBe(451);
    expect(r.leaks).toBe(1);
    expect(r.bossLeaks).toBe(1);
    expect(r.bossLeaks * CONFIG.player.hpLossBoss).toBeLessThan(CONFIG.player.startHp);
    // w20 보스 하나만 놓친다.
    expect(r.earned).toBe(earnedFor(w => w !== CONFIG.wave.total));
  });
});

describe('N7 — 보스 3/4 처치 가능성 ★ (감시: 적 유형 단계의 유일한 난이도 판정)', () => {
  it('최소 승리 빌드 비용은 18,800G (CONFIG 유도)', () => {
    expect(buildCost(minWinBuild())).toBe(
      16 * CONFIG.pieces.rook.cost + 12 * CONFIG.pieces.queen.cost,
    );
    expect(buildCost(minWinBuild())).toBe(18800);
  });

  it('w5 · w10 · w15 보스는 어느 파일에 나와도 반드시 잡힌다', () => {
    // 시작 체력 10 / 보스 누수 −5이므로 보스 4마리 중 3마리는 반드시 잡아야 한다.
    // 여기가 깨지면 그 빌드로는 게임을 이길 수 없다 — 적 유형 단계의 합격선이다.
    for (const w of [5, 10, 15]) {
      for (const f of FILES) {
        expect(bossTransit(w, f, minWinBuild()).killed, `w${w} 파일${f}`).toBe(true);
      }
    }
  });

  it('w20 보스는 최소 승리 빌드로는 잡히지 않는다 — 놓쳐도 이기지만 보상은 못 받는다', () => {
    const killed = FILES.map(f => bossTransit(20, f, minWinBuild())).filter(r => r.killed).length;
    expect(killed).toBe(0);
  });

  it('★ 더 사면 w20이 열린다 — "약간 더 사면 되는 압력"이 실제로 존재하는지', () => {
    // 이 단언이 없으면 w20 0/8이 "불가능한 벽"인지 "투자하면 되는 목표"인지 구분되지 않는다.
    // 벽이 되면 마지막 보스 보상 1,770G가 설계상 도달 불가가 된다.
    const bigger = () => {
      const b = minWinBuild();
      for (const f of FILES) b.push(boardPiece('rook', f, 5));
      return b;
    };
    expect(buildCost(bigger()) - buildCost(minWinBuild())).toBe(8 * CONFIG.pieces.rook.cost);
    const killed = FILES.map(f => bossTransit(20, f, bigger())).filter(r => r.killed).length;
    expect(killed).toBeGreaterThanOrEqual(6);
  });
});

describe('N8 — rng draw 총수 ★ (감시: 무작위 지급 단계)', () => {
  it('draw는 정확히 스폰 마리 수와 같다', () => {
    // 스폰 파일 추첨은 호출 "순서"에만 의존한다. 지급 추첨 같은 소비 지점이 하나라도 늘면
    // 파일 시퀀스가 통째로 달라져 이후 모든 헤드리스 측정이 조용히 다른 것을 재게 된다.
    const rng = countingRng(cycleRng());
    fullRun(rooksTwoPerFile(), rng);
    let expected = 0;
    for (let w = 1; w <= CONFIG.wave.total; w++) expected += enemyCount(w);
    expect(rng.count()).toBe(expected);
    expect(rng.count()).toBe(452);
  });
});
