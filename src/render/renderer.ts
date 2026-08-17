import { CONFIG } from '../config';
import { BOARD_H, BOARD_W, fileCenterX, rankToTopY } from '../core/grid';
import { slowCoverage } from '../core/slow';
import { SLOW_HALO, SLOW_INK, SLOW_RGB } from './palette';
import { ALLY_SPRITE_PX, getAllySprite, getEnemySprite } from './sprites';
import { tierRingColor } from './tiers';
import type { Enemy, EnemyTrait, GameState, Piece, PieceType, Square } from '../types';

const SQ = CONFIG.board.squarePx;
// 8랭크/7랭크 경계선 두께 — 표현(presentation) 값이라 config.ts가 아닌 여기에 둔다. export하는
// 이유는 테스트가 이 두께를 리터럴로 못박아, "경계선이 두께 0으로 그려져도 통과하는" 결함
// (재검토 Important 1)을 재발 방지하기 위함이다.
export const SPAWN_BORDER_PX = 4;

/** 적 유형 표식 색. 아군 티어 링(render/tiers.ts)과 겹치지 않는 톤을 골랐다 — 둘이 같은
 *  화면에 있으므로 색이 겹치면 "강화된 아군"과 "특성 있는 적"이 구분되지 않는다. */
const TRAIT_COLOR: Record<EnemyTrait, string> = {
  armored: '#9AA7B4',    // 회청 — 금속
  swift: '#4FD1C5',      // 청록 — 속도
  shielded: '#B98CFF',   // 연보라 — 보호막
};

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
  // 융합물은 유니코드에 대응 글리프가 없다. 스프라이트가 로드되지 않은 아주 짧은 순간에만
  // 쓰이는 폴백이므로, 재료 중 주기 공격을 담당하는 쪽의 글리프를 빌려 쓴다.
  archbishop: '♝', chancellor: '♜', amazon: '♛',
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
  // 감속 오라가 덮는 칸의 상시 표식. 알파가 낮은 이유는 이것이 **배경**이기 때문이다 —
  // 그 위에 사거리·이동·선택 하이라이트가 얹혀도 둘 다 읽혀야 한다.
  slowField: `rgba(${SLOW_RGB}, 0.30)`,
};

/** 꺾쇠 팔 길이. 칸 전체를 두르지 않는 이유는 잉크 총량이다 — L자 8칸은 서로 변으로 맞닿지
 *  않아 테두리가 하나로 병합되지 않으므로, 나이트 한 기만으로도 독립 사각형 8개가 생긴다.
 *  모서리만 남기면 칸당 선 길이가 320px → 112px로 줄면서 "여기가 경계다"는 인지는 유지된다. */
const SLOW_ARM = 14;

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
    // ★ 순서가 규칙이다. drawBoard **뒤**여야 8랭크 명도 오버레이 위에 얹혀 스폰 구역의 오라
    // 칸이 보이고(감속 범위는 8랭크를 포함한다 — 이 게임에서 유일하게 새로운 정보다),
    // view.highlights **앞**이어야 선택·사거리 미리보기(일시적)가 상시 오라(배경) 위에 읽힌다.
    // 집합은 프레임당 정확히 한 번만 계산해 drawEnemy까지 넘긴다 — 적마다 다시 구하면
    // 60fps × 최대 46마리만큼의 중복 순회가 된다.
    const slowField = slowCoverage(state);
    drawSlowField(ctx, slowField);
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
    for (const p of state.pieces) drawPiece(ctx, p);
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

/**
 * 감속 오라가 덮는 칸 — 얼음색 옅은 채움 + 네 모서리 꺾쇠 (v1.10).
 *
 * ★ **칸당 정확히 한 번만 그린다.** 그 보장은 인자가 Map이라는 데서 나온다(core/slow.ts) —
 * 나이트 셋이 같은 칸을 덮어도 원소가 하나라 알파가 겹쳐 쌓일 수가 없다. 겹쳐 칠하면 화면이
 * "저기는 더 느리다"고 말하는데 규칙은 정확히 ×0.7 한 번이라, 그 순간 연출이 거짓말이 된다.
 * **중첩 금지가 코드가 아니라 자료구조로 보장되는 지점이 여기다.**
 *
 * 꺾쇠를 쓰고 칸 전체를 두르지 않는 이유는 SLOW_ARM 주석에 있다. 안쪽으로 1.5px 물려 그리는
 * 것은 인접한 오라 칸끼리 선이 붙어 한 덩어리로 뭉개지지 않게 하기 위함이다.
 */
function drawSlowField(ctx: CanvasRenderingContext2D, field: Map<string, Square>): void {
  if (field.size === 0) return;
  ctx.save();
  for (const sq of field.values()) {
    const x = sq.file * SQ, y = rankToTopY(sq.rank);
    ctx.fillStyle = COLOR.slowField;
    ctx.fillRect(x, y, SQ, SQ);
  }
  // 선은 채움을 전부 끝낸 뒤 한 번에 긋는다 — 인접 칸의 채움이 앞 칸의 꺾쇠를 덮지 않는다.
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  for (const sq of field.values()) {
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
 * 감속당한 적에게 붙는 회전 점선 고리.
 *
 * ★ **위상을 벽시계가 아니라 `e.y`에서 뽑는다.** 그래서 고리는 적이 실제로 나아가는 속도로
 * 돌고, 감속된 적의 고리는 정확히 30% 느리게 돈다 — **연출 자체가 규칙이다.** 덤으로 일시정지·
 * 준비 단계에서 저절로 멈춘다(적이 안 움직이므로). 시간 기반으로 두면 그 셋을 전부 따로
 * 처리해야 하고, main.ts가 dt를 0으로 눌러 막는 함정(Effects.shakeOffset 전례)에 다시 걸린다.
 *
 * ⚠️ `arc`와 `stroke`로만 그린다 — renderer.test.ts가 fillRect(80×80 64개, 640폭 2개)와
 * '×'로 시작하는 fillText의 개수를 리터럴로 못박고 있어서, 다른 프리미티브를 쓰면 감속과
 * 무관한 렌더 테스트가 무더기로 깨진다(drawTraitMarks와 같은 제약).
 */
function drawSlowRing(ctx: CanvasRenderingContext2D, e: Enemy, x: number, size: number): void {
  const r = size / 2 + 5;
  ctx.save();
  ctx.translate(x, e.y);
  ctx.rotate((e.y / SQ) * 0.9);            // 한 칸 내려올 때마다 0.9rad — 눈에 보일 만큼만
  ctx.setLineDash([7, 6]);
  ctx.lineWidth = 4; ctx.strokeStyle = SLOW_HALO;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 2; ctx.strokeStyle = SLOW_INK;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
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
  const x = fileCenterX(p.square.file);
  const y = rankToTopY(p.square.rank) + SQ / 2;
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
  // 고리는 스프라이트 **아래**에 그린다 — 적의 실루엣을 가리면 무엇이 오는지 못 읽는다.
  if (e.slowed) drawSlowRing(ctx, e, x, size);
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
  // 상·하한 둘 다 클램프한다. 하한만 두면 회복 계열이 생겼을 때 막대가 칸 밖으로 넘어간다.
  ctx.fillRect(x - w / 2, top, w * Math.min(1, Math.max(0, e.hp / e.maxHp)), h);
  drawTraitMarks(ctx, e, x, top);
}

/**
 * 적 유형 표식 — 체력바 왼쪽에 작은 고리로, 보호막은 체력바 위 아크 게이지로 그린다.
 *
 * ⚠️ **`arc`/`stroke`로만 그린다.** renderer.test.ts가 `fillRect`(80×80 정확히 64개, 640폭
 * 정확히 2개)와 `fillText`('×'로 시작하는 것 전량)의 개수를 리터럴로 못박고 있어서, 표식을
 * 그 프리미티브로 그리면 밸런스와 무관한 렌더 테스트가 무더기로 깨진다.
 */
function drawTraitMarks(ctx: CanvasRenderingContext2D, e: Enemy, x: number, top: number): void {
  if (e.traits.length === 0) return;
  ctx.save();
  let cx = x - 26;
  for (const t of e.traits) {
    ctx.beginPath();
    ctx.arc(cx, top + 2, 3.5, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = TRAIT_COLOR[t];
    ctx.stroke();
    cx -= 9;
  }
  // 보호막은 "얼마나 남았는가"가 보여야 한다 — 남은 풀에 비례하는 아크로 그린다.
  if (e.shieldPool > 0) {
    const full = Math.round(e.maxHp * (CONFIG.traitDefs.shielded.absorbPool ?? 0));
    if (full > 0) {
      ctx.beginPath();
      ctx.arc(x, e.y, CONFIG.enemy.spritePx / 2 + 3, -Math.PI / 2,
        -Math.PI / 2 + (Math.PI * 2 * Math.min(1, e.shieldPool / full)));
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = TRAIT_COLOR.shielded;
      ctx.stroke();
    }
  }
  ctx.restore();
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
