import { describe, expect, it } from 'vitest';
import { CONFIG, clearBonus, enemyCount, enemyHp, pickGrantType } from '../src/config';
import { emptySquares, sellPrice } from '../src/core/economy';
import { createInitialState } from '../src/core/state';
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

/**
 * N1b — **실측** 구매력. N1a가 이론 상한을 재는 것과 달리, 이쪽은 한 판을 실제로 돌려
 * "플레이어가 손에 쥔 최대 구매력"을 잰다: 관측된 최대 보유 골드 + 무상으로 받은 기물의 원가.
 *
 * ⚠️ 이 신호는 구현 계획서(§S0 신호 표)가 S5 몫으로 정의해 놓고 **끝내 만들어지지 않았다.**
 * 그 사이 v1.12가 지급 기물을 트레이가 아니라 **보드에 직접 스폰**하도록 바꾸면서, 하필
 * 이 신호가 감시하도록 설계된 축이 크게 움직였다 — 지급 비숍이 받는 즉시 골드를 벌기
 * 시작한 것이다. **정의된 눈이 없던 자리에서 가장 큰 변화가 일어났다**는 것이 이 신호를
 * 뒤늦게라도 세우는 이유다.
 */
describe('N1b — 실측 구매력 ★ (감시: 무작위 지급 · 지급 기물의 즉시 참전)', () => {
  // 지급 종류를 고정하는 난수. pickGrantType의 누적 구간에서 뽑았다.
  const GRANT = {
    pawn: () => 0,
    bishop: () => 0.4,
    rook: () => 0.6,
    knight: () => 0.9,
  } as const;

  it('고정 난수가 의도한 종류를 뽑는다 — 아래 측정의 전제', () => {
    // 이 단언이 없으면 가중치를 조정했을 때 아래 기준선들이 **다른 것을 재면서** 그대로 통과한다.
    for (const [type, rng] of Object.entries(GRANT)) {
      expect(pickGrantType(rng()), type).toBe(type);
    }
  });

  it('★ w5 시작 구매력이 목표(3,000G) 안에 있다 — 계획서 §6의 지급 주기 판정 기준', () => {
    // 계획서는 grant.everyWaves를 2(10회)로 정하면서 그 근거를 "w5 시작 전 ≤ 3,000G"로 적었다
    // (20회면 3,928G로 처방 4를 상쇄한다). 그 판정을 지금 실측으로 다시 건다.
    for (const [type, rng] of Object.entries(GRANT)) {
      const r = fullRun(rooksTwoPerFile(), cycleRng(), rng);
      expect(r.goldAtWaveStart[4], type).toBeLessThanOrEqual(3000);
    }
  });

  it('w5 시작 보유 골드는 N1a의 이론 상한과 정확히 같다 — 전량 처치 빌드이므로', () => {
    // 룩 2기/파일은 일반 웨이브를 전멸시키므로 실측이 상한에 붙는다. 둘이 갈라지면 정산
    // 어딘가가 새는 것이고, 그 누수는 이 등식 말고는 드러나지 않는다.
    const r = fullRun(rooksTwoPerFile(), cycleRng(), GRANT.pawn);
    expect(r.goldAtWaveStart[4]).toBe(2788);
  });

  it('★ 지급 종류가 구매력을 바꾼다 — 비숍이 압도적이다 (v1.12가 만든 축)', () => {
    // 예전에는 지급 기물이 트레이에 앉아 있어 **종류와 무관하게** 원가만큼만 구매력이었다.
    // 이제 보드에서 곧바로 일하므로 "무엇을 받았는가"가 판 전체 수입을 좌우한다.
    const by = Object.fromEntries(
      Object.entries(GRANT).map(([t, rng]) => [t, fullRun(rooksTwoPerFile(), cycleRng(), rng)]),
    ) as Record<keyof typeof GRANT, ReturnType<typeof fullRun>>;

    // 지급 수는 종류와 무관하게 같다 — 달라지는 것은 그 기물이 판에서 하는 일뿐이다.
    for (const t of Object.keys(GRANT) as (keyof typeof GRANT)[]) {
      expect(by[t].granted, t).toBe(CONFIG.wave.total / CONFIG.grant.everyWaves);
      expect(by[t].grantedValue, t).toBe(by[t].granted * CONFIG.pieces[t].cost);
    }

    // ★ 비숍만 **보유 골드 자체**를 부풀린다(goldPerAttack). 나머지 셋은 원가만 더한다.
    expect(by.bishop.peakGold - by.pawn.peakGold).toBe(9320);
    expect(by.knight.peakGold).toBe(by.pawn.peakGold);   // 나이트는 공격력 0이라 수입에 무관

    // 룩은 이미 전멸하는 웨이브라 처치를 늘리지 못한다 — 원가만큼만 구매력이 는다.
    expect(by.rook.peakGold - by.pawn.peakGold).toBeLessThan(1000);

    // 실측 구매력 기준선. 가장 낮은 폰과 가장 높은 비숍의 폭이 곧 지급의 분산이다.
    expect(by.pawn.peakGold + by.pawn.grantedValue).toBe(21432);
    expect(by.bishop.peakGold + by.bishop.grantedValue).toBe(31752);
    expect(by.bishop.peakGold + by.bishop.grantedValue)
      .toBeGreaterThan((by.pawn.peakGold + by.pawn.grantedValue) * 1.4);
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

/**
 * N5 — 지급 폐기 횟수. 자리가 없어 지급이 환급으로 바뀐 횟수다.
 *
 * ⚠️ N1b와 마찬가지로 계획서가 정의해 놓고 **끝내 구현되지 않은** 신호다. 계획서는 이 값의
 * 목표 대역을 0~3회로 두고 **"0이면 갈림길 4번으로 판단을 올린다"**고 적었다 — 즉 0은
 * 실패가 아니라 **설계 판단을 요구하는 결과**다(위험 등록부 R15).
 *
 * ★ 실측 결과는 0이다. 그 판단의 내용은 아래 첫 테스트 주석에 적었다.
 */
describe('N5 — 지급 폐기 횟수 ★ (감시: 자리 압박이 실재하는가)', () => {
  const GRANT_PAWN = (): number => 0;
  const GRANTS = CONFIG.wave.total / CONFIG.grant.everyWaves;

  it('★ 정상 빌드에서는 한 번도 폐기되지 않는다 — "자리 압박"은 실재하지 않는다', () => {
    // ★ 계획서 R15가 예측한 그대로다. 판정(갈림길 4번): **원안이 노렸던 압박 목표는 폐기한다.**
    // 지급이 남기는 가치는 압박이 아니라 ① 판마다 다른 구성 ② 초반 부양 ③ 융합 재료 셋이고,
    // 그 셋은 폐기가 0이어도 온전히 성립한다.
    //
    // 무대는 v1.12에서 트레이 16칸 → 보드 56칸으로 넓어졌고, 그만큼 압박은 더 멀어졌다:
    // 최소 승리 빌드 28기 + 지급 10기 = 38기로 18칸이 남는다.
    for (const build of [rooksTwoPerFile(), minWinBuild()]) {
      const r = fullRun(build, cycleRng(), GRANT_PAWN);
      expect(r.discarded).toBe(0);
      expect(r.refunded).toBe(0);
      expect(r.granted).toBe(GRANTS);          // 열 번 다 실제로 받았다
    }
  });

  it('★ 그래도 폐기 경로는 죽은 코드가 아니다 — 보드를 채우면 전부 폐기된다', () => {
    // 위 테스트만 있으면 환급·배너·grantDiscarded 이벤트가 "도달 불가"로 보인다. 도달
    // 가능하다는 것을 같은 신호 안에서 보여야, 나중에 그 경로를 지우자는 판단이 나올 때
    // 근거가 함께 읽힌다. 폰 스팸 빌드에서는 실제로 일어나는 상황이다.
    const s = createInitialState();
    const full = emptySquares(s).map(q => boardPiece('pawn', q.file, q.rank));
    expect(full).toHaveLength(CONFIG.board.files * (CONFIG.board.ranks - 1));

    const r = fullRun(full, cycleRng(), GRANT_PAWN);
    expect(r.granted).toBe(0);                 // 한 번도 못 받았다
    expect(r.discarded).toBe(GRANTS);          // 열 번 다 폐기됐다
    // 환급은 판매가다 — 지급 종류가 폰이므로 원가의 sellRatio배.
    expect(r.refunded).toBe(GRANTS * sellPrice('pawn'));
  });

  it('추첨 횟수는 폐기 여부와 무관하다 — 조건부로 뽑으면 재현성이 사라진다', () => {
    // grant.test.ts가 같은 것을 draw 수로 재고, 여기서는 **결과 수**로 교차 확인한다:
    // 받았든 폐기됐든 둘의 합은 언제나 추첨 횟수와 같아야 한다.
    const s = createInitialState();
    const full = emptySquares(s).map(q => boardPiece('pawn', q.file, q.rank));
    for (const build of [rooksTwoPerFile(), full]) {
      const r = fullRun(build, cycleRng(), GRANT_PAWN);
      expect(r.granted + r.discarded).toBe(GRANTS);
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
  //
  // ⚠️ ★ **grantRng는 반드시 주입해야 한다**(v1.12). 기물 보관함이 사라지면서 지급 기물이
  // 트레이가 아니라 **보드에 스폰돼 곧바로 싸운다** — 무엇을 받았는지가 결과를 바꾼다.
  // 기본값(Math.random)으로 두면 같은 빌드의 총수입이 실측 20,862 ~ 23,762G로 널뛰어
  // 이 신호가 통째로 무의미해진다. 예전에는 지급 기물이 트레이에서 아무것도 하지 않아
  // 기본값이어도 결과가 고정됐다 — 그 사실에 기대고 있던 코드가 여기다.
  const GRANT_PAWN = () => 0;      // pickGrantType(0) = 폰(가중치 첫 구간). 폰은 골드를 벌지 않는다.
  it('룩 2기/파일: 일반 적 전멸 · 보스 4마리 전부 누수', () => {
    const r = fullRun(rooksTwoPerFile(), cycleRng(), GRANT_PAWN);
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
    // 보스이므로(체력 10 → −5 → 5 > 0) 이것이 의도된 상태다.
    // ⚠️ 이 빌드가 w20을 놓치는 것은 **화력이 모자라서가 아니라 배치 때문이다.** 같은 18,800G를
    // 보스 파일에 집중하면 8/8로 잡힌다(아래 N7 참고). 골드를 더 쓰는 것(룩 8기 +4,000G → 6/8)도
    // 방법이지만, 이 게임에서 w20을 여는 주된 수단은 구매가 아니라 **이동**이다.
    const r = fullRun(minWinBuild(), cycleRng(), GRANT_PAWN);
    expect(r.phase).toBe('victory');
    expect(r.kills).toBe(451);
    expect(r.leaks).toBe(1);
    expect(r.bossLeaks).toBe(1);
    expect(r.bossLeaks * CONFIG.player.hpLossBoss).toBeLessThan(CONFIG.player.startHp);
    // w20 보스 하나만 놓친다.
    expect(r.earned).toBe(earnedFor(w => w !== CONFIG.wave.total));
  });

  it('★ 지급 기물이 이제 수입에 직접 기여한다 — 보관함 폐지의 실제 크기 (v1.12)', () => {
    // 이 신호가 없으면 v1.12의 가장 큰 밸런스 변화가 어디에도 기록되지 않는다.
    //
    // 예전에는 지급 기물이 트레이에 쌓였고, 플레이어가 직접 배치하기 전까지 아무 일도 하지
    // 않았다. 헤드리스 하네스는 배치를 흉내내지 않으므로 지급 10기가 통째로 놀았고, 그래서
    // 총수입이 "처치 골드 + 클리어 보너스" 공식과 정확히 일치했다. 이제 스폰이 곧 배치라
    // 지급 비숍은 받는 즉시 골드를 벌고 지급 룩은 적을 잡는다.
    //
    // 폰(무수입)과 비숍(공격당 +10G)을 각각 고정 지급해 그 차이를 격리한다.
    const GRANT_BISHOP = () => 0.4;   // pickGrantType(0.4) = 비숍
    expect(pickGrantType(0)).toBe('pawn');
    expect(pickGrantType(0.4)).toBe('bishop');

    const pawns = fullRun(rooksTwoPerFile(), cycleRng(), GRANT_PAWN);
    const bishops = fullRun(rooksTwoPerFile(), cycleRng(), GRANT_BISHOP);

    // 처치 수는 같다 — 비숍은 공격력 1이라 룩 2기/파일이 이미 전멸시키는 적을 더 죽이지 못한다.
    expect(bishops.kills).toBe(pawns.kills);
    // 그런데 수입은 늘어난다. 그 증가분 전부가 비숍의 goldPerAttack이다.
    expect(bishops.earned).toBeGreaterThan(pawns.earned);
    // 폰 지급은 공식과 정확히 일치한다 — 지급이 수입에 관여하지 않는 유일한 경우다.
    expect(pawns.earned).toBe(earnedFor(w => w % CONFIG.wave.bossEvery !== 0));

    // 크기를 못박는다. 지급 10회 전부가 비숍일 때의 실측 증가분이다 — 기준 수입 20,132G의
    // **+46%**이고, 비숍 1기당 932G다(CONFIG.pieces 주석의 "한 판 1,120~1,850G"보다 낮은 것은
    // 지급이 짝수 웨이브마다 늦게 도착해 버는 시간이 짧기 때문이다).
    // 이 값이 v1.12가 플레이어에게 준 실질 이득의 크기이고, 밸런스를 되돌려야 할 때 볼 수다.
    expect(bishops.earned - pawns.earned).toBe(9320);
    expect((bishops.earned - pawns.earned) / pawns.earned).toBeGreaterThan(0.4);
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

  it('★ w20은 불가능한 벽이 아니다 — 더 사도 열리고, 옮기면 더 확실히 열린다', () => {
    // 이 단언이 없으면 w20 0/8이 "불가능한 벽"인지 "투자하면 되는 목표"인지 구분되지 않는다.
    // 벽이 되면 마지막 보스 보상 1,770G가 설계상 도달 불가가 된다.
    //
    // ⚠️ 이 테스트의 예전 이름은 "더 사면 w20이 열린다"였는데 그 서술은 절반만 맞았다. 실측상
    // w20을 여는 더 강한 수단은 **이동**이다 — 같은 18,800G를 대칭 배치하면 0/8, 보스 파일에
    // 집중하면 8/8이다. 골드는 보조 수단이고, 아래 두 단언이 그 둘을 각각 고정한다.
    const bigger = () => {
      const b = minWinBuild();
      for (const f of FILES) b.push(boardPiece('rook', f, 5));
      return b;
    };
    expect(buildCost(bigger()) - buildCost(minWinBuild())).toBe(8 * CONFIG.pieces.rook.cost);
    const killed = FILES.map(f => bossTransit(20, f, bigger())).filter(r => r.killed).length;
    expect(killed).toBeGreaterThanOrEqual(6);

    // ★ 그리고 더 사지 않아도, 같은 18,800G를 보스 파일 쪽으로 옮기기만 하면 8/8이 된다.
    // 이쪽이 더 싸고(0G) 더 확실하다(8/8 > 6/8). 보스는 적이 1마리·1파일이라 일반 웨이브의
    // 최적해("8파일을 고루 덮어라")가 통째로 뒤집힌다 — 대칭 배치는 화력의 5/8을 놀린다.
    //
    // ⚠️ 퀸은 **실제로 인접한** 파일에 둬야 한다. 인접 판정에 랩어라운드는 없으므로 파일 7의
    // 이웃을 (7+1)%8=0으로 잡으면 버프가 통째로 사라지고 같은 골드로도 7/8에 그친다.
    const focused = (bossFile: number) => {
      const { files, ranks } = CONFIG.board;
      // ★ 배치 가능한 랭크는 1~7이다. 8랭크는 적 스폰 구역이라 inLandableBounds가 막는다.
      //
      // ⚠️ v1.9의 첫 판본은 `r <= ranks`로 8랭크까지 채웠다 — **게임에서는 놓을 수 없는
      // 칸을 쓰는 대조군**이었다. 결론(같은 골드를 몰면 8/8)은 합법 칸만으로도 그대로
      // 재현되므로 신호가 거짓을 고정하고 있었던 것은 아니지만, 규칙이 금지한 칸에 기대는
      // 대조군은 그 자체로 신호를 못 믿게 만든다. 밸런스 측정 중에 발견해 고쳤다.
      const TOP = ranks - 1;
      const b: ReturnType<typeof minWinBuild> = [];
      const near = bossFile === files - 1 ? bossFile - 1 : bossFile + 1;
      const far = bossFile === files - 1 ? bossFile - 2 : bossFile === 0 ? 2 : bossFile - 1;
      const queens = () => b.filter(p => p.type === 'queen').length;
      // 보스 파일 한 줄은 적이 내려오는 내내 사거리 안에 든다
      for (let r = 1; r <= TOP; r++) b.push(boardPiece('rook', bossFile, r));
      for (const f of [near, far]) for (let r = 1; r <= TOP && queens() < 12; r++) {
        b.push(boardPiece('queen', f, r));
      }
      for (let d = 2, n = 0; d < files && n < 16 - TOP; d++) for (const sgn of [1, -1]) {
        const f = bossFile + d * sgn;
        if (f < 0 || f >= files) continue;
        for (let r = 1; r <= TOP && n < 16 - TOP; r++) {
          if (b.some(p => p.square!.file === f && p.square!.rank === r)) continue;
          b.push(boardPiece('rook', f, r)); n++;
        }
      }
      return b;
    };
    // ★ 대조군이 **게임에서 실제로 만들 수 있는 배치**인지 먼저 단언한다. 이 세 줄이 없었기
    // 때문에 첫 판본이 8랭크를 쓰는 것을 아무도 잡지 못했다.
    for (const f of FILES) {
      const build = focused(f);
      for (const p of build) {
        expect(p.square!.rank, `f${f}`).toBeLessThanOrEqual(CONFIG.board.ranks - 1);
        expect(p.square!.rank).toBeGreaterThanOrEqual(1);
      }
      const keys = build.map(p => `${p.square!.file},${p.square!.rank}`);
      expect(new Set(keys).size, `f${f} 중복 점유`).toBe(build.length);
    }
    expect(buildCost(focused(0))).toBe(buildCost(minWinBuild()));   // 한 푼도 더 쓰지 않는다
    expect(FILES.filter(f => bossTransit(20, f, focused(f)).killed).length).toBe(CONFIG.board.files);
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
