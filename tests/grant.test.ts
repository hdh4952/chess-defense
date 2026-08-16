import { describe, expect, it } from 'vitest';
import { CONFIG, TRAITS, clearBonus, enemyCount, pickGrantType } from '../src/config';
import { SLOT_CAPACITY, sellPrice } from '../src/core/economy';
import { createInitialState } from '../src/core/state';
import { checkWaveEnd, startWave, updateSpawning } from '../src/core/wave';
import type { GameEvent, PieceType } from '../src/types';
import { countingRng, cycleRng, fullRun, minWinBuild, rooksTwoPerFile } from './helpers';

/**
 * 무작위 지급 — 짝수 웨이브 클리어마다 T1 기물 하나.
 *
 * 목적은 **매 판을 다르게 만드는 것**이다. 원안이 노렸던 "슬롯 압박"은 실측상 거의 없다 —
 * 트레이가 차면 구매가 막히므로 플레이어는 어차피 비워 두고, 지급 10기는 동종 합성만으로
 * 5칸 이하로 압축된다. 그 목표는 폐기했고 무작위성·초반 부양·융합 재료 셋만 남겼다.
 */

const rngFile = (f: number) => () => f / CONFIG.board.files;

/** 적을 전부 처치한 상태로 웨이브를 끝낸 상태 */
function clearedWave(wave: number) {
  const s = createInitialState();
  s.wave = wave;
  startWave(s);
  updateSpawning(s, 60, [], rngFile(0));
  s.enemies = [];
  s.killedThisWave = enemyCount(wave);
  return s;
}

describe('pickGrantType — 가중치 매핑', () => {
  it('rng를 스스로 부르지 않는다 — roll을 주입받는다', () => {
    // 난수를 안에서 뽑으면 테스트가 전 구간을 결정론적으로 훑을 수 없다.
    expect(pickGrantType(0)).toBe(pickGrantType(0));
  });

  it('가중치가 0인 기물은 절대 나오지 않는다', () => {
    const zero = (Object.keys(CONFIG.grant.weights) as PieceType[])
      .filter(t => CONFIG.grant.weights[t] === 0);
    expect(zero).toContain('queen');   // 퀸은 곱셈 축이라 분산이 골드로 흡수되지 않는다
    for (let i = 0; i < 1000; i++) {
      expect(zero).not.toContain(pickGrantType(i / 1000));
    }
  });

  it('융합물은 지급 풀에 없다 — 융합으로만 얻는다', () => {
    for (const t of Object.keys(TRAITS) as PieceType[]) {
      if (!TRAITS[t].purchasable) expect(CONFIG.grant.weights[t]).toBe(0);
    }
  });

  it('경계값 — roll 0과 1 근처가 모두 유효한 기물을 돌려준다', () => {
    expect(CONFIG.grant.weights[pickGrantType(0)]).toBeGreaterThan(0);
    expect(CONFIG.grant.weights[pickGrantType(0.999999)]).toBeGreaterThan(0);
    expect(CONFIG.grant.weights[pickGrantType(1)]).toBeGreaterThan(0);
  });

  it('실측 분포가 가중치에 수렴한다', () => {
    const counts = new Map<PieceType, number>();
    const N = 10000;
    for (let i = 0; i < N; i++) {
      const t = pickGrantType((i + 0.5) / N);
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    for (const [type, w] of Object.entries(CONFIG.grant.weights) as [PieceType, number][]) {
      expect(Math.abs((counts.get(type) ?? 0) / N - w)).toBeLessThan(0.01);
    }
  });
});

describe('지급 시점과 횟수', () => {
  it('짝수 웨이브에만 지급한다', () => {
    for (const w of [1, 2, 3, 4]) {
      const s = clearedWave(w);
      const ev: GameEvent[] = [];
      checkWaveEnd(s, ev, () => 0);
      const granted = ev.some(x => x.kind === 'granted' || x.kind === 'grantDiscarded');
      expect(granted, `w${w}`).toBe(w % CONFIG.grant.everyWaves === 0);
    }
  });

  it('★ 한 판에 정확히 10회 추첨한다 — 조건 없이', () => {
    // 추첨을 조건부로 만들면(예: 트레이가 빌 때만) draw 수가 플레이 내용에 의존해 재현성이
    // 사라진다. 무조건 뽑고, 넣을 자리가 없으면 그때 버린다.
    const grantRng = countingRng(() => 0);
    fullRun(rooksTwoPerFile(), cycleRng(), grantRng);
    expect(grantRng.count()).toBe(CONFIG.wave.total / CONFIG.grant.everyWaves);
    expect(grantRng.count()).toBe(10);
  });

  it('★ 스폰 난수는 지급 때문에 한 번도 더 소모되지 않는다', () => {
    // 스폰 파일 추첨은 호출 "순서"에만 의존한다. 지급이 같은 난수원을 쓰면 파일 시퀀스가
    // 통째로 달라져 기존 헤드리스 측정이 조용히 다른 것을 잰다.
    const spawnRng = countingRng(cycleRng());
    fullRun(rooksTwoPerFile(), spawnRng, () => 0);
    let expected = 0;
    for (let w = 1; w <= CONFIG.wave.total; w++) expected += enemyCount(w);
    expect(spawnRng.count()).toBe(expected);
    expect(spawnRng.count()).toBe(452);
  });

  it('w20(승리)에도 지급한다 — 추첨 조건에 예외를 두지 않는다', () => {
    const s = clearedWave(CONFIG.wave.total);
    const ev: GameEvent[] = [];
    checkWaveEnd(s, ev, () => 0);
    expect(s.phase).toBe('victory');
    expect(ev.some(x => x.kind === 'granted')).toBe(true);
  });
});

describe('지급 결과', () => {
  it('빈 슬롯에 T1으로 들어가고 골드는 차감되지 않는다', () => {
    const s = clearedWave(2);
    const gold = s.gold;
    const ev: GameEvent[] = [];
    checkWaveEnd(s, ev, () => 0);

    const granted = ev.find(x => x.kind === 'granted');
    expect(granted).toBeDefined();
    const p = s.pieces.find(x => x.slotIndex !== null)!;
    expect(p.tier).toBe(1);
    expect(p.cooldown).toBe(0);
    expect(p.square).toBeNull();
    // 클리어 보너스만 들어오고 지급으로 골드가 나가지는 않는다
    expect(s.gold).toBe(gold + clearBonus(2));
  });

  it('★ 트레이가 꽉 차면 판매가로 환급하고 알린다 — 조용히 버리지 않는다', () => {
    const s = clearedWave(2);
    for (let i = 0; i < SLOT_CAPACITY; i++) {
      s.pieces.push({
        id: `full-${i}`, type: 'pawn', square: null, slotIndex: i,
        cooldown: 0, queenBuffCount: 0, tier: 1,
      });
    }
    const gold = s.gold;
    const earned = s.stats.totalGoldEarned;
    const ev: GameEvent[] = [];
    checkWaveEnd(s, ev, () => 0);

    const discarded = ev.find(x => x.kind === 'grantDiscarded');
    expect(discarded).toBeDefined();
    const type = (discarded as { pieceType: PieceType }).pieceType;
    const refund = sellPrice(type);
    expect(s.gold).toBe(gold + clearBonus(2) + refund);
    // ⚠️ 환급은 판매와 같은 취급이라 "벌어들인 골드" 통계에는 넣지 않는다.
    expect(s.stats.totalGoldEarned).toBe(earned + clearBonus(2));
    expect(s.pieces.filter(p => p.slotIndex !== null)).toHaveLength(SLOT_CAPACITY);
  });
});

describe('지급이 게임 전체에 미치는 영향', () => {
  it('무상 가치가 예산의 일부를 차지한다 — 총량이 10회인 근거', () => {
    // 20회면 무상 가치가 적 유형이 만든 난이도 상승을 통째로 상쇄해 게임이 오히려 쉬워진다.
    //
    // ⚠️ 계획 문서의 "기댓값 290G"는 산술 오류다. 퀸의 5%를 룩으로 옮기면서 룩 몫 +25G만
    // 더하고 퀸 몫 −45G를 빼지 않았다. 실제 값은 265G이고, 한 판 총 무상 가치는 2,650G다
    // (문서는 2,850G로 적고 있다). 방향은 바뀌지 않는다 — 계획보다 오히려 작으므로 적 유형이
    // 올린 난이도를 덜 상쇄한다.
    let expected = 0;
    const entries = Object.entries(CONFIG.grant.weights) as [PieceType, number][];
    for (const [type, w] of entries) expected += w * CONFIG.pieces[type].cost;
    const grants = CONFIG.wave.total / CONFIG.grant.everyWaves;
    expect(grants).toBe(10);
    expect(Math.round(expected)).toBe(265);
    expect(Math.round(expected) * grants).toBe(2650);

    // 한 판 총 골드(24,902G) 대비 10.6% — 판을 흔들되 뒤집지는 않는 크기다.
    expect(Math.round(expected) * grants / 24902).toBeLessThan(0.12);
  });

  it('지급이 켜져도 20웨이브 진행 자체는 그대로다 (엔진 무결성)', () => {
    const r = fullRun(minWinBuild(), cycleRng(), () => 0);
    expect(r.phase).toBe('victory');
    expect(r.kills).toBe(451);
  });
});
