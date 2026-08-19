import * as THREE from 'three';
import { BOARD_H, BOARD_W } from '../core/grid';
import { drawBoardBase } from '../render/renderer';
import { onPixelScaleChange, pixelScale } from '../render/dpr';
import { CONFIG } from '../config';
import {
  boardXFromWorld, boardYFromWorld, type BoardView, DECAL_Y, HALF_D, HALF_W, KING_SCALE, KING_WORLD,
  WIDE_VIEW,
  SLAB_THICKNESS,
} from './coords';
import { playerKingRadius, playerKingTop } from './geometry';
import { STRETCH_Y } from './pose';
import type { Square } from '../types';
import { SLAB_SIDE } from './materials';
import { setOutlineResolution } from './outline';
import { toonGradient } from './toon';

/**
 * 씬·카메라·조명 (v1.24 — ★ **원근 쿼터뷰**).
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★ v1.21~v1.23은 **직교 투영 + 보드에 맞춘 프러스텀**이었다. 그 구성의 값은 하나였다:
 *   보드 좌표 → 화면 좌표가 **항등**이라, 드롭 판정도 바닥 데칼도 오버레이도 윤곽선도
 *   전부 "보드 픽셀 = 화면 픽셀"에 기대어 공짜로 맞았다.
 *
 * ★ **v1.24에서 그 성질을 의도적으로 버렸다** (사용자 결정: "원근 쿼터뷰"). 그 대가로
 *   네 곳이 실제 투영을 거쳐야 한다 — 공짜였던 것들의 청구서다:
 *
 *   | 무엇 | 예전 (직교 항등) | 지금 (원근) |
 *   |---|---|---|
 *   | 드롭 판정 | rect를 8등분하는 선형 매핑 | **광선 → 판 평면 교점**(`squareAt`) |
 *   | 오버레이 좌표 | 보드 픽셀 그대로 | **`toScreen`으로 투영** |
 *   | 윤곽선 두께 | 월드 고정 = 화면 고정 | **클립 공간에서 w로 보정**(outline.ts) |
 *   | 바닥 데칼 | 화면과 1:1 | 평면 텍스처라 **투영이 알아서** 한다(해상도만 올림) |
 *
 *   반대로 얻은 것: 판이 **두께를 가진 물건**으로 보이고(슬래브 옆면이 드러난다), 기물이
 *   옆모습을 내주며, 원근이 깊이를 만든다 — 캐주얼 3D의 전형적인 화면이다.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ★ **화면 흔들림은 `setViewOffset`으로 건다.** 프러스텀을 직접 밀던 예전 방식은 직교라서
 * 가능했다. 지금은 뷰 오프셋이 **투영 행렬 자체에 들어가므로**, `toScreen`·`squareAt`이
 * 흔들림을 자동으로 반영한다 — 오버레이가 좌표에 shake를 따로 더할 필요가 없어졌다.
 */

/**
 * 수직에서 기울인 각 — 22°(v1.23) → 40°(v1.24) → ★ **0°**(v1.25 · 사용자 조정).
 *
 * **0은 완전 탑다운이다** — 지면 기준 90°. 판이 사다리꼴로 눕지 않아 여덟 랭크가 모두 같은
 * 크기로 남고, 8랭크(스폰 구역)가 1랭크만큼 크게 보인다. 원근 자체는 살아 있어서(카메라가
 * 유한 거리에 있다) 높이가 있는 것은 여전히 가까울수록 커진다.
 *
 * ★★ **그런데 기물은 이 각도로 그려지지 않는다.** 지면을 세울수록 전황 파악은 좋아지지만
 * 기물은 정수리만 보이고, 회전체는 위에서 보면 전부 그냥 원이다. 이 장르의 관습은 그 둘을
 * **분리**하는 것이다(지면은 가파르게, 유닛은 낮은 각도로 렌더한 스프라이트를 세워 둔다).
 * 이 저장소는 실시간 3D라 스프라이트를 쓸 수 없으므로, 같은 결과를 **기물을 눕혀서** 만든다 —
 * `render3d/pieces.ts`의 `LEAN` 주석에 계산이 있다. 지면을 90°까지 세울 수 있는 것도 그
 * 보정이 있기 때문이다.
 */
export const TILT = THREE.MathUtils.degToRad(0);

/**
 * 시야각. **좁을수록(망원) 원근 왜곡이 약하다.** 28°는 "원근이 있다"가 읽히면서 가장자리
 * 칸이 사다리꼴로 심하게 일그러지지 않는 지점이다 — 보드 게임 화면은 칸이 칸으로 보여야 한다.
 */
const FOV_DEG = 28;

/* ⚠️ 프레이밍 여유(`FIT_MARGIN`)는 v1.36에서 **뷰가 소유한다**(coords.ts의 `BoardView.margin`).
   좁은 화면에서는 여백 1%가 곧 판 크기라 넓은 뷰와 같은 값을 쓸 수 없다. */

/** 프레이밍에 포함시킬 기물 높이 — 먼 랭크의 기물이 화면 위로 잘리지 않게 한다.
 *  ★ v1.25에서 세로 늘림(`STRETCH_Y`, pieces.ts)만큼 함께 키웠다. */
const FIT_PIECE_HEIGHT = 92;

/**
 * 키 라이트 세기 — **실측값이다.**
 *
 * PBR 시절 값(2.7)에서 툰 보정을 유도하면 `2.7 × NdotL / 램프최상단 ≈ 2.31`이 나오는데,
 * 그건 키 라이트만 놓고 본 근사다. 실제 화면에는 반구광과 림 라이트가 함께 얹히고, 그 둘도
 * 툰 램프의 계단에 걸리므로 **유도로는 끝까지 갈 수 없다.** 브라우저에서 판만 띄우고 픽셀을
 * 재서 `#F0D9B5`(240,217,181)에 맞춘 값이 아래 숫자다.
 *
 * ⚠️ 키 위치·림 세기·램프 단계 수 중 **하나라도 바꾸면 다시 재야 한다.** 유도식이 아니라
 * 측정값이라, 코드를 읽어서는 그 사실이 드러나지 않는다.
 */
const KEY_INTENSITY = 2.17;

/**
 * 판이 화면을 꽉 채우도록 **거리와 중심을 함께** 맞춘다.
 *
 * ★ **거리를 손으로 못박지 않는 이유**: 기울기(TILT)나 시야각을 조금만 건드려도 맞는 값이
 * 달라진다. 손 계산으로 두면 각도를 만질 때마다 판이 잘리거나 화면 한가운데 조그맣게 뜨고,
 * 그 사실은 브라우저를 띄워야만 드러난다.
 *
 * ★ **중심 정렬이 따로 필요한 이유**: 기울어진 평면은 **투영된 상의 중심이 평면 중심의
 * 투영과 다르다** — 먼 쪽 절반이 압축되기 때문이다. 그래서 `lookAt(0,0,0)`만으로는 판이
 * 화면 위쪽으로 쏠려 아래에 빈 띠가 남는다(실제로 첫 판본이 그랬다). 투영된 경계 상자의
 * 중심을 재서 **뷰 오프셋으로 되민다.**
 *
 * 원근에서 상의 크기는 거의 거리에 반비례하고 오프셋은 선형이라, 둘을 번갈아 보정하면
 * 몇 번 만에 수렴한다.
 *
 * @returns 화면 흔들림에 **더해질** 기준 뷰 오프셋(px).
 */
function fitCamera(camera: THREE.PerspectiveCamera, view: BoardView): { x: number; y: number } {
  const probes: THREE.Vector3[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      probes.push(new THREE.Vector3(sx * HALF_W, 0, sz * HALF_D));
      probes.push(new THREE.Vector3(sx * HALF_W, FIT_PIECE_HEIGHT, sz * HALF_D));
    }
  }
  // ★ 플레이어 킹은 판 **밖**에 서므로 프레이밍에 반드시 넣어야 한다 — 빼면 화면 오른쪽에서
  //   잘린다. 눕힘까지 정확히 계산하지 않고 늘린 높이를 상한으로 쓴다(눕히면 낮아지므로 안전).
  // ⚠️ 좁은 뷰에는 킹이 아예 없다(v1.36). 그래도 이 프로브를 남겨 두면 **없는 것을 담느라
  //    판이 작아진다** — 킹 자리를 뗀 이유가 통째로 사라진다.
  if (view.king) {
    const kr = playerKingRadius() * KING_SCALE;
    const kh = playerKingTop() * KING_SCALE * STRETCH_Y;
    for (const dx of [-kr, kr]) {
      for (const dz of [-kr, kr]) {
        probes.push(new THREE.Vector3(KING_WORLD.x + dx, 0, KING_WORLD.z + dz));
        probes.push(new THREE.Vector3(KING_WORLD.x + dx, kh, KING_WORLD.z + dz));
      }
    }
  }

  const v = new THREE.Vector3();
  let dist = 1200, ox = 0, oy = 0;

  for (let i = 0; i < 10; i++) {
    placeCamera(camera, dist);
    camera.setViewOffset(view.w, view.h, ox, oy, view.w, view.h);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of probes) {
      v.copy(p).project(camera);
      const sx = (v.x * 0.5 + 0.5) * view.w, sy = (-v.y * 0.5 + 0.5) * view.h;
      minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
    }
    // 뷰 오프셋을 +d 하면 화면이 보여 주는 창이 아래로 내려가 **내용은 위로** 올라간다.
    // 그래서 "중심이 화면 중앙보다 아래에 있다"면 오프셋을 그만큼 더한다.
    ox += (minX + maxX) / 2 - view.w / 2;
    oy += (minY + maxY) / 2 - view.h / 2;
    // ⚠️ **축마다 따로 재고 더 빡빡한 쪽을 따른다.** 뷰가 정사각이 아니게 되면서(VIEW_W는
    //    킹 자리만큼 넓다) 한 축만 보고 맞추면 다른 축이 넘친다. 지금 구성에서는 세로가
    //    binding이고, 그래서 가로를 넓힌 것이 **보드 크기를 한 픽셀도 줄이지 않는다.**
    const need = Math.max(
      ((maxX - minX) / 2) / (view.w / 2 * view.margin),
      ((maxY - minY) / 2) / (view.h / 2 * view.margin),
    );
    dist *= need;
  }
  placeCamera(camera, dist);
  // near/far를 실제 거리에서 유도한다 — 넉넉히 잡아 둔 상수는 깊이 버퍼 정밀도를 낭비하고,
  // 그 손해는 판 위에 눕힌 데칼처럼 얇게 겹친 면에서 z-fighting으로 나타난다.
  camera.near = dist * 0.35;
  camera.far = dist * 2.2;
  camera.setViewOffset(view.w, view.h, ox, oy, view.w, view.h);
  return { x: ox, y: oy };
}

/** +Z가 1랭크(플레이어 쪽)이므로 카메라는 그쪽 위에 선다. 수직에서 TILT만큼 눕혔다. */
function placeCamera(camera: THREE.PerspectiveCamera, dist: number): void {
  camera.position.set(0, dist * Math.cos(TILT), dist * Math.sin(TILT));
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
}

/**
 * 투영 — **원근이 되면서 새로 생긴 계약**이다 (v1.24).
 *
 * 직교 항등 시절에는 이 둘이 산수였다(`x + 320`). 이제는 카메라의 투영 행렬을 거쳐야 하고,
 * 그 행렬을 아는 곳은 이 모듈뿐이다. 그래서 **투영을 필요로 하는 모든 계층이 이 인터페이스
 * 하나만 본다** — 오버레이(체력바·숫자)는 `toScreen`을, 드롭 판정(ui/drag.ts)은 `squareAt`을.
 */
export interface Projector {
  /** 월드 좌표 → 캔버스 픽셀(0~640). 화면 흔들림이 이미 반영돼 있다. */
  toScreen(x: number, y: number, z: number): { x: number; y: number };
  /**
   * 캔버스 픽셀 → 그 아래 **판 평면(y=0)의 칸**. 판 밖을 가리키면 null.
   *
   * ★ 원근에서는 화면 사각형이 판의 사다리꼴에 대응하므로, **캔버스 안이라고 판 위인 것이
   * 아니다** — 네 귀퉁이는 판 밖이다. null이 그 경우를 말한다.
   */
  squareAt(x: number, y: number): Square | null;
  /**
   * 판이 화면에서 차지하는 사각형(뷰 px). **DOM 요소를 판에 맞춰 놓을 때 쓴다** — v1.30에서
   * 판매 영역이 "보드 오른쪽 스트립, 보드 전체 높이"가 되면서 그 자리를 아는 곳이 필요해졌다.
   *
   * ★ 원근에서 판은 사다리꼴이라 정확한 사각형이 아니다 — 네 귀를 투영한 **경계 상자**다.
   * DOM은 사각형밖에 못 놓으므로 그 이상은 필요하지도 않다.
   */
  boardScreenRect(): { left: number; top: number; right: number; bottom: number };
}

/**
 * 판이 화면에 꼭 들어오도록 맞춘 카메라. **WebGL 없이 만들어진다** — 투영은 순수한 행렬
 * 연산이라 렌더러가 필요 없고, 덕분에 역투영의 정확성(칸 → 화면 → 칸 왕복)을 브라우저 없이
 * 테스트할 수 있다. 원근 전환에서 가장 조용히 틀릴 수 있는 곳이 그 왕복이다.
 */
export function createBoardCamera(
  view: BoardView = WIDE_VIEW,
): { camera: THREE.PerspectiveCamera; baseOffset: { x: number; y: number } } {
  const camera = new THREE.PerspectiveCamera(FOV_DEG, view.w / view.h, 100, 4000);
  const baseOffset = fitCamera(camera, view);
  return { camera, baseOffset };
}

/**
 * 카메라 하나에 묶인 투영/역투영. 카메라의 **현재** 행렬을 읽으므로 화면 흔들림(뷰 오프셋)이
 * 자동으로 반영된다.
 */
export function createProjector(camera: THREE.Camera, view: BoardView = WIDE_VIEW): Projector {
  const vec = new THREE.Vector3();
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();

  return {
    toScreen(x, y, z) {
      vec.set(x, y, z).project(camera);
      return { x: (vec.x * 0.5 + 0.5) * view.w, y: (-vec.y * 0.5 + 0.5) * view.h };
    },
    boardScreenRect() {
      let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          vec.set(sx * HALF_W, 0, sz * HALF_D).project(camera);
          const x = (vec.x * 0.5 + 0.5) * view.w, y = (-vec.y * 0.5 + 0.5) * view.h;
          left = Math.min(left, x); right = Math.max(right, x);
          top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
      }
      return { left, top, right, bottom };
    },
    squareAt(px, py) {
      ndc.set((px / view.w) * 2 - 1, -((py / view.h) * 2 - 1));
      ray.setFromCamera(ndc, camera);
      if (!ray.ray.intersectPlane(groundPlane, hit)) return null;
      const bx = boardXFromWorld(hit.x), by = boardYFromWorld(hit.z);
      if (bx < 0 || bx >= BOARD_W || by < 0 || by >= BOARD_H) return null;
      return {
        file: Math.floor(bx / CONFIG.board.squarePx),
        rank: CONFIG.board.ranks - Math.floor(by / CONFIG.board.squarePx),
      };
    },
  };
}

export interface SceneKit extends Projector {
  /** 이 씬이 쓰는 뷰 (v1.36). 오버레이가 자기 좌표계를 여기서 읽는다 — 뷰를 별도 인자로
   *  또 넘기면 씬과 오버레이가 서로 다른 뷰를 볼 수 있는 여지가 생긴다. */
  view: BoardView;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  /** 바닥 데칼을 그릴 2D 컨텍스트. 다 그렸으면 `decalDirty()`를 불러 GPU에 올린다. */
  decalCtx: CanvasRenderingContext2D;
  decalDirty(): void;
  /** 화면 흔들림(보드 좌표 px). 뷰 오프셋으로 걸어 투영 행렬에 함께 실린다. */
  setShake(shake: { x: number; y: number }): void;
  draw(): void;
  dispose(): void;
}

/**
 * 데칼 텍스처 해상도 배율.
 *
 * ★ **원근이 되면서 3으로 올렸다** (v1.24). 직교 항등 시절에는 데칼이 화면에 1:1로 얹혀
 * 2배면 충분했지만, 원근에서는 **가까운 랭크가 확대돼** 같은 텍셀이 더 넓은 화면을 덮는다 —
 * 2배로 두면 1~2랭크의 하이라이트 경계가 눈에 띄게 뭉갠다. 업로드는 `decalSignature`가
 * 바뀔 때만 일어나므로(render/renderer.ts) 상시 비용이 아니다.
 */
const DECAL_SCALE = 3;

/** 판 텍스처 해상도 배율. 딱 한 번만 굽고 끝이므로 넉넉하게 준다. */
const BASE_SCALE = 3;

function bakedCanvas(scale: number, paint: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.round(BOARD_W * scale);
  c.height = Math.round(BOARD_H * scale);
  const ctx = c.getContext('2d')!;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  paint(ctx);
  return c;
}

export function createScene(canvas: HTMLCanvasElement, view: BoardView = WIDE_VIEW): SceneKit {
  // ★ `alpha: true` — 쿼터뷰에서는 판이 사다리꼴이라 캔버스 네 귀퉁이가 **비어 있다.**
  //   투명하게 두면 페이지 배경이 그대로 비쳐, 판이 배경 위에 놓인 물건처럼 보인다.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(pixelScale());
  // ★ 세 번째 인자가 false다 (v1.31): 인라인 style을 건드리지 않고 **백킹 스토어만** 맞춘다.
  //   표시 크기는 CSS가 소유한다 — 화면 높이에 맞춰 보드가 줄어들어야 하기 때문이다(render/dpr.ts).
  renderer.setSize(view.w, view.h, false);
  // ★ 윤곽선은 화면 픽셀 고정 두께라 **뷰 크기를 알아야 한다**(outline.ts). 재질이 모듈
  //   싱글턴이므로 여기서 한 번 맞춰 준다 — 뷰는 판마다 하나뿐이다.
  setOutlineResolution(view.w, view.h);
  // ★ **그림자 맵을 쓰지 않는다** (v1.25). 기물이 카메라 반대쪽으로 눕어 있어서(각도 불일치,
  //   pieces.ts) 실제 그림자를 켜면 **기울어진 그림자**가 찍혀 "서 있다"가 "넘어지고 있다"로
  //   읽힌다. 밑동에 원판 그림자를 따로 깐다(render3d/blob.ts) — 렌더 패스도 하나 줄어든다.

  const scene = new THREE.Scene();
  const { camera, baseOffset } = createBoardCamera(view);

  // ── 조명 ───────────────────────────────────────────────────────────────────
  // ★ **조명이 곧 입체감이다.** 키 라이트를 한쪽으로 크게 치우쳐 세운다 — 정면에서 비추면
  //   회전체 전부가 평평한 원반으로 읽힌다. (v1.23까지는 카메라가 거의 수직이라 윗면 명암이
  //   판독의 전부였다. 쿼터뷰가 된 지금은 옆면도 보이지만, 치우친 광원의 값은 그대로다.)
  //
  // ⚠️ **세기와 색은 눈대중으로 정하면 안 된다.** 판 윗면은 조명을 받는 면인 동시에 색이
  //   이미 정해져 있는 텍스처다(#F0D9B5 / #B58863) — 조명이 그 색을 **그대로 재현**해야
  //   2D 시절에 맞춰 둔 대비(밝은 칸 위의 흰 기물, 어두운 칸 위의 검은 적)가 유지된다.
  //   자세한 것은 KEY_INTENSITY 주석에.
  scene.add(new THREE.HemisphereLight(0xDCE6F2, 0x6B5540, 1.0));
  const key = new THREE.DirectionalLight(0xFFFFFF, KEY_INTENSITY);
  // ★ z가 **음수**인 것이 중요하다. 광원을 8랭크 쪽(화면 위)에 두어야 그림자가 플레이어
  //   쪽(화면 아래)으로 떨어진다 — 위에서 내려다보는 화면에서 그림자가 위로 뻗으면 기물이
  //   서 있는 게 아니라 매달린 것처럼 읽힌다.
  // 그림자를 드리우지는 않지만(위 ★) 이 방향이 여전히 화면의 명암을 정한다 —
  // 블롭 그림자의 오프셋도 이 방향에서 유도한다(render3d/blob.ts의 BLOB_OFFSET).
  key.position.set(-300, 700, -320);
  scene.add(key);
  scene.add(key.target);            // target을 씬에 넣어야 matrixWorld가 갱신된다 (기본 위치 = 원점)

  // ★ **림 라이트** (v1.23) — 키 라이트 반대편에서 약하게 비춘다. 툰 램프에서는 이 한 줄이
  //   실루엣 가장자리에 **한 단 밝은 띠**를 만든다. 캐주얼 아트가 물체를 배경에서 떼어내는
  //   전형적인 수단이다. 그림자는 드리우지 않는다: 두 방향에서 그림자가 지면 발밑이 지저분해진다.
  //
  // ⚠️ **낮게 깔아야 림 라이트다.** 처음에는 (420, 220, 380)이었는데, 그 각도는 판 윗면과의
  //   내적이 0.36이라 3단 램프의 **최상단**에 얹혀 판 전체를 통째로 한 단 밝혔다 — 실루엣을
  //   훑는 대신 두 번째 키 라이트가 된 셈이다.
  const rim = new THREE.DirectionalLight(0xBFD4FF, 0.6);
  rim.position.set(470, 110, 430);
  scene.add(rim);
  scene.add(rim.target);

  // ── 판(슬래브) ─────────────────────────────────────────────────────────────
  // 윗면만 체커 텍스처, 나머지 다섯 면은 어두운 나무색. BoxGeometry의 재질 순서는
  // [+X, −X, +Y, −Y, +Z, −Z]이므로 인덱스 2가 윗면이다.
  //
  // ★ **쿼터뷰가 되면서 옆면이 실제로 보인다** (v1.24). v1.23까지는 카메라가 거의 수직이라
  //   두께가 화면에 나타나지 않아 20이면 충분했지만, 지금은 판의 앞면이 드러나므로 두께가
  //   곧 "판이 물건이다"라는 인상을 만든다 — coords.ts에서 34로 올렸다.
  const baseTex = new THREE.CanvasTexture(bakedCanvas(BASE_SCALE, drawBoardBase));
  baseTex.colorSpace = THREE.SRGBColorSpace;
  baseTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const slabTop = new THREE.MeshToonMaterial({ map: baseTex, gradientMap: toonGradient() });
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(BOARD_W, SLAB_THICKNESS, BOARD_H),
    [SLAB_SIDE, SLAB_SIDE, slabTop, SLAB_SIDE, SLAB_SIDE, SLAB_SIDE],
  );
  slab.position.y = -SLAB_THICKNESS / 2;     // 윗면이 정확히 y = 0
  scene.add(slab);

  // ── 데칼 평면 ──────────────────────────────────────────────────────────────
  // 하이라이트·감속 오라·합성 미리보기. **조명을 받지 않는다**(MeshBasicMaterial) — 이것들은
  // 물체가 아니라 UI라서, 기물 그림자에 따라 색이 변하면 "저 칸은 왜 더 어둡지?"가 된다.
  const decalCanvas = bakedCanvas(DECAL_SCALE, () => {});
  const decalTex = new THREE.CanvasTexture(decalCanvas);
  decalTex.colorSpace = THREE.SRGBColorSpace;
  decalTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const decal = new THREE.Mesh(
    new THREE.PlaneGeometry(BOARD_W, BOARD_H),
    new THREE.MeshBasicMaterial({ map: decalTex, transparent: true, depthWrite: false }),
  );
  decal.rotation.x = -Math.PI / 2;
  decal.position.y = DECAL_Y;
  scene.add(decal);

  // 화면 밀도가 바뀌면(모니터 이동·브라우저 확대) 백킹 스토어를 다시 맞춘다 — 2D 캔버스
  // 시절 render/dpr.ts가 하던 일을 WebGL 렌더러에 그대로 잇는다.
  const offPixelScale = onPixelScaleChange(() => {
    renderer.setPixelRatio(pixelScale());
    renderer.setSize(view.w, view.h, false);
  });

  const projector = createProjector(camera, view);
  let shakeX = 0, shakeY = 0;

  return {
    view, scene, camera, renderer,
    toScreen: projector.toScreen,
    squareAt: projector.squareAt,
    boardScreenRect: projector.boardScreenRect,
    decalCtx: decalCanvas.getContext('2d')!,
    decalDirty: () => { decalTex.needsUpdate = true; },

    setShake(shake) {
      if (shake.x === shakeX && shake.y === shakeY) return;
      shakeX = shake.x; shakeY = shake.y;
      // ★ **뷰 오프셋으로 건다.** 카메라 위치를 흔들면 기울기 각이 미세하게 떨려 판 전체가
      //   출렁인다. 뷰 오프셋은 상을 **정확히 픽셀 단위로만** 옮기고, 무엇보다 **투영 행렬
      //   안에 들어가므로** toScreen·squareAt이 흔들림을 저절로 반영한다 — 오버레이가
      //   좌표에 shake를 따로 더하던 v1.23까지의 처리가 통째로 사라진 이유다.
      //   부호가 음인 것은 프레임을 왼쪽으로 밀면 내용이 오른쪽으로 가기 때문이다.
      //   ⚠️ 기준 오프셋(프레이밍 중심 정렬)에 **더한다** — 덮어쓰면 흔들릴 때마다 판이
      //   원래 자리에서 튀어 오른다.
      camera.setViewOffset(
        view.w, view.h, baseOffset.x - shakeX, baseOffset.y - shakeY, view.w, view.h,
      );
    },

    draw() { renderer.render(scene, camera); },
    dispose() {
      offPixelScale();
      baseTex.dispose(); decalTex.dispose();
      slab.geometry.dispose(); decal.geometry.dispose();
      (decal.material as THREE.Material).dispose();
      slabTop.dispose();
      renderer.dispose();
    },
  };
}
