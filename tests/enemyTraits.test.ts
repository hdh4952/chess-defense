import { describe, expect, it } from 'vitest';
import { CONFIG, enemyTraits, armorMultiplier } from '../src/config';
import { resolveDamage } from '../src/core/combat';
import { createEnemy } from '../src/core/enemy';
import type { EnemyTrait } from '../src/types';

/** 적 유형 — 정체성(traits)과 상태(shieldPool)의 규칙. */

const ALL: EnemyTrait[] = ['armored', 'swift', 'shielded'];

describe('enemyTraits — 결정론적 쿼터', () => {
  it('rng를 전혀 쓰지 않는다 — 같은 입력이면 언제나 같은 출력', () => {
    // 확률 추첨을 쓰면 스폰 파일 시퀀스가 오염되고(signals의 N8), 웨이브별 실측 혼합률이
    // 18~50%로 흔들려 회귀 신호가 잡음에 묻힌다.
    for (let i = 0; i < 40; i++) {
      expect(enemyTraits(19, i, false)).toEqual(enemyTraits(19, i, false));
    }
  });

  it('해금 전에는 아무 유형도 붙지 않는다', () => {
    for (const t of ALL) {
      const before = CONFIG.traitSchedule[t] - 1;
      const seen = [...Array(40).keys()].flatMap(i => enemyTraits(before, i, false));
      expect(seen).not.toContain(t);
    }
  });

  it('일반 적의 유형 보유 비율이 traitRatio에 수렴한다 (해금 수와 무관하게)', () => {
    // 유형별로 독립 쿼터를 돌리면 해금이 늘수록 합집합이 커져 의도한 비율을 넘긴다(실측 52%).
    for (const w of [6, 12, 19]) {
      const n = 10 + 2 * (w - 1);
      const withTrait = [...Array(n).keys()].filter(i => enemyTraits(w, i, false).length > 0).length;
      expect(Math.abs(withTrait / n - CONFIG.traitRatio)).toBeLessThan(0.03);
    }
  });

  it('일반 적은 유형을 하나만 갖는다', () => {
    for (let i = 0; i < 46; i++) {
      expect(enemyTraits(19, i, false).length).toBeLessThanOrEqual(CONFIG.maxTraitsNormal);
    }
  });

  it('보스는 신속을 갖지 않는다 — 가속은 "딜 넣을 시간을 준다"는 보스 설계를 깬다', () => {
    for (const w of [5, 10, 15, 20]) expect(enemyTraits(w, 0, true)).not.toContain('swift');
  });

  it('보스는 w15부터 유형 둘을 겸한다', () => {
    expect(enemyTraits(5, 0, true)).toEqual([]);            // 아무것도 해금 전
    expect(enemyTraits(10, 0, true)).toEqual(['armored']);
    expect(enemyTraits(15, 0, true)).toHaveLength(2);
    expect(enemyTraits(20, 0, true)).toHaveLength(2);
  });
});

describe('resolveDamage — 장갑과 보호막', () => {
  it('장갑은 비율 감산이다 (고정 감산이 아니다)', () => {
    const e = createEnemy(19, 0, false, 'a', ['armored']);
    const m = CONFIG.traitDefs.armored.damageMultiplier!;
    for (const raw of [1, 2, 5, 40]) {
      const fresh = createEnemy(19, 0, false, `a${raw}`, ['armored']);
      expect(resolveDamage(fresh, raw)).toBe(raw * m);
    }
    expect(armorMultiplier(e.traits, false)).toBe(m);
  });

  it('보스는 별도 배수를 쓴다 — 일반 웨이브를 안 건드리고 난이도를 조절하는 유일한 노브', () => {
    const normal = CONFIG.traitDefs.armored.damageMultiplier!;
    const boss = CONFIG.traitDefs.armored.bossDamageMultiplier!;
    expect(boss).not.toBe(normal);
    expect(armorMultiplier(['armored'], true)).toBe(boss);
    expect(armorMultiplier(['armored'], false)).toBe(normal);
  });

  it('보호막은 남은 피해량을 깎는다 — 피격 횟수가 아니다', () => {
    // 횟수로 세면 합성이 피격 수를 절반으로 줄이므로 "T1 둘 = T2 하나"가 깨진다(실측 −23%).
    const e = createEnemy(19, 0, false, 's', ['shielded']);
    const pool = e.shieldPool;
    expect(pool).toBe(Math.round(e.maxHp * CONFIG.traitDefs.shielded.absorbPool!));

    expect(resolveDamage(e, 3)).toBe(0);        // 전량 흡수
    expect(e.shieldPool).toBe(pool - 3);
    expect(resolveDamage(e, pool)).toBe(3);     // 남은 풀만큼만 흡수되고 나머지는 통과
    expect(e.shieldPool).toBe(0);
    expect(resolveDamage(e, 7)).toBe(7);        // 풀이 비면 그대로 들어간다
  });

  it('순서가 규칙이다 — 장갑을 먼저 걸고 그 뒤 풀에서 뺀다', () => {
    // 반대로 하면 장갑 적이 풀을 더 오래 유지해 두 유형이 곱셈으로 겹친다.
    const e = createEnemy(19, 0, false, 'b', ['armored', 'shielded']);
    const m = CONFIG.traitDefs.armored.damageMultiplier!;
    const pool = e.shieldPool;
    const raw = 40;
    expect(resolveDamage(e, raw)).toBe(Math.max(0, raw * m - pool));
    expect(e.shieldPool).toBe(Math.max(0, pool - raw * m));
  });

  it('유형이 없으면 원피해가 그대로 들어간다', () => {
    const e = createEnemy(19, 0, false, 'p');
    expect(e.traits).toEqual([]);
    expect(e.shieldPool).toBe(0);
    expect(resolveDamage(e, 12)).toBe(12);
  });
});

describe('신속 — 속도에 굽는다', () => {
  it('종주 시간이 배수만큼 짧아진다', () => {
    const plain = createEnemy(19, 0, false, 'n');
    const swift = createEnemy(19, 0, false, 'f', ['swift']);
    expect(swift.speed).toBe(plain.speed * CONFIG.traitDefs.swift.speedMultiplier!);
  });

  it('보스 감속과 곱해진다 (금지 조합이지만 식 자체는 성립해야 한다)', () => {
    const boss = createEnemy(20, 0, true, 'b');
    const base = CONFIG.board.squarePx / CONFIG.enemy.secondsPerSquare;
    expect(boss.speed).toBe(base * CONFIG.enemy.bossSpeedMultiplier);
  });
});
