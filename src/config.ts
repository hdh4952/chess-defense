import type { EnemyTrait, PieceType } from './types';

export const CONFIG = {
  board: { files: 8, ranks: 8, squarePx: 80 },

  player: { startHp: 10, startGold: 300, hpLossNormal: 1, hpLossBoss: 5 },

  wave: {
    total: 20,
    prepareSeconds: 10,
    // 클리어 보너스는 정액이 아니라 **역방향 곡선**이다. 이 게임은 골드의 83%가 후반에
    // 들어오는데 최소 승리 비용은 초반부터 필요해서, 정액 보너스는 초반을 조이고 후반에
    // 남아돌게 만든다. 곡선으로 바꾸면 w5 예산이 2,108 → 2,788G(+32%)가 되고 후반 잉여는
    // 줄어든다. 총액은 6,000 → 6,200G로 거의 그대로다.
    clearBonusBase: 500,
    clearBonusDecay: 20,
    // 처치율 연동의 하한. 0으로 두면 무너진 판의 수입이 더 줄어 사망 나선이 생기고,
    // 1로 두면(=연동 없음) "체력만 버틸 수 있다면 누수 방치가 이득"이라는 기존 구멍이
    // 곡선 때문에 오히려 커진다(무조건 수입이 w1 기준 300 → 500G로 1.67배).
    clearBonusFloor: 0.5,
    spawnInterval: 1.0,
    countBase: 10,
    countPerWave: 2,        // 10 + 2*(w-1)
    bossEvery: 5,
  },

  enemy: {
    hpBase: 10,
    hpPerWaveEarly: 1,      // w <= 10
    hpPerWaveLate: 4,       // w >= 11
    hpScalingBreakpoint: 10,
    secondsPerSquare: 3.0,
    bossHpMultiplier: 30,
    bossSpeedMultiplier: 0.5,
    spritePx: 44,
    jitterPx: 8,
  },

  /**
   * goldPerAttack — 공격 1회당 얻는 골드. "1회"는 combat.ts가 실제로 발사한 횟수이지, 명중한
   * 적의 수도 처치한 수도 아니다(정액). 사거리에 적이 없으면 발사 자체가 없으므로 골드도 없다.
   * 퀸 버프는 공격력에만 곱해진다 — 골드에는 적용하지 않는다 (사용자 결정).
   *
   * 비숍만 0이 아니다: 딜러(공격력 3)에서 경제 기물(공격력 1 + 골드)로 역할을 바꿨다. 헤드리스
   * 실측(2026-08-15, 이 수치로 20웨이브 완주 ≈970초)으로 비숍 한 기의 총 공격 횟수는 배치에 따라
   * 112~185회 — 공격당 10G면 한 판에 1,120~1,850G로 비용 200G의 5.6~9.3배를 회수한다. 수입은
   * 웨이브당 20~60G(초반) → 160~190G(후반)로 커지지만 후반 처치 골드가 웨이브당 2,000G를 넘으므로
   * 비중은 오히려 줄어든다 — 즉 초반 투자 기물이다. 보스 웨이브만 예외적으로 낮다(20~50G): 보스
   * 한 마리는 대각선을 잠깐 스칠 뿐이라 48초짜리 웨이브에서도 2~5회밖에 못 쏜다.
   * 적이 사거리에 살아 있어야만 벌리는 구조라 방어가 무너지면 수입도 함께 끊긴다(스노우볼 방지).
   *
   * 비용은 300 → 200이다: 공격력을 버린 대신 초반 회수(초반 수입 기준 웨이브 4~5개)를 앞당겨,
   * "초반에 지르고 굴린다"는 이 기물의 결정 자체가 성립하게 만든다. 총 수익이 아니라 비용을
   * 건드린 이유는 goldPerAttack을 올리면 이미 골드가 남아도는 후반 수입까지 같이 부풀기 때문이다.
   */
  pieces: {
    pawn:   { cost: 100, damage: 2, interval: 0.5, goldPerAttack: 0  },
    // 이동 쿨다운 없음 (게임 규칙 변경, 사용자 승인) — 나이트는 배치·이동마다 매번 폭발한다.
    // 게이트(canLandAt/tryKnightBlast/drag.ts)는 그대로 남아 있으므로 3.0 등으로 되돌리면
    // 옛 쿨다운 동작이 코드 변경 없이 복원된다.
    knight: { cost: 300, damage: 3, interval: 0,   goldPerAttack: 0  },
    bishop: { cost: 200, damage: 1, interval: 3.0, goldPerAttack: 10 },
    rook:   { cost: 500, damage: 5, interval: 3.0, goldPerAttack: 0  },
    queen:  { cost: 900, damage: 0, interval: 0,   goldPerAttack: 0  },

    // ── 융합 기물 (v1.9) — 상점에 없고 뽑기에도 안 나온다. 같은 티어 재료 둘을 겹쳐야 나온다.
    //
    // 능력치는 **재료 합**이다. 그래야 §5.4의 골드 중립성과 판매가 불변식(원가 × 2^(t−1) × 0.5)이
    // 그대로 성립한다 — cost도 재료 원가의 합으로 둔 이유가 그것이다. 융합은 "더 세지는" 것이
    // 아니라 **역할을 겸업시키는** 것이다: 나이트는 자동 공격이 없어 칸값을 못 하는데, 융합물은
    // 재료의 주기 공격 + 나이트의 이동 폭발을 한 칸에서 겸한다.
    //
    // interval은 나이트 것(0)을 물려받지 않고 **주기 공격을 담당하는 재료의 것**을 쓴다.
    // 나이트의 interval 0을 상속하면 드래그 반복만으로 무제한 폭발하는 기물이 된다.
    archbishop: { cost: 500,  damage: 4, interval: 3.0, goldPerAttack: 10 },  // 비숍(200)+나이트(300)
    chancellor: { cost: 800,  damage: 8, interval: 3.0, goldPerAttack: 0  },  // 룩(500)+나이트(300)
    amazon:     { cost: 1200, damage: 3, interval: 0,   goldPerAttack: 0  },  // 퀸(900)+나이트(300)
  },

  /**
   * 동일 기물 합성 — **같은 종류 · 같은 티어**끼리만 합쳐지고 티어가 한 단계 오른다
   * (흰+흰=녹, 녹+녹=파, 파+파=보, 보+보=노, 노+노=빨). 능력치는 정확히 "합"이다: 공격력 5짜리
   * 룩 둘을 합치면 10이고, 판매가도 두 기물 판매가의 합과 같다.
   *
   * 같은 티어끼리만 합쳐지므로 배수는 단계마다 정확히 2배가 된다 — T2가 T1 둘의 합(×2)이고
   * T3는 그 T2 둘의 합(×4)이다. 그래서 tier는 "흡수한 개수"가 아니라 레벨이고, 실제 배수는
   * tierMultiplier()가 유도한다.
   *
   * 배수와 비용이 같은 속도로 커지므로(둘 다 2의 거듭제곱) 골드당 화력은 티어와 무관하게
   * 일정하다 — 이 기능은 골드 축에서 정확히 중립이다. 헤드리스 통제 실측(골드·파일 커버리지를
   * 동시에 고정)에서도 8,000G 룩 16×T1과 8×T2가 w16~w19 누수 0으로 완전히 동률이었고, 20웨이브
   * 최소 승리 비용도 18,800G로 합성 유무가 같았다. 다른 것은 그 방어선이 차지하는 칸뿐이다
   * (28칸 → 8칸). 즉 합성은 증폭이 아니라 압축이다.
   *
   * 플레이 상의 의미는 "문턱"에서 나온다. 룩 2기가 적 한 마리에게 넣는 총딜은 45(자기 파일 8발
   * + 상대 랭크 1발)라 w16의 43은 넘지만 w17의 47은 못 넘는데, 못 넘으면 그 피해는 전량 폐기된다
   * (실측: 같은 1,000G로 w17에서 룩 2×T1은 처치 0, 1×T2는 처치 6). 화력이 남으면 흩어놓는 쪽이,
   * 문턱에 걸리면 합치는 쪽이 옳다.
   *
   * maxTier는 5종 모두 6이다 — 테두리 색 6단계와 같은 수. 다만 퀸만은 성질이 다르다는 것을
   * 알고 열어 둔 것이라 근거를 남긴다(사용자 결정): 퀸의 버프는 다른 모든 기물의 공격력에
   * 곱해지는 유일한 값이라, 퀸의 티어 상한은 그대로 게임 전체 화력의 지수가 된다.
   * T3 퀸 두 기의 라인이 겹치는 칸은 이미 ×9이고, T6 두 기가 겹치면 ×65다 — 그 칸의 T6 룩은
   * 공격력 160 × 65 = 10,400이 된다(w20 보스 HP 1,770의 5.9배를 한 발에). 밸런스가 무너지면
   * 여기 queen만 3으로 되돌리는 것이 가장 국소적인 처방이고, 그러면 T3가 상한이 된다.
   */
  merge: {
    maxTier: {
      pawn: 6, knight: 6, bishop: 6, rook: 6, queen: 6,
      // 융합물도 같은 상한을 쓴다 — 같은 종류·같은 티어끼리 다시 합칠 수 있다.
      archbishop: 6, chancellor: 6, amazon: 6,
    },
  },

  /**
   * 적 유형 — 웨이브가 진행되며 섞여 들어오는 세 가지 정체성.
   *
   * **이것은 난이도 노브가 아니다.** 헤드리스 실측으로 룩 2기/파일 이상에서는 감산을 0.5까지
   * 내려도 w16~w19 누수가 전부 0이었다(포화). 난이도는 보스가 담당하고(bossDamageMultiplier),
   * 유형이 하는 일은 **구성 편중을 깨는 것**이다 — 정가제의 실제 최적해는 폰 스팸이었는데
   * (자동 플레이어 실측: 폰 222.9기 / 룩 0기) T1 폰은 2딜이라 감산에 정면으로 취약하다.
   * traitRatio를 올려 난이도를 잡으려는 시도는 위 포화 실측 때문에 듣지 않는다.
   *
   * ★ 감산이 **비율**인 이유: 고정 감산(−2)은 티어마다 다른 비율로 깎아 합성의 골드 중립성을
   * 무너뜨린다(실측: 룩 +33% / 나이트 +100% / 비숍 −50%). 비율이면 모든 티어에 같은 배수가
   * 걸려 정확히 보존되고, "최소 피해 1 보장" 같은 바닥도 필요 없어진다.
   * 값은 **이진 정확값만** 쓴다 — 3 × 0.6 = 1.7999999999999998이라 정수 단언이 밸런스와
   * 무관하게 깨진다. 0.5 / 0.625 / 0.75는 전부 정확하다.
   */
  traitDefs: {
    armored:  { damageMultiplier: 0.625, bossDamageMultiplier: 0.875 },
    swift:    { speedMultiplier: 1.5 },
    shielded: { absorbPool: 0.15 },
  } as Record<EnemyTrait, {
    damageMultiplier?: number; bossDamageMultiplier?: number;
    speedMultiplier?: number; absorbPool?: number;
  }>,

  /** 각 유형이 처음 등장하는 웨이브 */
  traitSchedule: { armored: 6, swift: 9, shielded: 12 } as Record<EnemyTrait, number>,
  /** 일반 적 중 유형을 갖는 비율 (결정론적 쿼터) */
  traitRatio: 0.3,
  /** 유형별 쿼터 위상. 겹치면 같은 적에게 몰려 분포가 무너지므로 서로 어긋나게 둔다. */
  traitPhase: { armored: 0, swift: 3, shielded: 7 } as Record<EnemyTrait, number>,
  /** 일반 적이 동시에 가질 수 있는 유형 수 */
  maxTraitsNormal: 1,
  /** 보스가 유형 둘을 겸하기 시작하는 웨이브 */
  bossTraitCountFromWave: 15,
  /** 보스에게 붙지 않는 유형. 보스는 "딜을 넣을 시간을 주는" 설계라 가속이 그 전제를 깬다. */
  bossForbidden: ['swift'] as readonly EnemyTrait[],

  /**
   * 무작위 기물 지급 — 짝수 웨이브를 클리어할 때마다 T1 기물 하나를 트레이에 준다.
   *
   * 목적은 **매 판을 다르게 만드는 것**이다. 이 게임의 무작위는 스폰 파일 하나뿐인데 그것도
   * 파일 커버리지를 넓히면 무의미해져서, 최적 빌드가 판마다 동일했다. 부수적으로 초반 골드를
   * 부양하고(사용가치 10 × 290G), 원치 않던 기물이 융합 재료가 되어 발견을 만든다.
   *
   * 정직한 한계: 원안이 노렸던 "슬롯 압박"은 실측상 거의 없다. 트레이가 차면 구매 자체가
   * 막히므로 플레이어는 어차피 트레이를 비워 두고, 지급 10기는 동종 합성만으로 5칸 이하로
   * 압축된다. 그 목표는 폐기하고 위 셋만 남긴다.
   *
   * 총량이 10회인 이유: 20회면 무상 가치 5,700G가 적 유형이 만든 난이도 상승을 통째로
   * 상쇄해 게임이 오히려 쉬워진다. 10회면 2,850G로 보너스 곡선 +200G와 합쳐 대략 균형이다.
   *
   * 퀸이 0%인 이유: 최소 승리 빌드의 58%가 퀸이고 퀸은 **곱셈 축**이라 분산이 골드로 흡수되지
   * 않는다. 10회 추첨에서 5%면 0회가 60%, 2회 이상이 8.6%라 판마다 전력이 널뛴다.
   */
  grant: {
    /** 롤백 노브. weights를 0으로 만들어 우회하지 말 것 — 추첨 자체는 계속 돌아 draw 수가 남는다. */
    enabled: true,
    everyWaves: 2,
    weights: {
      pawn: 0.30, bishop: 0.25, rook: 0.25, knight: 0.20, queen: 0,
      archbishop: 0, chancellor: 0, amazon: 0,
    } as Record<PieceType, number>,
  },

  economy: { sellRatio: 0.5 },
  slots: { rows: 4, cols: 4 },
} as const;

/**
 * 기물의 **행동 특성** 표 — `type === 'knight'` 같은 술어가 코드 곳곳에 흩어지는 것을 막는다.
 *
 * 왜 필요한가. 지금 `type === 'knight'` 술어가 10곳, `type === 'queen'`이 8곳에 흩어져 있는데
 * **컴파일 시 전수성이 보장되는 것은 하나도 없다.** 기물이 늘면 그 술어들은 조용히 false를
 * 돌려주고, 새 기물은 "공격은 하는데 소리가 안 나고 이펙트도 안 그려지는" 상태로 배포된다.
 * TRAITS는 `Record<PieceType, …>`이라 기물이 늘면 **컴파일러가 빠짐없이 짚어 준다.**
 *
 * 이 표는 "무엇을 하는 기물인가"만 담는다. "얼마나 세게"는 CONFIG.pieces가, "어떤 칸을"은
 * patterns.ts가 담당한다 — 세 축을 섞지 않는 것이 이 표의 유일한 규칙이다.
 */
export type AttackPattern = 'pawn' | 'bishop' | 'rook' | 'none';

export interface PieceTraits {
  /** 주기 발사 패턴. 'none'이면 updateCombat의 발사 루프에서 제외된다. */
  pattern: AttackPattern;
  /** 배치·이동·합성 직후 주변 3×3 폭발 (tryKnightBlast). */
  blast: boolean;
  /** 보드 위 이동이 L자로 제한되는가. blast와 근거가 다르다 — 이쪽은 행마 규칙이고,
   *  blast 쪽 쿨다운 게이트는 "미리보기가 약속한 폭발을 실제로도 터뜨리기 위한" 장치다. */
  moveL: boolean;
  /** 퀸 라인 버프 계수. 0이면 버프를 주지 않는다(buff.ts). */
  buffFactor: number;
  /** 상점에 노출되고 구매할 수 있는가. */
  purchasable: boolean;
}

export const TRAITS: Record<PieceType, PieceTraits> = {
  pawn:   { pattern: 'pawn',   blast: false, moveL: false, buffFactor: 0, purchasable: true },
  knight: { pattern: 'none',   blast: true,  moveL: true,  buffFactor: 0, purchasable: true },
  bishop: { pattern: 'bishop', blast: false, moveL: false, buffFactor: 0, purchasable: true },
  rook:   { pattern: 'rook',   blast: false, moveL: false, buffFactor: 0, purchasable: true },
  queen:  { pattern: 'none',   blast: false, moveL: false, buffFactor: 1, purchasable: true },

  // 융합물은 재료 둘의 특성을 겸한다. **moveL은 물려받지 않는다** — 나이트의 L자 제약을
  // 상속하면 융합물이 인접 칸으로 한 칸 미는 조작조차 못 하게 되어, 룩보다 기동성이
  // *낮아진다*(룩은 이미 보드 위 아무 칸으로나 순간이동한다). 폭발 능력만 물려받는다.
  archbishop: { pattern: 'bishop', blast: true, moveL: false, buffFactor: 0, purchasable: false },
  chancellor: { pattern: 'rook',   blast: true, moveL: false, buffFactor: 0, purchasable: false },
  // 아마존은 퀸의 버프를 물려받되 계수를 절반으로 둔다 — 퀸의 티어는 보드 전체 화력의
  // 지수라(§5.4) 버프를 겸하는 기물이 늘면 그 지수가 곱으로 겹친다.
  amazon:     { pattern: 'none',   blast: true, moveL: false, buffFactor: 0.5, purchasable: false },
};

/**
 * 티어 n 기물의 능력치 배수 = 2^(n-1). 같은 티어끼리만 합쳐지므로(CONFIG.merge) T2는 T1 둘의
 * 합, T3는 T2 둘의 합 …이 되어 단계마다 정확히 2배다. 배열이 아니라 식으로 두는 이유는 상한을
 * 바꿔도 표를 함께 고칠 필요가 없기 때문이다 — enemyHp/enemyCount와 같은 "CONFIG에서 유도하는
 * 함수" 선례를 따른다.
 *
 * 누적 투자액도 정확히 같은 배수를 탄다(T2 = 기본 기물 2기분 = cost × 2). 그래서 골드당 화력이
 * 티어와 무관하게 일정하고, 판매가(economy.ts)도 이 함수 하나로 "합성 전 판매액의 합"이 된다.
 */
export function tierMultiplier(tier: number): number {
  return 2 ** (tier - 1);
}

export function enemyHp(wave: number): number {
  const { hpBase, hpPerWaveEarly, hpPerWaveLate, hpScalingBreakpoint } = CONFIG.enemy;
  return wave <= hpScalingBreakpoint
    ? hpBase + (wave - 1) * hpPerWaveEarly
    : hpBase + (hpScalingBreakpoint - 1) * hpPerWaveEarly
      + (wave - hpScalingBreakpoint) * hpPerWaveLate;
}

export function enemyCount(wave: number): number {
  if (wave % CONFIG.wave.bossEvery === 0) return 1;   // 보스 단독
  return CONFIG.wave.countBase + CONFIG.wave.countPerWave * (wave - 1);
}


/**
 * 스폰되는 적의 유형 — **rng를 소비하지 않는 결정론적 쿼터**다.
 *
 * 확률 추첨을 쓰지 않는 이유가 둘이다. ① 스폰 파일 추첨은 rng 호출 "순서"에만 의존하므로,
 * 여기서 draw를 한 번 더 뽑으면 파일 시퀀스가 통째로 달라져 기존 헤드리스 측정이 조용히 다른
 * 것을 재게 된다(signals.test.ts의 N8이 이 사실을 강제한다). ② n=20~46짜리 30% 이항 추첨은
 * 웨이브별 실측 혼합률이 18~50%로 흔들려 회귀 신호가 잡음에 묻힌다.
 */
export function enemyTraits(wave: number, spawnIndex: number, isBoss: boolean): EnemyTrait[] {
  const unlocked = (Object.keys(CONFIG.traitSchedule) as EnemyTrait[])
    .filter(t => wave >= CONFIG.traitSchedule[t]);

  if (isBoss) {
    const allowed = unlocked.filter(t => !CONFIG.bossForbidden.includes(t));
    const count = wave >= CONFIG.bossTraitCountFromWave ? 2 : 1;
    return allowed.slice(0, count);
  }

  if (unlocked.length === 0) return [];
  // 쿼터는 **유형별이 아니라 적별로 한 번만** 판정한다. 유형마다 독립 쿼터를 돌리면 해금이
  // 늘수록 합집합이 커져(실측 3종 해금 시 52%) 의도한 비율을 훌쩍 넘긴다.
  // 누적 개수가 정확히 ratio 비율로 늘어나는 지점에서만 붙인다 — n에 무관하게 비율이 고정된다.
  const k = spawnIndex;
  const gets = Math.floor(k * CONFIG.traitRatio) > Math.floor((k - 1) * CONFIG.traitRatio);
  if (!gets) return [];
  // 어느 유형인지는 순환으로 정한다. 위상을 더해 웨이브마다 같은 순서로 시작하지 않게 한다.
  const nth = Math.floor(k * CONFIG.traitRatio) + CONFIG.traitPhase[unlocked[0]];
  return [unlocked[nth % unlocked.length]].slice(0, CONFIG.maxTraitsNormal);
}

/** 이 적이 받는 피해 배수 (장갑). 보스는 별도 값을 쓴다 — 일반 웨이브를 건드리지 않고
 *  난이도를 조절할 수 있는 유일한 노브이기 때문이다. */
export function armorMultiplier(traits: readonly EnemyTrait[], isBoss: boolean): number {
  let m = 1;
  for (const t of traits) {
    const def = CONFIG.traitDefs[t];
    const v = isBoss ? def.bossDamageMultiplier ?? def.damageMultiplier : def.damageMultiplier;
    if (v !== undefined) m *= v;
  }
  return m;
}


/**
 * 웨이브 클리어 보너스 — 웨이브 번호에 따라 줄어드는 곡선이고, 그 웨이브의 처치율에 연동된다.
 *
 * 두 축이 각각 다른 문제를 푼다.
 *  - **곡선**: 골드의 83%가 후반에 들어오는데 최소 승리 비용은 초반부터 필요하다. 정액이면
 *    초반이 숨막히고 후반이 남아돈다.
 *  - **처치율 연동**: 정액 보너스는 "체력만 버틸 수 있다면 누수 방치가 이득"이라는 선택지를
 *    만든다(클리어 보너스는 그대로 받고 처치 골드만 포기). 곡선이 그 무조건 수입을 1.67배로
 *    키우므로 연동 없이 곡선만 넣으면 결함이 오히려 커진다.
 *
 * 하한(clearBonusFloor)이 사망 나선을 막는다 — 0이면 무너진 판의 수입이 더 줄어 회복이
 * 불가능해지고, 1이면 연동이 없는 것과 같다.
 */
export function clearBonus(wave: number, killRatio = 1): number {
  const { clearBonusBase, clearBonusDecay, clearBonusFloor } = CONFIG.wave;
  const full = Math.max(0, clearBonusBase - clearBonusDecay * (wave - 1));
  const ratio = clearBonusFloor + (1 - clearBonusFloor) * Math.min(1, Math.max(0, killRatio));
  return Math.round(full * ratio);
}


/**
 * 누적합으로 roll ∈ [0,1)을 기물 종류에 매핑한다. **rng를 여기서 부르지 않는다** —
 * 난수는 호출부가 주입해야 테스트가 결정론적으로 전 구간을 훑을 수 있다.
 */
export function pickGrantType(roll: number): PieceType {
  const entries = Object.entries(CONFIG.grant.weights) as [PieceType, number][];
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let acc = 0;
  const target = Math.min(Math.max(roll, 0), 1 - Number.EPSILON) * total;
  for (const [type, w] of entries) {
    acc += w;
    if (target < acc) return type;
  }
  // 부동소수 잔차로 여기 도달할 수 있다. 가중치가 0이 아닌 마지막 종류로 떨어뜨린다.
  return entries.filter(([, w]) => w > 0).map(([t]) => t).pop()!;
}
