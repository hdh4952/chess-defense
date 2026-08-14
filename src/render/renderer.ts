import { CONFIG } from '../config';
import { BOARD_H, BOARD_W, fileCenterX, rankToTopY } from '../core/grid';
import { ALLY_SPRITE_PX, getAllySprite, getEnemySprite } from './sprites';
import type { Enemy, GameState, Piece, PieceType, Square } from '../types';

const SQ = CONFIG.board.squarePx;
const SPAWN_BORDER_PX = 4;   // 8랭크/7랭크 경계선 두께 — 표현(presentation) 값이라 config.ts가 아닌 여기에 둔다

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
  allyFill: '#ffffff', allyStroke: '#2b2b2b', allyShadow: 'rgba(70, 120, 220, 0.35)',
  enemyFill: '#141414', enemyStroke: '#f2f2f2', enemyShadow: 'rgba(220, 60, 50, 0.35)',
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

/** 바닥 그림자 (진영 색 구분, 스펙 8.1). 글리프 경로와 스프라이트 경로가 동일한 그림자를 쓴다 —
 * 두 곳에 같은 타원 공식을 따로 두면(중복) 언젠가 하나만 고쳐져 어긋나기 쉽다. */
function drawGroundShadow(
  ctx: CanvasRenderingContext2D, x: number, y: number, sizePx: number, shadow: string,
): void {
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.ellipse(x, y + sizePx * 0.42, sizePx * 0.38, sizePx * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawGlyph(
  ctx: CanvasRenderingContext2D, glyph: string, x: number, y: number,
  sizePx: number, fill: string, stroke: string, shadow: string,
): void {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  drawGroundShadow(ctx, x, y, sizePx, shadow);
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
  const sprite = getAllySprite(p.type);
  if (sprite) {
    ctx.save();
    drawGroundShadow(ctx, x, y, ALLY_SPRITE_PX, COLOR.allyShadow);
    ctx.drawImage(sprite, x - ALLY_SPRITE_PX / 2, y - ALLY_SPRITE_PX / 2, ALLY_SPRITE_PX, ALLY_SPRITE_PX);
    ctx.restore();
  } else {
    drawGlyph(ctx, ALLY_GLYPH[p.type], x, y, 52, COLOR.allyFill, COLOR.allyStroke, COLOR.allyShadow);
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
    ctx.save();
    drawGroundShadow(ctx, x, e.y, size, COLOR.enemyShadow);
    ctx.drawImage(sprite, x - size / 2, e.y - size / 2, size, size);
    ctx.restore();
  } else {
    drawGlyph(ctx, e.isBoss ? '♚' : '♟', x, e.y, size, COLOR.enemyFill, COLOR.enemyStroke, COLOR.enemyShadow);
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
