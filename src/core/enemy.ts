import { CONFIG, enemyHp } from '../config';
import type { Enemy, EnemyTrait, GameEvent, GameState } from '../types';
import { BOARD_H } from './grid';

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function createEnemy(
  wave: number, file: number, isBoss: boolean, id: string,
  traits: readonly EnemyTrait[] = [],
): Enemy {
  const hp = enemyHp(wave) * (isBoss ? CONFIG.enemy.bossHpMultiplier : 1);
  const base = CONFIG.board.squarePx / CONFIG.enemy.secondsPerSquare;
  const j = CONFIG.enemy.jitterPx;
  // 영구 배수만 speed에 굽는다. 일시적 감속 같은 것이 생기면 speed가 아니라 별도 상태로 둬야
  // 한다 — 여기 구우면 원래 속도로 되돌릴 방법이 사라진다.
  const swift = traits.includes('swift') ? CONFIG.traitDefs.swift.speedMultiplier ?? 1 : 1;
  const absorb = CONFIG.traitDefs.shielded.absorbPool ?? 0;
  return {
    id, file, y: 0, hp, maxHp: hp, isBoss,
    speed: base * (isBoss ? CONFIG.enemy.bossSpeedMultiplier : 1) * swift,
    jitterX: (hashId(id) % (2 * j + 1)) - j,
    traits,
    shieldPool: traits.includes('shielded') ? Math.round(hp * absorb) : 0,
  };
}

export function moveEnemies(state: GameState, dt: number): void {
  if (state.phase !== 'wave') return;
  for (const e of state.enemies) e.y += e.speed * dt;
}

/** 1랭크 통과: 소멸 + 체력 감소. 체력 0이면 즉시 defeat 전환 후 중단 (스펙 10.5) */
export function processLeaks(state: GameState, events: GameEvent[]): void {
  if (state.phase !== 'wave') return;
  for (let i = 0; i < state.enemies.length; i++) {
    const e = state.enemies[i];
    if (e.y < BOARD_H) continue;
    state.enemies.splice(i, 1);
    i--;
    state.hp -= e.isBoss ? CONFIG.player.hpLossBoss : CONFIG.player.hpLossNormal;
    events.push({ kind: 'enemyLeaked', enemyId: e.id, file: e.file, isBoss: e.isBoss });
    if (state.hp <= 0) {
      state.hp = 0;
      state.phase = 'defeat';
      return;
    }
  }
}
