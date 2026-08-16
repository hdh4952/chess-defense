import type { PieceType } from './types';

export const CONFIG = {
  board: { files: 8, ranks: 8, squarePx: 80 },

  player: { startHp: 10, startGold: 300, hpLossNormal: 1, hpLossBoss: 5 },

  wave: {
    total: 20,
    prepareSeconds: 10,
    clearBonus: 300,
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
  merge: { maxTier: { pawn: 6, knight: 6, bishop: 6, rook: 6, queen: 6 } },

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
