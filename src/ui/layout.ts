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

/**
 * 보드가 들어갈 자리(availW × availH)에 **뷰 비율을 지킨 채** 넣을 수 있는 최대 크기 (v1.35).
 *
 * ★ **두 축을 함께 본다**는 것이 전부다. v1.31~v1.34에서는 높이 하나만 봤다(CSS의
 * `aspect-ratio`가 남는 높이에서 너비를 유도했다) — 데스크톱에서는 늘 높이가 먼저 동나므로
 * 맞는 답이었지만, 세로로 긴 폰에서는 그 너비가 **화면 폭을 넘고** `overflow: hidden`이
 * 넘친 만큼을 스크롤도 없이 잘라 냈다(실측 iPhone 13: 판 484px / 화면 390px — 킹과 판매
 * 영역이 통째로 화면 밖).
 *
 * ⚠️ **레터박싱은 답이 될 수 없다.** 캔버스를 `object-fit: contain`으로 넣어 남는 여백을
 * 두면 `getBoundingClientRect`가 여백까지 포함한 상자를 돌려주고, 드롭 판정은 그 rect로
 * 정규화하므로(ui/drag.ts) **판정이 통째로 어긋난다.** 그래서 여백이 생길 수 없는 쪽 —
 * 상자 자체를 비율대로 깎는 쪽 — 을 택했다.
 *
 * 순수 함수로 떼어 둔 이유도 같다: 틀리면 드롭이 조용히 어긋나는 계산이라 브라우저 없이
 * 검증할 수 있어야 한다(tests/mobile.test.ts).
 */
export function fitBoardSize(
  availW: number, availH: number, ratio = VIEW_W / VIEW_H,
): { width: number; height: number } {
  const width = Math.max(0, Math.min(availW, availH * ratio));
  return { width, height: width / ratio };
}

/**
 * 보드 크기를 자리에 맞춘다 — 리사이즈·회전·주소창 접힘을 전부 따라간다 (v1.35).
 *
 * ★ 관찰 대상은 래퍼가 아니라 **슬롯**이다. 래퍼는 슬롯 안에 절대 배치라 슬롯 크기에 전혀
 * 기여하지 않으므로, "재는 것"과 "바꾸는 것"이 서로 다른 상자다 — 예전 구조(래퍼가 흐름에
 * 있고 자기 크기를 관찰)에서는 그 둘이 같아 되먹임 고리가 있었다.
 *
 * ⚠️ 그래도 고리가 완전히 없지는 않다: `--board-w`가 상태 줄·조작 줄의 너비를 바꾸고, 그
 * 줄들의 **높이**가 달라지면 슬롯 높이가 다시 달라질 수 있다. 그래서 값이 실질적으로 같으면
 * 아무것도 쓰지 않고 끝낸다 — 브라우저가 "ResizeObserver loop" 경고를 뱉는 무한 왕복을 막는
 * 가장 값싼 방법이다.
 */
function wireBoardFit(app: HTMLElement): void {
  const slot = app.querySelector<HTMLElement>('#board-slot')!;
  const wrap = app.querySelector<HTMLElement>('#board-wrap')!;
  const col = app.querySelector<HTMLElement>('#board-col')!;
  let lastW = -1;
  const fit = (): void => {
    const r = slot.getBoundingClientRect();
    const { width, height } = fitBoardSize(r.width, r.height);
    // 아직 레이아웃이 없거나(테스트 환경) 화면 밖이면 그냥 둔다 — CSS 폴백이 자리를 지킨다.
    if (width <= 0 || Math.abs(width - lastW) < 0.5) return;
    lastW = width;
    wrap.style.width = `${width}px`;
    wrap.style.height = `${height}px`;
    col.style.setProperty('--board-w', `${width}px`);
  };
  fit();
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fit).observe(slot);
  // resize는 회전(orientationchange)까지 함께 커버한다. visualViewport는 모바일에서 주소창이
  // 접히거나 키보드가 올라올 때 **resize 없이** 보이는 높이만 바뀌는 경우를 잡는다.
  window.addEventListener('resize', fit);
  window.visualViewport?.addEventListener('resize', fit);
}

export function createLayout(app: HTMLElement): Layout {
  app.innerHTML = `
    <main id="main">
      <div id="board-col">
        <!-- ★ 판에서 벌어지는 일은 판 바로 위에 적는다 (v1.29). 화면 맨 위 막대에 있을 때는
             시선이 보드와 HUD 사이를 오갔다 — 웨이브 번호도 남은 적 수도 타이머도 전부
             "지금 저 판에서 무슨 일이 일어나는가"에 대한 답이기 때문이다. -->
        <div id="board-status">
          <span class="stat-pill">웨이브 <b id="hud-wave"></b></span>
          <span class="stat-pill">남은 적 <b id="hud-remaining"></b></span>
          <span class="stat-pill" id="timer-pill">⏱<b id="hud-timer"></b><b id="hud-boss-icon" hidden> ♚보스!</b></span>
        </div>
        <!-- ★ 슬롯은 **남는 자리**를 차지하는 빈 상자고, 래퍼는 그 안에 절대 배치로 떠 있다
             (v1.35). 이렇게 나눠야 "자리가 얼마나 남았나"를 재는 일이 "보드를 얼마로 할까"에
             영향을 받지 않는다 — 아래 fitBoard 주석. -->
        <div id="board-slot">
          <div id="board-wrap">
            <!-- width/height는 배율 1일 때의 값이자 폴백이다. 실제 해상도는 두 캔버스 모두
                 화면 픽셀 밀도에 맞춰 다시 정해지고 CSS 크기는 뷰 크기로 못박힌다 — 3D 쪽은
                 WebGLRenderer.setPixelRatio(render3d/scene.ts), 오버레이는 createBoardContext
                 (render/dpr.ts)가 맡는다. -->
            <canvas id="board" width="${VIEW_W}" height="${VIEW_H}"></canvas>
            <canvas id="board-overlay" width="${VIEW_W}" height="${VIEW_H}"></canvas>
            <!-- ★ 판매 영역은 **판 오른쪽 스트립에 겹쳐 놓인다** (v1.30). 자리는 코드가 정한다 —
                 보드가 캔버스에서 차지하는 사각형은 카메라만 아는 값이라(render3d/index.ts의
                 boardRect) main.ts가 그 값을 받아 여기 style로 밀어 넣는다.
                 드래그 중에만 보이므로 평소에는 킹이 그 자리에 그대로 서 있다. -->
            <div id="sell-slot">🗑<br><small>여기에 놓으면<br>즉시 판매 (50%)</small><div id="sell-preview"></div></div>
          </div>
        </div>
        <!-- ★ 조작 UI를 보드 아래 한 줄로 모았다 (v1.30). 왼쪽은 **사는 것**(뽑기 버튼 + 확률표),
             오른쪽은 **굴리는 것**(웨이브 시작 + 재생바). 예전에는 보드 양옆에 갈라져 있어
             시선이 좌우로 벌어졌다. -->
        <div id="board-bottom">
          <div class="bottom-col" id="shop"></div>
          <div class="bottom-col">
            <button id="start-wave">웨이브 시작</button>
            <div id="controls">
              <button id="hud-pause" class="ctl-btn" title="일시정지">⏸</button>
              <button id="hud-speed" class="ctl-btn" title="배속">▶▶1x</button>
              <button id="hud-mute" class="ctl-btn" aria-pressed="false" title="음소거">🔊</button>
            </div>
          </div>
        </div>
      </div>
    </main>
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

  // ★ 게임 화면만 화면 높이에 맞춘다 (v1.31 — style.css의 `#app.in-game`). 시작 화면은
  //   기물 설명 8탭이라 세로로 길어서 같은 규칙을 걸면 내용이 잘린다.
  app.classList.add('in-game');
  // ★ 보드 래퍼의 비율은 **뷰 크기에서 유도한다.** CSS에 숫자를 박으면 VIEW_W를 바꿨을 때
  //   조용히 어긋나고, 그 어긋남은 드롭 판정까지 함께 틀어진다(래퍼 rect로 정규화하므로).
  //   fitBoard가 픽셀을 직접 넣은 뒤에도 남겨 둔다 — 스크립트가 재기 전의 폴백이자, 이 파일이
  //   비율을 소유한다는 표시다.
  const wrap = app.querySelector<HTMLElement>('#board-wrap')!;
  wrap.style.aspectRatio = `${VIEW_W} / ${VIEW_H}`;
  wireBoardFit(app);

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
