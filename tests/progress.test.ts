// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../src/config';
import {
  FINAL_WAVE_CLEAR_LABEL, hasClearedFinalWave, onProgressChange, recordFinalWaveClear,
  resetProgressForTest,
} from '../src/progress';
import { installStorage, uninstallStorage } from './storageStub';

const KEY = 'chess-defense.progress.v1';

beforeEach(() => { resetProgressForTest(); });
afterEach(() => { resetProgressForTest(); uninstallStorage(); });

describe('승리 기록', () => {
  it('처음에는 클리어 경험이 없다', () => {
    expect(hasClearedFinalWave()).toBe(false);
  });

  it('기록하면 남는다', () => {
    recordFinalWaveClear();
    expect(hasClearedFinalWave()).toBe(true);
  });

  it('저장되어 다음 판까지 살아남는다', () => {
    // 결과 화면의 "다시 시작"이 location.reload()라(ui/banners.ts) 메모리는 매 판 날아간다 —
    // 저장하지 않으면 해금이 그 판에서만 유효하다.
    const store = installStorage();
    recordFinalWaveClear();
    expect(JSON.parse(store.data[KEY])).toEqual({ clearedFinalWave: true });
  });

  it('★ 두 번째부터는 아무 일도 하지 않는다 — 승리 화면 동안 매 프레임 불린다', () => {
    // main.ts는 페이즈 전환을 따로 추적하지 않고 victory인 동안 매 프레임 부른다. 멱등하지
    // 않으면 결과 화면이 떠 있는 내내 초당 60회 localStorage에 쓴다.
    const store = installStorage();
    recordFinalWaveClear();
    const afterFirst = store.writes;
    for (let i = 0; i < 60; i++) recordFinalWaveClear();
    expect(store.writes, '두 번째 호출부터는 저장하지 않는다').toBe(afterFirst);
  });

  it('구독자에게는 처음 한 번만 알린다', () => {
    let calls = 0;
    const off = onProgressChange(() => { calls++; });
    recordFinalWaveClear();
    recordFinalWaveClear();
    expect(calls).toBe(1);
    off();
    resetProgressForTest();
    recordFinalWaveClear();
    expect(calls, '해지 후에는 알리지 않는다').toBe(1);
  });

  it('저장할 곳이 없어도 그 판에서는 정상 동작한다', () => {
    uninstallStorage();
    expect(() => recordFinalWaveClear()).not.toThrow();
    expect(hasClearedFinalWave()).toBe(true);
  });
});

describe('해금 문구', () => {
  it('웨이브 수를 CONFIG에서 유도한다', () => {
    expect(FINAL_WAVE_CLEAR_LABEL).toContain(String(CONFIG.wave.total));
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
    const mod = await reload(JSON.stringify({ clearedFinalWave: true }));
    expect(mod.hasClearedFinalWave()).toBe(true);
  });

  it.each([
    ['JSON이 아님', 'not json{'],
    ['객체가 아님', '"yes"'],
    ['배열', '[true]'],
    ['null', 'null'],
    ['빈 객체', '{}'],
    ['★ 문자열 "false"', '{"clearedFinalWave":"false"}'],
    ['★ 숫자 1', '{"clearedFinalWave":1}'],
  ])('망가진 저장값(%s)은 잠긴 상태로 시작한다', async (_label, raw) => {
    // 해금은 **얻어야 하는 것**이다. `truthy` 검사로 느슨하게 읽으면 문자열 "false"나 숫자 1이
    // 해금으로 통과해, 저장값이 조금만 어긋나도 공짜로 열린다.
    const mod = await reload(raw);
    expect(mod.hasClearedFinalWave()).toBe(false);
  });
});
