import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { createEnemy, moveEnemies, processLeaks } from '../src/core/enemy';
import { BOARD_H } from '../src/core/grid';
import { createInitialState } from '../src/core/state';
import type { GameEvent } from '../src/types';

describe('createInitialState (스펙 3)', () => {
  it('골드 300, 체력 30, 기물 0개, 웨이브 1 준비 10초', () => {
    const s = createInitialState();
    expect(s.hp).toBe(30);
    expect(s.gold).toBe(300);
    expect(s.wave).toBe(1);
    expect(s.phase).toBe('prepare');
    expect(s.prepareTimer).toBe(10);
    expect(s.pieces).toEqual([]);
    expect(s.enemies).toEqual([]);
    expect(s.speedMultiplier).toBe(1);
    expect(s.paused).toBe(false);
    expect(s.stats).toEqual({ totalKills: 0, totalGoldEarned: 0 });
  });
});

describe('createEnemy (스펙 4.1/4.2)', () => {
  it('일반 적: 1칸당 3초 → 80/3 px/s, 체력 = enemyHp, y는 0에서 시작', () => {
    const e = createEnemy(1, 3, false, 'e-1');
    expect(e.speed).toBeCloseTo(80 / 3);
    expect(e.hp).toBe(10);
    expect(e.maxHp).toBe(10);
    expect(e.y).toBe(0);
    expect(e.isBoss).toBe(false);
  });
  it('보스: 속도 1/2, 체력 ×30', () => {
    const b = createEnemy(5, 0, true, 'boss');
    expect(b.speed).toBeCloseTo(80 / 6);
    expect(b.hp).toBe(420);
  });
  it('지터는 ID 기반 결정론적, ±jitterPx 이내 (스펙 7.8)', () => {
    const a1 = createEnemy(1, 0, false, 'x');
    const a2 = createEnemy(1, 0, false, 'x');
    expect(a1.jitterX).toBe(a2.jitterX);
    expect(Math.abs(a1.jitterX)).toBeLessThanOrEqual(CONFIG.enemy.jitterPx);
  });
});

describe('이동과 1랭크 통과 (스펙 3/9.1)', () => {
  function waveState() {
    const s = createInitialState();
    s.phase = 'wave';
    return s;
  }

  it('moveEnemies: y += speed * dt', () => {
    const s = waveState();
    const e = createEnemy(1, 0, false, 'e-1');
    s.enemies.push(e);
    moveEnemies(s, 3);
    expect(e.y).toBeCloseTo(80);
  });
  it('일반 적 통과: 소멸 + 체력 −1 + enemyLeaked 이벤트', () => {
    const s = waveState();
    const e = createEnemy(1, 2, false, 'e-1');
    e.y = BOARD_H + 1;
    s.enemies.push(e);
    const ev: GameEvent[] = [];
    processLeaks(s, ev);
    expect(s.enemies).toHaveLength(0);
    expect(s.hp).toBe(29);
    expect(ev).toEqual([{ kind: 'enemyLeaked', enemyId: 'e-1', file: 2, isBoss: false }]);
  });
  it('보스 통과: 체력 −5', () => {
    const s = waveState();
    const b = createEnemy(5, 0, true, 'boss');
    b.y = BOARD_H;
    s.enemies.push(b);
    processLeaks(s, []);
    expect(s.hp).toBe(25);
  });
  it('체력 0 도달 → 즉시 defeat, 같은 프레임 나머지 처리 중단 (스펙 10.5)', () => {
    const s = waveState();
    s.hp = 1;
    const e1 = createEnemy(1, 0, false, 'e-1');
    const e2 = createEnemy(1, 1, false, 'e-2');
    e1.y = BOARD_H;
    e2.y = BOARD_H;
    s.enemies.push(e1, e2);
    processLeaks(s, []);
    expect(s.phase).toBe('defeat');
    expect(s.hp).toBe(0);
    expect(s.enemies).toHaveLength(1); // e-2는 처리되지 않고 그 자리에 남는다
  });
  it('통과 직전(y < BOARD_H)에는 소멸하지 않는다', () => {
    const s = waveState();
    const e = createEnemy(1, 0, false, 'e-1');
    e.y = BOARD_H - 0.01;
    s.enemies.push(e);
    processLeaks(s, []);
    expect(s.enemies).toHaveLength(1);
    expect(s.hp).toBe(30);
  });
});
