import { CONFIG } from '../config';
import { BOARD_H, BOARD_W } from '../core/grid';
import { allySpriteUrl } from '../render/skins';
import type { PieceType } from '../types';

export interface Layout {
  canvas: HTMLCanvasElement;
  hud: {
    hp: HTMLElement; bossRoom: HTMLElement; gold: HTMLElement; wave: HTMLElement; remaining: HTMLElement;
    timer: HTMLElement; bossIcon: HTMLElement;
    pauseBtn: HTMLButtonElement; speedBtn: HTMLButtonElement; muteBtn: HTMLButtonElement;
  };
  /**
   * 뽑기 버튼 하나 (v1.16). 예전에는 기물별 구매 버튼 5개였는데, 무엇이 나올지 고를 수
   * 없으므로 버튼도 하나가 됐다.
   */
  drawBtn: HTMLButtonElement;
  sellSlot: HTMLElement;
  startBtn: HTMLButtonElement;
  bannerRoot: HTMLElement;
}

/**
 * 뽑기 확률 표시 순서 — 가중치가 큰 것부터 (v1.16).
 *
 * 목록을 손으로 유지하지 않고 CONFIG.gacha.weights에서 유도한다: 가중치가 0인 것(융합물)은
 * 빼고, 나머지를 확률 내림차순으로 정렬한다. 확률을 바꾸면 표시 순서가 저절로 따라온다.
 */
function gachaOdds(): [PieceType, number][] {
  return (Object.entries(CONFIG.gacha.weights) as [PieceType, number][])
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1]);
}
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
 *
 * ★ **"기본 기물 이미지"라고 좁혀 적는다** (v1.19 — 스킨 도입). 스킨을 켜면 화면의 그 기물은
 * 위키미디어 저작물이 아니다(생성형 AI 산출물이라 표시할 저작자가 없다 — NOTICE.md). 그냥
 * "기물 이미지"라고 두면 **그들이 만들지 않은 그림을 그들의 것으로 표시하는** 셈이 된다.
 * BY 조항은 저작자를 빠뜨리지 않는 것만이 아니라 엉뚱한 사람을 적지 않는 것이기도 하다.
 */
export const CREDIT_HTML = `
    <footer id="credit">
      기본 기물 이미지:
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
        <div id="shop"></div>
      </aside>
      <div id="board-wrap">
        <!-- width/height는 배율 1일 때의 값이자 폴백이다. 실제 해상도는 createBoardContext가
             화면 픽셀 밀도에 맞춰 다시 정하고 CSS 크기를 640px로 못 박는다(render/dpr.ts). -->
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

  // ★ 뽑기 UI (v1.16). 확률을 **화면에 항상 적어 둔다** — 가챠에서 확률을 숨기면 플레이어가
  // 자기 판단의 근거를 가질 수 없고, 특히 퀸 1%처럼 극단적인 값은 알려주지 않으면 "왜 안
  // 나오지"가 버그로 읽힌다. 수치는 CONFIG에서 유도하므로 확률을 바꾸면 문구가 따라온다.
  const shop = app.querySelector<HTMLElement>('#shop')!;
  const odds = gachaOdds()
    .map(([t, w]) => `<li><img class="piece-icon odds-icon" src="${allySpriteUrl(t)}" alt="" draggable="false">`
      + `<span>${PIECE_NAME[t]}</span><b>${Math.round(w * 1000) / 10}%</b></li>`)
    .join('');
  shop.innerHTML = `
    <button id="draw-btn">
      기물 뽑기<br><small>${CONFIG.gacha.cost}G</small>
    </button>
    <ul id="odds">${odds}</ul>`;

  const q = <T extends HTMLElement>(sel: string) => app.querySelector<T>(sel)!;
  return {
    canvas: q<HTMLCanvasElement>('#board'),
    hud: {
      hp: q('#hud-hp'), bossRoom: q('#hud-boss-room'), gold: q('#hud-gold'), wave: q('#hud-wave'),
      remaining: q('#hud-remaining'), timer: q('#hud-timer'), bossIcon: q('#hud-boss-icon'),
      pauseBtn: q<HTMLButtonElement>('#hud-pause'), speedBtn: q<HTMLButtonElement>('#hud-speed'),
      muteBtn: q<HTMLButtonElement>('#hud-mute'),
    },
    drawBtn: q<HTMLButtonElement>('#draw-btn'),
    sellSlot: q('#sell-slot'),
    startBtn: q<HTMLButtonElement>('#start-wave'),
    bannerRoot: q('#banner-root'),
  };
}
