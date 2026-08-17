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
    // 오라 보너스도 매 틱 재계산되는 파생 상태다(core/aura.ts).
    auraBonus: 0,
  };
}

/**
 * 적 전진. **감속은 여기서 곱한다** — speed 필드에 굽지 않는다(위 createEnemy 주석 참조).
 *
 * prepare 단계에서는 이 함수 자체가 이른 반환하므로 감속도 자동으로 무의미해진다. 즉
 * "준비 중에는 오라가 놀고 있다"는 것은 별도 가드가 아니라 이 한 줄에서 따라 나온다.
 */
/**
 * 분열형이 죽을 때 태어나는 적들 (v1.14).
 *
 * ★ **rng를 한 번도 쓰지 않는다.** 인접 파일은 file±1로 결정되고 개수도 config 상수다 —
 * 스폰 파일 추첨이 호출 "순서"에만 의존하므로 여기서 draw를 하나라도 뽑으면 파일 시퀀스가
 * 통째로 달라져 기존 헤드리스 측정이 조용히 다른 것을 잰다(N8이 그 사실을 강제한다).
 * 적 유형이 처음부터 결정론적 쿼터인 것과 같은 이유다.
 *
 * ★ **분열체는 분열하지 않는다.** traits를 빈 배열로 주는 것이 그 보장이다 — 비율을 아무리
 * 작게 잡아도 분열이 재귀하면 한 마리가 지수적으로 늘어난다. `maxTraitsNormal`이 1이라
 * 분열형은 애초에 다른 유형을 겸하지 않으므로 물려줄 유형도 없다.
 *
 * 체력은 부모의 **maxHp 비율**이다(남은 hp가 아니라). 남은 hp를 쓰면 "아슬아슬하게 죽인 적이
 * 더 약한 분열체를 남긴다"가 되어, 오버킬을 하는 쪽이 손해가 된다 — 그 역인센티브를 만들지
 * 않으려고 확정값을 쓴다.
 *
 * 파일이 보드를 벗어나면 남은 한쪽에 몰아 준다 — "죽으면 2마리"라는 규칙이 가장자리에서만
 * 조용히 1마리가 되지 않게 한다.
 */
export function splitEnemies(parent: Enemy, wave: number): Enemy[] {
  const def = CONFIG.traitDefs.splitter;
  const count = def.splitCount ?? 0;
  const ratio = def.splitHpRatio ?? 0;
  if (count <= 0 || ratio <= 0) return [];

  const sides = [parent.file - 1, parent.file + 1]
    .filter(f => f >= 0 && f < CONFIG.board.files);
  if (sides.length === 0) return [];

  const hp = Math.max(1, Math.round(parent.maxHp * ratio));
  const out: Enemy[] = [];
  for (let i = 0; i < count; i++) {
    const file = sides[i % sides.length];
    const child = createEnemy(wave, file, false, `${parent.id}-s${i}`, []);
    child.hp = hp;
    child.maxHp = hp;          // 처치 보상도 이 값이다 — 분열은 골드를 늘린다(의도된 성질)
    child.y = parent.y;        // 부모가 죽은 자리에서 태어난다
    out.push(child);
  }
  return out;
}

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
