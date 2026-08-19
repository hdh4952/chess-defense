// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLobby } from '../src/ui/lobby';
import { DEFAULT_DIFFICULTY, DIFFICULTIES } from '../src/config';
import { resetDifficultyForTest, selectedDifficulty } from '../src/difficulty';
import { installStorage, uninstallStorage } from './storageStub';
import type { Difficulty } from '../src/types';

/**
 * ★★ v1.37 — **새 로비** (사용자 결정: "빈페이지 중앙에 난이도 버튼 세 개를 가로로 배치
 * (EASY, NORMAL, HARD)하고 하단에 BATTLE 버튼을 배치해. 난이도를 선택하고 BATTLE을 누르면
 * 게임 화면으로 넘어가도록. 부가 설명없이 딱 내가 말한 내용만").
 *
 * ⚠️ 예전 시작 화면은 **지우지 않고 보관한다**(`ui/titleScreen.ts`, 사용자 요청). 그 파일의
 * 테스트도 그대로 돌아간다 — 다만 그것들은 이제 **화면에 뜨지 않는 모듈**을 검증한다.
 * 그래서 실제로 배포되는 화면에 대한 보증(특히 저작자 표시)은 **여기**가 져야 한다.
 */
describe('로비 (v1.37)', () => {
  beforeEach(() => { installStorage(); resetDifficultyForTest(); });
  afterEach(() => { uninstallStorage(); document.body.innerHTML = ''; });

  function mount(onBattle: (d: Difficulty) => void = () => {}): HTMLElement {
    const app = document.createElement('div');
    document.body.appendChild(app);
    createLobby(app, onBattle);
    return app;
  }

  const picks = (app: HTMLElement) => [...app.querySelectorAll<HTMLButtonElement>('.lobby-diff')];

  it('★ 로고 · 난이도 버튼 셋 · BATTLE, 그게 전부다', () => {
    const app = mount();
    expect(picks(app).map(b => b.textContent)).toEqual(['EASY', 'NORMAL', 'HARD']);
    expect(app.querySelector('#battle')).toBeTruthy();
    // "부가 설명없이" — 예전 화면의 구성물이 하나도 따라오지 않았는지 본다. 이 목록이
    // 이 화면의 **비어 있음**을 지키는 유일한 장치다.
    for (const gone of ['#title-head', '#title-guide', '#title-tabs', '#title-panels',
      '#title-hint', '#difficulty', '.title-tab', '.panel-facts', '.range-board']) {
      expect(app.querySelector(gone), gone).toBeNull();
    }
  });

  it('★ 로고가 화면 맨 위에 있다 (v1.37.1)', () => {
    const app = mount();
    const logo = app.querySelector<HTMLImageElement>('#lobby-logo')!;
    expect(logo).toBeTruthy();
    // 순서 — 로고가 난이도 줄보다 앞이어야 "상단"이다.
    const kids = [...app.querySelector('#lobby')!.children];
    expect(kids.indexOf(logo)).toBe(0);
    expect(kids.indexOf(logo)).toBeLessThan(kids.indexOf(app.querySelector('#lobby-difficulty')!));
    // ⚠️ alt가 비면 그림이 뜨지 않았을 때 이 화면에 **이름이 하나도 남지 않는다** —
    //    로비의 글자는 난이도 셋과 BATTLE뿐이라 게임 이름을 말하는 것은 이 그림이 유일하다.
    expect(logo.alt).toBe('CHESS RANDOM DEFENSE');
    // 크기를 미리 적어 둬야 로고가 늦게 도착해도 아래 버튼이 밀려 올라갔다 내려오지 않는다.
    expect(logo.getAttribute('width')).toBeTruthy();
    expect(logo.getAttribute('height')).toBeTruthy();
  });

  it('버튼 목록은 CONFIG에서 유도된다 — 난이도를 하나 더 넣어도 이 화면은 그대로다', () => {
    const app = mount();
    expect(picks(app).map(b => b.dataset.difficulty)).toEqual(DIFFICULTIES);
  });

  it('처음 열면 기본 난이도가 골라져 있다', () => {
    const app = mount();
    const on = picks(app).filter(b => b.getAttribute('aria-pressed') === 'true');
    expect(on).toHaveLength(1);
    expect(on[0].dataset.difficulty).toBe(DEFAULT_DIFFICULTY);
  });

  it('★ 고르면 하나만 눌린 상태가 되고, 그 선택이 저장된다', () => {
    const app = mount();
    picks(app).find(b => b.dataset.difficulty === 'hard')!.click();
    expect(picks(app).map(b => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true']);
    expect(selectedDifficulty()).toBe('hard');

    // 다시 열어도 살아 있다 — 저장의 요점이 그것이다.
    document.body.innerHTML = '';
    const again = mount();
    expect(picks(again).find(b => b.getAttribute('aria-pressed') === 'true')!.dataset.difficulty)
      .toBe('hard');
  });

  it('★ BATTLE은 **누른 순간의** 선택을 넘긴다', () => {
    const onBattle = vi.fn();
    const app = mount(onBattle);
    app.querySelector<HTMLButtonElement>('#battle')!.click();
    expect(onBattle).toHaveBeenCalledWith(DEFAULT_DIFFICULTY);

    // 고른 뒤 다시 누르면 바뀐 값이 간다 — 클로저에 미리 담아 두면 여기서 옛 값이 나온다.
    picks(app).find(b => b.dataset.difficulty === 'normal')!.click();
    app.querySelector<HTMLButtonElement>('#battle')!.click();
    expect(onBattle).toHaveBeenLastCalledWith('normal');
  });

  it('게임 화면 전용 높이 고정을 푼다', () => {
    const app = document.createElement('div');
    app.classList.add('in-game');       // 게임에서 돌아온 상황
    document.body.appendChild(app);
    createLobby(app, () => {});
    expect(app.classList.contains('in-game')).toBe(false);
  });

  /**
   * ⚠️ **이 화면에는 위키미디어 그림이 하나도 없다.** 그래도 크레딧을 남긴 것은, 게임 화면이
   * 여전히 그 그림을 쓰고(뽑기 확률표 아이콘 · 드래그 고스트) v1.30에서 **표시를 로비가
   * 전담하기로** 했기 때문이다 — 로비에서 지우면 앱 어디에도 저작자 표시가 없어진다.
   * 보증이 보관된 `titleScreen.test.ts`에만 남아 있으면, 그 화면은 이제 뜨지 않으므로
   * 지켜지는지와 무관하게 초록이다.
   */
  it('★ 저작자 표시가 로비에 남아 있다 (NOTICE.md — CC BY-SA 이행)', () => {
    const credit = mount().querySelector('#credit');
    expect(credit).not.toBeNull();
    expect(credit!.textContent).toContain('Cburnett');
    expect(credit!.textContent).toContain('CC BY-SA 3.0');
    expect(credit!.textContent).toContain('CC BY-SA 4.0');
    expect(credit!.textContent).toContain('기본 기물 이미지');
    expect(credit!.querySelector('a[href*="NOTICE.md"]')).toBeTruthy();
  });
});
