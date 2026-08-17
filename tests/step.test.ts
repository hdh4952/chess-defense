import { describe, expect, it } from 'vitest';
import { cleanState } from './helpers';
import { CONFIG, enemyCount } from '../src/config';
import { stepGame } from '../src/core/step';
import type { GameEvent } from '../src/types';

const rng0 = () => 0; // 항상 a파일

function run(state: ReturnType<typeof cleanState>, seconds: number, events: GameEvent[] = []) {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) stepGame(state, dt, events, rng0, () => 0);
}

describe('stepGame (스펙 10.2)', () => {
  it('준비 10초 → 웨이브 시작 → 스폰 진행', () => {
    const s = cleanState();
    run(s, 10.1);
    expect(s.phase).toBe('wave');
    expect(s.spawnedCount).toBeGreaterThanOrEqual(1);
  });
  it('기물이 없으면 적 10마리 전부 통과 → 웨이브 2 준비', () => {
    const s = cleanState();
    s.hp = 100;               // 통과 10회를 견디게 — 확인 대상은 웨이브 종료 판정이지 체력 잔량이 아니다
    run(s, 10 + 10 + 24 + 1); // 준비 + 스폰 + 종주 + 여유
    expect(s.hp).toBe(100 - enemyCount(1) * CONFIG.player.hpLossNormal);
    expect(s.wave).toBe(2);
    expect(s.phase).toBe('prepare');
  });
  it('paused면 아무것도 진행되지 않는다', () => {
    const s = cleanState();
    s.paused = true;
    run(s, 5);
    expect(s.prepareTimer).toBe(10);
  });
  it('defeat/victory에서는 진행되지 않는다', () => {
    const s = cleanState();
    s.phase = 'defeat';
    run(s, 5);
    expect(s.wave).toBe(1);
  });
});
