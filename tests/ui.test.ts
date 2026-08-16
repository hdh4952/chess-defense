// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { CONFIG, TRAITS } from '../src/config';
import { buyPiece, SLOT_CAPACITY } from '../src/core/economy';
import { createInitialState } from '../src/core/state';
import { ALLY_SPRITE_URL } from '../src/render/sprites';
import { createLayout, PIECE_NAME } from '../src/ui/layout';
import { updateHud } from '../src/ui/hud';
import { updateShop, wireShop } from '../src/ui/shop';
import { updateSlots } from '../src/ui/slots';
import type { UiAudio } from '../src/audio';
import type { UiCueKind } from '../src/audio/cues';
import type { GameState, PieceType } from '../src/types';

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

describe('createLayout (Task 14 — UI 셸)', () => {
  it('슬롯 트레이는 정확히 16칸이며 각 칸이 자신의 인덱스를 가진다', () => {
    const layout = createLayout(makeApp());
    const cells = Array.from(layout.slotGrid.children) as HTMLElement[];
    expect(cells).toHaveLength(SLOT_CAPACITY);
    cells.forEach((cell, i) => {
      expect(cell.dataset.slotIndex).toBe(String(i));
    });
  });

  it('상점 버튼은 구매 가능한 기물당 1개, 각각 CONFIG의 가격이 라벨에 표시된다', () => {
    // 융합물이 생기면서 "기물 종류 수 = 상점 버튼 수"가 더 이상 성립하지 않는다.
    // 상점은 구매 가능한 것만 보여준다.
    const layout = createLayout(makeApp());
    const purchasable = PIECE_TYPES.filter(t => TRAITS[t].purchasable);
    expect(layout.shopButtons.size).toBe(purchasable.length);
    expect(purchasable).toHaveLength(5);
    for (const type of purchasable) {
      const btn = layout.shopButtons.get(type);
      expect(btn).toBeInstanceOf(HTMLButtonElement);
      expect(btn!.textContent).toContain(String(CONFIG.pieces[type].cost));
      expect(btn!.textContent).toContain('G');
      expect(btn!.dataset.pieceType).toBe(type);
    }
  });

  it('Layout의 모든 필드가 실제 요소로 해석된다 (null/undefined 없음)', () => {
    const layout = createLayout(makeApp());
    expect(layout.canvas).toBeInstanceOf(HTMLCanvasElement);
    expect(layout.hud.hp).toBeInstanceOf(HTMLElement);
    expect(layout.hud.gold).toBeInstanceOf(HTMLElement);
    expect(layout.hud.wave).toBeInstanceOf(HTMLElement);
    expect(layout.hud.remaining).toBeInstanceOf(HTMLElement);
    expect(layout.hud.timer).toBeInstanceOf(HTMLElement);
    expect(layout.hud.bossIcon).toBeInstanceOf(HTMLElement);
    expect(layout.hud.pauseBtn).toBeInstanceOf(HTMLButtonElement);
    expect(layout.hud.speedBtn).toBeInstanceOf(HTMLButtonElement);
    expect(layout.slotGrid).toBeInstanceOf(HTMLElement);
    expect(layout.shopButtons).toBeInstanceOf(Map);
    expect(layout.shopButtons.size).toBeGreaterThan(0);
    expect(layout.sellSlot).toBeInstanceOf(HTMLElement);
    expect(layout.startBtn).toBeInstanceOf(HTMLButtonElement);
    expect(layout.bannerRoot).toBeInstanceOf(HTMLElement);
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
    const state = createInitialState();
    return { layout, state };
  }

  it('hp/gold/wave/prepareTimer 값을 HUD 요소에 반영한다', () => {
    const { layout, state } = setup();
    state.hp = 17;
    state.gold = 555;
    state.wave = 3;
    state.prepareTimer = 4.26;
    updateHud(layout, state);
    expect(layout.hud.hp.textContent).toBe('17');
    expect(layout.hud.gold.textContent).toBe('555');
    expect(layout.hud.wave.textContent).toBe(`3/${CONFIG.wave.total}`);
    expect(layout.hud.timer.textContent).toBe('4.3s');
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
    const state = createInitialState();
    state.gold = 300;
    expect(CONFIG.pieces.pawn.cost).toBeLessThanOrEqual(300);
    expect(CONFIG.pieces.queen.cost).toBeGreaterThan(300);
    updateShop(layout, state);
    expect(layout.shopButtons.get('pawn')!.disabled).toBe(false);
    expect(layout.shopButtons.get('queen')!.disabled).toBe(true);
  });

  it('일시정지 중에는 5종 모두 비활성', () => {
    const layout = createLayout(makeApp());
    const state = createInitialState();
    state.gold = 999999;
    state.paused = true;
    updateShop(layout, state);
    for (const btn of layout.shopButtons.values()) {
      expect(btn.disabled).toBe(true);
    }
  });

  it('트레이가 16칸 모두 찼으면 5종 모두 비활성', () => {
    const layout = createLayout(makeApp());
    const state = createInitialState();
    state.gold = 999999;
    for (let i = 0; i < SLOT_CAPACITY; i++) {
      state.pieces.push({
        id: `full-${i}`, type: 'pawn', square: null, slotIndex: i,
        cooldown: 0, queenBuffCount: 0, tier: 1,
      });
    }
    updateShop(layout, state);
    for (const btn of layout.shopButtons.values()) {
      expect(btn.disabled).toBe(true);
    }
  });
});

describe('updateSlots (Task 14)', () => {
  it('두 개 구매 후 처음 두 칸에 해당 기물 이미지/piece id가 표시되고 나머지는 비어있다', () => {
    const layout = createLayout(makeApp());
    const state = createInitialState();
    state.gold = CONFIG.pieces.pawn.cost + CONFIG.pieces.knight.cost; // 두 종류 모두 살 만큼
    const p1 = buyPiece(state, 'pawn');
    const p2 = buyPiece(state, 'knight');
    expect(p1).not.toBeNull();
    expect(p2).not.toBeNull();

    updateSlots(layout, state);

    const cells = Array.from(layout.slotGrid.children) as HTMLElement[];
    expect(cells[0].dataset.pieceId).toBe(p1!.id);
    const img0 = cells[0].querySelector('img');
    expect(img0).not.toBeNull();
    expect(img0!.getAttribute('src')).toBe(ALLY_SPRITE_URL.pawn); // 폰 칸에는 반드시 폰 스프라이트
    expect(cells[1].dataset.pieceId).toBe(p2!.id);
    const img1 = cells[1].querySelector('img');
    expect(img1).not.toBeNull();
    expect(img1!.getAttribute('src')).toBe(ALLY_SPRITE_URL.knight); // 나이트 칸에는 반드시 나이트 스프라이트

    for (let i = 2; i < cells.length; i++) {
      expect(cells[i].innerHTML).toBe('');
      expect(cells[i].dataset.pieceId).toBe('');
    }
  });
});

describe('wireShop (Task 14) — 실제 클릭 배선 검증', () => {
  it('폰 버튼 클릭 시 트레이에 폰이 추가되고 골드가 비용만큼 감소한다', () => {
    const layout = createLayout(makeApp());
    const state = createInitialState();
    const startGold = state.gold;
    wireShop(layout, state, makeAudioSpy());

    const pawnBtn = layout.shopButtons.get('pawn')!;
    pawnBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const pawns = state.pieces.filter(p => p.type === 'pawn');
    expect(pawns).toHaveLength(1);
    expect(pawns[0].slotIndex).toBe(0);
    expect(state.gold).toBe(startGold - CONFIG.pieces.pawn.cost);
  });

  it('구매 성공 시 uiBuy가 울린다 (스펙 §10.1 v1.3)', () => {
    const layout = createLayout(makeApp());
    const state = createInitialState();
    const audio = makeAudioSpy();
    wireShop(layout, state, audio);

    layout.shopButtons.get('pawn')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(audio.played).toEqual(['uiBuy']);
  });

  it('구매 실패(골드 부족)는 uiBuy를 울리지 않는다', () => {
    const layout = createLayout(makeApp());
    const state = createInitialState();
    state.gold = 0;
    const audio = makeAudioSpy();
    wireShop(layout, state, audio);

    // 버튼은 updateShop이 매 프레임 비활성화하지만, wireShop 자체의 클릭 핸들러가 buyPiece의
    // 반환값으로 판정하는지(canBuy 사전 체크에만 기대지 않는지) 여기서 직접 확인한다.
    layout.shopButtons.get('pawn')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(state.pieces).toHaveLength(0);
    expect(audio.played).toEqual([]);
  });
});

// 지난 SVG 전환 시도에서 <img>에 draggable="false"를 빠뜨려, 브라우저의 네이티브 HTML5 드래그가
// 시작되며 pointercancel을 발생시켜 DragController의 드래그를 조용히 끊어버린 회귀가 있었다.
// 상점/트레이 어디서 이미지를 내보내든 이 속성이 반드시 있어야 한다.
describe('기물 이미지 — draggable="false" 안전장치 (지난 시도 회귀 방지)', () => {
  it('상점 버튼의 모든 기물 이미지는 draggable="false"를 갖는다', () => {
    const layout = createLayout(makeApp());
    expect(layout.shopButtons.size).toBeGreaterThan(0);
    for (const btn of layout.shopButtons.values()) {
      const img = btn.querySelector('img');
      expect(img).not.toBeNull();
      expect(img!.getAttribute('draggable')).toBe('false');
    }
  });

  it('슬롯 트레이에 표시된 기물 이미지도 draggable="false"를 갖는다', () => {
    const layout = createLayout(makeApp());
    const state = createInitialState();
    state.gold = CONFIG.pieces.pawn.cost;
    expect(buyPiece(state, 'pawn')).not.toBeNull();
    updateSlots(layout, state);

    const img = layout.slotGrid.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('draggable')).toBe('false');
  });
});

describe('저작자 표시줄 (NOTICE.md — CC BY-SA 3.0 이행)', () => {
  it('결과 화면이 아니라 상시 레이아웃에 크레딧이 있고, 저작자·출처·라이선스 링크를 포함한다', () => {
    const app = makeApp();
    createLayout(app);

    const credit = app.querySelector('#credit');
    expect(credit).not.toBeNull();                 // #main 밖 일회성 오버레이가 아니라 항상 존재하는 요소
    expect(credit!.textContent).toContain('Cburnett');
    expect(credit!.textContent).toContain('CC BY-SA 3.0');

    const links = Array.from(credit!.querySelectorAll('a')) as HTMLAnchorElement[];
    expect(links.length).toBeGreaterThanOrEqual(3);
    const licenseLink = links.find(a => a.getAttribute('href') === 'https://creativecommons.org/licenses/by-sa/3.0/');
    expect(licenseLink).toBeDefined();              // 라이선스 원문 링크
    const sourceLink = links.find(a => (a.getAttribute('href') ?? '').includes('commons.wikimedia.org'));
    expect(sourceLink).toBeDefined();                // 출처(Wikimedia Commons) 링크
    // 재검토 Item 2: NOTICE.md는 dist/에 포함되지 않으므로, 배포된 사이트에서 변경 내역까지
    // 확인하려면 저장소의 NOTICE.md로 가는 링크가 크레딧 안에 있어야 한다.
    const noticeLink = links.find(a => (a.getAttribute('href') ?? '').includes('NOTICE.md'));
    expect(noticeLink).toBeDefined();
  });
});
