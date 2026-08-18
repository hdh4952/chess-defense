import { CONFIG } from '../config';
import { VIEW_H, VIEW_W } from '../render3d/coords';
import { allySpriteUrl } from '../render/skins';
import type { PieceType } from '../types';

export interface Layout {
  canvas: HTMLCanvasElement;
  /**
   * 3D 씬 위에 얹히는 2D 오버레이 캔버스 (v1.21) — 체력바·데미지 숫자·골드처럼 **무엇에도
   * 가려지면 안 되는 정보**만 여기 그린다(render3d/overlay.ts).
   *
   * ★ 드롭 판정은 여전히 `canvas`(3D 쪽) 기준이다. 오버레이는 `pointer-events: none`이라
   * 포인터를 잡지 않고, 두 캔버스의 CSS 크기·위치가 정확히 같으므로 어느 쪽 rect를 재도
   * 같은 답이 나온다 — 그래도 기준을 하나로 못 박아 두는 편이 낫다(ui/drag.ts).
   */
  overlay: HTMLCanvasElement;
  hud: {
    /**
     * ★ **v1.29에서 상단 HUD 막대 자체가 사라졌다** (사용자 결정). 값들은 없어진 게 아니라
     * **자기가 말하는 것 옆으로** 옮겨 갔다:
     *   - 웨이브·남은 적·타이머 → **보드 바로 위**(`#board-status`). 판에서 벌어지는 일이다.
     *   - 일시정지·배속·음소거 → **웨이브 시작 버튼 아래**(`#controls`). 판을 조작하는 것이다.
     *
     * 그 앞선 두 판에서 `gold`(v1.27 → 뽑기 버튼)와 `hp`·`bossRoom`(v1.28 → 플레이어 킹)이
     * 먼저 빠졌다. 이 필드 묶음이 `hud`라는 이름을 유지하는 것은 여전히 "상태 표시와 조작"이기
     * 때문이지, 한 곳에 모여 있어서가 아니다.
     */
    wave: HTMLElement; remaining: HTMLElement;
    timer: HTMLElement; bossIcon: HTMLElement;
    pauseBtn: HTMLButtonElement; speedBtn: HTMLButtonElement; muteBtn: HTMLButtonElement;
  };
  /**
   * 뽑기 버튼 하나 (v1.16). 예전에는 기물별 구매 버튼 5개였는데, 무엇이 나올지 고를 수
   * 없으므로 버튼도 하나가 됐다.
   */
  drawBtn: HTMLButtonElement;
  /** 뽑기 버튼 안의 `보유 / 필요` 줄. 매 프레임 텍스트만 갈아 끼우려고 따로 잡아 둔다 —
   *  버튼 전체를 innerHTML로 다시 쓰면 골드가 오를 때마다 DOM을 재파싱한다. */
  drawCost: HTMLElement;
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
    <main id="main">
      <aside id="left">
        <div id="shop"></div>
      </aside>
      <div id="board-col">
        <!-- ★ 판에서 벌어지는 일은 판 바로 위에 적는다 (v1.29). 화면 맨 위 막대에 있을 때는
             시선이 보드와 HUD 사이를 오갔다 — 웨이브 번호도 남은 적 수도 타이머도 전부
             "지금 저 판에서 무슨 일이 일어나는가"에 대한 답이기 때문이다. -->
        <div id="board-status">
          <span class="stat-pill">웨이브 <b id="hud-wave"></b></span>
          <span class="stat-pill">남은 적 <b id="hud-remaining"></b></span>
          <span class="stat-pill" id="timer-pill">⏱<b id="hud-timer"></b><b id="hud-boss-icon" hidden> ♚보스!</b></span>
        </div>
        <div id="board-wrap">
          <!-- width/height는 배율 1일 때의 값이자 폴백이다. 실제 해상도는 두 캔버스 모두
               화면 픽셀 밀도에 맞춰 다시 정해지고 CSS 크기는 뷰 크기로 못박힌다 — 3D 쪽은
               WebGLRenderer.setPixelRatio(render3d/scene.ts), 오버레이는 createBoardContext
               (render/dpr.ts)가 맡는다. -->
          <canvas id="board" width="${VIEW_W}" height="${VIEW_H}"></canvas>
          <canvas id="board-overlay" width="${VIEW_W}" height="${VIEW_H}"></canvas>
        </div>
      </div>
      <aside id="right">
        <div id="sell-slot">🗑<br><small>드래그 = 즉시 판매 (50%)</small><div id="sell-preview"></div></div>
        <button id="start-wave">웨이브 시작</button>
        <!-- ★ 판을 조작하는 버튼은 판을 시작하는 버튼 아래에 모은다 (v1.29). -->
        <div id="controls">
          <button id="hud-pause" class="ctl-btn" title="일시정지">⏸</button>
          <button id="hud-speed" class="ctl-btn" title="배속">▶▶1x</button>
          <button id="hud-mute" class="ctl-btn" aria-pressed="false" title="음소거">🔊</button>
        </div>
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
  // ★ 버튼 안에 **보유 골드 / 필요 골드**를 함께 적는다 (v1.27, 사용자 결정). 구조는 여기서
  //   한 번만 만들고, 매 프레임 바뀌는 것은 `#draw-cost`의 텍스트뿐이다(ui/shop.ts).
  shop.innerHTML = `
    <button id="draw-btn">
      <span class="draw-title">기물 뽑기</span>
      <b id="draw-cost"></b>
    </button>
    <ul id="odds">${odds}</ul>`;

  const q = <T extends HTMLElement>(sel: string) => app.querySelector<T>(sel)!;
  return {
    canvas: q<HTMLCanvasElement>('#board'),
    overlay: q<HTMLCanvasElement>('#board-overlay'),
    hud: {
      wave: q('#hud-wave'),
      remaining: q('#hud-remaining'), timer: q('#hud-timer'), bossIcon: q('#hud-boss-icon'),
      pauseBtn: q<HTMLButtonElement>('#hud-pause'), speedBtn: q<HTMLButtonElement>('#hud-speed'),
      muteBtn: q<HTMLButtonElement>('#hud-mute'),
    },
    drawBtn: q<HTMLButtonElement>('#draw-btn'),
    drawCost: q('#draw-cost'),
    sellSlot: q('#sell-slot'),
    startBtn: q<HTMLButtonElement>('#start-wave'),
    bannerRoot: q('#banner-root'),
  };
}
