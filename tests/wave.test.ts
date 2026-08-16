import { describe, expect, it } from 'vitest';
import { CONFIG, clearBonus, enemyCount } from '../src/config';
import { createInitialState } from '../src/core/state';
import {
  checkWaveEnd, remainingEnemies, startWave, updatePrepare, updateSpawning,
} from '../src/core/wave';
import type { GameEvent } from '../src/types';

const rngFile = (file: number) => () => file / 8; // floor(rng*8) === file

describe('준비 시간 (스펙 3/4.4)', () => {
  it('10초 경과 시 자동으로 웨이브 시작', () => {
    const s = createInitialState();
    updatePrepare(s, 9.99);
    expect(s.phase).toBe('prepare');
    updatePrepare(s, 0.02);
    expect(s.phase).toBe('wave');
    expect(s.spawnedCount).toBe(0);
  });
  it('수동 시작 가능, prepare가 아닐 때는 무시', () => {
    const s = createInitialState();
    startWave(s);
    expect(s.phase).toBe('wave');
    startWave(s); // 이미 wave — 상태 불변
    expect(s.phase).toBe('wave');
  });
});

describe('스폰 (스펙 4.1/4.4)', () => {
  it('시작 즉시 1마리, 이후 1.0초 간격', () => {
    const s = createInitialState();
    startWave(s);
    updateSpawning(s, 0.1, [], rngFile(3));
    expect(s.enemies).toHaveLength(1);
    expect(s.enemies[0].file).toBe(3);
    updateSpawning(s, 0.8, [], rngFile(3));
    expect(s.enemies).toHaveLength(1);
    updateSpawning(s, 0.1, [], rngFile(3));
    expect(s.enemies).toHaveLength(2);
  });
  it('웨이브 1은 총 10마리에서 멈춘다', () => {
    const s = createInitialState();
    startWave(s);
    updateSpawning(s, 60, [], rngFile(0));
    expect(s.spawnedCount).toBe(10);
    expect(s.enemies).toHaveLength(10);
  });
  it('보스 웨이브(5)는 보스 1마리 + bossSpawned 이벤트', () => {
    const s = createInitialState();
    s.wave = 5;
    startWave(s);
    const ev: GameEvent[] = [];
    updateSpawning(s, 60, ev, rngFile(6));
    expect(s.enemies).toHaveLength(1);
    expect(s.enemies[0].isBoss).toBe(true);
    expect(s.enemies[0].hp).toBe(420);
    expect(ev).toContainEqual({ kind: 'bossSpawned', file: 6 });
  });
});

describe('웨이브 종료 (스펙 3/4.4)', () => {
  function clearedWave(wave: number) {
    const s = createInitialState();
    s.wave = wave;
    startWave(s);
    updateSpawning(s, 60, [], rngFile(0));
    s.enemies = []; // 전부 처치된 상황
    // 처치율 연동이 생긴 뒤로는 "적이 사라졌다"만으로는 부족하다 — 처치와 누수가 구분되므로
    // 이 하네스가 어느 쪽을 흉내내는지 명시해야 한다. 여기서는 전멸이다.
    s.killedThisWave = enemyCount(wave);
    return s;
  }

  it('스폰이 남았거나 생존자가 있으면 종료되지 않는다', () => {
    const s = createInitialState();
    startWave(s);
    updateSpawning(s, 0.1, [], rngFile(0)); // 1/10 스폰
    checkWaveEnd(s, []);
    expect(s.phase).toBe('wave');
    updateSpawning(s, 60, [], rngFile(0));  // 전부 스폰, 생존 중
    checkWaveEnd(s, []);
    expect(s.phase).toBe('wave');
  });
  it('클리어: 보너스 지급, 다음 웨이브 준비 10초, 이벤트 2종', () => {
    const s = clearedWave(1);
    const gold = s.gold;
    const ev: GameEvent[] = [];
    checkWaveEnd(s, ev);
    // 정액 300G에서 곡선으로 바뀌었다. 값을 하드코딩하지 않고 clearBonus에서 유도한다.
    expect(s.gold).toBe(gold + clearBonus(1));
    expect(s.stats.totalGoldEarned).toBe(clearBonus(1));
    expect(s.wave).toBe(2);
    expect(s.phase).toBe('prepare');
    expect(s.prepareTimer).toBe(10);
    expect(ev).toContainEqual({ kind: 'waveCleared', wave: 1 });
    expect(ev).toContainEqual({ kind: 'prepareStarted', wave: 2, isBossWave: false });
  });
  it('웨이브 4 클리어 → 웨이브 5는 보스 웨이브 예고', () => {
    const s = clearedWave(4);
    const ev: GameEvent[] = [];
    checkWaveEnd(s, ev);
    expect(ev).toContainEqual({ kind: 'prepareStarted', wave: 5, isBossWave: true });
  });
  it('웨이브 20 클리어 → victory (마지막 보너스도 지급)', () => {
    const s = clearedWave(20);
    const gold = s.gold;
    checkWaveEnd(s, []);
    expect(s.phase).toBe('victory');
    expect(s.gold).toBe(gold + clearBonus(20));
    expect(s.wave).toBe(20);
  });

  it('★ 누수를 방치하면 보너스가 줄어든다 — 하한 50%까지', () => {
    // 예전에는 클리어 보너스가 정액이라 "체력만 버틸 수 있다면 누수 방치는 처치 골드만
    // 포기하는 선택지"였다. 이제 방치에 직접 대가가 붙는다.
    const full = clearedWave(1);
    const half = clearedWave(1); half.killedThisWave = Math.floor(enemyCount(1) / 2);
    const none = clearedWave(1); none.killedThisWave = 0;
    const paid = (s: ReturnType<typeof clearedWave>): number => {
      const g = s.gold; checkWaveEnd(s, []); return s.gold - g;
    };
    const a = paid(full), b = paid(half), c = paid(none);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
    expect(c).toBe(Math.round(clearBonus(1) * CONFIG.wave.clearBonusFloor));
  });
});

describe('remainingEnemies (HUD)', () => {
  it('wave 중: 미스폰 + 생존', () => {
    const s = createInitialState();
    startWave(s);
    updateSpawning(s, 2.5, [], rngFile(0)); // 3마리 스폰
    s.enemies.pop();                        // 1마리 처치됨
    expect(remainingEnemies(s)).toBe(10 - 3 + 2);
  });
  it('prepare 중: 다음 웨이브 총원', () => {
    const s = createInitialState();
    expect(remainingEnemies(s)).toBe(10);
  });
});
