// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bestWaveCleared, hasClearedWaves, onProgressChange, recordWaveCleared,
  resetProgressForTest, waveClearLabel,
} from '../src/progress';
import { enemyCount } from '../src/config';
import { createInitialState } from '../src/core/state';
import { checkWaveEnd, startWave } from '../src/core/wave';
import type { Difficulty, GameEvent } from '../src/types';
import { installStorage, uninstallStorage } from './storageStub';

const KEY = 'chess-defense.progress.v1';

beforeEach(() => { resetProgressForTest(); });
afterEach(() => { resetProgressForTest(); uninstallStorage(); });

describe('웨이브 클리어 기록 (v1.20 — boolean에서 최고 웨이브로)', () => {
  it('처음에는 아무것도 클리어하지 않았다', () => {
    expect(bestWaveCleared()).toBe(0);
    expect(hasClearedWaves(1)).toBe(false);
  });

  it('클리어한 웨이브가 남고, 그 이하는 전부 만족된다', () => {
    recordWaveCleared(23);
    expect(bestWaveCleared()).toBe(23);
    expect(hasClearedWaves(20), '20웨이브 "이상"이므로 23은 20을 만족한다').toBe(true);
    expect(hasClearedWaves(23)).toBe(true);
    expect(hasClearedWaves(24)).toBe(false);
  });

  it('★ 기록은 단조다 — 낮은 난이도로 다시 놀아도 깎이지 않는다', () => {
    // 하드로 30웨이브까지 간 사람이 이지를 한 판 하면 w1부터 다시 기록이 들어온다.
    // 최댓값만 올라가지 않으면 그 판이 성취를 **지운다.**
    recordWaveCleared(30);
    for (let w = 1; w <= 20; w++) recordWaveCleared(w);
    expect(bestWaveCleared()).toBe(30);
  });

  it('저장되어 다음 판까지 살아남는다', () => {
    // 결과 화면의 "다시 시작"이 location.reload()라(ui/banners.ts) 메모리는 매 판 날아간다 —
    // 저장하지 않으면 해금이 그 판에서만 유효하다.
    const store = installStorage();
    recordWaveCleared(20);
    expect(JSON.parse(store.data[KEY])).toEqual({ bestWaveCleared: 20 });
  });

  it('★ 최고 기록을 넘지 못하는 호출은 저장하지 않는다', () => {
    // 웨이브마다 불리므로(main.ts) 이미 넘어선 구간을 다시 지날 때 매번 쓰면
    // 이지 한 판(20웨이브)마다 localStorage에 20번을 헛으로 쓴다.
    const store = installStorage();
    recordWaveCleared(20);
    const afterFirst = store.writes;
    for (let w = 1; w <= 20; w++) recordWaveCleared(w);
    expect(store.writes, '같거나 낮은 웨이브는 저장하지 않는다').toBe(afterFirst);
  });

  it('구독자에게는 기록이 실제로 올라갔을 때만 알린다', () => {
    let calls = 0;
    const off = onProgressChange(() => { calls++; });
    recordWaveCleared(20);
    recordWaveCleared(20);
    recordWaveCleared(5);
    expect(calls).toBe(1);
    off();
    resetProgressForTest();
    recordWaveCleared(20);
    expect(calls, '해지 후에는 알리지 않는다').toBe(1);
  });

  it('숫자가 아닌 값은 기록하지 않는다', () => {
    recordWaveCleared(Number.NaN);
    recordWaveCleared(Number.POSITIVE_INFINITY);
    expect(bestWaveCleared()).toBe(0);
  });

  it('저장할 곳이 없어도 그 판에서는 정상 동작한다', () => {
    uninstallStorage();
    expect(() => recordWaveCleared(20)).not.toThrow();
    expect(hasClearedWaves(20)).toBe(true);
  });
});

/**
 * main.ts의 배선을 그대로 흉내 낸다 — `waveCleared` 이벤트 하나당 `recordWaveCleared` 한 번.
 * 여기서 보려는 것은 저장 로직이 아니라 **코어가 그 이벤트를 웨이브마다 정확히 한 번 내는가**,
 * 그리고 그 값이 난이도와 무관한 절대 웨이브 번호인가다.
 */
function playThrough(difficulty: Difficulty, upTo: number): void {
  const s = createInitialState(difficulty);
  const events: GameEvent[] = [];
  for (let w = 1; w <= upTo; w++) {
    startWave(s);
    s.spawnedCount = enemyCount(s.wave, difficulty);
    s.killedThisWave = s.spawnedCount;
    checkWaveEnd(s, events, () => 0);
    for (const ev of events) if (ev.kind === 'waveCleared') recordWaveCleared(ev.wave);
    events.length = 0;
  }
}

describe('코어와의 배선 — 승리가 아니라 웨이브 클리어를 적는다 (v1.20)', () => {
  it('★ 하드 판을 20웨이브까지만 진행해도 20이 기록된다 — 판을 끝내지 않았는데도', () => {
    // 예전 규칙(승리 시 기록)이었다면 하드는 40을 다 깨야 했고, w25에서 무너진 판은
    // 이지 승리보다 멀리 갔는데도 아무것도 남기지 못했다.
    playThrough('hard', 20);
    expect(bestWaveCleared()).toBe(20);
    expect(hasClearedWaves(20)).toBe(true);
  });

  it('이지 완주도 같은 수를 남긴다 — 조건이 난이도를 묻지 않는다는 것의 다른 면', () => {
    playThrough('easy', 20);
    expect(bestWaveCleared()).toBe(20);
  });

  it('중간에 멈추면 거기까지만 남는다', () => {
    playThrough('normal', 7);
    expect(bestWaveCleared()).toBe(7);
    expect(hasClearedWaves(20)).toBe(false);
  });
});

describe('해금 문구', () => {
  it('★ 수를 인자로 받는다 — 조건의 단일 출처는 스킨 표다', () => {
    expect(waveClearLabel(20)).toContain('20');
    expect(waveClearLabel(30)).toContain('30');
  });

  it('★ "이상"이라고 적는다 — 40웨이브를 깬 사람에게 20은 이미 지나온 조건이다', () => {
    expect(waveClearLabel(20)).toContain('이상');
  });
});

/** 저장값 읽기는 모듈 로드 시점에 한 번뿐이라, 이 블록만 모듈을 지우고 다시 import한다
 *  (tests/skins.test.ts의 같은 이름 블록과 같은 이유). */
describe('저장값 읽기 — 신뢰할 수 없는 입력', () => {
  async function reload(raw: string | null) {
    const store = installStorage();
    if (raw !== null) store.data[KEY] = raw;
    vi.resetModules();
    return import('../src/progress');
  }

  afterEach(() => { uninstallStorage(); vi.resetModules(); });

  it('기록된 값을 복원한다', async () => {
    const mod = await reload(JSON.stringify({ bestWaveCleared: 27 }));
    expect(mod.bestWaveCleared()).toBe(27);
  });

  it('★ v1.19의 옛 형식(boolean)은 20웨이브 클리어로 읽는다', async () => {
    // 그 시절에는 난이도가 없어 "마지막 웨이브"가 20 하나뿐이었다. 이 이관이 없으면
    // 이미 폰 스킨을 열어 둔 사람이 업데이트 직후 스킨을 도로 빼앗긴다.
    const mod = await reload(JSON.stringify({ clearedFinalWave: true }));
    expect(mod.bestWaveCleared()).toBe(20);
    expect(mod.hasClearedWaves(20)).toBe(true);
  });

  it('새 형식이 있으면 옛 형식은 무시한다', async () => {
    const mod = await reload(JSON.stringify({ bestWaveCleared: 35, clearedFinalWave: true }));
    expect(mod.bestWaveCleared()).toBe(35);
  });

  it.each([
    ['JSON이 아님', 'not json{'],
    ['객체가 아님', '"yes"'],
    ['배열', '[20]'],
    ['null', 'null'],
    ['빈 객체', '{}'],
    ['★ 문자열 "20"', '{"bestWaveCleared":"20"}'],
    ['★ true', '{"bestWaveCleared":true}'],
    ['★ 음수', '{"bestWaveCleared":-5}'],
    ['★ Infinity(JSON에서는 null)', '{"bestWaveCleared":null}'],
    ['★ 옛 형식의 문자열 "false"', '{"clearedFinalWave":"false"}'],
    ['★ 옛 형식의 숫자 1', '{"clearedFinalWave":1}'],
  ])('망가진 저장값(%s)은 기록 없음으로 시작한다', async (_label, raw) => {
    // 해금은 **얻어야 하는 것**이다. 느슨하게 읽으면 문자열 "20"이나 true가 해금으로 통과해,
    // 저장값이 조금만 어긋나도 공짜로 열린다.
    const mod = await reload(raw);
    expect(mod.bestWaveCleared()).toBe(0);
  });
});
