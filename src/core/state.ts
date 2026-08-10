import { CONFIG } from '../config';
import type { GameState } from '../types';

export function createInitialState(): GameState {
  return {
    hp: CONFIG.player.startHp,
    gold: CONFIG.player.startGold,
    wave: 1,
    phase: 'prepare',
    prepareTimer: CONFIG.wave.prepareSeconds,
    spawnTimer: 0,
    spawnedCount: 0,
    speedMultiplier: 1,
    paused: false,
    pieces: [],
    enemies: [],
    stats: { totalKills: 0, totalGoldEarned: 0 },
  };
}
