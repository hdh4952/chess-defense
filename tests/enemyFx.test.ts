import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { applyAttack } from '../src/core/combat';
import { EnemyFx } from '../src/render/enemyFx';
import { enemyAt, waveState } from './helpers';
import type { Enemy, EnemyTrait, GameEvent, GameState } from '../src/types';

/**
 * 적별 표시 상태 — 피격 플래시와 체력바 보간 (v1.15).
 *
 * ★ 이 스위트가 지키는 것은 연출의 **모양**이 아니라 **계층과 수명**이다:
 *   ① 코어가 연출 상태를 갖지 않는다(Enemy에 플래시·표시체력 필드가 없다)
 *   ② 죽은 적의 항목이 새지 않는다 — 한 판에 452마리 + 분열체가 지나간다
 *   ③ 일시정지 중에는 진행하지 않는다(Effects와 같은 규칙)
 * 모양은 눈으로 판단할 몫이고, 위 셋은 눈으로 못 보는 대신 조용히 망가진다.
 */

const HIT = (e: Enemy, damage = 5, blocked = false): GameEvent =>
  ({ kind: 'enemyHit', enemyId: e.id, file: e.file, y: e.y, damage, blocked });

function withTraits(e: Enemy, traits: EnemyTrait[]): Enemy {
  (e as { traits: readonly EnemyTrait[] }).traits = traits;
  return e;
}

describe('피격 플래시', () => {
  it('맞으면 1에서 시작해 2프레임 뒤 0이 된다', () => {
    // 사용자 요청이 "2프레임"이므로 60fps 기준 2/60초다. 그 값을 넘기면 사라져야 하고,
    // 그 전에는 남아 있어야 한다 — 둘 중 하나만 재면 "영원히 켜져 있는" 구현이 통과한다.
    const s = waveState();
    const e = enemyAt(10, 3, 4);
    s.enemies.push(e);
    const fx = new EnemyFx();
    expect(fx.flashAmount(e.id)).toBe(0);

    fx.onEvent(HIT(e));
    expect(fx.flashAmount(e.id)).toBe(1);
    fx.update(1 / 60, s);
    expect(fx.flashAmount(e.id)).toBeGreaterThan(0);
    expect(fx.flashAmount(e.id)).toBeLessThan(1);
    fx.update(2 / 60, s);
    expect(fx.flashAmount(e.id)).toBe(0);
  });

  it('★ 막힌 피격도 번쩍인다 — "맞았는데 안 들어갔다"가 보여야 한다', () => {
    // 장갑형 문턱에 막힌 공격이 아무 표시도 안 내면, 플레이어는 폰이 왜 아무것도 못 하는지
    // 알 수 없다. 번쩍임은 "닿았다"를 말하고, 함께 뜨는 막힘 표식이 "안 들어갔다"를 말한다.
    const s = waveState();
    const e = enemyAt(10, 3, 4);
    s.enemies.push(e);
    const fx = new EnemyFx();
    fx.onEvent(HIT(e, 0, true));
    expect(fx.flashAmount(e.id)).toBe(1);
  });

  it('일시정지 중에는 감쇠하지 않는다', () => {
    const s = waveState();
    const e = enemyAt(10, 3, 4);
    s.enemies.push(e);
    const fx = new EnemyFx();
    fx.onEvent(HIT(e));
    fx.update(0, s);
    fx.update(0, s);
    expect(fx.flashAmount(e.id)).toBe(1);
  });
});

describe('체력바 보간', () => {
  /** 이 적의 실제 유효 체력 — 보간 목표값이다. */
  const target = (e: Enemy): number => Math.max(0, e.hp + e.auraBonus);

  it('★ 즉시가 아니라 0.2초에 걸쳐 따라간다', () => {
    const s = waveState();
    const e = enemyAt(10, 3, 4);
    s.enemies.push(e);
    const fx = new EnemyFx();
    fx.update(1 / 60, s);
    expect(fx.displayHp(e)).toBe(e.maxHp);

    e.hp = 0;                                    // 한 방에 다 깎였다
    fx.update(0.1, s);                           // 절반 시간
    const mid = fx.displayHp(e);
    expect(mid).toBeGreaterThan(0);               // 아직 남아 있다 = 보간이 실제로 걸렸다
    expect(mid).toBeLessThan(e.maxHp);
    fx.update(0.15, s);                          // 남은 시간 + 여유
    expect(fx.displayHp(e)).toBe(0);
  });

  it('보스와 일반 적이 같은 0.2초를 쓴다 — 속도가 최대 체력에 비례한다', () => {
    // 고정 속도(초당 N)로 만들면 체력 1,770의 보스는 막대가 몇 초씩 흐른다. 최대 체력
    // 기준이어야 크기와 무관하게 같은 시간이 걸린다.
    const s = waveState();
    const small = enemyAt(1, 0, 4, false, 'small');
    const boss = enemyAt(20, 1, 4, true, 'boss');
    s.enemies.push(small, boss);
    const fx = new EnemyFx();
    fx.update(1 / 60, s);
    small.hp = 0;
    boss.hp = 0;
    fx.update(0.25, s);
    expect(fx.displayHp(small)).toBe(0);
    expect(fx.displayHp(boss)).toBe(0);
    expect(boss.maxHp).toBeGreaterThan(small.maxHp * 10);   // 크기 차가 실제로 크다
  });

  it('★ 오라 보너스가 목표값에 포함된다 — 분모와 분자가 같은 정의를 써야 한다', () => {
    // renderer가 분모를 maxHp + auraBonus로 쓰므로 분자도 같은 정의여야 한다. 어긋나면
    // 오라가 붙은 적의 막대가 꽉 찬 상태에서 시작하지 않는다.
    const s = waveState();
    const e = enemyAt(18, 3, 4);
    e.auraBonus = 12;
    s.enemies.push(e);
    const fx = new EnemyFx();
    fx.update(1 / 60, s);
    expect(fx.displayHp(e)).toBe(target(e));
    expect(fx.displayHp(e)).toBe(e.maxHp + 12);
  });

  it('적립된 피해(hp 음수)는 0으로 하한 짓는다 — 막대는 음수를 못 그린다', () => {
    const s = waveState();
    const e = enemyAt(18, 3, 4);
    e.hp = -30;
    s.enemies.push(e);
    const fx = new EnemyFx();
    fx.update(1, s);
    expect(fx.displayHp(e)).toBe(0);
  });

  it('새로 스폰된 적은 첫 프레임부터 꽉 찬 막대다 — 0에서 치솟지 않는다', () => {
    const s = waveState();
    const fx = new EnemyFx();
    fx.update(1 / 60, s);                        // 적이 없는 상태로 한 프레임
    const e = enemyAt(10, 3, 4);
    s.enemies.push(e);
    // update 전에 물어봐도(렌더가 먼저 도는 순서) 실제 값이 온다.
    expect(fx.displayHp(e)).toBe(e.maxHp);
    fx.update(0, s);                             // 일시정지 프레임에도 초기값은 잡힌다
    expect(fx.displayHp(e)).toBe(e.maxHp);
  });
});

describe('★ 죽은 적의 항목이 새지 않는다', () => {
  it('적이 사라지면 플래시·표시체력 항목도 사라진다', () => {
    // 한 판에 452마리 + 분열체가 지나간다. 정리하지 않으면 Map이 단조 증가하고, 그 누수는
    // 화면에 아무 증상도 내지 않는다 — 이 테스트 말고는 감시할 방법이 없다.
    const s = waveState();
    const e = enemyAt(10, 3, 4, false, 'gone');
    s.enemies.push(e);
    const fx = new EnemyFx();
    fx.onEvent(HIT(e));
    fx.update(1 / 60, s);
    expect(fx.flashAmount('gone')).toBeGreaterThan(0);

    s.enemies.length = 0;
    fx.update(1 / 60, s);
    expect(fx.flashAmount('gone')).toBe(0);
    // 표시체력도 지워졌는지 — 지워졌으면 다시 물어볼 때 인자의 실제 값이 그대로 온다.
    e.hp = 7;
    expect(fx.displayHp(e)).toBe(7);
  });

  it('일시정지 중에도 정리는 한다 — 죽은 적이 정지 동안 쌓이지 않는다', () => {
    const s = waveState();
    const e = enemyAt(10, 3, 4, false, 'gone');
    s.enemies.push(e);
    const fx = new EnemyFx();
    fx.onEvent(HIT(e));
    s.enemies.length = 0;
    fx.update(0, s);
    expect(fx.flashAmount('gone')).toBe(0);
  });
});

describe('★ 코어가 연출 상태를 갖지 않는다 (계층 규칙)', () => {
  it('Enemy에 플래시·표시체력 필드가 없다', () => {
    // src/core/는 DOM-free이자 연출-free여야 한다. 이 단언이 없으면 다음 사람이 "간단하니까"
    // Enemy에 flash 필드를 더하고, 그 순간 헤드리스 측정이 연출 값을 들고 다니기 시작한다.
    const e = enemyAt(10, 3, 4);
    const keys = Object.keys(e);
    for (const forbidden of ['flash', 'shownHp', 'displayHp', 'hitAt']) {
      expect(keys, forbidden).not.toContain(forbidden);
    }
    // 코어가 갖는 파생 상태는 **규칙에 쓰이는 것**뿐이다(감속 티어·오라 보너스).
    expect(keys).toContain('slowTier');
    expect(keys).toContain('auraBonus');
  });
});

describe('enemyHit 이벤트 — 발행 규칙', () => {
  function hitsOf(traits: EnemyTrait[], damage: number, fromRank: number): GameEvent[] {
    const s: GameState = waveState();
    const e = withTraits(enemyAt(12, 3, 4, false, 'h'), traits);
    s.enemies.push(e);
    const ev: GameEvent[] = [];
    applyAttack(s, [{ file: 3, rank: 4 }], damage, ev, { file: 3, rank: fromRank });
    return ev.filter(x => x.kind === 'enemyHit');
  }

  it('피해가 들어가면 damage에 실제 값이, blocked는 false다', () => {
    const [hit] = hitsOf([], 7, 5);
    expect(hit).toMatchObject({ kind: 'enemyHit', damage: 7, blocked: false });
  });

  it('★ 장갑형 문턱에 막히면 damage 0 · blocked true로 **발행된다**', () => {
    // 발행 자체를 건너뛰면 화면이 아무것도 못 보여주고, 플레이어는 폰이 왜 무력한지 모른다.
    const below = CONFIG.traitDefs.armored.damageThreshold! - 1;
    const [hit] = hitsOf(['armored'], below, 5);
    expect(hit).toMatchObject({ damage: 0, blocked: true });
  });

  it('★ 실드형 전방 차단도 blocked true다', () => {
    // 두 유형이 같은 표식을 쓴다 — 플레이어에게는 "안 들어갔다"가 같은 사실이고, 왜인지는
    // 적에게 붙은 유형 표식이 말한다.
    const [hit] = hitsOf(['shielded'], 99, 2);   // 적(rank 4)보다 낮은 랭크 = 전방
    expect(hit).toMatchObject({ damage: 0, blocked: true });
  });

  it('원피해가 0이면 blocked가 아니다 — 유형이 막은 것과 구분된다', () => {
    // 공격력 0인 기물은 애초에 발사 루프에서 제외되므로 실전에서는 오지 않지만, blocked의
    // 정의가 "유형이 막았다"라는 것을 여기서 고정한다. 거짓 양성이면 막힘 표식이 남발된다.
    const [hit] = hitsOf([], 0, 5);
    expect(hit).toMatchObject({ damage: 0, blocked: false });
  });

  it('사거리 밖 적에게는 발행되지 않는다', () => {
    const s = waveState();
    s.enemies.push(enemyAt(12, 0, 1, false, 'far'));
    const ev: GameEvent[] = [];
    applyAttack(s, [{ file: 3, rank: 4 }], 10, ev, { file: 3, rank: 5 });
    expect(ev).toEqual([]);
  });
});
