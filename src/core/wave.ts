import { CONFIG, enemyCount } from '../config';
import type { GameEvent, GameState } from '../types';
import { createEnemy } from './enemy';

export function updatePrepare(state: GameState, dt: number): void {
  if (state.phase !== 'prepare') return;
  state.prepareTimer -= dt;
  if (state.prepareTimer <= 0) startWave(state);
}

/** 준비 중 수동/자동 시작 (스펙 4.4 — 조기 시작 보너스 없음) */
export function startWave(state: GameState): void {
  if (state.phase !== 'prepare') return;
  state.phase = 'wave';
  state.prepareTimer = 0;
  state.spawnTimer = 0;      // 첫 스폰은 즉시
  state.spawnedCount = 0;
}

export function updateSpawning(
  state: GameState, dt: number, events: GameEvent[], rng: () => number,
): void {
  if (state.phase !== 'wave') return;
  const total = enemyCount(state.wave);
  if (state.spawnedCount >= total) return;
  state.spawnTimer -= dt;
  while (state.spawnTimer <= 0 && state.spawnedCount < total) {
    const file = Math.min(CONFIG.board.files - 1, Math.floor(rng() * CONFIG.board.files));
    const isBoss = state.wave % CONFIG.wave.bossEvery === 0;
    state.enemies.push(createEnemy(state.wave, file, isBoss, `e-${state.wave}-${state.spawnedCount}`));
    state.spawnedCount++;
    if (isBoss) events.push({ kind: 'bossSpawned', file });
    state.spawnTimer += CONFIG.wave.spawnInterval;
  }
}

/** 모든 적이 사망 또는 통과 → 클리어 보너스, 다음 웨이브 또는 승리 (스펙 3/4.4) */
export function checkWaveEnd(state: GameState, events: GameEvent[]): void {
  if (state.phase !== 'wave') return;
  if (state.spawnedCount < enemyCount(state.wave) || state.enemies.length > 0) return;
  state.gold += CONFIG.wave.clearBonus;
  state.stats.totalGoldEarned += CONFIG.wave.clearBonus;
  events.push({ kind: 'waveCleared', wave: state.wave });
  if (state.wave >= CONFIG.wave.total) {
    state.phase = 'victory';
    return;
  }
  state.wave++;
  state.phase = 'prepare';
  state.prepareTimer = CONFIG.wave.prepareSeconds;
  events.push({
    kind: 'prepareStarted',
    wave: state.wave,
    isBossWave: state.wave % CONFIG.wave.bossEvery === 0,
  });
}

/** HUD "남은 적": 아직 스폰 안 된 수 + 보드 위 생존 수 */
export function remainingEnemies(state: GameState): number {
  const total = enemyCount(state.wave);
  return state.phase === 'wave'
    ? total - state.spawnedCount + state.enemies.length
    : total;
}
