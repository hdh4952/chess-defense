export const CONFIG = {
  board: { files: 8, ranks: 8, squarePx: 80 },

  player: { startHp: 30, startGold: 300, hpLossNormal: 1, hpLossBoss: 5 },

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
    hpPerWaveLate: 3,       // w >= 11
    hpScalingBreakpoint: 10,
    secondsPerSquare: 3.0,
    bossHpMultiplier: 30,
    bossSpeedMultiplier: 0.5,
    spritePx: 44,
    jitterPx: 8,
  },

  pieces: {
    pawn:   { cost: 100, damage: 2, interval: 0.5 },
    // 이동 쿨다운 없음 (게임 규칙 변경, 사용자 승인) — 나이트는 배치·이동마다 매번 폭발한다.
    // 게이트(canLandAt/tryKnightBlast/drag.ts)는 그대로 남아 있으므로 3.0 등으로 되돌리면
    // 옛 쿨다운 동작이 코드 변경 없이 복원된다.
    knight: { cost: 300, damage: 3, interval: 0 },
    bishop: { cost: 300, damage: 3, interval: 3.0 },
    rook:   { cost: 500, damage: 5, interval: 3.0 },
    queen:  { cost: 900, damage: 0, interval: 0   },
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
