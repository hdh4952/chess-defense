import { CONFIG } from '../config';
import { BOARD_H, BOARD_W } from '../core/grid';
import { SLOT_CAPACITY } from '../core/economy';
import { ALLY_SPRITE_URL } from '../render/sprites';
import type { PieceType } from '../types';

export interface Layout {
  canvas: HTMLCanvasElement;
  hud: {
    hp: HTMLElement; gold: HTMLElement; wave: HTMLElement; remaining: HTMLElement;
    timer: HTMLElement; bossIcon: HTMLElement;
    pauseBtn: HTMLButtonElement; speedBtn: HTMLButtonElement;
  };
  slotGrid: HTMLElement;
  shopButtons: Map<PieceType, HTMLButtonElement>;
  sellSlot: HTMLElement;
  startBtn: HTMLButtonElement;
  bannerRoot: HTMLElement;
}

const SHOP_ORDER: PieceType[] = ['pawn', 'knight', 'bishop', 'rook', 'queen'];
export const PIECE_NAME: Record<PieceType, string> = {
  pawn: '폰', knight: '나이트', bishop: '비숍', rook: '룩', queen: '퀸',
};

export function createLayout(app: HTMLElement): Layout {
  app.innerHTML = `
    <header id="hud">
      <span>♥<b id="hud-hp"></b></span>
      <span>💰<b id="hud-gold"></b></span>
      <span>웨이브 <b id="hud-wave"></b></span>
      <span>남은 적 <b id="hud-remaining"></b></span>
      <span>⏱<b id="hud-timer"></b><b id="hud-boss-icon" hidden> ♚보스!</b></span>
      <button id="hud-pause">⏸</button>
      <button id="hud-speed">▶▶1x</button>
    </header>
    <main id="main">
      <aside id="left">
        <div id="slots"></div>
        <div id="shop"></div>
      </aside>
      <div id="board-wrap">
        <canvas id="board" width="${BOARD_W}" height="${BOARD_H}"></canvas>
      </div>
      <aside id="right">
        <div id="sell-slot">🗑<br><small>드래그 = 즉시 판매 (50%)</small><div id="sell-preview"></div></div>
        <button id="start-wave">웨이브 시작</button>
      </aside>
    </main>
    <footer id="credit">
      기물 이미지:
      <a href="https://commons.wikimedia.org/wiki/Category:SVG_chess_pieces" target="_blank" rel="noopener noreferrer">Cburnett / Wikimedia Commons</a>
      —
      <a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noopener noreferrer">CC BY-SA 3.0</a>
    </footer>
    <div id="banner-root"></div>
  `;

  const slotGrid = app.querySelector<HTMLElement>('#slots')!;
  for (let i = 0; i < SLOT_CAPACITY; i++) {
    const cell = document.createElement('div');
    cell.className = 'slot-cell';
    cell.dataset.slotIndex = String(i);
    slotGrid.appendChild(cell);
  }

  const shop = app.querySelector<HTMLElement>('#shop')!;
  const shopButtons = new Map<PieceType, HTMLButtonElement>();
  for (const type of SHOP_ORDER) {
    const btn = document.createElement('button');
    btn.className = 'shop-btn';
    btn.dataset.pieceType = type;
    btn.innerHTML = `<img class="piece-icon shop-icon" src="${ALLY_SPRITE_URL[type]}" alt="${PIECE_NAME[type]}" draggable="false"> ${PIECE_NAME[type]}<br><small>${CONFIG.pieces[type].cost}G</small>`;
    shop.appendChild(btn);
    shopButtons.set(type, btn);
  }

  const q = <T extends HTMLElement>(sel: string) => app.querySelector<T>(sel)!;
  return {
    canvas: q<HTMLCanvasElement>('#board'),
    hud: {
      hp: q('#hud-hp'), gold: q('#hud-gold'), wave: q('#hud-wave'),
      remaining: q('#hud-remaining'), timer: q('#hud-timer'), bossIcon: q('#hud-boss-icon'),
      pauseBtn: q<HTMLButtonElement>('#hud-pause'), speedBtn: q<HTMLButtonElement>('#hud-speed'),
    },
    slotGrid,
    shopButtons,
    sellSlot: q('#sell-slot'),
    startBtn: q<HTMLButtonElement>('#start-wave'),
    bannerRoot: q('#banner-root'),
  };
}
