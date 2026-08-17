// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { createEnemy } from '../src/core/enemy';
import { stepGame } from '../src/core/step';
import { createLayout } from '../src/ui/layout';
import { wireControls, wireMuteButton, type MuteControllable } from '../src/ui/controls';
import type { GameEvent, GameState } from '../src/types';
import { boardPiece, cleanState } from './helpers';

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
    const state = cleanState();
    wireControls(layout, state);

    layout.hud.pauseBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(state.paused).toBe(true);

    layout.hud.pauseBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(state.paused).toBe(false);
  });

  it('phase가 victory/defeat이면 클릭해도 토글되지 않는다 (재개할 것이 없으므로)', () => {
    const layout = createLayout(makeApp());
    const state = cleanState();
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
    const state = cleanState();
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
    const state = cleanState();
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

describe('wireMuteButton — 음소거 버튼 (스펙 7.6/§10.1 v1.2, 공격 사운드 첫 슬라이스)', () => {
  function fakeAudio(): MuteControllable & { muted: boolean } {
    return {
      muted: false,
      isMuted() { return this.muted; },
      setMuted(v: boolean) { this.muted = v; },
    };
  }

  it('HUD에 음소거 버튼이 존재한다', () => {
    const layout = createLayout(makeApp());
    expect(layout.hud.muteBtn).toBeInstanceOf(HTMLButtonElement);
  });

  it('클릭하면 audio.setMuted가 토글되고, 다시 클릭하면 되돌아온다', () => {
    const layout = createLayout(makeApp());
    const audio = fakeAudio();
    wireMuteButton(layout, audio);

    expect(audio.isMuted()).toBe(false);
    layout.hud.muteBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(audio.isMuted()).toBe(true);
    layout.hud.muteBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(audio.isMuted()).toBe(false);
  });

  it('버튼 라벨과 aria-pressed가 음소거 상태를 반영한다', () => {
    const layout = createLayout(makeApp());
    const audio = fakeAudio();
    wireMuteButton(layout, audio);

    expect(layout.hud.muteBtn.getAttribute('aria-pressed')).toBe('false');
    layout.hud.muteBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(layout.hud.muteBtn.getAttribute('aria-pressed')).toBe('true');
    expect(layout.hud.muteBtn.textContent).toBe('🔇');
  });
});

describe('speedMultiplier 배속 균일성 (스펙 7.7 — main.ts의 유일한 dt 경로 검증)', () => {
  // 아래 두 테스트가 함께 "이동/쿨다운/준비시간이 모두 같은 dt를 공유하므로, 배속이 한쪽에만
  // 적용되는 회귀를 잡아낸다"는 주장을 검증한다 (검토 Item 4). 이전에는 이 테스트가 그 주장을
  // 주석에 적어 두고도 두 state의 pieces/enemies를 항상 비운 채 'prepare' 페이즈에만 머물러,
  // moveEnemies/updateCombat을 단 한 번도 실행하지 않았다 — 준비 카운트다운만 검증하면서
  // "세 서브시스템 모두"를 검증한다고 주장한 것 자체가 틀렸다.
  it('2배속은 동일한 프레임 수에 걸쳐 준비 카운트다운을 정확히 2배 진행시킨다', () => {
    // main.ts의 tick(realDt, dt => stepGame(state, dt * state.speedMultiplier, events))와
    // 동일한 호출 형태를 고정 스텝으로 재현한다. 이 테스트는 updatePrepare 경로만 검증한다 —
    // 이동/쿨다운 경로는 pieces/enemies가 비어 있어 전혀 구동되지 않으며, 그 두 경로는
    // 바로 아래 테스트가 담당한다.
    const fixedDt = 1 / 60;
    const frames = 120; // 1배속 2초, 2배속 4초 — 둘 다 prepareSeconds(10s) 미만
    const events: GameEvent[] = [];

    const s1 = cleanState();
    const s2 = cleanState();
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

  it('2배속은 동일한 프레임 수에 걸쳐 적 이동과 기물 쿨다운도 정확히 2배 진행시킨다 (wave 페이즈)', () => {
    // 위 테스트의 빈 상태로는 moveEnemies/updateCombat이 실제로 dt를 소비하는지 검증할 수 없었다
    // (검토 Item 4) — 보드 위 기물 1개와 적 1개를 두고 'wave' 페이즈에서 직접 구동해, 적 y 진행량과
    // 기물 쿨다운 소진량이 실제로 2:1이 되는지 측정한다. 쿨다운은 10초로 크게 잡아 두 state 모두
    // 측정 구간(최대 4초 상당) 안에 0에 도달해 발사·리셋되는 일이 없게 한다.
    const fixedDt = 1 / 60;
    const frames = 120;
    const events: GameEvent[] = [];

    const s1 = cleanState();
    s1.phase = 'wave';
    const p1 = boardPiece('rook', 0, 1);
    p1.cooldown = 10;
    s1.pieces.push(p1);
    const e1 = createEnemy(1, 0, false, 'e1');
    s1.enemies.push(e1);

    const s2 = cleanState();
    s2.phase = 'wave';
    s2.speedMultiplier = 2;
    const p2 = boardPiece('rook', 0, 1);
    p2.cooldown = 10;
    s2.pieces.push(p2);
    const e2 = createEnemy(1, 0, false, 'e2');
    s2.enemies.push(e2);

    for (let i = 0; i < frames; i++) {
      stepGame(s1, fixedDt * s1.speedMultiplier, events);
      stepGame(s2, fixedDt * s2.speedMultiplier, events);
    }

    expect(s1.phase).toBe('wave');
    expect(s2.phase).toBe('wave');

    // 적 이동(moveEnemies): 2배속 쪽이 정확히 2배 더 전진했다.
    expect(e1.y).toBeGreaterThan(0);
    expect(e2.y).toBeCloseTo(e1.y * 2, 9);

    // 기물 쿨다운(updateCombat): 2배속 쪽이 정확히 2배 더 소진됐다.
    const cooldownProgress1 = 10 - p1.cooldown;
    const cooldownProgress2 = 10 - p2.cooldown;
    expect(cooldownProgress1).toBeGreaterThan(0);
    expect(cooldownProgress2).toBeCloseTo(cooldownProgress1 * 2, 9);
  });
});
