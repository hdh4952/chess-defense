import { BOARD_H, BOARD_W } from '../core/grid';

/**
 * 보드 캔버스의 해상도를 화면 픽셀 밀도에 맞춘다 (v1.19).
 *
 * **문제** — 캔버스는 백킹 스토어(`canvas.width`)와 화면 크기(CSS 폭)가 별개다. v1.18까지는
 * 둘 다 640이었고, 레티나처럼 CSS 픽셀 하나가 기기 픽셀 2×2인 화면에서는 브라우저가 640×640
 * 이미지를 1280×1280으로 **확대**해 보여줬다 — 보드·기물·글자 전부가 한 겹 흐렸다.
 * `sprites.ts`가 오래전부터 "나중에 캔버스가 DPR을 인식하도록 바뀌면 bake() 크기도 같은 배율로
 * 함께 키워야 한다"고 적어 둔 그 작업이다.
 *
 * **해법** — 백킹 스토어만 배율만큼 키우고(1280×1280), CSS 크기는 640px로 **못 박는다.**
 * 그리고 컨텍스트에 그 배율을 한 번 걸어 두면(`setTransform`) 그리는 쪽 좌표계는 그대로
 * 0~640이다. 그래서 renderer/effects/enemyFx는 **한 줄도 바뀌지 않는다** — 이 저장소가
 * 보드 좌표를 `core/grid.ts` 하나에서만 유도해 온 덕이다.
 *
 * ★ **크기를 인자로 받는다** (v1.28). 예전에는 보드 크기(640×640)가 곧 캔버스 크기였지만,
 * 플레이어 킹이 판 밖에 서면서 화면이 보드보다 넓어졌다(render3d/coords.ts의 `VIEW_W`).
 * 이 모듈이 쓰이는 곳은 이제 오버레이 캔버스 하나뿐이고, 그 크기는 뷰 크기다.
 *
 * ★ **v1.31에서 표시 크기의 소유권이 CSS로 넘어갔다.** 예전에는 여기서 인라인 style로 CSS
 * 크기를 못 박았다 — 캔버스에 CSS 크기가 없으면 화면 크기가 백킹 스토어를 따라가 배율 2에서
 * 보드가 두 배로 부풀기 때문이다. 그 위험은 여전하지만, **화면 높이에 맞춰 보드가 줄어들어야
 * 하므로**(스크롤 금지) 크기를 픽셀로 못 박을 수가 없어졌다. 대신 `style.css`가
 * `#board-wrap canvas { width:100%; height:100% }`로 소유한다 — 못 박는 주체가 바뀌었을 뿐
 * 못 박혀 있다는 사실은 같다.
 *
 * ⚠️ 그래서 이 함수는 **백킹 스토어와 컨텍스트 변환만** 건드린다. 인라인 style을 다시
 * 넣으면 CSS가 지고 보드가 화면 밖으로 넘친다.
 */

/**
 * 배율 상한. 3에서 백킹 스토어는 1920×1920(≈14.7MB)이고 기물 스프라이트는 216px로 구워진다.
 * 상한이 필요한 이유는 `devicePixelRatio`가 하드웨어 상수가 아니기 때문이다 — 브라우저 확대를
 * 하면 함께 올라가므로, 상한이 없으면 사용자가 확대할수록 메모리와 굽기 비용이 제한 없이 는다.
 */
export const MAX_PIXEL_SCALE = 3;

/** 브라우저가 보고하는 값 그대로(상한 적용 전). 미디어 쿼리는 이 값으로 만들어야 한다 —
 *  상한을 씌운 값으로 물으면 실제 밀도가 3을 넘는 화면에서 조건이 영영 맞지 않는다. */
function rawPixelRatio(): number {
  const raw = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

/** 실제로 사용할 배율 — 1 이상 MAX_PIXEL_SCALE 이하. */
export function pixelScale(): number {
  return Math.min(Math.max(rawPixelRatio(), 1), MAX_PIXEL_SCALE);
}

/**
 * 캔버스의 백킹 스토어·CSS 크기·컨텍스트 변환을 한꺼번에 맞춘다. **다시 불러도 안전하다**
 * (배율이 바뀔 때마다 다시 부른다).
 *
 * ⚠️ `canvas.width`에 대입하면 **컨텍스트 상태가 초기화된다** — 변환도 함께 지워지므로
 * `setTransform`은 반드시 크기 대입 **뒤**에 와야 한다. 순서가 뒤집히면 배율이 조용히 사라져
 * 보드가 캔버스의 왼쪽 위 1/4에만 그려진다.
 */
export function syncBoardCanvas(
  canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D,
  cssW: number = BOARD_W, cssH: number = BOARD_H, scale: number = pixelScale(),
): void {
  const w = Math.round(cssW * scale);
  const h = Math.round(cssH * scale);
  canvas.width = w;
  canvas.height = h;
  // 요청 배율이 아니라 **반올림된 백킹 스토어에서 되유도한 배율**을 건다 — 그래야 그리는 영역이
  // 백킹 스토어를 정확히 채운다(배율이 정수가 아닐 때 최대 반 픽셀이 어긋나는 것을 막는다).
  ctx.setTransform(w / cssW, 0, 0, h / cssH, 0, 0);
}

/**
 * 픽셀 밀도가 바뀌면 알린다 — 창을 다른 모니터로 옮기거나 브라우저를 확대/축소할 때다.
 * 해지 함수를 돌려준다.
 *
 * `resize` 이벤트로는 안 된다: 모니터 간 이동은 창 크기를 바꾸지 않는다. 미디어 쿼리는 **지금
 * 값에 묶인 질문**("밀도가 2인가?")이라 한 번 어긋나면 그 뒤로는 조용하므로, 알림을 받을 때마다
 * 새 값으로 **다시 건다**(re-arm).
 */
export function onPixelScaleChange(listener: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  let mq: MediaQueryList | null = null;
  let disposed = false;

  const handler = (): void => {
    if (disposed) return;
    arm();                      // 새 밀도에 맞춰 질문을 다시 건다 (이걸 빼면 딱 한 번만 동작한다)
    listener();
  };
  function arm(): void {
    mq?.removeEventListener('change', handler);
    mq = window.matchMedia(`(resolution: ${rawPixelRatio()}dppx)`);
    mq.addEventListener('change', handler);
  }

  arm();
  return () => {
    disposed = true;
    mq?.removeEventListener('change', handler);
  };
}

/**
 * 보드 캔버스의 2D 컨텍스트를 만들어 배율까지 걸어 돌려준다. 밀도가 바뀌면 스스로 다시 맞춘다
 * (구독은 페이지 수명 내내 유지하므로 해지 함수는 쓰지 않는다 — 캔버스는 하나이고, 이 캔버스가
 * 사라질 때는 페이지도 함께 사라진다).
 */
export function createBoardContext(
  canvas: HTMLCanvasElement, cssW: number = BOARD_W, cssH: number = BOARD_H,
): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d')!;
  syncBoardCanvas(canvas, ctx, cssW, cssH);
  onPixelScaleChange(() => syncBoardCanvas(canvas, ctx, cssW, cssH));
  return ctx;
}
