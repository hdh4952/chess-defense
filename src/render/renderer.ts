import { CONFIG } from '../config';
import { BOARD_H, BOARD_W, fileCenterX, rankToTopY, squareKey } from '../core/grid';
import { slowFieldSquares } from '../core/slow';
import { SLOW_HALO, SLOW_INK, SLOW_RGB } from './palette';
import { tierRingColor } from './tiers';
import type { GameState, Square } from '../types';

/**
 * 보드 바닥 계층 (v1.21 — Three.js 전면 도입으로 역할이 좁아졌다).
 *
 * ★ **이 파일은 더 이상 기물과 적을 그리지 않는다.** 그 둘은 이제 실제 3D 메시다
 * (`render3d/pieces.ts` · `render3d/enemies.ts`). 여기 남은 것은 **판에 깔리는 것들**뿐이다:
 * 체커 무늬 · 스폰 구역 · 감속 오라 · 하이라이트 · 퀸 라인 · 합성 미리보기.
 *
 * ★ **왜 3D인데 아직 2D 캔버스로 그리는가.** 이것들은 전부 바닥에 붙는 **데칼**이고, 데칼은
 * 3D에서도 텍스처가 정답이다. 그리고 이 저장소에는 그 데칼의 색·알파·형태가 오랜 조정을
 * 거쳐 굳어 있다(꺾쇠 팔 길이, 티어별 알파, 스폰 구역 이중 표식…). 그것을 메시로 옮기면
 * 조정 결과가 통째로 날아가고, 얻는 것은 없다 — 바닥 데칼은 어차피 평면이다.
 *
 * ★ **그리고 이 계층은 화면과 픽셀 단위로 일치한다.** 카메라가 직교 투영이고 프러스텀이
 * 보드에 정확히 맞춰져 있어(render3d/scene.ts) 판 높이(y≈0)의 점은 보드 좌표 그대로 화면
 * 좌표가 된다 — 즉 여기 그린 640×640은 화면의 640×640에 1:1로 얹힌다. 기울어진 카메라인데도
 * 데칼이 일그러지지 않는 이유이고, 아래 코드가 한 줄도 바뀌지 않아도 되는 이유다.
 *
 * 두 함수로 나뉘어 있고, 그 경계는 **얼마나 자주 바뀌는가**다:
 *   - `drawBoardBase` — 판 그 자체. 한 번 굽고 끝(정적 텍스처).
 *   - `drawDecals`    — 상태에 따라 바뀌는 것. `decalSignature`가 달라질 때만 다시 굽는다.
 */

const SQ = CONFIG.board.squarePx;
// 8랭크/7랭크 경계선 두께 — 표현(presentation) 값이라 config.ts가 아닌 여기에 둔다. export하는
// 이유는 테스트가 이 두께를 리터럴로 못박아, "경계선이 두께 0으로 그려져도 통과하는" 결함
// (재검토 Important 1)을 재발 방지하기 위함이다.
export const SPAWN_BORDER_PX = 4;

export interface ViewState {
  highlights: { square: Square; color: string }[];
  lines: { from: Square; to: Square; color: string }[];
  shake: { x: number; y: number };
  /** 합성 미리보기 — 드래그 중인 기물을 지금 놓으면 나올 결과. null이면 합성 대상 위가 아니다.
   *  highlights와 달리 "한 칸에 하나"뿐이라 배열이 아니다 (드롭 지점은 언제나 한 곳). */
  mergePreview: { square: Square; tier: number } | null;
}
export const EMPTY_VIEW: ViewState = {
  highlights: [], lines: [], shake: { x: 0, y: 0 }, mergePreview: null,
};
// 공유 싱글턴 보호: 과거 main.ts가 `{ ...EMPTY_VIEW, highlights: [] }`로 highlights만 새로
// 할당하고 lines/shake는 이 상수를 참조 공유한 채로 남겨둔 버그가 있었다 (Task 17 리뷰에서 발견).
// freeze로 향후 실수로 EMPTY_VIEW.lines.push(...) 등을 호출하면 개발 중 즉시 TypeError로 드러난다.
Object.freeze(EMPTY_VIEW.highlights);
Object.freeze(EMPTY_VIEW.lines);
Object.freeze(EMPTY_VIEW.shake);
Object.freeze(EMPTY_VIEW);

/** 매 프레임 새로 만드는 ViewState. 세 필드 모두 새 배열/객체 — EMPTY_VIEW와 참조를 공유하지
 * 않으므로 Task 18(하이라이트/툴팁)·19(공격 이펙트/화면 흔들림)가 안전하게 push/대입할 수 있다. */
export function createFrameView(): ViewState {
  return { highlights: [], lines: [], shake: { x: 0, y: 0 }, mergePreview: null };
}

/**
 * ★ 타일 사이 홈(grout)과 안쪽 베벨 — 스타일라이즈드 전환의 일부 (v1.23).
 *
 * 사용자 결정: **보드도 툰으로 같이 간다.** 그런데 판은 회전체가 아니라 위를 향한 평면이라
 * 법선이 어디서나 같고, 그래서 **툰 램프가 판 위에서는 아무 일도 하지 않는다** — 재질만
 * 갈아서는 판이 하나도 안 바뀐다. 판의 스타일은 셰이딩이 아니라 **텍스처가 만들어야 한다.**
 *
 * 그래서 칸마다 홈을 파고 안쪽에 베벨을 넣는다. 카메라가 거의 수직이고 판 높이의 좌표가
 * 화면 좌표와 항등이므로(render3d/scene.ts), 여기 그린 베벨은 **그린 그대로** 화면에 나온다 —
 * 지오메트리로 64칸을 깎는 것과 같은 그림을 얻으면서 정점은 하나도 늘지 않는다.
 *
 * ⚠️ **드롭 판정에는 영향이 없다.** 홈은 그림일 뿐이고 `pickDropTarget`은 여전히 칸을 8등분한
 * 기하로만 판정한다 — 홈 위를 눌러도 그 칸에 놓인다.
 */
export const TILE_GAP = 2;      // 칸 경계에서 안쪽으로 파는 홈
export const TILE_BEVEL = 3;    // 타일 안쪽 모서리의 명암 띠
/** 실제로 칠해지는 타일 몸체 한 변 — 칸(SQ)이 아니다. */
export const TILE_PX = CONFIG.board.squarePx - TILE_GAP * 2;

const COLOR = {
  // react-chessboard의 기본 보드 색(customLightSquareStyle / customDarkSquareStyle)과 동일한
  // 값. 리체스·chess.com에서 쓰는 고전적인 나무 톤이라, 흑백 체스 기물이 양쪽 칸 모두에서
  // 또렷하게 읽힌다 — 스펙 8.1이 요구한 진영 구분(아군 화이트 / 적 블랙)의 전제가 된다.
  //
  // ★ **v1.23 툰 전환에서도 이 두 값은 그대로 두었다** (사용자 결정: "진영 구분은
  // 화이트/블랙 그대로"). 베벨용 명/암은 이 색에서 파생된 것이지 새 팔레트가 아니다 —
  // 판의 정체성은 유지하고 **형태만** 스타일라이즈한다.
  light: '#F0D9B5', dark: '#B58863',
  lightHi: '#FCEBCE', lightLo: '#D6BC95',
  darkHi: '#CFA079', darkLo: '#98704F',
  /** 타일 사이 홈. 슬래브 옆면(materials.ts의 SLAB_SIDE)과 같은 나무색이라 판이 한 덩어리로 읽힌다. */
  grout: '#6B4A32',
  // 8랭크(배치 금지 스폰 구역, 스펙 2.1) 표식. 예전 값(옅은 붉은 틴트 rgba(200,60,50,0.10))은
  // 중립 회색 보드에서는 색상(hue) 변화로 도드라졌지만, 지금의 따뜻한 나무색 보드 위에서는
  // 대비비(luminance contrast)가 거의 그대로인데도 육안으로는 인접 랭크와 구분이 안 된다 —
  // 붉은 기 위에 다시 붉은 기를 얹는 것이라 손실이 색상에서만 났기 때문. 색조가 아니라
  // 명도(어둡게)로 대비를 만들고, 랭크 7 경계에 불투명한 경계선을 더해 이중으로 표식한다.
  spawnOverlay: 'rgba(0, 0, 0, 0.14)',
  spawnBorder: '#C83C32',              // 예전 spawnTint와 같은 RGB(200,60,50)를 불투명 경계선으로 재사용
};

/** 꺾쇠 팔 길이. 칸 전체를 두르지 않는 이유는 잉크 총량이다 — L자 8칸은 서로 변으로 맞닿지
 *  않아 테두리가 하나로 병합되지 않으므로, 나이트 한 기만으로도 독립 사각형 8개가 생긴다.
 *  모서리만 남기면 칸당 선 길이가 320px → 112px로 줄면서 "여기가 경계다"는 인지는 유지된다. */
const SLOW_ARM = 14;

/**
 * 판 그 자체 — 체커 무늬 + 스폰 구역. **상태에 의존하지 않으므로 딱 한 번만 굽는다.**
 * (render3d/scene.ts가 보드 슬래브의 윗면 텍스처로 쓴다.)
 */
export function drawBoardBase(ctx: CanvasRenderingContext2D): void {
  // 홈을 먼저 바닥에 깔고 그 위에 타일을 얹는다 — 칸마다 네 변의 홈을 따로 그리는 것보다
  // 싸고, 인접 타일의 홈이 이중으로 그려지는 일도 없다.
  ctx.fillStyle = COLOR.grout;
  ctx.fillRect(0, 0, BOARD_W, BOARD_H);

  for (let rank = CONFIG.board.ranks; rank >= 1; rank--) {
    const row = CONFIG.board.ranks - rank;         // grid.ts의 rankToTopY와 동일한 매핑을 재사용
    const y = rankToTopY(rank);
    for (let col = 0; col < CONFIG.board.files; col++) {
      const isLight = (row + col) % 2 === 0;
      const x = col * SQ + TILE_GAP, ty = y + TILE_GAP;
      ctx.fillStyle = isLight ? COLOR.light : COLOR.dark;
      ctx.fillRect(x, ty, TILE_PX, TILE_PX);
      // 왼쪽 위가 밝고 오른쪽 아래가 어둡다 — 키 라이트가 화면 왼쪽 위에서 온다는
      // 3D 씬의 설정과 같은 방향이어야 판과 기물이 같은 빛을 받는 것으로 읽힌다.
      ctx.fillStyle = isLight ? COLOR.lightHi : COLOR.darkHi;
      ctx.fillRect(x, ty, TILE_PX, TILE_BEVEL);
      ctx.fillRect(x, ty, TILE_BEVEL, TILE_PX);
      ctx.fillStyle = isLight ? COLOR.lightLo : COLOR.darkLo;
      ctx.fillRect(x, ty + TILE_PX - TILE_BEVEL, TILE_PX, TILE_BEVEL);
      ctx.fillRect(x + TILE_PX - TILE_BEVEL, ty, TILE_BEVEL, TILE_PX);
    }
  }
  // 8랭크(배치 불가 스폰 구역, 스펙 2.1) — 명도 오버레이 + 랭크 7 경계의 불투명 경계선으로
  // 이중 표식한다(위 COLOR.spawnOverlay/spawnBorder 주석 참조). 경계선은 SQ px인 8랭크 칸의
  // 하단, 즉 7랭크와 맞닿는 안쪽 가장자리에 그려 7랭크 쪽을 침범하지 않는다.
  ctx.fillStyle = COLOR.spawnOverlay;
  ctx.fillRect(0, 0, BOARD_W, SQ);
  ctx.fillStyle = COLOR.spawnBorder;
  ctx.fillRect(0, SQ - SPAWN_BORDER_PX, BOARD_W, SPAWN_BORDER_PX);
}

/**
 * 칸의 감속 세기를 알파로 — T1 0.30에서 티어마다 조금씩 진해진다 (v1.13).
 *
 * 백분율에 비례시키지 않고 완만하게 올리는 이유: T1 30% → T6 55%는 1.83배인데 알파를 그대로
 * 1.83배 하면(0.30 → 0.55) 상시로 깔리는 배경이 사거리 하이라이트를 이긴다. 세기 차이가
 * **읽히기만** 하면 되고 정확한 값은 진입 라벨("−40%")이 말한다.
 */
function slowFieldAlpha(tier: number): number {
  return 0.30 + 0.03 * (tier - 1);
}

/**
 * 감속 오라가 덮는 칸 — 얼음색 채움 + 네 모서리 꺾쇠 (v1.10).
 *
 * ★ **칸당 정확히 한 번만 그린다.** 그 보장은 core/slow.ts의 slowFieldSquares가 칸마다
 * **최댓값 티어 하나**만 담아 돌려주는 데서 나온다 — 나이트 셋이 같은 칸을 덮어도 원소가
 * 하나라 알파가 겹쳐 쌓일 수가 없다. 겹쳐 칠하면 화면이 "저기는 더 느리다"고 말하는데 규칙은
 * 최댓값 하나뿐이라, 그 순간 연출이 거짓말이 된다. **중첩 금지가 코드가 아니라 자료구조로
 * 보장되는 지점이 여기다.**
 */
function drawSlowField(ctx: CanvasRenderingContext2D, field: { square: Square; tier: number }[]): void {
  if (field.length === 0) return;
  ctx.save();
  for (const { square: sq, tier } of field) {
    const x = sq.file * SQ, y = rankToTopY(sq.rank);
    ctx.fillStyle = `rgba(${SLOW_RGB}, ${slowFieldAlpha(tier)})`;
    ctx.fillRect(x, y, SQ, SQ);
  }
  // 선은 채움을 전부 끝낸 뒤 한 번에 긋는다 — 인접 칸의 채움이 앞 칸의 꺾쇠를 덮지 않는다.
  ctx.lineCap = 'round';
  for (const { square: sq } of field) {
    const x = sq.file * SQ + 1.5, y = rankToTopY(sq.rank) + 1.5;
    const w = SQ - 3;
    for (const pass of [SLOW_HALO, SLOW_INK]) {
      ctx.strokeStyle = pass;
      ctx.lineWidth = pass === SLOW_HALO ? 3.5 : 2;
      ctx.beginPath();
      for (const [cx, cy, dx, dy] of [
        [x, y, 1, 1], [x + w, y, -1, 1], [x, y + w, 1, -1], [x + w, y + w, -1, -1],
      ] as const) {
        ctx.moveTo(cx + dx * SLOW_ARM, cy);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx, cy + dy * SLOW_ARM);
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * 합성 미리보기 — 드래그 중인 기물을 지금 놓으면 나올 결과를 그 칸 위에 미리 보여준다.
 * 결과 티어의 링을 점선으로 그리고 단계를 숫자로 적는다("T3"). 놓기 전에 결과를 보여주는 것이
 * 이 기능의 유일한 사전 안전장치다 — 합성은 비가역이고 복구 수단은 판매(50% 손실)뿐이다.
 *
 * ★ 3D로 옮기지 않고 데칼로 남긴 이유: 이것은 **칸에 붙는 표식**이지 공중에 뜨는 물체가
 * 아니다. 그리고 기물 메시가 그 위에 서므로, 데칼로 두면 기물이 링을 자연스럽게 가린다 —
 * "이 기물 아래에 무엇이 예고돼 있다"가 깊이로 읽힌다.
 */
function drawMergePreview(
  ctx: CanvasRenderingContext2D, preview: { square: Square; tier: number },
): void {
  const x = fileCenterX(preview.square.file);
  const y = rankToTopY(preview.square.rank) + SQ / 2;
  const color = tierRingColor(preview.tier) ?? '#FFFFFF';
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, SQ / 2 - 6, 0, Math.PI * 2);
  ctx.setLineDash([6, 5]);
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(20,16,22,0.55)';
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.setLineDash([]);
  const label = `T${preview.tier}`;
  ctx.font = 'bold 15px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(20,16,22,0.75)';
  ctx.strokeText(label, x, y + SQ / 2 - 10);
  ctx.fillStyle = color;
  ctx.fillText(label, x, y + SQ / 2 - 10);
  ctx.restore();
}

/**
 * 상태에 따라 바뀌는 바닥 표식 전부. **투명 배경에 그린다** — 판(drawBoardBase)은 그 아래
 * 슬래브 텍스처로 따로 있고, 이 계층은 그 위에 얹히는 데칼이다.
 *
 * 순서가 규칙이다: 감속 오라(상시 배경)가 먼저, 하이라이트(일시적)가 그 위. 반대로 두면
 * 사거리 미리보기가 오라에 묻힌다.
 */
export function drawDecals(
  ctx: CanvasRenderingContext2D, state: GameState, view: ViewState = EMPTY_VIEW,
): void {
  ctx.clearRect(0, 0, BOARD_W, BOARD_H);
  drawSlowField(ctx, slowFieldSquares(state));
  for (const h of view.highlights) {
    ctx.fillStyle = h.color;
    ctx.fillRect(h.square.file * SQ, rankToTopY(h.square.rank), SQ, SQ);
  }
  for (const l of view.lines) {
    ctx.strokeStyle = l.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(fileCenterX(l.from.file), rankToTopY(l.from.rank) + SQ / 2);
    ctx.lineTo(fileCenterX(l.to.file), rankToTopY(l.to.rank) + SQ / 2);
    ctx.stroke();
  }
  if (view.mergePreview) drawMergePreview(ctx, view.mergePreview);
}

/**
 * 데칼 텍스처를 다시 구워야 하는가를 판단하는 서명 (v1.21).
 *
 * ★ **매 프레임 GPU에 텍스처를 올리지 않기 위한 것이다.** 640×640 텍스처 업로드는 배율 2에서
 * 프레임당 6.5MB이고, 60fps면 초당 400MB다 — 그런데 이 계층의 내용은 **적이 움직여도 바뀌지
 * 않는다.** 감속 오라는 기물 배치에서만, 하이라이트는 상호작용에서만 바뀐다. 그래서 서명이
 * 같으면 다시 굽지도, 올리지도 않는다.
 *
 * 서명에 적(enemies)이 들어가지 않는 것이 요점이자 이 최적화가 성립하는 이유다 — 이 계층이
 * 적을 그리지 않으므로 적이 아무리 움직여도 그림은 같다.
 */
export function decalSignature(state: GameState, view: ViewState): string {
  const slow = slowFieldSquares(state).map(f => `${squareKey(f.square)}:${f.tier}`).join('|');
  const hl = view.highlights.map(h => `${squareKey(h.square)}${h.color}`).join('|');
  const ln = view.lines.map(l => `${squareKey(l.from)}>${squareKey(l.to)}${l.color}`).join('|');
  const mp = view.mergePreview ? `${squareKey(view.mergePreview.square)}:${view.mergePreview.tier}` : '';
  return `${slow}#${hl}#${ln}#${mp}`;
}
