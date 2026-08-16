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

  economy: { sellRatio: 0.5 },
  slots: { rows: 4, cols: 4 },
} as const;

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
