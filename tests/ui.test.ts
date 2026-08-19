// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { drawCost, CONFIG, waveTotal } from '../src/config';
import { emptySquares } from '../src/core/economy';
import { squareKey } from '../src/core/grid';
import { allySpriteUrl } from '../src/render/skins';
import { createLayout, PIECE_NAME } from '../src/ui/layout';
import { updateHud } from '../src/ui/hud';
import { updateShop, wireShop } from '../src/ui/shop';
import { boardPiece, cleanState, totalDrawCost } from './helpers';
import type { UiAudio } from '../src/audio';
import type { UiCueKind } from '../src/audio/cues';
import type { GameEvent, GameState, PieceType } from '../src/types';

/** wireShop 테스트 전용 UiAudio 스텁 — drag.test.ts의 makeAudioSpy와 같은 목적. */
function makeAudioSpy(): UiAudio & { played: UiCueKind[] } {
  return {
    played: [],
    playUi(cue: UiCueKind): void {
      this.played.push(cue);
    },
  };
}

const PIECE_TYPES = Object.keys(CONFIG.pieces) as PieceType[];

function makeApp(): HTMLElement {
  const app = document.createElement('div');
  document.body.appendChild(app);
  return app;
}

/**
 * 배치 가능한 칸을 하나도 남기지 않는다 — v1.12의 "만석" 상태.
 * 칸 목록을 손으로 적지 않고 emptySquares에서 유도하는 것이 핵심이다: 배치 금지 구역(8랭크)
 * 규칙이 바뀌어도 이 헬퍼가 저절로 따라가고, "꽉 찼다"의 정의가 테스트와 프로덕션에서
 * 갈라지지 않는다.
 */
function fillBoard(state: GameState): void {
  for (const sq of emptySquares(state)) state.pieces.push(boardPiece('pawn', sq.file, sq.rank));
  expect(emptySquares(state)).toHaveLength(0);
}

describe('createLayout (Task 14 — UI 셸)', () => {
  // ⚠️ "슬롯 트레이는 정확히 16칸이며 각 칸이 자신의 인덱스를 가진다" 테스트는 v1.12에서 삭제했다.
  //    기물 보관함이 없어지면서 Layout.slotGrid와 ui/slots.ts가 통째로 사라졌으므로 검증 대상
  //    자체가 없다. 그 테스트가 실제로 지키던 것 — "구매·지급이 자리를 다투는 유한한 공간이
  //    있고, 그 공간이 차면 더 못 산다" — 는 아래 updateShop의 "빈 칸 없으면 전부 비활성"이
  //    이어받았다. 공간의 정의만 트레이 16칸 → 보드 빈 칸(emptySquares)으로 바뀌었다.

  it('★ 상점은 뽑기 버튼 하나다 — 무엇이 나올지 고를 수 없으므로 고를 UI도 없다 (v1.16)', () => {
    // ⚠️ v1.16 이전에는 기물별 구매 버튼 5개였다(각각 정가 라벨). 사용자 결정으로 기물을
    //   얻는 유일한 구매 경로가 뽑기가 되면서 버튼도 하나가 됐다.
    const layout = createLayout(makeApp());
    expect(layout.drawBtn).toBeInstanceOf(HTMLButtonElement);
    expect(layout.drawCost).toBeInstanceOf(HTMLElement);
    expect(layout.drawBtn.textContent).toContain('기물 뽑기');
    // ★ v1.27: 금액은 **`createLayout`이 쓰지 않는다.** 보유 골드와 가격 둘 다 상태에서
    //   오므로 매 프레임 `updateShop`이 채운다 — 껍데기가 초기값을 하드코딩하면 상태가
    //   붙기 전 한 프레임 동안 거짓 금액이 떠 있게 된다.
    expect(layout.drawCost.textContent).toBe('');
    // 기물을 고르는 UI가 남아 있지 않은지 — data-piece-type이 붙은 버튼이 하나도 없어야 한다.
    expect(makeApp().querySelectorAll('button[data-piece-type]')).toHaveLength(0);
  });

  /**
   * ★ v1.27 — 버튼이 `기물 뽑기` / `보유 / 필요` 두 줄이 됐다(사용자 결정). "지금 뽑을 수
   * 있나"가 두 수의 대소로 즉시 읽히는 것이 이 배치의 전부라, 순서가 뒤집히거나 한쪽이
   * 빠지면 의미가 사라진다.
   */
  it('★ 뽑기 버튼이 `보유 / 필요` 골드를 함께 적는다 (v1.27)', () => {
    const layout = createLayout(makeApp());
    const state = cleanState();
    state.gold = 137;
    updateShop(layout, state);
    expect(layout.drawCost.textContent).toBe(`137 / ${drawCost(state.draws)}`);
    // 모자라면 숫자 색이 바뀐다 — 버튼 자체는 비활성화 사유(일시정지·만석)와 구분해야 하므로
    // 클래스로만 말한다.
    expect(layout.drawBtn.classList.contains('poor')).toBe(true);

    state.gold = 99999;
    updateShop(layout, state);
    expect(layout.drawBtn.classList.contains('poor')).toBe(false);
  });

  it('★ 뽑기 가격이 오르면 버튼의 필요 금액도 따라 오른다 — 누진(v1.18)이 화면에 드러나는 유일한 자리', () => {
    const layout = createLayout(makeApp());
    const state = cleanState();
    state.gold = 99999;
    updateShop(layout, state);
    const first = layout.drawCost.textContent!;
    state.draws = 5;
    updateShop(layout, state);
    expect(layout.drawCost.textContent).not.toBe(first);
    expect(layout.drawCost.textContent).toBe(`99999 / ${drawCost(5)}`);
  });

  it('★ 뽑기 확률이 화면에 항상 적혀 있다 — 가챠에서 확률을 숨기면 판단 근거가 없다', () => {
    // 특히 퀸 1%처럼 극단적인 값은 알려주지 않으면 "왜 안 나오지"가 버그로 읽힌다.
    // 수치는 CONFIG에서 유도되므로 확률을 바꾸면 문구가 따라온다.
    const app = makeApp();
    createLayout(app);
    const odds = app.querySelector('#odds');
    expect(odds).not.toBeNull();
    const text = odds!.textContent ?? '';
    for (const [type, w] of Object.entries(CONFIG.gacha.weights) as [PieceType, number][]) {
      if (w === 0) {
        expect(text, type).not.toContain(PIECE_NAME[type]);   // 융합물은 표에 없다
        continue;
      }
      expect(text, type).toContain(PIECE_NAME[type]);
      expect(text, type).toContain(`${Math.round(w * 1000) / 10}%`);
    }
    // 가중치가 큰 것부터 — 표시 순서도 유도된다.
    expect(text.indexOf(PIECE_NAME.pawn)).toBeLessThan(text.indexOf(PIECE_NAME.queen));
  });

  it('Layout의 모든 필드가 실제 요소로 해석된다 (null/undefined 없음)', () => {
    const layout = createLayout(makeApp());
    expect(layout.canvas).toBeInstanceOf(HTMLCanvasElement);
    expect(layout.hud.wave).toBeInstanceOf(HTMLElement);
    expect(layout.hud.remaining).toBeInstanceOf(HTMLElement);
    expect(layout.hud.timer).toBeInstanceOf(HTMLElement);
    expect(layout.hud.bossIcon).toBeInstanceOf(HTMLElement);
    expect(layout.hud.pauseBtn).toBeInstanceOf(HTMLButtonElement);
    expect(layout.hud.speedBtn).toBeInstanceOf(HTMLButtonElement);
    expect(layout.hud.muteBtn).toBeInstanceOf(HTMLButtonElement);
    expect(layout.drawBtn).toBeInstanceOf(HTMLButtonElement);
    expect(layout.drawCost).toBeInstanceOf(HTMLElement);
    expect(layout.sellSlot).toBeInstanceOf(HTMLElement);
    expect(layout.startBtn).toBeInstanceOf(HTMLButtonElement);
    expect(layout.bannerRoot).toBeInstanceOf(HTMLElement);
  });

  /**
   * ★ v1.29 — 화면 맨 위 상태 막대(`#hud`)를 없애고 값들을 **자기가 말하는 것 옆으로** 옮겼다
   * (사용자 결정). 웨이브·남은 적·타이머는 판에서 벌어지는 일이므로 보드 위로, 일시정지·
   * 배속·음소거는 판을 조작하는 것이므로 웨이브 시작 아래로.
   *
   * 위치를 못박는 이유: 이 요소들은 `id`로 잡히므로 **DOM 어디에 있든 코드는 동작한다** —
   * 누가 편의로 되돌려 놓아도 테스트가 아니면 드러나지 않는다.
   */
  it('★ 화면이 한 줄기다 — 상태는 보드 위, 조작은 보드 아래 (v1.29 · v1.30)', () => {
    const app = makeApp();
    createLayout(app);
    expect(app.querySelector('#hud')).toBeNull();          // 맨 위 막대(v1.29에 삭제)
    expect(app.querySelector('#left')).toBeNull();         // 보드 양옆 두 단(v1.30에 삭제)
    expect(app.querySelector('#right')).toBeNull();

    const col = app.querySelector('#board-col')!;
    const kids = [...col.children];
    const at = (sel: string): number => kids.indexOf(app.querySelector(sel)!);
    // 상태 → 보드 → 조작 순서. 상태가 아래로 내려가면 시선이 다시 오간다.
    expect(at('#board-status')).toBeLessThan(at('#board-wrap'));
    expect(at('#board-bottom')).toBeGreaterThan(at('#board-wrap'));

    const status = app.querySelector('#board-status')!;
    for (const id of ['hud-wave', 'hud-remaining', 'hud-timer']) {
      expect(status.querySelector(`#${id}`)).toBeTruthy();
    }

    // ★ 아래 줄은 **사는 쪽 / 굴리는 쪽** 두 칸이다.
    const bottom = app.querySelector('#board-bottom')!;
    const [buy, run] = [...bottom.children];
    expect(buy.querySelector('#draw-btn')).toBeTruthy();
    expect(buy.querySelector('#odds')).toBeTruthy();
    expect(run.querySelector('#start-wave')).toBeTruthy();
    const controls = run.querySelector('#controls')!;
    for (const id of ['hud-pause', 'hud-speed', 'hud-mute']) {
      expect(controls.querySelector(`#${id}`)).toBeTruthy();
    }
    // 재생바는 웨이브 시작 **아래**다.
    const rk = [...run.children];
    expect(rk.indexOf(controls)).toBeGreaterThan(rk.indexOf(run.querySelector('#start-wave')!));
  });

  /**
   * ★ v1.30 — 판매 영역이 판 오른쪽 스트립 위에 겹치는 오버레이가 됐고, **드래그 중에만**
   * 보인다. 평소에는 그 자리에 플레이어 킹이 서 있다.
   *
   * ⚠️ 숨기는 방법이 중요하다: `display:none`으로 빼면 `getBoundingClientRect`가 0이 되어
   * 드롭 판정이 통째로 죽는다(ui/drag.ts가 rect로 판정한다). 그래서 투명도로만 숨긴다.
   */
  it('★ 판매 영역은 보드 위 오버레이이고 드래그 중에만 보인다 (v1.30)', () => {
    const app = makeApp();
    const layout = createLayout(app);
    // 보드 래퍼 안에 있어야 판 위에 겹칠 수 있다.
    expect(layout.sellSlot.closest('#board-wrap')).toBeTruthy();
    expect(layout.sellSlot.classList.contains('visible')).toBe(false);
    // 레이아웃에서 빠지지 않는다 — 빠지면 rect가 0이 되어 판매가 죽는다.
    expect(layout.sellSlot.hasAttribute('hidden')).toBe(false);
  });

  it('PIECE_NAME은 5개 기물 종류를 모두 포함한다', () => {
    for (const type of PIECE_TYPES) {
      expect(PIECE_NAME[type]).toBeTruthy();
    }
  });
});

describe('updateHud (Task 14)', () => {
  function setup(): { layout: ReturnType<typeof createLayout>; state: GameState } {
    const layout = createLayout(makeApp());
    const state = cleanState();
    return { layout, state };
  }

  it('wave/prepareTimer 값을 HUD 요소에 반영한다', () => {
    const { layout, state } = setup();
    state.wave = 3;
    state.prepareTimer = 4.26;
    updateHud(layout, state);
    expect(layout.hud.wave.textContent).toBe(`3/${waveTotal()}`);
    expect(layout.hud.timer.textContent).toBe('4.3s');
  });

  /**
   * ★ v1.27 — 보유 골드가 HUD를 떠나 뽑기 버튼으로 갔다(사용자 결정). HUD가 골드를 **다시
   * 그리지 않는다**는 것을 못박아 두지 않으면, 나중에 누가 편의로 되살렸을 때 같은 값이 화면
   * 두 곳에 생기고 그중 하나가 조용히 낡는다.
   */
  /**
   * ★ HUD가 계속 얇아졌다: 골드는 v1.27에 뽑기 버튼으로, **체력과 `♚ 여유`는 v1.28에 판 밖의
   * 플레이어 킹으로** 옮겨 갔다. 같은 값이 두 곳에 있으면 하나는 반드시 조용히 낡으므로,
   * HUD가 그것들을 **다시 그리지 않는다**는 사실을 못박는다.
   */
  it('★ HUD는 보유 골드·체력·여유를 그리지 않는다 — 각각 뽑기 버튼과 플레이어 킹의 몫이다', () => {
    const { layout, state } = setup();
    state.gold = 555;
    state.hp = 7;
    updateHud(layout, state);
    // ★ v1.29에서 `#hud` 막대 자체가 사라졌다 — 상태 표시는 보드 위로 옮겨 갔다.
    const status = layout.hud.wave.closest('#board-status')!;
    expect(status).toBeTruthy();
    expect(status.textContent).not.toContain('555');
    expect(status.textContent).not.toContain('여유');
    expect(status.textContent).not.toContain('♥');
  });

  it('보스 웨이브(5의 배수) 준비 중에만 보스 아이콘을 표시한다', () => {
    const { layout, state } = setup();
    state.phase = 'prepare';
    state.wave = 4;
    updateHud(layout, state);
    expect(layout.hud.bossIcon.hidden).toBe(true);

    state.wave = 5;
    updateHud(layout, state);
    expect(layout.hud.bossIcon.hidden).toBe(false);
  });

  it('웨이브 시작 버튼은 prepare 단계에서 보이고 wave 단계에서 숨겨진다', () => {
    const { layout, state } = setup();
    state.phase = 'prepare';
    updateHud(layout, state);
    expect(layout.startBtn.hidden).toBe(false);

    state.phase = 'wave';
    updateHud(layout, state);
    expect(layout.startBtn.hidden).toBe(true);
  });

  it('victory/defeat에서는 remainingEnemies()의 전체 웨이브 수 대신 0을 표시한다 (편차 사항)', () => {
    const { layout, state } = setup();
    state.phase = 'victory';
    state.wave = 20;
    updateHud(layout, state);
    expect(layout.hud.remaining.textContent).toBe('0');

    state.phase = 'defeat';
    updateHud(layout, state);
    expect(layout.hud.remaining.textContent).toBe('0');
  });
});

describe('updateShop (Task 14) — canBuy 기반 비활성화', () => {
  it('300골드면 폰은 활성, 퀸은 비활성', () => {
    const layout = createLayout(makeApp());
    const state = cleanState();
    state.gold = 300;
    expect(CONFIG.pieces.pawn.cost).toBeLessThanOrEqual(300);
    expect(CONFIG.pieces.queen.cost).toBeGreaterThan(300);
    updateShop(layout, state);
    expect(layout.drawBtn.disabled).toBe(false);
  });

  it('일시정지 중에는 5종 모두 비활성', () => {
    const layout = createLayout(makeApp());
    const state = cleanState();
    state.gold = 999999;
    state.paused = true;
    updateShop(layout, state);
    expect(layout.drawBtn.disabled).toBe(true);
  });

  it('★ 보드에 빈 칸이 없으면 5종 모두 비활성 (v1.12 — 예전 "트레이 만석" 게이트의 후신)', () => {
    // 상점 버튼이 이 상태에서도 눌리면, 살 수는 있는데 놓을 자리가 없는 기물이 생긴다.
    // 사용자 결정은 "빈칸 없으면 구매 불가"이고, 그 결정이 실제로 화면에 드러나는 유일한 곳이
    // 이 비활성화다 — 실패를 알리는 별도 문구가 없기 때문이다.
    const layout = createLayout(makeApp());
    const state = cleanState();
    state.gold = 999999;
    fillBoard(state);
    updateShop(layout, state);
    expect(layout.drawBtn.disabled).toBe(true);

    // 한 칸만 비면 곧바로 되살아나야 한다 — 게이트가 "빈 칸 수"가 아니라 다른 것(예: 기물 총수)에
    // 걸려 있으면 이 대조에서 드러난다.
    state.pieces.pop();
    expect(emptySquares(state)).toHaveLength(1);
    updateShop(layout, state);
    expect(layout.drawBtn.disabled).toBe(false);
  });
});

describe('wireShop (Task 14) — 실제 클릭 배선 검증', () => {
  // wireShop은 rng를 Math.random으로 내부 고정한다(구매는 stepGame 밖의 UI 조작이라 적 스폰
  // 난수열과 섞이지 않는다). 테스트에서 스폰 칸을 결정론적으로 보려면 이 한 지점만 스텁한다.
  afterEach(() => { vi.restoreAllMocks(); });

  /** 0 ~ 1 미만을 골고루 훑는 고정 수열. 항상 같은 인덱스만 뽑으면 "겹치지 않는다"가 우연히
   *  성립할 수 있어(예: 항상 0번 → 어차피 앞칸부터 채워짐) 일부러 흩어 놓았다. */
  function stubRandom(): void {
    const seq = [0, 0.99, 0.5, 0.25, 0.75, 0.1, 0.9, 0.33];
    let i = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => seq[i++ % seq.length]);
  }

  it('뽑기 버튼 클릭 시 보드의 빈 칸에 기물이 스폰되고 골드가 뽑기 비용만큼 감소한다', () => {
    stubRandom();
    const layout = createLayout(makeApp());
    const state = cleanState();
    const events: GameEvent[] = [];
    const startGold = state.gold;
    wireShop(layout, state, events, makeAudioSpy());

    const pawnBtn = layout.drawBtn;
    pawnBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // ★ v1.16: 무엇이 나올지 모른다. 종류를 단언할 수 없으므로 **한 기가 생겼다**와
    //   **뽑기 비용만큼 줄었다**만 잰다 — 종류 분포는 economy.test.ts가 따로 잰다.
    expect(state.pieces).toHaveLength(1);
    const drawn = state.pieces[0];
    expect(state.gold).toBe(startGold - CONFIG.gacha.cost);
    // 8랭크는 적 스폰 구역이라 배치 대상이 아니다. 여기 떨어지면 적과 같은 칸에서 게임이 시작된다.
    expect(drawn.square.rank).toBeGreaterThanOrEqual(1);
    expect(drawn.square.rank).toBeLessThanOrEqual(CONFIG.board.ranks - 1);
    // ★ 이벤트의 square가 실제 기물 위치와 어긋나면 화면이 엉뚱한 칸을 가리킨다 — 스폰 위치를
    //   플레이어가 고르지 않으므로, 어디에 생겼는지 알려 주는 통로가 이 이벤트뿐이다.
    expect(events).toEqual([
      { kind: 'pieceSpawned', square: drawn.square, pieceType: drawn.type, bought: true },
    ]);
  });

  it('★ 연속 뽑기해도 스폰 칸이 서로 겹치지 않는다', () => {
    // 무작위 스폰의 유일한 안전 요건이다. 후보를 "전체 칸"에서 뽑으면 기물이 기물 위에 겹쳐
    // 쌓이고, pieceAt/tooltip이 전부 첫 일치만 집으므로 아래 깔린 쪽은 조작조차 불가능해진다.
    stubRandom();
    const layout = createLayout(makeApp());
    const state = cleanState();
    const events: GameEvent[] = [];
    const n = 12;
    // ★ v1.18: 가격이 누진이므로 누진 총액을 준다(정액 × n이면 중간에 돈이 마른다).
    state.gold = totalDrawCost(n);
    wireShop(layout, state, events, makeAudioSpy());

    const pawnBtn = layout.drawBtn;
    for (let i = 0; i < n; i++) {
      pawnBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }

    expect(state.pieces).toHaveLength(n);
    expect(new Set(state.pieces.map(p => squareKey(p.square))).size).toBe(n);
    expect(events).toHaveLength(n);
    for (const p of state.pieces) {
      expect(p.square.rank).toBeLessThanOrEqual(CONFIG.board.ranks - 1);
      expect(p.square.file).toBeLessThan(CONFIG.board.files);
    }
  });

  it('★ 보드가 꽉 차 있으면 골드가 남아돌아도 클릭이 아무 일도 하지 않는다', () => {
    stubRandom();
    const layout = createLayout(makeApp());
    const state = cleanState();
    const events: GameEvent[] = [];
    state.gold = 999999;
    fillBoard(state);
    const before = state.pieces.length;
    const audio = makeAudioSpy();
    wireShop(layout, state, events, audio);

    // updateShop이 이미 버튼을 비활성화하지만, 여기서는 그 사전 체크에 기대지 않고 핸들러 자체가
    // 골드를 깎지 않는지를 본다 — 깎고 나서 스폰에 실패하면 조용한 골드 증발이 된다.
    layout.drawBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(state.pieces).toHaveLength(before);
    expect(state.gold).toBe(999999);
    expect(events).toEqual([]);
    expect(audio.played).toEqual([]);
  });

  it('구매 성공 시 uiBuy가 울린다 (스펙 §10.1 v1.3)', () => {
    stubRandom();
    const layout = createLayout(makeApp());
    const state = cleanState();
    const audio = makeAudioSpy();
    wireShop(layout, state, [], audio);

    layout.drawBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(audio.played).toEqual(['uiBuy']);
  });

  it('구매 실패(골드 부족)는 uiBuy를 울리지 않는다', () => {
    stubRandom();
    const layout = createLayout(makeApp());
    const state = cleanState();
    state.gold = 0;
    const audio = makeAudioSpy();
    const events: GameEvent[] = [];
    wireShop(layout, state, events, audio);

    // 버튼은 updateShop이 매 프레임 비활성화하지만, wireShop 자체의 클릭 핸들러가 buyPiece의
    // 반환값으로 판정하는지(canBuy 사전 체크에만 기대지 않는지) 여기서 직접 확인한다.
    layout.drawBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(state.pieces).toHaveLength(0);
    expect(events).toEqual([]);
    expect(audio.played).toEqual([]);
  });
});

// 지난 SVG 전환 시도에서 <img>에 draggable="false"를 빠뜨려, 브라우저의 네이티브 HTML5 드래그가
// 시작되며 pointercancel을 발생시켜 DragController의 드래그를 조용히 끊어버린 회귀가 있었다.
// ⚠️ v1.16: 기물 이미지를 DOM으로 내보내는 곳이 상점 버튼에서 **뽑기 확률 표**로 옮겨졌다
// (뽑기 버튼 자체에는 이미지가 없다 — 무엇이 나올지 모르므로 그릴 기물도 없다). 확률 표
// 위에서 누른 채 움직이면 여전히 같은 pointercancel이 날아와 진행 중이던 제스처(선택·판매
// 프리뷰)를 지우므로 안전장치는 그대로 필요하다.
describe('기물 이미지 — draggable="false" 안전장치 (지난 시도 회귀 방지)', () => {
  it('확률 표의 모든 기물 이미지는 draggable="false"를 갖는다', () => {
    const app = makeApp();
    createLayout(app);
    const items = [...app.querySelectorAll('#odds li')];
    expect(items.length).toBeGreaterThan(0);        // 공허 방지
    for (const li of items) {
      const img = li.querySelector('img');
      expect(img).not.toBeNull();
      expect(img!.getAttribute('draggable')).toBe('false');
    }
  });

  it('확률 표의 아이콘은 그 기물 자신의 스프라이트를 가리킨다 (v1.16)', () => {
    // 삭제된 트레이 렌더 테스트가 지키던 "폰 칸에는 반드시 폰 스프라이트"를 여기로 옮겨
    // 살렸다. 이제 무대는 상점 버튼이 아니라 뽑기 확률 표다 — 그림과 확률이 어긋나면
    // 플레이어가 완전히 잘못된 기대를 갖고 300G를 쓴다.
    const app = makeApp();
    createLayout(app);
    const items = [...app.querySelectorAll('#odds li')];
    const shown = (Object.entries(CONFIG.gacha.weights) as [PieceType, number][])
      .filter(([, w]) => w > 0);
    expect(items).toHaveLength(shown.length);
    for (const li of items) {
      const img = li.querySelector('img');
      expect(img).not.toBeNull();
      // 같은 li 안의 이름과 아이콘이 같은 기물을 가리키는지 — 둘이 갈라지는 것이 이 테스트가
      // 막는 유일한 결함이다(이름만 맞고 그림이 옆 기물이면 아무도 못 알아챈다).
      const name = li.querySelector('span')!.textContent!;
      const type = (Object.keys(PIECE_NAME) as PieceType[]).find(t => PIECE_NAME[t] === name)!;
      expect(type, name).toBeDefined();
      expect(img!.getAttribute('src'), name).toBe(allySpriteUrl(type));
    }
  });
});

/**
 * ⚠️ **저작자 표시(CC BY-SA) 검증은 `tests/titleScreen.test.ts`로 옮겼다** (v1.30).
 *
 * 게임 화면 하단의 크레딧 줄이 사라졌기 때문이다(사용자 결정: "이 내용은 로비 화면만 표시되면
 * 될 것 같다"). 표시 의무 자체가 없어진 것이 아니라 **표시하는 화면이 시작 화면 하나로
 * 좁아진 것**이므로, 그 화면을 검증하는 스위트가 보증을 이어받는다.
 *
 * ⚠️ 게임 화면에도 위키미디어 저작물이 **여전히 남아 있다** — 뽑기 확률표의 기물 아이콘과
 * 드래그 고스트가 `allySpriteUrl`(Cburnett SVG)을 띄운다. 보드 자체는 v1.21부터 절차적
 * 지오메트리라 저작물이 아니지만, 그 둘은 아니다. 크레딧이 시작 화면에만 있는 지금 구성은
 * "게임의 크레딧은 타이틀 화면에 둔다"는 관행에 기대는 것이고, 그 판단은 사용자의 것이다.
 */
