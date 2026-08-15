import { describe, expect, it } from 'vitest';
import { CONFIG, enemyCount, enemyHp } from '../src/config';

describe('enemyHp (스펙 4.3 / 4.5)', () => {
  it('웨이브 1~10은 10 + (w-1)', () => {
    expect(enemyHp(1)).toBe(10);
    expect(enemyHp(5)).toBe(14);
    expect(enemyHp(10)).toBe(19);
  });
  it('웨이브 11~20은 19 + 4*(w-10)', () => {
    expect(enemyHp(11)).toBe(23);
    expect(enemyHp(15)).toBe(39);
    expect(enemyHp(20)).toBe(59);
  });
  it('보스 체력 = 일반 체력 × 30 (420/570/1170/1770)', () => {
    const m = CONFIG.enemy.bossHpMultiplier;
    expect(enemyHp(5) * m).toBe(420);
    expect(enemyHp(10) * m).toBe(570);
    expect(enemyHp(15) * m).toBe(1170);
    expect(enemyHp(20) * m).toBe(1770);
  });
});

describe('enemyCount (스펙 4.4 / 4.5)', () => {
  it('일반 웨이브는 10 + 2*(w-1)', () => {
    expect(enemyCount(1)).toBe(10);
    expect(enemyCount(4)).toBe(16);
    expect(enemyCount(19)).toBe(46);
  });
  it('5의 배수 웨이브는 보스 1마리', () => {
    for (const w of [5, 10, 15, 20]) expect(enemyCount(w)).toBe(1);
  });
  it('전체 마릿수 합계는 452 (스펙 4.5)', () => {
    let total = 0;
    for (let w = 1; w <= 20; w++) total += enemyCount(w);
    expect(total).toBe(452);
  });
});
