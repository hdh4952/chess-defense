import { describe, expect, it } from 'vitest';
import { cleanState } from './helpers';
import { CONFIG, clearBonus, enemyCount, spawnInterval, waveTotal } from '../src/config';
import {
  checkWaveEnd, remainingEnemies, startWave, updatePrepare, updateSpawning,
} from '../src/core/wave';
import type { Difficulty, GameEvent } from '../src/types';

const rngFile = (file: number) => () => file / 8; // floor(rng*8) === file

describe('준비 시간 (스펙 3/4.4)', () => {
  it('10초 경과 시 자동으로 웨이브 시작', () => {
    const s = cleanState();
    updatePrepare(s, 9.99);
    expect(s.phase).toBe('prepare');
    updatePrepare(s, 0.02);
    expect(s.phase).toBe('wave');
    expect(s.spawnedCount).toBe(0);
  });
  it('수동 시작 가능, prepare가 아닐 때는 무시', () => {
    const s = cleanState();
    startWave(s);
    expect(s.phase).toBe('wave');
    startWave(s); // 이미 wave — 상태 불변
    expect(s.phase).toBe('wave');
  });
});

describe('스폰 (스펙 4.1/4.4)', () => {
  it('시작 즉시 1마리, 이후 1.0초 간격', () => {
    const s = cleanState();
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
    const s = cleanState();
    startWave(s);
    updateSpawning(s, 60, [], rngFile(0));
    expect(s.spawnedCount).toBe(10);
    expect(s.enemies).toHaveLength(10);
  });
  it('보스 웨이브(5)는 보스 1마리 + bossSpawned 이벤트', () => {
    const s = cleanState();
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
    const s = cleanState();
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
    const s = cleanState();
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
    const s = cleanState();
    startWave(s);
    updateSpawning(s, 2.5, [], rngFile(0)); // 3마리 스폰
    s.enemies.pop();                        // 1마리 처치됨
    expect(remainingEnemies(s)).toBe(10 - 3 + 2);
  });
  it('prepare 중: 다음 웨이브 총원', () => {
    const s = cleanState();
    expect(remainingEnemies(s)).toBe(10);
  });
});


/**
 * ★★ **스폰 창 상한** (v1.33, 사용자 결정: "1웨이브당 최대 40초 안에는 적들이 다 나오게").
 *
 * **문제** — 마릿수는 웨이브마다 늘어나는데 간격이 1초 고정이라 스폰 구간이 그대로 길어졌다.
 * 하드 w39는 172마리 × 1초 = **스폰만 172초**였고, 그 대부분은 적이 띄엄띄엄 내려오는 동안
 * 아무 결정도 하지 않고 기다리는 시간이다(§6의 판 길이 표가 이미 이 값을 "가장 직접적인
 * 노브"로 지목해 뒀다).
 *
 * ★ **마릿수는 건드리지 않는다.** 그래서 총 체력·총 처치 골드 같은 밸런스 총량은 불변이고,
 * 바뀌는 것은 그것이 도착하는 **밀도**뿐이다 — 그 사실을 아래 첫 테스트가 못박는다.
 */
describe('스폰 창 상한 — 한 웨이브의 스폰은 40초 안에 끝난다 (v1.33)', () => {
  /** 실제 루프를 돌려 마지막 적이 나오기까지 걸린 시간(초)을 잰다. */
  function measureSpawnSeconds(wave: number, difficulty: Difficulty): number {
    const s = cleanState();
    s.difficulty = difficulty;
    s.wave = wave;
    s.phase = 'prepare';
    startWave(s);
    const total = enemyCount(wave, difficulty);
    const dt = 1 / 60;
    let t = 0;
    while (s.spawnedCount < total) {
      updateSpawning(s, dt, [], () => 0);
      if (s.spawnedCount >= total) break;
      t += dt;
      if (t > 600) throw new Error('스폰이 끝나지 않는다');
    }
    return t;
  }

  it('★ 마릿수는 한 마리도 바뀌지 않는다 — 바뀌는 것은 도착 밀도뿐이다', () => {
    for (const d of ['easy', 'normal', 'hard'] as Difficulty[]) {
      for (let w = 1; w <= waveTotal(d); w++) {
        const s = cleanState();
        s.difficulty = d;
        s.wave = w;
        s.phase = 'prepare';
        startWave(s);
        const total = enemyCount(w, d);
        for (let i = 0; i < 60 * 60 && s.spawnedCount < total; i++) updateSpawning(s, 1 / 60, [], () => 0);
        expect(s.spawnedCount, `${d} w${w}`).toBe(total);
      }
    }
  });

  it('세 난이도 **모든 웨이브**에서 스폰이 창 안에 끝난다', () => {
    for (const d of ['easy', 'normal', 'hard'] as Difficulty[]) {
      for (let w = 1; w <= waveTotal(d); w++) {
        // dt 한 틱만큼의 오차는 허용한다 — 마지막 적이 틱 경계에 걸린다.
        expect(measureSpawnSeconds(w, d), `${d} w${w}`)
          .toBeLessThanOrEqual(CONFIG.wave.spawnWindowMax + 1 / 60);
      }
    }
  });

  it('이른 웨이브는 창을 다 쓰지 않으므로 간격이 그대로다 — 상한이지 고정 배분이 아니다', () => {
    // 이지 w1은 10마리 → 9초면 끝난다. 40초에 억지로 펴 바르면 오히려 더 느려진다.
    expect(spawnInterval(1)).toBe(CONFIG.wave.spawnIntervalMax);
    expect(measureSpawnSeconds(1, 'easy')).toBeCloseTo(9, 1);
  });

  it('가장 붐비는 웨이브가 예전에는 창을 크게 넘었다 — 그 사실이 이 상한의 존재 이유다', () => {
    // 하드 마지막 비보스 웨이브. 옛 규칙(간격 1초 고정)이었다면 (n−1)초가 걸렸다.
    const worst = waveTotal('hard') - 1;                 // w39 — 보스가 아닌 마지막 웨이브
    const n = enemyCount(worst, 'hard');
    expect(n).toBeGreaterThan(CONFIG.wave.spawnWindowMax);   // 옛 규칙이면 40초를 넘는다
    expect(measureSpawnSeconds(worst, 'hard')).toBeLessThanOrEqual(CONFIG.wave.spawnWindowMax + 1 / 60);
  });

  it('보스 웨이브(1마리)에서 0으로 나누지 않는다', () => {
    for (const d of ['easy', 'normal', 'hard'] as Difficulty[]) {
      expect(enemyCount(CONFIG.wave.bossEvery, d)).toBe(1);
      expect(Number.isFinite(spawnInterval(CONFIG.wave.bossEvery, d))).toBe(true);
      expect(measureSpawnSeconds(CONFIG.wave.bossEvery, d)).toBe(0);
    }
  });
});
