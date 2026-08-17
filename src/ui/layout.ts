import { CONFIG, TRAITS } from '../config';
import { BOARD_H, BOARD_W } from '../core/grid';
import { SLOT_CAPACITY } from '../core/economy';
import { ALLY_SPRITE_URL } from '../render/sprites';
import type { PieceType } from '../types';

export interface Layout {
  canvas: HTMLCanvasElement;
  hud: {
    hp: HTMLElement; bossRoom: HTMLElement; gold: HTMLElement; wave: HTMLElement; remaining: HTMLElement;
    timer: HTMLElement; bossIcon: HTMLElement;
    pauseBtn: HTMLButtonElement; speedBtn: HTMLButtonElement; muteBtn: HTMLButtonElement;
  };
  slotGrid: HTMLElement;
  shopButtons: Map<PieceType, HTMLButtonElement>;
  sellSlot: HTMLElement;
  startBtn: HTMLButtonElement;
  bannerRoot: HTMLElement;
}

/** 상점 노출 순서. 목록을 손으로 유지하지 않고 TRAITS에서 유도한다 — 융합물처럼 구매할 수
 *  없는 기물이 늘어도 상점이 저절로 맞는다. */
const SHOP_ORDER: PieceType[] = (Object.keys(TRAITS) as PieceType[])
  .filter(t => TRAITS[t].purchasable);
export const PIECE_NAME: Record<PieceType, string> = {
  pawn: '폰', knight: '나이트', bishop: '비숍', rook: '룩', queen: '퀸',
  archbishop: '아치비숍', chancellor: '챈슬러', amazon: '아마존',
};

/** 저작자 표시줄 (NOTICE.md — CC BY-SA 3.0 이행). 게임 화면과 시작 화면 둘 다 같은 Cburnett
 * 기물 SVG를 보여주므로 두 화면 모두에 떠 있어야 한다 — 한쪽에만 두면 그 화면을 띄운 동안에는
 * 표시 의무가 지켜지지 않는다. 문구가 갈라지지 않도록 여기 한 곳에서만 정의한다. */
/**
 * 저작자 표시줄 — CC BY-SA의 BY 조항 이행. 보드 화면과 시작 화면이 이 상수 하나를 공유해서
 * 한쪽 문구만 갈라지거나 한 화면에서 표시가 누락되는 일이 생기지 않는다.
 *
 * ★ 저작자가 셋이고 **라이선스 버전이 둘**이다(v1.10). 융합 기물의 아트워크가 직접 만든
 * 합성물에서 위키미디어의 실제 페어리 기물로 바뀌면서 출처가 갈라졌다:
 *   - 기본 5종 + 적 2종  → Cburnett            (CC BY-SA 3.0)
 *   - 아치비숍 · 챈슬러  → NikNaks93 파생      (CC BY-SA 3.0)
 *   - 아마존             → Mszulc29            (**CC BY-SA 4.0**)
 * 4.0 하나 때문에 "CC BY-SA 3.0"만 적으면 그 파일의 BY 이행이 틀린 것이 되므로 둘 다 링크한다.
 * 자세한 대응표는 NOTICE.md에 있고, 아래 NOTICE.md 링크가 그리로 가는 유일한 경로다
 * (NOTICE.md는 dist/에 포함되지 않는다).
 */
export const CREDIT_HTML = `
    <footer id="credit">
      기물 이미지:
      <a href="https://commons.wikimedia.org/wiki/Category:SVG_chess_pieces" target="_blank" rel="noopener noreferrer">Cburnett · NikNaks93 · Mszulc29 / Wikimedia Commons</a>
      —
      <a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noopener noreferrer">CC BY-SA 3.0</a>
      ·
      <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">CC BY-SA 4.0</a>
      —
      <a href="https://github.com/hdh4952/chess-defense/blob/main/NOTICE.md" target="_blank" rel="noopener noreferrer">변경 내역(NOTICE.md)</a>
    </footer>`;

export function createLayout(app: HTMLElement): Layout {
  app.innerHTML = `
    <header id="hud">
      <span>♥<b id="hud-hp"></b></span>
      <span id="hud-boss-room" title="보스를 몇 번 더 놓쳐도 버티는가"></span>
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
${CREDIT_HTML}
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
      hp: q('#hud-hp'), bossRoom: q('#hud-boss-room'), gold: q('#hud-gold'), wave: q('#hud-wave'),
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
