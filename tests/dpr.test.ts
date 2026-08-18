// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { BOARD_H, BOARD_W } from '../src/core/grid';
import { MAX_PIXEL_SCALE, onPixelScaleChange, pixelScale, syncBoardCanvas } from '../src/render/dpr';

/**
 * DPR 대응 (v1.19). 여기서 지키는 것은 셋이다.
 *   ① 백킹 스토어는 배율만큼 커진다        — 커지지 않으면 흐린 채로 남는다
 *   ② CSS 크기는 배율과 무관하게 640px      — 안 박으면 레이아웃이 깨진다
 *   ③ 배율은 크기 대입 **뒤에** 걸린다      — 순서가 뒤집히면 조용히 사라진다
 * happy-dom은 2D 컨텍스트를 주지 않으므로(getContext가 null) 컨텍스트는 스텁을 쓴다 —
 * renderer.test.ts가 makeStubCtx를 쓰는 것과 같은 이유다.
 */

/** setTransform이 불린 **시점의** 캔버스 크기까지 기록하는 스텁. ③을 검사하려면 인자만으로는
 *  부족하다 — 크기 대입이 컨텍스트 상태를 초기화하므로 "언제 걸렸는가"가 곧 정답이다. */
function makeTransformSpy(canvas: HTMLCanvasElement) {
  const calls: { args: number[]; canvasWidth: number; canvasHeight: number }[] = [];
  const ctx = {
    setTransform: (...args: number[]): void => {
      calls.push({ args, canvasWidth: canvas.width, canvasHeight: canvas.height });
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

function withDevicePixelRatio(value: number): void {
  Object.defineProperty(window, 'devicePixelRatio', { value, configurable: true });
}

afterEach(() => { withDevicePixelRatio(1); });

describe('pixelScale', () => {
  it.each([[1, 1], [2, 2], [3, 3], [1.5, 1.5]])(
    'devicePixelRatio %s를 그대로 쓴다', (dpr, expected) => {
      withDevicePixelRatio(dpr);
      expect(pixelScale()).toBe(expected);
    });

  it('상한을 넘는 밀도는 잘라낸다 — 확대할수록 메모리가 제한 없이 늘지 않도록', () => {
    // devicePixelRatio는 하드웨어 상수가 아니다. 브라우저 확대로도 올라가므로 상한이 없으면
    // 사용자가 확대할수록 백킹 스토어와 굽기 비용이 끝없이 커진다.
    withDevicePixelRatio(8);
    expect(pixelScale()).toBe(MAX_PIXEL_SCALE);
  });

  it('1 미만·비정상 값은 1로 되돌린다 — 축소해도 640보다 작게 굽지 않는다', () => {
    for (const bad of [0.5, 0, -2, NaN, Infinity]) {
      withDevicePixelRatio(bad);
      expect(pixelScale(), String(bad)).toBe(1);
    }
  });
});

describe('syncBoardCanvas', () => {
  it('백킹 스토어를 배율만큼 키운다', () => {
    const canvas = document.createElement('canvas');
    const { ctx } = makeTransformSpy(canvas);
    syncBoardCanvas(canvas, ctx, BOARD_W, BOARD_H, 2);
    expect(canvas.width).toBe(BOARD_W * 2);
    expect(canvas.height).toBe(BOARD_H * 2);
  });

  it('★ CSS 크기는 배율과 무관하게 항상 보드 크기다', () => {
    // 이걸 놓치면 배율 2에서 보드가 1280px로 부풀어 3단 레이아웃(#main)이 통째로 깨진다.
    // 백킹 스토어만 키우고 CSS를 안 박는 것이 이 작업에서 가장 흔한 실수다.
    for (const scale of [1, 2, 3]) {
      const canvas = document.createElement('canvas');
      const { ctx } = makeTransformSpy(canvas);
      syncBoardCanvas(canvas, ctx, BOARD_W, BOARD_H, scale);
      expect(canvas.style.width, String(scale)).toBe(`${BOARD_W}px`);
      expect(canvas.style.height, String(scale)).toBe(`${BOARD_H}px`);
    }
  });

  it('그리는 좌표계가 백킹 스토어를 정확히 채우는 배율을 건다', () => {
    const canvas = document.createElement('canvas');
    const { ctx, calls } = makeTransformSpy(canvas);
    syncBoardCanvas(canvas, ctx, BOARD_W, BOARD_H, 2);
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual([2, 0, 0, 2, 0, 0]);
    // 자기 참조를 피해 백킹 스토어에서 되유도한다: (0,0)~(BOARD_W,BOARD_H)를 그리면
    // 캔버스가 정확히 다 덮여야 한다.
    expect(calls[0].args[0] * BOARD_W).toBe(canvas.width);
    expect(calls[0].args[3] * BOARD_H).toBe(canvas.height);
  });

  it('배율이 정수가 아니어도 백킹 스토어와 어긋나지 않는다', () => {
    // 1.5처럼 반올림이 필요한 배율에서 "요청 배율"을 그대로 걸면 최대 반 픽셀이 어긋난다.
    const canvas = document.createElement('canvas');
    const { ctx, calls } = makeTransformSpy(canvas);
    syncBoardCanvas(canvas, ctx, BOARD_W, BOARD_H, 1.5);
    expect(calls[0].args[0] * BOARD_W).toBe(canvas.width);
    expect(calls[0].args[3] * BOARD_H).toBe(canvas.height);
  });

  it('★ 배율은 크기 대입 뒤에 걸린다 — 순서가 뒤집히면 변환이 조용히 지워진다', () => {
    // canvas.width에 대입하면 컨텍스트 상태(변환 포함)가 초기화된다. setTransform이 먼저면
    // 배율이 사라져 보드가 캔버스의 왼쪽 위 1/4에만 그려지는데, 인자만 보는 테스트는 통과한다.
    const canvas = document.createElement('canvas');
    const { ctx, calls } = makeTransformSpy(canvas);
    syncBoardCanvas(canvas, ctx, BOARD_W, BOARD_H, 2);
    expect(calls[0].canvasWidth).toBe(BOARD_W * 2);
    expect(calls[0].canvasHeight).toBe(BOARD_H * 2);
  });

  it('다시 불러도 안전하다 — 밀도가 바뀔 때마다 부르는 함수다', () => {
    const canvas = document.createElement('canvas');
    const { ctx, calls } = makeTransformSpy(canvas);
    syncBoardCanvas(canvas, ctx, BOARD_W, BOARD_H, 2);
    syncBoardCanvas(canvas, ctx, BOARD_W, BOARD_H, 3);
    syncBoardCanvas(canvas, ctx, BOARD_W, BOARD_H, 1);
    expect(canvas.width).toBe(BOARD_W);                    // 배율이 내려가면 함께 줄어든다
    expect(calls.map(c => c.args[0])).toEqual([2, 3, 1]);   // 배율이 곱으로 누적되지 않는다
  });

  it('배율을 넘기지 않으면 현재 devicePixelRatio를 쓴다', () => {
    withDevicePixelRatio(2);
    const canvas = document.createElement('canvas');
    const { ctx } = makeTransformSpy(canvas);
    syncBoardCanvas(canvas, ctx);
    expect(canvas.width).toBe(BOARD_W * 2);
  });
});

/** matchMedia 스텁 — happy-dom의 실제 MediaQueryList로는 밀도 변화를 일으킬 수 없다. */
function installMatchMedia() {
  const armed: { query: string; fire: () => void }[] = [];
  const original = window.matchMedia;
  (window as unknown as Record<string, unknown>).matchMedia = (query: string) => {
    const listeners = new Set<() => void>();
    const entry = { query, fire: () => { for (const l of [...listeners]) l(); } };
    armed.push(entry);
    return {
      matches: false,
      media: query,
      addEventListener: (_: string, l: () => void) => { listeners.add(l); },
      removeEventListener: (_: string, l: () => void) => { listeners.delete(l); },
    } as unknown as MediaQueryList;
  };
  return { armed, restore: () => { (window as unknown as Record<string, unknown>).matchMedia = original; } };
}

describe('onPixelScaleChange', () => {
  it('밀도가 바뀌면 알리고, ★ 다음 변화도 계속 알린다', () => {
    // 미디어 쿼리는 "지금 값에 묶인 질문"이라 한 번 어긋나면 그 뒤로는 조용하다. 다시 걸지
    // 않으면 모니터를 두 번 옮겼을 때 두 번째부터는 흐린 채로 남는다 — 이 테스트가 없으면
    // "첫 번째 변화만 동작하는" 구현이 그대로 통과한다.
    const mm = installMatchMedia();
    withDevicePixelRatio(1);
    let calls = 0;
    const off = onPixelScaleChange(() => { calls++; });
    expect(mm.armed).toHaveLength(1);
    expect(mm.armed[0].query).toContain('1dppx');

    withDevicePixelRatio(2);
    mm.armed[0].fire();
    expect(calls).toBe(1);
    expect(mm.armed).toHaveLength(2);              // 새 밀도로 다시 걸었다
    expect(mm.armed[1].query).toContain('2dppx');

    withDevicePixelRatio(3);
    mm.armed[1].fire();
    expect(calls).toBe(2);

    off();
    mm.armed[2].fire();
    expect(calls, '해지 후에는 알리지 않는다').toBe(2);
    mm.restore();
  });

  it('상한이 아니라 실제 밀도로 질문한다', () => {
    // 상한(3)을 씌운 값으로 물으면 밀도가 4인 화면에서는 조건이 영영 맞지 않아 변화를 놓친다.
    const mm = installMatchMedia();
    withDevicePixelRatio(4);
    const off = onPixelScaleChange(() => {});
    expect(mm.armed[0].query).toContain('4dppx');
    off();
    mm.restore();
  });

  it('matchMedia가 없는 환경에서도 죽지 않는다', () => {
    const original = window.matchMedia;
    delete (window as unknown as Record<string, unknown>).matchMedia;
    expect(() => onPixelScaleChange(() => {})()).not.toThrow();
    (window as unknown as Record<string, unknown>).matchMedia = original;
  });
});
