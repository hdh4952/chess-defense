import { CONFIG } from '../config';
import { BOARD_H, BOARD_W, fileCenterX, rankToTopY } from '../core/grid';
import type { Square } from '../types';

/**
 * 보드 픽셀 좌표 ↔ 3D 월드 좌표 (v1.21 — Three.js 전면 도입).
 *
 * **월드 단위는 보드 픽셀과 1:1이다.** 배율을 두고 싶은 유혹이 있지만(예: 칸 = 1.0), 그러면
 * 기물 크기·이펙트 반경·조명 감쇠·그림자 카메라 범위가 전부 두 좌표계 사이에서 환산돼야 하고,
 * 그 환산을 한 곳이라도 빠뜨리면 "기물만 거대한" 같은 결함이 난다. 이 게임의 보드는 640px로
 * 고정이라 큰 수를 그대로 써도 부동소수 정밀도에 아무 문제가 없다.
 *
 * 축 대응:
 *   보드 x (0 → 640, a파일 → h파일)   →  월드 +X
 *   보드 y (0 → 640, 8랭크 → 1랭크)   →  월드 +Z
 *   높이(보드 위로 솟는 방향)           →  월드 +Y
 *
 * 원점은 **보드 중앙**이다(월드 x,z ∈ [−320, 320]). 카메라·조명·그림자 프러스텀이 전부
 * 중앙 대칭이라, 원점을 구석에 두면 그 셋의 상수마다 320을 더하는 항이 붙는다.
 */

export const HALF_W = BOARD_W / 2;
export const HALF_D = BOARD_H / 2;

/**
 * ★ **화면(뷰)은 보드보다 넓다** (v1.28).
 *
 * v1.27까지 캔버스는 정확히 640×640이었고, 그 전제가 여러 곳에 박혀 있었다(드롭 판정 정규화 ·
 * 오버레이 지우기 · 보스 비네트 · 카메라 프레이밍). 원근이 되면서 이미 "캔버스 = 보드"는
 * 거짓이었지만(보드가 화면 일부만 차지한다) 크기만은 같아서 티가 나지 않았다.
 *
 * **플레이어 킹을 보드 바깥에 세우면서 그 전제를 명시적으로 깬다.** 캔버스를 넓히지 않고
 * 킹을 넣으면 카메라가 킹까지 담느라 **보드가 20% 작아진다** — 8×8 칸에 기물을 끌어다 놓는
 * 게임에서 그건 순손실이다. 가로만 140px 늘리면 세로가 프레이밍을 결정하므로 **보드 크기는
 * 한 픽셀도 줄지 않고** 오른쪽에 킹이 설 자리만 생긴다.
 */
export const VIEW_W = BOARD_W + 180;
export const VIEW_H = BOARD_H;

/**
 * 플레이어 킹이 서는 자리 — 보드 **바깥 우측 하단**(사용자 결정: "킹 = 플레이어").
 *
 * ⚠️ **z를 보드 안쪽으로 충분히 당겨야 한다.** 처음에는 1랭크 옆(z = HALF_D − 34)에 뒀는데,
 * 원근에서 **높이는 화면을 중심 바깥으로 밀어낸다** — 킹은 크고 높아서(KING_SCALE) 그
 * 밀림이 세로 방향에도 실렸고, 프레이밍이 세로를 그만큼 넓히면서 **보드가 28% 작아졌다.**
 * 8×8 칸에 기물을 끌어다 놓는 게임에서 그건 순손실이다.
 *
 * 지금 값은 킹의 세로 범위(높이 밀림 포함)가 보드의 세로 범위 안에 들어오는 자리다. 그러면
 * 프레이밍의 세로는 **보드가 결정**하고(그리고 그건 킹이 없을 때와 같다), 킹은 가로로만
 * 자리를 요구한다 — 그 몫은 `VIEW_W`를 넓혀 낸다. **보드 크기는 한 픽셀도 줄지 않는다.**
 *
 * 그래도 판의 우측 하단이다: 적이 넘어오는 아래쪽 절반에 서 있어야 "저것이 뚫리면 저 킹이
 * 맞는다"가 위치로 읽힌다.
 */
export const KING_WORLD = { x: HALF_W + 62, z: 170 };

/** 판 위 기물보다 크게 세운다 — "이건 말이 아니라 나다"가 크기로 먼저 읽힌다.
 *  카메라 프레이밍(render3d/scene.ts)과 메시 생성(playerKing.ts)이 함께 본다. */
export const KING_SCALE = 1.15;
const SQ = CONFIG.board.squarePx;

/**
 * 보드 슬래브(판) 두께. 기물이 서는 면은 y = 0이고, 슬래브는 그 아래로 파고든다 —
 * 이렇게 두면 기물·이펙트의 높이가 전부 "판 위 몇 px"이라는 한 가지 뜻만 갖는다.
 *
 * ★ **v1.24에서 20 → 34로 올렸다.** 직교 탑다운에서는 옆면이 화면에 아예 나타나지 않아
 * 두께가 보이지 않는 값이었지만, 원근 쿼터뷰에서는 판의 앞면이 드러난다 — 그 두께가 곧
 * "판이 그림이 아니라 물건이다"라는 인상을 만든다.
 */
export const SLAB_THICKNESS = 34;

/** 데칼(하이라이트·감속 오라) 평면이 뜨는 높이. 판과 z-fighting하지 않을 만큼만 띄운다. */
export const DECAL_Y = 0.35;

export function worldX(boardX: number): number { return boardX - HALF_W; }
export function worldZ(boardY: number): number { return boardY - HALF_D; }

/** 월드 → 보드 픽셀 (오버레이가 3D 위치를 2D 좌표로 되돌릴 때 쓴다). */
export function boardXFromWorld(x: number): number { return x + HALF_W; }
export function boardYFromWorld(z: number): number { return z + HALF_D; }

/** 칸 중심의 월드 좌표 (y는 판 위 0). */
export function squareWorld(sq: Square): { x: number; z: number } {
  return { x: worldX(fileCenterX(sq.file)), z: worldZ(rankToTopY(sq.rank) + SQ / 2) };
}

/**
 * 적의 월드 좌표. 적은 칸 사이를 연속으로 움직이므로 rank가 아니라 픽셀 y를 그대로 쓴다.
 * jitterX는 렌더 전용 흔들림이라 여기서 함께 반영한다(스펙 7.8).
 */
export function enemyWorld(e: { file: number; y: number; jitterX: number }): { x: number; z: number } {
  return { x: worldX(fileCenterX(e.file) + e.jitterX), z: worldZ(e.y) };
}
