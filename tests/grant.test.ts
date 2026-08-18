import { describe, expect, it } from 'vitest';
import { CONFIG, TRAITS, clearBonus, enemyCount, pickGrantType, waveTotal } from '../src/config';
import { emptySquares, sellPrice } from '../src/core/economy';
import { checkWaveEnd, startWave, updateSpawning } from '../src/core/wave';
import type { GameEvent, GameState, PieceType } from '../src/types';
import {
  countingRng, cycleRng, fullRun, minWinBuild, rooksTwoPerFile, totalSplitBorn, cleanState } from './helpers';

/**
 * 무작위 지급 — 짝수 웨이브 클리어마다 T1 기물 하나.
 *
 * 목적은 **매 판을 다르게 만드는 것**이다. 원안이 노렸던 "슬롯 압박"은 실측상 거의 없었고,
 * v1.12에서 기물 보관함 자체가 사라지면서 압박의 대상도 바뀌었다 — 이제 지급은 트레이가 아니라
 * **보드의 빈 칸**을 놓고 구매와 자리를 다툰다. 무작위성·초반 부양·융합 재료 셋만 남은 것은
 * 그대로다.
 */

const rngFile = (f: number) => () => f / CONFIG.board.files;

/** 기물을 놓을 수 있는 칸 수. 8랭크는 적 스폰 구역이라 빠진다 — 리터럴 금지, CONFIG에서 유도. */
const BOARD_CAPACITY = CONFIG.board.files * (CONFIG.board.ranks - 1);

/** 적을 전부 처치한 상태로 웨이브를 끝낸 상태 */
function clearedWave(wave: number) {
  const s = cleanState();
  s.wave = wave;
  startWave(s);
  updateSpawning(s, 60, [], rngFile(0));
  s.enemies = [];
  s.killedThisWave = enemyCount(wave);
  return s;
}

/** 빈 칸을 폰으로 전부 메운다 — 예전 "트레이 만석"에 대응하는 v1.12의 만석 상태다. */
function fillBoard(s: GameState): void {
  for (const sq of emptySquares(s)) {
    s.pieces.push({
      id: `fill-${sq.file}-${sq.rank}`, type: 'pawn', square: sq,
      cooldown: 0, queenBuffCount: 0, tier: 1,
    });
  }
}

/** 지급만 n번 반복시킨다. checkWaveEnd가 웨이브를 넘겨 버리므로 매번 짝수 웨이브로 되돌려 세운다. */
function grantTimes(n: number, grantRng: () => number): { s: GameState; ev: GameEvent[] } {
  const s = clearedWave(CONFIG.grant.everyWaves);
  const ev: GameEvent[] = [];
  for (let i = 0; i < n; i++) {
    s.phase = 'wave';
    s.wave = CONFIG.grant.everyWaves;
    s.spawnedCount = enemyCount(s.wave);
    s.enemies = [];
    checkWaveEnd(s, ev, grantRng);
  }
  return { s, ev };
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
      // 스폰 이벤트는 구매와 공유하므로 bought로 갈라 본다 — 여기서는 아무것도 사지 않았다.
      const granted = ev.some(x => (x.kind === 'pieceSpawned' && !x.bought) || x.kind === 'grantDiscarded');
      expect(granted, `w${w}`).toBe(w % CONFIG.grant.everyWaves === 0);
    }
  });

  it('★ 한 판에 정확히 10회 추첨한다 — 조건 없이 (draw는 그 2배)', () => {
    // 추첨을 조건부로 만들면(예: 자리가 빌 때만 뽑는다) draw 수가 플레이 내용에 의존해 재현성이
    // 사라진다. 무조건 뽑고, 넣을 자리가 없으면 그때 버린다.
    //
    // v1.12에서 지급 한 번이 grantRng를 **두 번** 뽑는다 — 종류 하나, 스폰 위치 하나. 트레이가
    // 사라져 "어디에 놓는가"가 지급의 일부가 됐기 때문이다. 위치를 적 스폰 난수에서 뽑는 것은
    // 금지고(바로 아래 테스트), 세 번째 난수원을 새로 만들 이유는 없다 — "무엇을"과 "어디에"는
    // 같은 한 사건이라 같은 실에서 나오는 편이 재현에 유리하다.
    const DRAWS_PER_GRANT = 2;                 // [종류, 위치]
    const grantRng = countingRng(() => 0);
    fullRun(rooksTwoPerFile(), cycleRng(), grantRng);
    const grants = waveTotal() / CONFIG.grant.everyWaves;
    expect(grants).toBe(10);
    // 룩 16기 + 지급 10기 = 26기라 56칸이 끝까지 남아돈다 → 위치 추첨이 한 번도 생략되지 않는다.
    expect(grantRng.count()).toBe(grants * DRAWS_PER_GRANT);
    expect(grantRng.count()).toBe(20);
  });

  it('★ 스폰 난수는 지급 때문에 한 번도 더 소모되지 않는다', () => {
    // 스폰 파일 추첨은 호출 "순서"에만 의존한다. 지급이 같은 난수원을 쓰면 파일 시퀀스가
    // 통째로 달라져 기존 헤드리스 측정이 조용히 다른 것을 잰다.
    // ★ v1.12에서 이 테스트의 값어치가 더 커졌다 — 지급이 스폰 **위치**까지 뽑게 됐으므로,
    // randomEmptySquare가 실수로 적 스폰 난수를 끌어다 쓰면 여기서만 잡힌다.
    const spawnRng = countingRng(cycleRng());
    fullRun(rooksTwoPerFile(), spawnRng, () => 0);
    let expected = 0;
    for (let w = 1; w <= waveTotal(); w++) expected += enemyCount(w);
    expect(spawnRng.count()).toBe(expected);
    expect(spawnRng.count()).toBe(452);
  });

  it('w20(승리)에도 지급한다 — 추첨 조건에 예외를 두지 않는다', () => {
    const s = clearedWave(waveTotal());
    const ev: GameEvent[] = [];
    checkWaveEnd(s, ev, () => 0);
    expect(s.phase).toBe('victory');
    expect(ev.some(x => x.kind === 'pieceSpawned' && !x.bought)).toBe(true);
  });
});

describe('지급 결과', () => {
  it('보드의 빈 칸에 T1으로 스폰되고 골드는 차감되지 않는다', () => {
    const s = clearedWave(2);
    const gold = s.gold;
    const ev: GameEvent[] = [];
    checkWaveEnd(s, ev, () => 0);

    const granted = ev.find(x => x.kind === 'pieceSpawned');
    expect(granted).toBeDefined();
    // 트레이가 없으므로 지급 기물은 곧바로 보드 위에 있다 — 이 판의 유일한 기물이다.
    expect(s.pieces).toHaveLength(1);
    const p = s.pieces[0];
    expect(p.tier).toBe(1);
    expect(p.cooldown).toBe(0);
    expect(p.square.rank).toBeGreaterThanOrEqual(1);
    expect(p.square.rank).toBeLessThanOrEqual(CONFIG.board.ranks - 1);  // 8랭크는 적 스폰 구역
    // 클리어 보너스만 들어오고 지급으로 골드가 나가지는 않는다
    expect(s.gold).toBe(gold + clearBonus(2));
  });

  it('★ pieceSpawned가 알리는 칸이 기물이 실제로 선 칸이다 — 구매가 아님도 함께 알린다', () => {
    // 스폰 위치를 플레이어가 고르지 않으므로, 이 이벤트가 틀리면 56칸 중에서 직접 찾아야 한다.
    const s = clearedWave(2);
    const ev: GameEvent[] = [];
    checkWaveEnd(s, ev, () => 0);

    const granted = ev.find(x => x.kind === 'pieceSpawned')!;
    const p = s.pieces[0];
    expect(granted.square).toEqual(p.square);
    expect(granted.pieceType).toBe(p.type);
    expect(granted.bought).toBe(false);      // 지급은 구매와 같은 이벤트를 쓰되 이 깃발로 갈린다
    // ⚠️ 값 복사여야 한다. 기물 객체의 square를 참조로 물고 있으면 나중의 이동·합성이 이미
    // 발행된 과거 이벤트를 뒤에서 바꾼다.
    expect(granted.square).not.toBe(p.square);
  });

  it('★ 지급은 언제나 빈 칸에 떨어진다 — 56회까지 한 번도 겹치지 않는다', () => {
    const { s, ev } = grantTimes(BOARD_CAPACITY, cycleRng());

    expect(BOARD_CAPACITY).toBe(56);
    expect(s.pieces).toHaveLength(BOARD_CAPACITY);
    // 칸이 하나라도 겹쳤다면 서로 다른 칸의 수가 기물 수보다 적다.
    const keys = new Set(s.pieces.map(p => `${p.square.file},${p.square.rank}`));
    expect(keys.size).toBe(BOARD_CAPACITY);
    for (const p of s.pieces) {
      expect(p.square.rank).toBeGreaterThanOrEqual(1);
      expect(p.square.rank).toBeLessThanOrEqual(CONFIG.board.ranks - 1);
    }
    // 정확히 다 채웠다 — 남지도, 넘치지도 않았다.
    expect(emptySquares(s)).toHaveLength(0);
    // 알린 칸과 실제로 채워진 칸이 같은 집합이다.
    const announced = ev.filter(x => x.kind === 'pieceSpawned').map(x => `${x.square.file},${x.square.rank}`);
    expect(announced).toHaveLength(BOARD_CAPACITY);
    expect(new Set(announced)).toEqual(keys);
    expect(ev.some(x => x.kind === 'grantDiscarded')).toBe(false);
  });

  it('★ 보드가 꽉 차면 판매가로 환급하고 알린다 — 조용히 버리지 않는다', () => {
    // 예전에는 트레이 16칸이 만석의 기준이었다. 보관함이 사라지면서 그 역할을 보드 56칸이
    // 그대로 물려받았고, 실패 처리(환급 + 통보)는 한 글자도 바뀌지 않았다.
    const s = clearedWave(2);
    fillBoard(s);
    expect(emptySquares(s)).toHaveLength(0);
    const gold = s.gold;
    const earned = s.stats.totalGoldEarned;
    const grantRng = countingRng(() => 0);
    const ev: GameEvent[] = [];
    checkWaveEnd(s, ev, grantRng);

    const discarded = ev.find(x => x.kind === 'grantDiscarded');
    expect(discarded).toBeDefined();
    const type = (discarded as { pieceType: PieceType }).pieceType;
    const refund = sellPrice(type);
    expect(s.gold).toBe(gold + clearBonus(2) + refund);
    // ⚠️ 환급은 판매와 같은 취급이라 "벌어들인 골드" 통계에는 넣지 않는다.
    expect(s.stats.totalGoldEarned).toBe(earned + clearBonus(2));
    // 만석이면 기물이 늘지 않고, 남의 칸을 밀어내지도 않는다.
    expect(s.pieces).toHaveLength(BOARD_CAPACITY);
    expect(ev.some(x => x.kind === 'pieceSpawned')).toBe(false);
    // 종류는 조건 없이 뽑지만 위치는 뽑지 않는다 — 고를 칸 자체가 없다. draw 2회가 아니라 1회다.
    expect(grantRng.count()).toBe(1);
  });

  it('grantRng가 1을 돌려줘도 보드 밖으로 나가지 않는다', () => {
    // 상수 난수원(테스트·롤백 노브)이 정확히 1.0을 주면 인덱스가 범위를 벗어난다.
    // economy.randomEmptySquare의 Math.min 방어가 이것을 막는다.
    const s = clearedWave(2);
    const ev: GameEvent[] = [];
    checkWaveEnd(s, ev, () => 1);

    expect(s.pieces).toHaveLength(1);
    // 빈 칸 목록의 마지막 칸 = 마지막 파일의 마지막 배치 가능 랭크.
    expect(s.pieces[0].square).toEqual({
      file: CONFIG.board.files - 1, rank: CONFIG.board.ranks - 1,
    });
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
    const grants = waveTotal() / CONFIG.grant.everyWaves;
    expect(grants).toBe(10);
    expect(Math.round(expected)).toBe(265);
    expect(Math.round(expected) * grants).toBe(2650);

    // 한 판 총 골드(24,902G) 대비 10.6% — 판을 흔들되 뒤집지는 않는 크기다.
    expect(Math.round(expected) * grants / 24902).toBeLessThan(0.12);
  });

  it('지급이 켜져도 20웨이브 진행 자체는 그대로다 (엔진 무결성)', () => {
    const r = fullRun(minWinBuild(), cycleRng(), () => 0);
    expect(r.phase).toBe('victory');
    // 일반 적 451 + 분열체(v1.14). 유도하는 이유는 helpers.totalSplitBorn 주석 참조.
    expect(r.kills).toBe(451 + totalSplitBorn());
  });
});
