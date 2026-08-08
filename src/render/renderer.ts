import { CONFIG } from '../config';
import { BOARD_H, BOARD_W, fileCenterX, rankToTopY } from '../core/grid';
import type { Enemy, GameState, Piece, PieceType, Square } from '../types';

const SQ = CONFIG.board.squarePx;

export interface ViewState {
  highlights: { square: Square; color: string }[];
  lines: { from: Square; to: Square; color: string }[];
  shake: { x: number; y: number };
}
export const EMPTY_VIEW: ViewState = { highlights: [], lines: [], shake: { x: 0, y: 0 } };
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
  return { highlights: [], lines: [], shake: { x: 0, y: 0 } };
}

export const ALLY_GLYPH: Record<PieceType, string> = {
  pawn: '♟', knight: '♞', bishop: '♝', rook: '♜', queen: '♛',
};

const COLOR = {
  light: '#e8e6e0', dark: '#77756e',
  spawnTint: 'rgba(200, 60, 50, 0.10)',
  allyFill: '#ffffff', allyStroke: '#2b2b2b', allyShadow: 'rgba(70, 120, 220, 0.35)',
  enemyFill: '#141414', enemyStroke: '#f2f2f2', enemyShadow: 'rgba(220, 60, 50, 0.35)',
  hpBack: '#3a3a3a', hpFill: '#e04b3a',
};

export function render(ctx: CanvasRenderingContext2D, state: GameState, view: ViewState = EMPTY_VIEW): void {
  ctx.save();
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
  const sorted = [...state.enemies].sort((a, b) => a.y - b.y);
  for (const e of sorted) drawEnemy(ctx, e);
  drawBossVignette(ctx, state);
  ctx.restore();
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
  ctx.fillStyle = COLOR.spawnTint;               // 8랭크 = 배치 불가 스폰 구역
  ctx.fillRect(0, 0, BOARD_W, SQ);
}

function drawGlyph(
  ctx: CanvasRenderingContext2D, glyph: string, x: number, y: number,
  sizePx: number, fill: string, stroke: string, shadow: string,
): void {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = shadow;                        // 바닥 그림자 (진영 색 구분, 스펙 8.1)
  ctx.beginPath();
  ctx.ellipse(x, y + sizePx * 0.42, sizePx * 0.38, sizePx * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = `${sizePx}px "Segoe UI Symbol", "Noto Sans Symbols 2", serif`;
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = stroke;
  ctx.strokeText(glyph, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(glyph, x, y);
  ctx.restore();
}

function drawPiece(ctx: CanvasRenderingContext2D, p: Piece): void {
  const x = fileCenterX(p.square!.file);
  const y = rankToTopY(p.square!.rank) + SQ / 2;
  drawGlyph(ctx, ALLY_GLYPH[p.type], x, y, 52, COLOR.allyFill, COLOR.allyStroke, COLOR.allyShadow);
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
  drawGlyph(ctx, e.isBoss ? '♚' : '♟', x, e.y, size, COLOR.enemyFill, COLOR.enemyStroke, COLOR.enemyShadow);
  const w = 40, h = 4;                           // 체력바 상시 표시 (스펙 4.1/7.8)
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
