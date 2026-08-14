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
    pauseBtn: HTMLButtonElement; speedBtn: HTMLButtonElement; muteBtn: HTMLButtonElement;
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
      <button id="hud-mute" aria-pressed="false">🔊</button>
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
      —
      <a href="https://github.com/hdh4952/chess-defense/blob/main/NOTICE.md" target="_blank" rel="noopener noreferrer">변경 내역(NOTICE.md)</a>
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
    // alt=""(장식용): 아이콘 바로 옆에 PIECE_NAME 텍스트가 보이므로 alt에 같은 이름을 또
    // 넣으면 스크린 리더가 두 번 읽는다(재검토 Item 7). 슬롯 트레이(slots.ts)의 아이콘은 옆에
    // 별도 텍스트가 없어 유일한 식별 수단이므로 그쪽은 alt를 그대로 의미 있게 유지한다.
    btn.innerHTML = `<img class="piece-icon shop-icon" src="${ALLY_SPRITE_URL[type]}" alt="" draggable="false"> ${PIECE_NAME[type]}<br><small>${CONFIG.pieces[type].cost}G</small>`;
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
      muteBtn: q<HTMLButtonElement>('#hud-mute'),
    },
    slotGrid,
    shopButtons,
    sellSlot: q('#sell-slot'),
    startBtn: q<HTMLButtonElement>('#start-wave'),
    bannerRoot: q('#banner-root'),
  };
}
