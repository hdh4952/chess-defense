import { CONFIG, enemyHp } from '../config';
import type { Enemy, EnemyTrait, GameEvent, GameState } from '../types';
import { BOARD_H } from './grid';
import { NO_SLOW, effectiveSpeed } from './slow';

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
  // v1.14: swift가 ×1.5 → ×2.0(1.5초/칸)이 됐다. 값만 바뀌었고 "영구 배수는 speed에 굽는다"는
  // 규칙은 그대로다 — 아래 주석이 요구한 "일시적 감속은 별도 상태"의 반례가 아니다.
  const swift = traits.includes('swift') ? CONFIG.traitDefs.swift.speedMultiplier ?? 1 : 1;
  return {
    id, file, y: 0, hp, maxHp: hp, isBoss,
    speed: base * (isBoss ? CONFIG.enemy.bossSpeedMultiplier : 1) * swift,
    jitterX: (hashId(id) % (2 * j + 1)) - j,
    traits,
    // 감속은 매 틱 재계산되는 파생 상태다(core/slow.ts). 스폰 시점에는 아직 판정 전이므로
    // NO_SLOW(0)로 시작하고, 첫 updateSlowAura가 곧바로 올바른 값으로 덮는다.
    slowTier: NO_SLOW,
  };
}

/**
 * 적 전진. **감속은 여기서 곱한다** — speed 필드에 굽지 않는다(위 createEnemy 주석 참조).
 *
 * prepare 단계에서는 이 함수 자체가 이른 반환하므로 감속도 자동으로 무의미해진다. 즉
 * "준비 중에는 오라가 놀고 있다"는 것은 별도 가드가 아니라 이 한 줄에서 따라 나온다.
 */
export function moveEnemies(state: GameState, dt: number): void {
  if (state.phase !== 'wave') return;
  for (const e of state.enemies) e.y += effectiveSpeed(e) * dt;
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
