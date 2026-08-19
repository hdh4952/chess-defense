// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLayout, fitBoardSize } from '../src/ui/layout';
import { COMPACT_VIEW, VIEW_H, VIEW_W, WIDE_VIEW } from '../src/render3d/coords';
import { COMPACT_MEDIA, pickBoardView } from '../src/render3d/view';
import { updateHud } from '../src/ui/hud';
import { kingHpFill } from '../src/render/palette';
import { CONFIG } from '../src/config';
import { cleanState } from './helpers';

const RATIO = VIEW_W / VIEW_H;

/**
 * ★ v1.35 — 모바일 플레이 (사용자 요청: "모바일 플레이도 가능하게 만들자. 모바일에서
 * 정상적으로 화면 전체가 보이도록 하고 드래그시에 화면이 움직이지 않도록").
 *
 * 두 요구가 각각 다른 것을 고친다:
 *   · "화면 전체가 보이도록" → **판이 잘려 나가는** 문제. 보드 너비를 남는 **높이 하나에서만**
 *     유도하던 탓에(v1.31) 세로로 긴 화면에서 그 값이 화면 폭을 넘었고, `overflow: hidden`이
 *     넘친 부분을 스크롤도 없이 잘라 냈다 — 실측 iPhone 13 세로에서 판 484px / 화면 390px,
 *     킹과 판매 영역이 통째로 화면 밖이었다.
 *   · "화면이 움직이지 않도록" → 터치가 스크롤·핀치로 해석되지 않게 하는 것(style.css).
 */
describe('fitBoardSize — 두 축을 함께 본다 (v1.35)', () => {
  it('★ 세로로 긴 화면에서는 **너비**가 정한다 (v1.34까지 판이 잘리던 자리)', () => {
    // 실측값 그대로: iPhone 13 세로에서 보드 자리는 374×413이었다. 높이만 보면 529px —
    // 화면 폭(390)을 훌쩍 넘는다.
    const { width, height } = fitBoardSize(374, 413);
    expect(width).toBeCloseTo(374, 5);          // 너비에 묶였다
    expect(height).toBeLessThanOrEqual(413);
  });

  it('가로로 넉넉한 화면에서는 **높이**가 정한다 (데스크톱 — v1.31의 동작 그대로)', () => {
    const { width, height } = fitBoardSize(1256, 614);
    expect(height).toBeCloseTo(614, 5);
    expect(width).toBeLessThanOrEqual(1256);
  });

  it('★ 어떤 자리를 줘도 **뷰 비율이 정확히** 유지된다', () => {
    // ⚠️ 이것이 이 함수의 존재 이유다. 비율이 어긋나면 캔버스가 레터박싱되고, 드롭 판정은
    //   래퍼 rect로 정규화하므로(ui/drag.ts) 여백만큼 **판정이 통째로 밀린다** — 화면으로는
    //   보이지 않고 "가끔 엉뚱한 칸에 놓인다"로만 드러난다.
    for (const [w, h] of [[374, 413], [1256, 614], [300, 300], [2000, 100], [1, 999]]) {
      const r = fitBoardSize(w, h);
      expect(r.width / r.height).toBeCloseTo(RATIO, 6);
    }
  });

  it('★ 어떤 자리를 줘도 그 자리를 넘지 않는다', () => {
    for (let w = 10; w <= 2000; w += 37) {
      for (let h = 10; h <= 2000; h += 53) {
        const r = fitBoardSize(w, h);
        expect(r.width).toBeLessThanOrEqual(w + 1e-9);
        expect(r.height).toBeLessThanOrEqual(h + 1e-9);
      }
    }
  });

  it('자리가 없으면 0이다 — 음수를 돌려주지 않는다', () => {
    // 레이아웃 전이나 회전 중에는 rect가 0이거나 음수로 오기도 한다. 그 값을 그대로 style에
    // 넣으면 CSS가 무시해 **직전 크기가 그대로 남고**, 그것이 화면과 어긋난 rect가 된다.
    expect(fitBoardSize(0, 500)).toEqual({ width: 0, height: 0 });
    expect(fitBoardSize(500, -10).width).toBe(0);
  });
});

describe('보드 자리 — 재는 상자와 바꾸는 상자를 나눈다 (v1.35)', () => {
  it('★ 래퍼는 슬롯 **안에** 있다', () => {
    const app = document.createElement('div');
    document.body.appendChild(app);
    createLayout(app);
    const slot = app.querySelector('#board-slot')!;
    const wrap = app.querySelector<HTMLElement>('#board-wrap')!;
    expect(wrap.parentElement).toBe(slot);
    // 비율은 여전히 이 파일이 소유한다 — 스크립트가 크기를 재기 전의 폴백이다.
    expect(wrap.style.aspectRatio.replace(/\s/g, '')).toBe(`${VIEW_W}/${VIEW_H}`);
    // 판매 영역은 래퍼 안에 남아야 판 위에 겹친다(v1.30).
    expect(app.querySelector('#sell-slot')!.closest('#board-wrap')).toBeTruthy();
  });
});

/**
 * 스타일시트를 **글자로** 확인한다.
 *
 * ⚠️ happy-dom은 `@media`·`env()`·`:has()`를 계산해 주지 않으므로 `getComputedStyle`로는
 * 이 규칙들이 살아 있는지 알 수 없다. 그렇다고 검증을 포기하면, 한 줄만 지워도 **모바일에서
 * 드래그가 조용히 끊기는** 회귀가 아무 테스트도 건드리지 않고 지나간다(브라우저 없이는
 * 재현되지 않는 종류다). 그래서 "그 선언이 그 선택자 아래 있는가"만 본다 — 약한 검증이지만,
 * 없어졌다는 사실은 확실히 잡는다.
 */
describe('터치 잠금 — 게임 화면에서만 (v1.35)', () => {
  // ⚠️ `import.meta.url`을 쓰지 않는다 — happy-dom 환경에서는 그 값이 file: URL이 아니라
  //    readFileSync가 거부한다. vitest는 저장소 루트에서 돌므로 cwd 기준이 안전하다.
  const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8');
  const css = read('src/style.css');
  const html = read('index.html');

  /** 선택자 하나의 선언 블록을 뽑는다(첫 번째 것). */
  function block(selector: string): string {
    const i = css.indexOf(selector + ' {');
    expect(i, `${selector} 규칙이 없다`).toBeGreaterThan(-1);
    return css.slice(i, css.indexOf('}', i));
  }

  it('★ 게임 화면은 터치를 스크롤로 해석하지 않는다', () => {
    // 이것이 없으면 브라우저가 제스처를 가로채는 순간 pointercancel이 날아와 드래그가
    // 조용히 끊긴다(ui/drag.ts의 onCancel) — 화면이 흔들리는 것보다 이쪽이 더 치명적이다.
    expect(block('#app.in-game')).toContain('touch-action: none');
  });

  it('★ 그 잠금은 **시작 화면까지 잠그지 않는다**', () => {
    // 시작 화면은 기물 설명 8탭이라 세로로 길다 — 여기까지 none을 걸면 읽을 수가 없다.
    expect(block('body')).toContain('touch-action: manipulation');
    expect(block('body')).not.toContain('touch-action: none');
    // 잠금 선택자가 `.in-game`으로 좁혀져 있는가.
    expect(css).toMatch(/html:has\(#app\.in-game\)[^{]*\{[^}]*overflow: hidden/);
  });

  it('당겨서 새로고침과 길게 누르기 메뉴를 끈다 — 둘 다 드래그와 같은 제스처다', () => {
    expect(block('body')).toContain('overscroll-behavior: none');
    expect(block('body')).toContain('-webkit-touch-callout: none');
  });

  /** viewport 메타의 content 값만 뽑는다 — ⚠️ 파일 전체를 문자열로 보면 **주석에 적어 둔
   *  설명**("user-scalable=no는 넣지 않았다")까지 걸려서 없는 것을 있다고 읽는다. */
  const viewport = (): string =>
    /<meta name="viewport" content="([^"]*)"/.exec(html)?.[1] ?? '';

  it('노치를 피한다 — viewport-fit과 안전 영역 여백은 **짝으로만** 뜻이 있다', () => {
    // cover만 넣고 여백을 안 주면 노치가 보드를 덮고, 여백만 주고 cover가 없으면 두 번 비운다.
    expect(viewport()).toContain('viewport-fit=cover');
    expect(block('#app.in-game')).toContain('env(safe-area-inset-left)');
  });

  it('★ 확대는 막지 않는다 — 접근성을 깎지 않고도 판 위 핀치는 이미 막힌다', () => {
    // 게임 화면의 touch-action: none이 핀치·더블탭을 막으므로 user-scalable=no는 필요 없다.
    // 글이 많은 시작 화면에서는 확대할 수 있어야 한다.
    expect(viewport()).not.toContain('user-scalable=no');
    expect(viewport()).not.toContain('maximum-scale');
  });
});


/**
 * ★★ v1.36 — **좁은 화면은 판만 담는다** (사용자 요청: "보드 크기가 작아서 모바일 화면
 * 너비에 거의 꽉채워서 보여줘야할거같아 … 기물 판매 영역을 보드 화면 아래 버튼이 모여있는
 * 영역으로 바꿔야할거같고 킹이 놓인 우측 공간을 없애고 체력바를 보드 바로 하단에 배치").
 *
 * v1.28의 "가로만 넓히면 보드가 한 픽셀도 줄지 않는다"는 **화면이 가로로 넉넉할 때만** 참인
 * 논리였다. 폰에서는 폭이 먼저 동나므로 킹 자리 180px이 판에서 그대로 떼어 낸 몫이 된다 —
 * 실측 390px 폭에서 판이 257px(화면의 66%)였다.
 */
describe('좁은 화면의 뷰 선택 (v1.36)', () => {
  function withMedia(matches: boolean, run: () => void): void {
    const original = window.matchMedia;
    (window as unknown as { matchMedia: unknown }).matchMedia =
      (q: string) => ({ matches: q === COMPACT_MEDIA ? matches : false });
    try { run(); } finally {
      (window as unknown as { matchMedia: unknown }).matchMedia = original;
    }
  }

  it('좁으면 판만 담는 뷰, 넓으면 킹이 서는 뷰', () => {
    withMedia(true, () => expect(pickBoardView()).toBe(COMPACT_VIEW));
    withMedia(false, () => expect(pickBoardView()).toBe(WIDE_VIEW));
  });

  it('⚠️ matchMedia가 없는 환경은 **넓은 뷰**로 떨어진다', () => {
    // 이 저장소의 기존 측정·테스트가 전부 넓은 뷰의 기하 위에 서 있다 — 모르는 환경에서
    // 조용히 다른 것을 재게 두면, 헤드리스 신호가 재는 대상이 소리 없이 바뀐다.
    const original = window.matchMedia;
    (window as unknown as { matchMedia: unknown }).matchMedia = undefined;
    try { expect(pickBoardView()).toBe(WIDE_VIEW); } finally {
      (window as unknown as { matchMedia: unknown }).matchMedia = original;
    }
  });

  it('★ 뷰를 가르는 문턱이 CSS의 좁은 화면 판정과 **같다**', () => {
    // 두 문턱이 어긋나면 그 사이 폭에서 "여백은 빽빽한데 킹은 그대로"인 화면이 나온다.
    const css = readFileSync(resolve(process.cwd(), 'src/style.css'), 'utf8');
    for (const q of COMPACT_MEDIA.split(',').map(t => t.trim())) {
      expect(css, `${q}가 style.css에 없다`).toContain(q);
    }
  });
});

describe('좁은 화면의 배치 (v1.36)', () => {
  function mount(view: typeof WIDE_VIEW): { app: HTMLElement; layout: ReturnType<typeof createLayout> } {
    document.body.innerHTML = '';
    const app = document.createElement('div');
    document.body.appendChild(app);
    return { app, layout: createLayout(app, view) };
  }

  it('★ 캔버스가 정사각이다 — 킹 자리가 판으로 넘어왔다', () => {
    const { app } = mount(COMPACT_VIEW);
    const canvas = app.querySelector<HTMLCanvasElement>('#board')!;
    expect(canvas.width).toBe(COMPACT_VIEW.w);
    expect(canvas.height).toBe(COMPACT_VIEW.h);
    expect(app.querySelector<HTMLElement>('#board-wrap')!.style.aspectRatio.replace(/\s/g, ''))
      .toBe(`${COMPACT_VIEW.w}/${COMPACT_VIEW.h}`);
  });

  it('★ 판매 영역이 판 오른쪽 스트립 → **아래 조작 줄**로 옮겨 간다', () => {
    expect(mount(COMPACT_VIEW).layout.sellSlot.closest('#board-bottom')).toBeTruthy();
    expect(mount(WIDE_VIEW).layout.sellSlot.closest('#board-wrap')).toBeTruthy();
    // 어느 쪽이든 **하나뿐**이다 — 둘 다 그리면 드롭 판정이 먼저 잡히는 쪽으로만 간다.
    expect(document.querySelectorAll('#sell-slot')).toHaveLength(1);
  });

  it('★ 체력 막대가 판 **바로 아래**에 생긴다 (넓은 화면에는 없다)', () => {
    const { app, layout } = mount(COMPACT_VIEW);
    expect(layout.hp).not.toBeNull();
    const kids = [...app.querySelector('#board-col')!.children];
    const at = (sel: string): number => kids.indexOf(app.querySelector(sel)!);
    expect(at('#board-hp')).toBeGreaterThan(at('#board-slot'));   // 판 아래
    expect(at('#board-hp')).toBeLessThan(at('#board-bottom'));    // 조작 줄 위

    const wide = mount(WIDE_VIEW);
    expect(wide.layout.hp).toBeNull();
    expect(wide.app.querySelector('#board-hp')).toBeNull();
  });

  it('★ 그 막대가 캔버스 킹 막대와 **같은 색 규칙**을 쓴다', () => {
    const { layout } = mount(COMPACT_VIEW);
    const state = cleanState();
    for (const hp of [CONFIG.player.startHp, 4, 1]) {
      state.hp = hp;
      updateHud(layout, state);
      const ratio = hp / CONFIG.player.startHp;
      expect(layout.hp!.text.textContent).toBe(`${hp}/${CONFIG.player.startHp}`);
      expect(layout.hp!.fill.style.width).toBe(`${ratio * 100}%`);
      // ⚠️ 색을 리터럴로 적지 않는다 — 그러면 팔레트를 바꿨을 때 이 테스트만 옛 색으로 남아
      //    "두 계층이 같은 색을 쓴다"는 주장 자체가 거짓이 된다.
      expect(layout.hp!.fill.style.background).toBe(kingHpFill(ratio));
    }
  });

  it('넓은 화면에서 updateHud는 체력 막대를 찾지 않는다 — 없어도 죽지 않는다', () => {
    const { layout } = mount(WIDE_VIEW);
    expect(() => updateHud(layout, cleanState())).not.toThrow();
  });
});
