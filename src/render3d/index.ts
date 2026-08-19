import { createBoardContext } from '../render/dpr';
import { decalSignature, drawDecals, type ViewState } from '../render/renderer';
import type { Fx } from '../render/effects';
import type { EnemyFx } from '../render/enemyFx';
import type { PieceFx } from '../render/pieceFx';
import type { GameState } from '../types';
import { Effects3D } from './effects3d';
import { Enemies3D } from './enemies';
import { drawOverlay } from './overlay';
import { Pieces3D } from './pieces';
import { createScene } from './scene';
import { createPlayerKing } from './playerKing';
import { VIEW_H, VIEW_W } from './coords';

/**
 * 보드 3D 렌더러 — 한 프레임을 그리는 단일 진입점 (v1.21).
 *
 * ★ **계층이 셋이고, 그 경계가 이 클래스의 전부다.**
 *
 *   1. **바닥 데칼** (2D 텍스처)   — 판·하이라이트·감속 오라. 카메라가 직교 투영이라 화면과
 *      1:1이고, `decalSignature`가 바뀔 때만 다시 굽는다(적이 움직여도 안 바뀐다).
 *   2. **3D 씬**                   — 기물·적·판 위 이펙트. 그림자와 깊이를 갖는 진짜 물체들.
 *   3. **화면 오버레이** (2D 캔버스) — 체력바·데미지 숫자·골드. 무엇에도 가려지면 안 되는 정보.
 *
 * ★ **`main.ts`가 보는 것은 이 클래스 하나뿐이다.** 예전에는 프레임 루프가 `render(ctx, …)`와
 * `fx.draw(ctx)`를 직접 부르고 그 사이에 `ctx.translate(shake)`까지 손으로 걸었다 — 계층이
 * 셋이 된 지금 그 방식이면 루프가 셋의 순서와 흔들림 처리를 전부 알아야 한다. 순서는 그리는
 * 쪽의 지식이므로 그리는 쪽에 둔다.
 */
export class Board3D {
  private kit: ReturnType<typeof createScene>;
  private pieces: Pieces3D;
  private enemies: Enemies3D;
  private effects: Effects3D;
  private overlayCtx: CanvasRenderingContext2D;
  /** 마지막으로 구운 데칼의 서명. `null`은 "아직 한 번도 굽지 않았다" — 첫 프레임에 반드시
   *  굽게 하려는 것이다(빈 문자열로 두면 "빈 보드"와 구분되지 않아 첫 프레임을 건너뛴다). */
  private lastDecal: string | null = null;

  constructor(canvas: HTMLCanvasElement, overlay: HTMLCanvasElement) {
    this.kit = createScene(canvas);
    this.pieces = new Pieces3D(this.kit.scene);
    this.enemies = new Enemies3D(this.kit.scene);
    this.effects = new Effects3D(this.kit.scene);
    // ★ 플레이어 킹은 **한 번 세우고 끝**이다 — 판 위 기물과 달리 생기거나 사라지지 않고
    //   움직이지도 않는다. 바뀌는 것은 머리 위 체력바뿐이고, 그건 오버레이가 그린다.
    this.kit.scene.add(createPlayerKing());
    this.overlayCtx = createBoardContext(overlay, VIEW_W, VIEW_H);
  }

  render(
    state: GameState, view: ViewState, fxItems: readonly Fx[],
    enemyFx?: EnemyFx, pieceFx?: PieceFx,
  ): void {
    // 화면 흔들림은 카메라 프러스텀을 옮겨 건다 — 3D·데칼이 한 몸으로 흔들린다(scene.ts).
    // 오버레이만 별도인데, 그건 2D라 자기 좌표에 직접 더한다(overlay.ts).
    this.kit.setShake(view.shake);

    const sig = decalSignature(state, view);
    if (sig !== this.lastDecal) {
      drawDecals(this.kit.decalCtx, state, view);
      this.kit.decalDirty();
      this.lastDecal = sig;
    }

    this.pieces.sync(state, pieceFx);
    this.enemies.sync(state, enemyFx);
    this.effects.sync(fxItems);
    this.kit.draw();

    drawOverlay(this.overlayCtx, state, fxItems, this.kit, enemyFx);
  }

  /**
   * **정규화 좌표**(0~1) → 그 아래 칸. 원근이 되면서 이 매핑이 더는 산수가 아니라 **역투영**이다
   * (v1.24) — 카메라를 아는 곳이 여기뿐이므로 드롭 판정(ui/drag.ts)에 이 함수를 주입한다.
   *
   * ★ **0~1로 받는 것이 v1.28의 요점이다.** 캔버스가 보드보다 넓어지면서(플레이어 킹 자리)
   * "캔버스 픽셀"이 더는 `ui/`가 아는 값이 아니게 됐다 — 정규화해서 넘기면 ui/는 rect만
   * 알면 되고 뷰 크기는 이쪽 계층에 남는다.
   */
  squareAt(u: number, v: number) {
    return this.kit.squareAt(u * VIEW_W, v * VIEW_H);
  }

  /**
   * 판이 캔버스에서 차지하는 사각형(CSS px — 캔버스 CSS 크기가 곧 뷰 크기다).
   * 판매 영역을 판 오른쪽 스트립에 정확히 맞추는 데 쓴다(v1.30).
   */
  boardRect(): { left: number; top: number; right: number; bottom: number } {
    return this.kit.boardScreenRect();
  }

  dispose(): void {
    this.pieces.dispose();
    this.enemies.dispose();
    this.effects.dispose();
    this.kit.dispose();
  }
}
