import { describe, expect, it } from 'vitest';
import {
  CONFIG, armorMultiplier, damageThresholdFor, enemyTraits, ignoresFrontalDamage, tierMultiplier, waveTotal,
} from '../src/config';
import { pieceDamage, resolveDamage } from '../src/core/combat';
import { recalcQueenBuffs } from '../src/core/buff';
import { createEnemy } from '../src/core/enemy';
import { BOARD_H } from '../src/core/grid';
import { moveEnemies } from '../src/core/enemy';
import type { EnemyTrait } from '../src/types';
import { boardPiece, enemyAt, waveState } from './helpers';

/**
 * 적 유형 5종 (v1.14에서 3종 → 5종 **재정의**).
 *
 * ⚠️ 세 유형이 이름을 유지한 채 규칙이 바뀌었다(사용자 결정). 이름만 보고 예전 규칙을
 * 가정하면 안 된다 — 이 파일의 옛 판본은 "장갑은 비율 감산이다" · "보호막은 남은 피해량을
 * 깎는다" · "순서가 규칙이다 — 장갑을 먼저 걸고 그 뒤 풀에서 뺀다"를 단언하고 있었고,
 * 그 셋 다 지금은 거짓이다.
 *
 * | 유형 | v1.9~v1.13 | v1.14 | 강제하는 것 |
 * |---|---|---|---|
 * | armored  | 피해 ×0.625 | **문턱 미만이면 0** | 폰 도배 무력화 → 버프·합성 강제 |
 * | swift    | ×1.5 | **×2.0 (1.5초/칸)** | 룩의 타격 횟수 절반 → 반응 재배치 |
 * | shielded | 흡수 풀 15% | **전방 피해 무시** | 뒤에서 쏘기 강제 |
 * | splitter | — | 사망 시 2마리 | 관통형 가치 급등 |
 * | aura     | — | 주변 유효 체력 +N | 우선 처치 판단 |
 *
 * 분열형·오라형의 **동작**은 각자의 엔진 단계가 들어올 때 전용 스위트에서 잰다. 여기서는
 * 유형 표·쿼터·해금처럼 다섯이 함께 지켜야 하는 성질만 다룬다.
 */

const ALL = Object.keys(CONFIG.traitDefs) as EnemyTrait[];

describe('유형 표 — 다섯 종의 공통 성질', () => {
  it('EnemyTrait 다섯 종이 전부 traitDefs·traitSchedule·traitPhase에 있다', () => {
    // 하나라도 빠지면 그 유형은 영원히 등장하지 않거나 undefined를 읽는다. 세 표가 따로
    // 관리되므로 컴파일러가 Record로 강제하더라도 **값이 있는지**는 여기서만 확인된다.
    expect(ALL).toHaveLength(5);
    expect(ALL.sort()).toEqual(['armored', 'aura', 'shielded', 'splitter', 'swift']);
    for (const t of ALL) {
      expect(CONFIG.traitSchedule[t], t).toBeGreaterThanOrEqual(1);
      expect(CONFIG.traitSchedule[t], t).toBeLessThanOrEqual(waveTotal());
      expect(CONFIG.traitPhase[t], t).toBeGreaterThanOrEqual(0);
      expect(Object.keys(CONFIG.traitDefs[t]).length, t).toBeGreaterThan(0);
    }
  });

  it('★ 첫 보스(w5)는 맨몸이다 — 이 게임의 w5 게이트가 그 전제 위에 서 있다', () => {
    // armored 해금을 6보다 앞으로 당기면 w5 보스가 0.875 배수를 달고 나오고, 실제로 그렇게
    // 해 봤더니 N3(w5 게이트 최소성)가 그 자리에서 깨졌다. 900G 최소 빌드로 넘을 수 있어야
    // 한다는 것이 계획서의 요구이고, 이 단언이 그 요구를 해금 스케줄에 묶는다.
    expect(enemyTraits(CONFIG.wave.bossEvery, 0, true)).toEqual([]);
    expect(CONFIG.traitSchedule.armored).toBeGreaterThan(CONFIG.wave.bossEvery);
  });

  it('★ 다섯 종이 모두 실제로 등장한다 — 해금이 너무 늦으면 죽은 유형이 된다', () => {
    // 일반 적이 있는 마지막 웨이브는 19다(w20은 보스 단독). 해금이 19를 넘으면 그 유형은
    // 코드에만 있고 게임에는 없다 — 컴파일러도 다른 테스트도 그것을 잡지 못한다.
    const seen = new Map<EnemyTrait, number>();
    for (let w = 1; w < waveTotal(); w++) {
      if (w % CONFIG.wave.bossEvery === 0) continue;
      for (let i = 0; i < 46; i++) {
        for (const t of enemyTraits(w, i, false)) seen.set(t, (seen.get(t) ?? 0) + 1);
      }
    }
    for (const t of ALL) expect(seen.get(t) ?? 0, t).toBeGreaterThan(0);
  });
});

describe('enemyTraits — 결정론적 쿼터', () => {
  it('rng를 전혀 쓰지 않는다 — 같은 입력이면 언제나 같은 출력', () => {
    // 스폰 파일 추첨은 호출 "순서"에만 의존한다. 유형이 draw를 하나라도 쓰면 파일 시퀀스가
    // 통째로 달라져 기존 헤드리스 측정이 조용히 다른 것을 잰다(N8이 그 사실을 강제한다).
    for (let i = 0; i < 50; i++) {
      expect(enemyTraits(15, i, false)).toEqual(enemyTraits(15, i, false));
    }
  });

  it('해금 전에는 아무 유형도 붙지 않는다', () => {
    const first = Math.min(...ALL.map(t => CONFIG.traitSchedule[t]));
    for (let w = 1; w < first; w++) {
      for (let i = 0; i < 20; i++) expect(enemyTraits(w, i, false), `w${w}`).toEqual([]);
    }
  });

  it('일반 적의 유형 보유 비율이 traitRatio에 수렴한다 (해금 수와 무관하게)', () => {
    // 유형마다 독립 쿼터를 돌리면 해금이 늘수록 합집합이 커져 의도한 비율을 넘긴다
    // (실측: 3종 해금 시 52%). 다섯 종이 되면서 그 함정이 더 커졌으므로 전 웨이브를 훑는다.
    // 해금 전 웨이브는 비율이 0이라 제외한다 — 그 사실은 바로 위 테스트가 따로 잰다.
    const first = Math.min(...ALL.map(t => CONFIG.traitSchedule[t]));
    let checked = 0;
    for (let w = first; w < waveTotal(); w++) {
      if (w % CONFIG.wave.bossEvery === 0) continue;
      const n = 40;
      let with_ = 0;
      for (let i = 1; i <= n; i++) if (enemyTraits(w, i, false).length > 0) with_++;
      expect(Math.abs(with_ / n - CONFIG.traitRatio), `w${w}`).toBeLessThan(0.05);
      checked++;
    }
    expect(checked).toBeGreaterThan(5);   // 공허 방지
  });

  it('일반 적은 유형을 하나만 갖는다', () => {
    for (let w = 1; w < waveTotal(); w++) {
      for (let i = 0; i < 40; i++) {
        expect(enemyTraits(w, i, false).length, `w${w}`).toBeLessThanOrEqual(CONFIG.maxTraitsNormal);
      }
    }
  });

  it('★ 보스는 armored만 갖는다 — 나머지 넷은 전부 금지됐다 (v1.14)', () => {
    // 금지 이유가 유형마다 다르다(config.ts bossForbidden 주석):
    //   swift·shielded — 보스는 "딜을 넣을 시간을 주는" 설계이고 둘 다 그 창을 줄인다.
    //     특히 shielded는 실측으로 게임을 클리어 불가능하게 만들어(w15 8/8 → 0/8) 금지됐다.
    //   splitter — 보스가 분열하면 누수 −5가 배로 늘어 즉사한다.
    //   aura — 보스는 단독 스폰이라 버프할 주변 적이 없다(완전한 no-op).
    for (let w = CONFIG.wave.bossEvery; w <= waveTotal(); w += CONFIG.wave.bossEvery) {
      const t = enemyTraits(w, 0, true);
      for (const forbidden of CONFIG.bossForbidden) {
        expect(t, `w${w} ${forbidden}`).not.toContain(forbidden);
      }
      expect(t.every(x => x === 'armored'), `w${w}`).toBe(true);
    }
    expect([...CONFIG.bossForbidden].sort()).toEqual(['aura', 'shielded', 'splitter', 'swift']);
  });

  it('⚠️ bossTraitCountFromWave는 휴면 상태다 — 보스가 가질 수 있는 유형이 하나뿐이라', () => {
    // 값을 남겨 둔 이유는 보스에 붙일 수 있는 유형이 다시 둘 이상이 되면 즉시 살아나기
    // 때문이다(traitPhase와 같은 성격). 지금은 "둘을 겸한다"가 성립할 수 없다는 것을
    // 명시적으로 못박아, 다음 사람이 그 값을 보고 잘못된 기대를 갖지 않게 한다.
    const allowed = ALL.filter(t => !CONFIG.bossForbidden.includes(t));
    expect(allowed).toHaveLength(1);
    const before = enemyTraits(CONFIG.bossTraitCountFromWave - CONFIG.wave.bossEvery, 0, true);
    const after = enemyTraits(CONFIG.bossTraitCountFromWave, 0, true);
    expect(after.length).toBe(before.length);   // 단계가 실제로 없다
  });
});

describe('장갑형 — 문턱 방식 (v1.14)', () => {
  const TH = CONFIG.traitDefs.armored.damageThreshold!;

  it('★ 문턱 미만은 0, 이상은 감산 없이 전량 통과한다', () => {
    // 고정 감산(−2)과 갈리는 지점이다. 감산이면 문턱 위에서도 값이 깎여 티어마다 다른
    // 비율이 걸리고 합성의 골드 중립성이 무너진다(N4가 감시). 문턱은 넘은 뒤 손대지 않는다.
    const e = createEnemy(12, 3, false, 'a', ['armored']);
    for (let raw = 0; raw < TH; raw++) expect(resolveDamage(e, raw), `raw ${raw}`).toBe(0);
    for (const raw of [TH, TH + 1, TH * 10]) expect(resolveDamage(e, raw), `raw ${raw}`).toBe(raw);
  });

  it('★ 폰은 혼자서 막히고, 퀸 버프나 합성으로 넘는다 — 이 유형의 존재 이유', () => {
    // "폰 도배(공격력 2)가 무력화 → 룩/퀸 버프 강제"가 사용자가 적은 의도다. 문턱 3이라는
    // 숫자 하나가 그 의도를 실현한다: T1 폰은 2라 막히고, 퀸 라인 위에서 2×(1+1)=4로 넘는다.
    const e = createEnemy(12, 3, false, 'a', ['armored']);

    const alone = waveState();
    const lone = boardPiece('pawn', 0, 1);
    alone.pieces.push(lone);
    recalcQueenBuffs(alone);
    expect(pieceDamage(lone)).toBeLessThan(TH);
    expect(resolveDamage(e, pieceDamage(lone))).toBe(0);

    const buffed = waveState();
    const p = boardPiece('pawn', 1, 1);
    buffed.pieces.push(p, boardPiece('queen', 0, 1));
    recalcQueenBuffs(buffed);
    expect(p.queenBuffCount).toBeGreaterThan(0);
    expect(resolveDamage(e, pieceDamage(p))).toBeGreaterThan(0);

    // 합성도 같은 문턱을 넘는 경로다 — 둘 중 하나만 열려 있으면 "강제"가 아니라 "봉쇄"다.
    const merged = waveState();
    const t2 = boardPiece('pawn', 0, 1, 2);
    merged.pieces.push(t2);
    recalcQueenBuffs(merged);
    expect(pieceDamage(t2)).toBe(CONFIG.pieces.pawn.damage * tierMultiplier(2));
    expect(resolveDamage(e, pieceDamage(t2))).toBeGreaterThan(0);
  });

  it('보스에게는 문턱이 아니라 비율을 쓴다 — 유일한 보스 난이도 노브', () => {
    // 보스 HP는 420~1,770이라 어떤 실전 빌드도 문턱 3을 넘으므로 문턱은 보스에게 no-op다.
    // 그런데 이 배수(S2에서 5안을 재서 고른 값)는 일반 웨이브를 건드리지 않고 보스 난이도만
    // 조절할 수 있는 유일한 수단이다 — 유형을 재정의하면서 잃으면 안 된다.
    const ratio = CONFIG.traitDefs.armored.bossDamageMultiplier!;
    expect(ratio).toBeLessThan(1);
    const boss = createEnemy(20, 3, true, 'b', ['armored']);
    expect(damageThresholdFor(boss.traits, true)).toBe(0);      // 보스에게 문턱은 없다
    expect(armorMultiplier(boss.traits, true)).toBe(ratio);
    expect(resolveDamage(boss, 100)).toBe(100 * ratio);
    // 문턱 아래 원피해도 보스에게는 비율만 걸린다(0이 되지 않는다).
    expect(resolveDamage(boss, 1)).toBe(ratio);
  });

  it('일반 적에게는 배수가 걸리지 않는다 — 두 축이 섞이면 문턱의 의미가 사라진다', () => {
    const e = createEnemy(12, 3, false, 'a', ['armored']);
    expect(armorMultiplier(e.traits, false)).toBe(1);
  });
});

describe('실드형 — 전방 피해 무시 (v1.14)', () => {
  it('★ 적보다 낮은 랭크에서 온 피해는 0, 같거나 높으면 전량 통과', () => {
    // 적은 위(8랭크)에서 아래(1랭크)로 내려온다. 따라서 "낮은 랭크" = 그 적의 진행 방향 = 전방.
    const e = enemyAt(12, 3, 4, false, 'sh');
    (e as { traits: readonly EnemyTrait[] }).traits = ['shielded'];
    expect(ignoresFrontalDamage(e.traits)).toBe(true);
    for (const rank of [1, 2, 3]) expect(resolveDamage(e, 10, { file: 3, rank }), `r${rank}`).toBe(0);
    for (const rank of [4, 5, 8]) expect(resolveDamage(e, 10, { file: 3, rank }), `r${rank}`).toBe(10);
  });

  it('★ 파일은 판정에 관여하지 않는다 — 랭크만 본다', () => {
    // 룩은 자기 랭크를 관통하므로 다른 파일에서도 때린다. 그 경우에도 랭크만으로 갈려야 한다 —
    // 파일까지 보면 "옆에서 쏘면 먹힌다"는 없는 규칙이 생긴다.
    const e = enemyAt(12, 3, 4, false, 'sh');
    (e as { traits: readonly EnemyTrait[] }).traits = ['shielded'];
    for (const file of [0, 3, 7]) {
      expect(resolveDamage(e, 10, { file, rank: 2 }), `f${file} 전방`).toBe(0);
      expect(resolveDamage(e, 10, { file, rank: 6 }), `f${file} 후방`).toBe(10);
    }
  });

  it('★ from을 생략하면 전방 판정을 건너뛴다 — 방향을 모르는 피해를 0으로 단정하지 않는다', () => {
    // 방향을 모르는 호출부(테스트·미래의 광역 효과)가 조용히 0을 받으면 그 침묵이 어디에서도
    // 드러나지 않는다. 실전 경로(updateCombat)는 항상 공격자 칸을 넘긴다.
    const e = enemyAt(12, 3, 4, false, 'sh');
    (e as { traits: readonly EnemyTrait[] }).traits = ['shielded'];
    expect(resolveDamage(e, 10)).toBe(10);
  });

  it('폰은 구조적으로 실드형을 때릴 수 없다 — 폰의 사거리가 항상 자기보다 위다', () => {
    // pawnTargets는 rank+1만 돌려주므로, 폰이 맞히는 적은 언제나 폰보다 위에 있다.
    // 즉 폰의 피해는 그 적 기준 항상 전방에서 온다 — 사용자가 적은 "폰의 전방 대각 공격이
    // 안 먹힘"이 규칙이 아니라 **기하**에서 나온다는 뜻이다.
    const e = enemyAt(12, 3, 5, false, 'sh');
    (e as { traits: readonly EnemyTrait[] }).traits = ['shielded'];
    // 폰이 (2,4)에 있으면 (3,5)를 때린다 — 폰의 랭크 4 < 적의 랭크 5 → 전방.
    expect(resolveDamage(e, 99, { file: 2, rank: 4 })).toBe(0);
  });
});

describe('고속형 — 속도에 굽는다 (v1.14: ×2.0 = 1.5초/칸)', () => {
  const MULT = CONFIG.traitDefs.swift.speedMultiplier!;

  it('배수와 초/칸이 서로 유도된다', () => {
    // 사용자가 정한 값은 "1.5초/칸"이고 config에 든 값은 배수다. 둘이 어긋나면 문구와 동작이
    // 갈라지므로 여기서 묶는다.
    expect(MULT).toBe(2.0);
    expect(CONFIG.enemy.secondsPerSquare / MULT).toBe(1.5);
  });

  it('종주 시간이 배수만큼 짧아진다', () => {
    const cross = (traits: EnemyTrait[]): number => {
      const s = waveState();
      const e = createEnemy(12, 3, false, 'x', traits);
      s.enemies.push(e);
      let t = 0;
      while (e.y < BOARD_H && t < 200) { moveEnemies(s, 1 / 60); t += 1 / 60; }
      return t;
    };
    const plain = cross([]);
    expect(cross(['swift']) * MULT).toBeCloseTo(plain, 1);
  });

  it('보스 감속과 곱해진다 (금지 조합이지만 식 자체는 성립해야 한다)', () => {
    const base = createEnemy(20, 3, true, 'b').speed;
    const swift = createEnemy(20, 3, true, 'b2', ['swift']).speed;
    expect(swift).toBeCloseTo(base * MULT, 9);
  });
});
