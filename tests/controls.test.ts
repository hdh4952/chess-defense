// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { stepGame } from '../src/core/step';
import { createInitialState } from '../src/core/state';
import { createLayout } from '../src/ui/layout';
import { wireControls } from '../src/ui/controls';
import type { GameEvent, GameState } from '../src/types';

function makeApp(): HTMLElement {
  const app = document.createElement('div');
  document.body.appendChild(app);
  return app;
}

/** happy-dom의 document.hidden은 getter이므로, 인스턴스에 재정의해 오버라이드한다. */
function setDocumentHidden(value: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
}

afterEach(() => {
  // 다음 테스트에 오버라이드가 새어나가지 않도록 인스턴스 프로퍼티를 제거해 프로토타입 getter로 복원한다.
  Reflect.deleteProperty(document, 'hidden');
});

describe('wireControls — 일시정지 버튼 (Task 16, 스펙 7.7)', () => {
  it('클릭하면 state.paused가 토글되고, 다시 클릭하면 되돌아온다', () => {
    const layout = createLayout(makeApp());
    const state = createInitialState();
    wireControls(layout, state);

    layout.hud.pauseBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(state.paused).toBe(true);

    layout.hud.pauseBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(state.paused).toBe(false);
  });

  it('phase가 victory/defeat이면 클릭해도 토글되지 않는다 (재개할 것이 없으므로)', () => {
    const layout = createLayout(makeApp());
    const state = createInitialState();
    wireControls(layout, state);

    state.phase = 'victory';
    layout.hud.pauseBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(state.paused).toBe(false);

    state.phase = 'defeat';
    layout.hud.pauseBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(state.paused).toBe(false);
  });
});

describe('wireControls — 배속 버튼 (Task 16, 스펙 7.7)', () => {
  it('클릭할 때마다 speedMultiplier가 1 → 2 → 1로 순환한다', () => {
    const layout = createLayout(makeApp());
    const state = createInitialState();
    wireControls(layout, state);

    expect(state.speedMultiplier).toBe(1);
    layout.hud.speedBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(state.speedMultiplier).toBe(2);
    layout.hud.speedBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(state.speedMultiplier).toBe(1);
  });
});

describe('wireControls — 탭 이탈 자동 일시정지 (Task 16, 스펙 7.7)', () => {
  function setupHiddenPhase(phase: GameState['phase']): GameState {
    const layout = createLayout(makeApp());
    const state = createInitialState();
    state.phase = phase;
    wireControls(layout, state);
    return state;
  }

  it('prepare 단계에서 탭이 숨겨지면 자동으로 일시정지된다', () => {
    const state = setupHiddenPhase('prepare');
    setDocumentHidden(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(state.paused).toBe(true);
  });

  it('wave 단계에서 탭이 숨겨지면 자동으로 일시정지된다', () => {
    const state = setupHiddenPhase('wave');
    setDocumentHidden(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(state.paused).toBe(true);
  });

  it('탭이 다시 보여도 자동으로는 재개되지 않는다 (수동 해제만 가능)', () => {
    const state = setupHiddenPhase('wave');
    setDocumentHidden(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(state.paused).toBe(true);

    setDocumentHidden(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(state.paused).toBe(true);   // 여전히 일시정지 — 자동 해제는 스펙 위반
  });
});

describe('speedMultiplier 배속 균일성 (스펙 7.7 — main.ts의 유일한 dt 경로 검증)', () => {
  it('2배속은 동일한 프레임 수에 걸쳐 준비 카운트다운을 정확히 2배 진행시킨다', () => {
    // main.ts의 tick(realDt, dt => stepGame(state, dt * state.speedMultiplier, events))와
    // 동일한 호출 형태를 고정 스텝으로 재현한다. 이동/쿨다운/준비시간이 모두 같은 dt를
    // 공유하는 구조이므로, 어느 한 서브시스템에만 배속이 적용되는 회귀를 잡아낸다.
    const fixedDt = 1 / 60;
    const frames = 120; // 1배속 2초, 2배속 4초 — 둘 다 prepareSeconds(10s) 미만
    const events: GameEvent[] = [];

    const s1 = createInitialState();
    const s2 = createInitialState();
    s2.speedMultiplier = 2;

    for (let i = 0; i < frames; i++) {
      stepGame(s1, fixedDt * s1.speedMultiplier, events);
      stepGame(s2, fixedDt * s2.speedMultiplier, events);
    }

    expect(s1.phase).toBe('prepare');
    expect(s2.phase).toBe('prepare');

    const elapsed1 = CONFIG.wave.prepareSeconds - s1.prepareTimer;
    const elapsed2 = CONFIG.wave.prepareSeconds - s2.prepareTimer;

    expect(elapsed1).toBeCloseTo(frames * fixedDt, 10);
    expect(elapsed2).toBeCloseTo(elapsed1 * 2, 10);
  });
});
