// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { buyPiece, SLOT_CAPACITY } from '../src/core/economy';
import { createInitialState } from '../src/core/state';
import { ALLY_GLYPH } from '../src/render/renderer';
import { createLayout, PIECE_NAME } from '../src/ui/layout';
import { updateHud } from '../src/ui/hud';
import { updateShop, wireShop } from '../src/ui/shop';
import { updateSlots } from '../src/ui/slots';
import type { GameState, PieceType } from '../src/types';

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

  it('상점 버튼은 기물 종류당 1개(총 5개), 각각 CONFIG의 가격이 라벨에 표시된다', () => {
    const layout = createLayout(makeApp());
    expect(layout.shopButtons.size).toBe(5);
    expect(PIECE_TYPES).toHaveLength(5);
    for (const type of PIECE_TYPES) {
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
        cooldown: 0, queenBuffCount: 0,
      });
    }
    updateShop(layout, state);
    for (const btn of layout.shopButtons.values()) {
      expect(btn.disabled).toBe(true);
    }
  });
});

describe('updateSlots (Task 14)', () => {
  it('두 개 구매 후 처음 두 칸에 글리프/piece id가 표시되고 나머지는 비어있다', () => {
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
    expect(cells[0].innerHTML).toContain(ALLY_GLYPH.pawn);
    expect(cells[1].dataset.pieceId).toBe(p2!.id);
    expect(cells[1].innerHTML).toContain(ALLY_GLYPH.knight);

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
    wireShop(layout, state);

    const pawnBtn = layout.shopButtons.get('pawn')!;
    pawnBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const pawns = state.pieces.filter(p => p.type === 'pawn');
    expect(pawns).toHaveLength(1);
    expect(pawns[0].slotIndex).toBe(0);
    expect(state.gold).toBe(startGold - CONFIG.pieces.pawn.cost);
  });
});
