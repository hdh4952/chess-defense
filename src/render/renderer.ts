import { CONFIG } from '../config';
import { BOARD_H, BOARD_W, fileCenterX, rankToTopY } from '../core/grid';
import { ALLY_SPRITE_PX, getAllySprite, getEnemySprite } from './sprites';
import { tierRingColor } from './tiers';
import type { Enemy, GameState, Piece, PieceType, Square } from '../types';

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

// 글리프 폴백 테이블. 이전에는 DOM 레이어(ui/drag.ts, ui/layout.ts, ui/slots.ts)가 텍스트
// 글리프를 직접 그리느라 이 모듈에서 가져다 썼지만, 지금은 DOM이 전부 <img>(ALLY_SPRITE_URL,
// sprites.ts)로 그린다 — 이 상수는 캔버스 글리프 폴백(drawGlyph) 내부용으로만 남아 export를
// 걷어냈다(재검토 Item 7).
const ALLY_GLYPH: Record<PieceType, string> = {
  pawn: '♟', knight: '♞', bishop: '♝', rook: '♜', queen: '♛',
};

const COLOR = {
  // react-chessboard의 기본 보드 색(customLightSquareStyle / customDarkSquareStyle)과 동일한
  // 값. 리체스·chess.com에서 쓰는 고전적인 나무 톤이라, 흑백 체스 기물이 양쪽 칸 모두에서
  // 또렷하게 읽힌다 — 스펙 8.1이 요구한 진영 구분(아군 화이트 / 적 블랙)의 전제가 된다.
  light: '#F0D9B5', dark: '#B58863',
  // 8랭크(배치 금지 스폰 구역, 스펙 2.1) 표식. 예전 값(옅은 붉은 틴트 rgba(200,60,50,0.10))은
  // 중립 회색 보드에서는 색상(hue) 변화로 도드라졌지만, 지금의 따뜻한 나무색 보드 위에서는
  // 대비비(luminance contrast)가 거의 그대로인데도(측정상 old/new 차이 미미) 육안으로는 인접
  // 랭크와 구분이 안 된다 — 붉은 기 위에 다시 붉은 기를 얹는 것이라 손실이 색상에서만 났기
  // 때문. 색조가 아니라 명도(어둡게)로 대비를 만들고, 랭크 7 경계에 불투명한 경계선을 더해
  // 이중으로 표식한다 — 재검토 스크린샷으로 두 랭크가 뚜렷이 갈리고 그 위 적(순검정)도 여전히
  // 또렷이 읽히는 것을 확인했다(SVG-report.md 참조).
  spawnOverlay: 'rgba(0, 0, 0, 0.14)',
  spawnBorder: '#C83C32',              // 예전 spawnTint와 같은 RGB(200,60,50)를 불투명 경계선으로 재사용
  // 글리프 폴백 전용 색 (스프라이트가 아직 로드되지 않았거나 브라우저가 아닌 환경). 바닥 그림자
  // 색은 그림자 자체를 없애면서 함께 제거했다.
  allyFill: '#ffffff', allyStroke: '#2b2b2b',
  enemyFill: '#141414', enemyStroke: '#f2f2f2',
  hpBack: '#3a3a3a', hpFill: '#e04b3a',
};

export function render(ctx: CanvasRenderingContext2D, state: GameState, view: ViewState = EMPTY_VIEW): void {
  ctx.save();
  // save()/restore()를 try/finally로 감싼다 (회귀 3). main.ts의 Item 3 수정 전에는 여기서 던지면
  // rAF 루프 자체가 멈췄으니 restore 누락이 관측될 일이 없었지만, 이제는 루프가 살아남아 다음
  // 프레임에도 같은 지점(예: drawPiece/drawEnemy)에서 반복해 던질 수 있다 — 그때마다 restore()가
  // 스킵되면 save 스택이 무한히 쌓이고 view.shake의 translate가 매 프레임 누적돼 보드가 화면
  // 밖으로 서서히 밀려난다. fx.draw() 주변에 이미 있던 try/finally와 동일한 이유·동일한 패턴이다.
  try {
    ctx.translate(view.shake.x, view.shake.y);
    drawBoard(ctx);
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
    for (const p of state.pieces) if (p.square) drawPiece(ctx, p);
    // 기물 위, 적 아래 — 미리보기는 대상 기물을 덮어야 읽히지만 적을 가리면 안 된다.
    if (view.mergePreview) drawMergePreview(ctx, view.mergePreview);
    const sorted = [...state.enemies].sort((a, b) => a.y - b.y);
    for (const e of sorted) drawEnemy(ctx, e);
    drawBossVignette(ctx, state);
  } finally {
    ctx.restore();
  }
}

function drawBoard(ctx: CanvasRenderingContext2D): void {
  for (let rank = CONFIG.board.ranks; rank >= 1; rank--) {
    const row = CONFIG.board.ranks - rank;         // grid.ts의 rankToTopY와 동일한 매핑을 재사용
    const y = rankToTopY(rank);
    for (let col = 0; col < CONFIG.board.files; col++) {
      ctx.fillStyle = (row + col) % 2 === 0 ? COLOR.light : COLOR.dark;
      ctx.fillRect(col * SQ, y, SQ, SQ);
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

// 바닥 그림자(타원)는 제거했다 (사용자 요청). 스펙 8.1은 이를 진영 구분 단서 중 하나로 들었지만,
// 그 목록은 기물이 유니코드 글리프이던 시절을 전제로 한 것이다. 지금은 아군이 화이트 세트, 적이
// 블랙 세트라 아트워크 자체가 진영을 말해 주고, 체력바(적만)와 크기 차이(72px/44px)도 그대로
// 남아 있어 구분 단서는 충분하다.

function drawGlyph(
  ctx: CanvasRenderingContext2D, glyph: string, x: number, y: number,
  sizePx: number, fill: string, stroke: string,
): void {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${sizePx}px "Segoe UI Symbol", "Noto Sans Symbols 2", serif`;
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = stroke;
  ctx.strokeText(glyph, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(glyph, x, y);
  ctx.restore();
}

/**
 * 강화 단계 링. 스프라이트(72px) 바로 바깥을 도는 원으로 그린다 — 칸(80px) 경계에 맞춘 사각
 * 테두리는 인접 칸의 링과 맞닿아 어느 쪽 것인지 구분이 안 되고, 8랭크 스폰 경계선과도 붙는다.
 * 어두운 바깥선을 먼저 깔아 반투명 하이라이트(선택 노랑·이동 초록) 위에서도 색이 독립적으로
 * 읽히게 한다. save/restore로 감싸 lineWidth/strokeStyle이 이후 그리기로 새지 않게 한다 —
 * drawPiece는 원래 ctx 상태를 복구하지 않는 함수라 여기서만이라도 스스로 닫는다.
 */
function drawTierRing(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, ALLY_SPRITE_PX / 2 + 2, 0, Math.PI * 2);
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(20,16,22,0.55)';
  ctx.stroke();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();
}

/**
 * 합성 미리보기 — 드래그 중인 기물을 지금 놓으면 나올 결과를 그 칸 위에 미리 보여준다.
 * 결과 티어의 링을 점선으로 그리고 단계를 숫자로 적는다("T3"). 놓기 전에 결과를 보여주는 것이
 * 이 기능의 유일한 사전 안전장치다 — 합성은 비가역이고 복구 수단은 판매(50% 손실)뿐이다.
 */
function drawMergePreview(
  ctx: CanvasRenderingContext2D, preview: { square: Square; tier: number },
): void {
  const x = fileCenterX(preview.square.file);
  const y = rankToTopY(preview.square.rank) + SQ / 2;
  const color = tierRingColor(preview.tier) ?? '#FFFFFF';
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, ALLY_SPRITE_PX / 2 + 7, 0, Math.PI * 2);
  ctx.setLineDash([6, 5]);
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(20,16,22,0.55)';
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.setLineDash([]);
  // 'T3' — renderer.test.ts가 '×'로 시작하는 fillText 전량을 퀸 버프 배지로 못박고 있으므로
  // 접두사를 '×'로 쓰면 안 된다.
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

function drawPiece(ctx: CanvasRenderingContext2D, p: Piece): void {
  const x = fileCenterX(p.square!.file);
  const y = rankToTopY(p.square!.rank) + SQ / 2;
  const ring = tierRingColor(p.tier);
  if (ring) drawTierRing(ctx, x, y, ring);       // 스프라이트 아래 — 실루엣을 가리지 않는다
  const sprite = getAllySprite(p.type);
  if (sprite) {
    ctx.drawImage(sprite, x - ALLY_SPRITE_PX / 2, y - ALLY_SPRITE_PX / 2, ALLY_SPRITE_PX, ALLY_SPRITE_PX);
  } else {
    drawGlyph(ctx, ALLY_GLYPH[p.type], x, y, 52, COLOR.allyFill, COLOR.allyStroke);
  }
  if (p.queenBuffCount > 0) {                    // 버프 뱃지 (스펙 7.7 — 상시 표식)
    ctx.font = 'bold 14px system-ui';
    ctx.fillStyle = '#ffd54a';
    ctx.textAlign = 'left';
    ctx.fillText(`×${1 + p.queenBuffCount}`, x + 12, y - 20);
  }
}

function drawEnemy(ctx: CanvasRenderingContext2D, e: Enemy): void {
  const x = fileCenterX(e.file) + e.jitterX;     // 지터는 렌더 전용 (스펙 7.8)
  const size = CONFIG.enemy.spritePx;
  const sprite = getEnemySprite(e.isBoss);
  if (sprite) {
    ctx.drawImage(sprite, x - size / 2, e.y - size / 2, size, size);
  } else {
    drawGlyph(ctx, e.isBoss ? '♚' : '♟', x, e.y, size, COLOR.enemyFill, COLOR.enemyStroke);
  }
  const w = 40, h = 4;                           // 체력바 상시 표시 (스펙 4.1/7.8) — 스프라이트 유무와 무관
  const top = e.y - size / 2 - 8;
  ctx.fillStyle = COLOR.hpBack;
  ctx.fillRect(x - w / 2, top, w, h);
  ctx.fillStyle = COLOR.hpFill;
  ctx.fillRect(x - w / 2, top, w * Math.max(0, e.hp / e.maxHp), h);
}

/** 보스가 2랭크 진입 시 화면 가장자리 붉은 비네트 (스펙 7.9) */
function drawBossVignette(ctx: CanvasRenderingContext2D, state: GameState): void {
  const near = state.enemies.some(e => e.isBoss && e.y >= rankToTopY(2));
  if (!near) return;
  const g = ctx.createRadialGradient(
    BOARD_W / 2, BOARD_H / 2, BOARD_H * 0.45,
    BOARD_W / 2, BOARD_H / 2, BOARD_H * 0.72,
  );
  g.addColorStop(0, 'rgba(200, 30, 30, 0)');
  g.addColorStop(1, 'rgba(200, 30, 30, 0.35)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, BOARD_W, BOARD_H);
}
