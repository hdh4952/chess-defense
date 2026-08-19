import { CONFIG } from '../config';
import { rankToTopY } from '../core/grid';
import type { Fx } from '../render/effects';
import type { EnemyFx } from '../render/enemyFx';
import { prefersReducedMotion } from '../render/enemyFx';
import { HP_TRACK_INK, kingHpFill, SLOW_INK, TRAIT_COLOR } from '../render/palette';
import { OUTLINE_INK } from './outline';
import { pieceTop } from './geometry';
import { type BoardView, enemyWorld, squareWorld, WIDE_VIEW, worldX, worldZ } from './coords';
import { Enemies3D } from './enemies';
import { leanedApex } from './pose';
import { playerKingApex } from './playerKing';
import type { Projector } from './scene';
import type { Enemy, GameState } from '../types';

/**
 * 화면 오버레이 — 3D 위에 얹히는 2D 계층 (v1.21).
 *
 * ★ **여기 있는 것은 전부 "가려지면 안 되는 정보"다.** 체력바·유형 표식·데미지 숫자·골드·
 * 감속 라벨·버프 배지. 이것들을 3D 물체로 만들면 큰 기물 뒤나 보스 그림자 속에서 읽히지
 * 않게 되는데, 그건 연출이 아니라 **결함**이다. 3D 게임의 HUD가 언제나 화면 공간에 남는
 * 이유와 같다.
 *
 * ★ **3D 위의 것을 2D로 따라 그리는 방법이 이 파일의 핵심이다.** 체력바는 적의 **머리 위**에
 * 떠야 하는데, 적은 높이를 가진 메시다. `Projector.toScreen`이 그 높이를 화면 좌표로
 * 되돌린다 — 큰 보스일수록 체력바가 화면에서 더 위로 올라가고, 그 차이 자체가 "저건 크다"는
 * 단서가 된다.
 *
 * ⚠️ ★ **v1.24(원근 쿼터뷰)에서 이 파일의 전제가 바뀌었다.** 직교 항등 시절에는 보드 픽셀이
 * 곧 화면 픽셀이라 대부분의 좌표를 그대로 썼고, 높이가 있는 것만 투영했다. 지금은 **전부
 * 투영을 거친다** — 판 위 같은 자리라도 랭크에 따라 화면 위치와 크기가 다르기 때문이다.
 *
 * ★ 그리고 **띄우는 일은 여기서 한다.** "적 머리 위로 42px" 같은 값은 화면 공간 결정인데,
 * 원근에서는 보드 y를 줄이면 위로 뜨는 게 아니라 판 위에서 뒤로 물러난다. 그래서 이벤트
 * 목록(render/effects.ts)은 일어난 자리만 담고, 리프트는 투영 **뒤에** 화면 픽셀로 더한다.
 *
 * ⚠️ 화면 흔들림을 여기서 더하지 않는다 — 뷰 오프셋으로 걸려 투영 행렬에 이미 실려 있다.
 */

/**
 * 체력바 치수 — ★ v1.26에서 툰 렌더링에 맞춰 굵어졌다(40×4 → 44×7).
 *
 * 얇은 막대는 테두리와 광택을 얹을 자리가 없다. 툰 스타일은 **선과 면이 또렷해야** 성립하고,
 * 그러려면 면이 최소한의 두께를 가져야 한다 — 4px에 2px 테두리를 두르면 남는 면이 0이다.
 *
 * ★ 모양은 **직사각형**이다(사용자 결정). v1.26 첫 판본은 양 끝이 둥근 캡슐이었는데, 각진
 * 쪽으로 되돌렸다 — 그래서 툰다움은 테두리와 광택 둘이 전부 감당한다.
 *
 * export하는 이유는 테스트가 이 값을 리터럴로 못박지 않게 하기 위함이다(`tests/overlay.test.ts`).
 */
export const HP_W = 44, HP_H = 7;

/** 테두리 두께. 기물 윤곽선(1.8)보다 살짝 두꺼운 것은 체력바가 훨씬 작기 때문이다 —
 *  같은 두께로 두면 화면에서 더 가늘어 보여 기물과 다른 화풍으로 읽힌다. */
const HP_OUTLINE = 2;

const COLOR = {
  /** 빈 구간. 순회색이 아니라 적 몸통(#2B2836)과 같은 계열의 어두운 자주 — 막대가 적에게
   *  달린 물건으로 읽힌다. */
  hpTrack: HP_TRACK_INK,
  /** 남은 체력. 2D 시절(#e04b3a)보다 채도를 올렸다 — 툰은 중간톤이 사라지므로 원래 색이
   *  어중간하면 탁해 보인다(materials.ts의 아군 상아색과 같은 사정). */
  hpFill: '#F0483C',
  /** 위쪽 광택. 캐주얼 UI가 막대를 **원통**으로 보이게 하는 거의 유일한 수단이다. */
  gloss: 'rgba(255,255,255,0.30)',
};

/** 플레이어 킹의 막대는 적보다 크다 — 킹 자체가 크고(KING_SCALE), 무엇보다 이 값이
 *  화면에서 가장 중요한 수이기 때문이다. */
const KING_HP_W = 62, KING_HP_H = 9;

/** 체력바 **아래쪽**과 적 머리 사이의 여유. ★ v1.26에서 기준이 바뀌었다 — 예전에는 막대의
 *  위쪽을 머리에 붙여 막대가 머리를 덮었다. 툰 막대는 테두리까지 있어 더 두꺼우므로,
 *  머리 위에 온전히 얹히도록 아래쪽을 기준으로 잡는다. */
const HP_GAP = 5;

/**
 * 떠오르는 글자를 화면에서 얼마나 띄울 것인가(화면 px). ★ v1.24에서 이벤트 목록이 아니라
 * 여기로 옮겨 왔다 — 원근에서는 보드 y를 줄이면 위로 뜨는 게 아니라 판 위에서 뒤로 물러난다.
 * 먼 적일수록 화면상 작아지지만 **리프트는 고정**이다 — 이것은 판 위 물체가 아니라 읽으라고
 * 띄운 쪽지이기 때문이다.
 */
const TEXT_LIFT: Partial<Record<Fx['kind'], number>> = {
  frostTag: 42, dmgNum: 28, blockMark: 28,
};

/** 화면 위쪽 하한 — 8랭크에 갓 스폰한 적의 글자가 캔버스 밖으로 잘리지 않게 한다. */
const TEXT_TOP_MARGIN = 12;

/**
 * @param view 이 캔버스의 좌표계 (v1.36). 지우는 범위와 화면 전체 연출(보스 비네트)이 뷰
 *   크기를 알아야 하고, **플레이어 킹 체력바는 킹이 있는 뷰에서만** 그린다 — 좁은 화면에서는
 *   킹이 3D에 없고 체력은 판 아래 DOM 막대가 말한다(ui/layout.ts의 `#board-hp`).
 */
export function drawOverlay(
  ctx: CanvasRenderingContext2D, state: GameState,
  fxItems: readonly Fx[], projector: Projector, enemyFx?: EnemyFx,
  view: BoardView = WIDE_VIEW,
): void {
  ctx.save();
  try {
    ctx.clearRect(0, 0, view.w, view.h);
    for (const p of state.pieces) drawQueenBadge(ctx, state, p.id, projector);
    // 적은 화면 아래쪽(큰 y)부터 그려야 앞의 체력바가 뒤의 것을 덮는다 — 3D 씬의 깊이 정렬과
    // 같은 순서다. 3D는 z버퍼가 알아서 하지만 이 계층은 나중에 그린 것이 이긴다.
    const sorted = [...state.enemies].sort((a, b) => a.y - b.y);
    for (const e of sorted) drawEnemyInfo(ctx, e, projector, enemyFx);
    if (view.king) drawPlayerKingHp(ctx, state, projector);
    drawTextFx(ctx, fxItems, projector);
    drawBossVignette(ctx, state, view);
  } finally {
    ctx.restore();
  }
}

/**
 * 툰 체력바 한 개. 적과 플레이어 킹이 **같은 함수를 쓴다** — 체력바 문법이 갈리면
 * "저건 내 것인가 적 것인가"를 색이 아니라 모양으로도 다시 배워야 한다.
 *
 * ★ **테두리는 선을 긋는 대신 한 겹 큰 어두운 사각형을 뒤에 깐다.** stroke는 선 두께의 절반이
 * 안쪽으로 들어와 채움을 갉아먹고 반픽셀 정렬 문제도 생긴다. 뒤에 깔면 두께가 정확히
 * `HP_OUTLINE`이고 안쪽 면은 온전히 남는다 — 그리는 것도 `fillRect` 하나다. 색은 기물
 * 윤곽선과 **같은 잉크**(render3d/outline.ts)를 쓴다.
 *
 * ★ **광택이 툰 처리의 거의 전부다** — 모양이 각진 사각형이므로(사용자 결정) 둥근 끝이 하던
 * 몫까지 떠맡는다. 채움 위에 얹어야 빈 구간과 남은 구간이 같은 재질로 읽힌다.
 */
function drawToonBar(
  ctx: CanvasRenderingContext2D, left: number, top: number, w: number, h: number,
  ratio: number, fill: string, bonus?: { ratio: number; color: string },
): void {
  ctx.fillStyle = OUTLINE_INK;
  ctx.fillRect(left - HP_OUTLINE, top - HP_OUTLINE, w + HP_OUTLINE * 2, h + HP_OUTLINE * 2);
  ctx.fillStyle = COLOR.hpTrack;
  ctx.fillRect(left, top, w, h);
  ctx.fillStyle = fill;
  ctx.fillRect(left, top, w * ratio, h);
  if (bonus) {
    ctx.fillStyle = bonus.color;
    ctx.fillRect(left + w * (1 - bonus.ratio), top, w * bonus.ratio, h);
  }
  ctx.fillStyle = COLOR.gloss;
  ctx.fillRect(left, top, w, h * 0.4);
}

/**
 * ★★ **플레이어 킹의 체력바** (v1.28) — 이것이 곧 플레이어의 남은 목숨이다.
 *
 * v1.27까지 이 값은 HUD 구석의 `♥10`이라는 숫자였다. 규칙상 가장 중요한 값인데(0이면 판이
 * 끝난다) 화면에서는 웨이브 번호와 나란한 텍스트 조각이라 **무엇이 걸려 있는지가 읽히지
 * 않았다.** 판 밖에 선 킹 위에 적과 **똑같이 생긴 막대**를 달면, 적을 깎는 그 문법이 내
 * 것에도 그대로 붙어 "저것도 깎이는 것"임이 설명 없이 통한다(render3d/playerKing.ts).
 *
 * ★ **색이 세 단계로 바뀐다.** 툰 램프가 명암을 세 단으로 끊는 것과 같은 어휘다 — 연속
 * 그라디언트는 이 화면에서 혼자 튄다. 적 막대는 언제나 붉으므로, 색이 변하는 것 자체가
 * "이건 내 것"이라는 신호도 겸한다.
 *
 * ★ **숫자를 함께 적는다.** 보스 누수는 5, 일반은 1을 깎으므로 남은 값의 **정확한 수**가
 * 판단에 필요하다 — 막대만으로는 "보스를 한 번 더 버티는가"를 셀 수 없다.
 */
function drawPlayerKingHp(
  ctx: CanvasRenderingContext2D, state: GameState, projector: Projector,
): void {
  const apex = playerKingApex();
  const head = projector.toScreen(apex.x, apex.y, apex.z);
  const w = KING_HP_W, h = KING_HP_H;
  const left = head.x - w / 2;
  const top = Math.max(HP_OUTLINE, head.y - HP_GAP - h);
  const ratio = Math.max(0, Math.min(1, state.hp / CONFIG.player.startHp));

  // ★ 색과 문턱은 팔레트가 소유한다 (v1.36) — 좁은 화면에서는 같은 막대를 DOM이 그린다.
  const fill = kingHpFill(ratio);
  drawToonBar(ctx, left, top, w, h, ratio, fill);

  ctx.font = 'bold 13px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = OUTLINE_INK;
  ctx.strokeText(String(state.hp), head.x, top + h / 2);
  ctx.fillStyle = '#FFF6E4';
  ctx.fillText(String(state.hp), head.x, top + h / 2);
}

/** 퀸 버프 배지 (스펙 7.7 — 상시 표식). 기물 꼭대기 옆에 붙는다. */
function drawQueenBadge(
  ctx: CanvasRenderingContext2D, state: GameState, pieceId: string, projector: Projector,
): void {
  const p = state.pieces.find(q => q.id === pieceId);
  if (!p || p.queenBuffCount <= 0) return;
  const w = squareWorld(p.square);
  // ★ 눕히고 늘린 뒤의 실제 꼭대기를 쓴다 (v1.25 각도 불일치 — render3d/pieces.ts).
  const apex = leanedApex(pieceTop(p.type));
  const s = projector.toScreen(w.x, apex.y, w.z + apex.z);
  ctx.font = 'bold 14px system-ui';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = 'rgba(20,16,6,0.8)';
  ctx.strokeText(`×${1 + p.queenBuffCount}`, s.x + 14, s.y);
  ctx.fillStyle = '#ffd54a';
  ctx.fillText(`×${1 + p.queenBuffCount}`, s.x + 14, s.y);
}

/** 체력바 + 적 유형 표식. 스프라이트가 사라져도 이 정보는 그대로다(스펙 4.1/7.8). */
function drawEnemyInfo(
  ctx: CanvasRenderingContext2D, e: Enemy, projector: Projector, enemyFx?: EnemyFx,
): void {
  const w = enemyWorld(e);
  const apex = leanedApex(Enemies3D.topOf(e.isBoss));
  const head = projector.toScreen(w.x, apex.y, w.z + apex.z);
  const x = head.x;
  // ⚠️ 위쪽으로 **하한**을 둔다. 체력바가 적의 머리 높이만큼 올라가 있는데, 적은 8랭크
  // y≈0에서 스폰하므로 그대로 두면 갓 나온 적의 막대가 캔버스 밖으로 잘려 **화면에 아예
  // 없는 것**이 된다. 스폰 직후가 곧 "무엇이 오는가"를 읽어야 하는 순간이라 하필 그때
  // 사라진다. 테두리까지 살아남도록 하한을 테두리 두께로 잡는다.
  const top = Math.max(HP_OUTLINE, head.y - HP_GAP - HP_H);
  const left = x - HP_W / 2;

  // ★ 오라 보너스가 있으면 분모가 커진다 (v1.14). 그러지 않으면 보너스만큼의 체력이 막대에
  //   나타나지 않아, 플레이어가 "다 깎았는데 안 죽는다"를 겪으면서 이유를 볼 수 없다.
  const total = e.maxHp + e.auraBonus;
  // ★ 보간된 표시값을 쓴다 (v1.15). enemyFx가 없으면 실제 값이 그대로 온다.
  const alive = enemyFx ? enemyFx.displayHp(e) : Math.max(0, e.hp + e.auraBonus);

  drawToonBar(ctx, left, top, HP_W, HP_H, Math.min(1, alive / total), COLOR.hpFill,
    e.auraBonus > 0
      // 보너스 구간을 오라 색으로 덧그린다 — 어디까지가 "오라가 빌려준 체력"인지 보이면
      // "오라를 먼저 끊으면 이만큼이 사라진다"가 화면에서 읽힌다.
      ? { ratio: Math.min(1, e.auraBonus / total), color: TRAIT_COLOR.aura }
      : undefined);

  // 적립된 피해(hp < 0)는 막대 아래 얇은 선으로 — 오라를 끊는 순간 터질 양이다.
  if (e.auraBonus > 0 && e.hp < 0) {
    ctx.fillStyle = COLOR.hpFill;
    ctx.fillRect(left, top + HP_H + HP_OUTLINE + 1, HP_W * Math.min(1, -e.hp / total), 2.5);
  }

  // ── ③ 유형 표식 ────────────────────────────────────────────────────────────
  // 체력바 왼쪽에 작은 고리 하나씩. 실드형의 방향 표시는 3D 쪽이 맡는다
  // (render3d/enemies.ts의 SHIELD_PROTO) — 그건 정보가 아니라 **공간**이기 때문이다:
  // "어느 쪽에서 때려야 먹히는가"는 판 위 방향이라 판 위에 그려야 뜻이 통한다.
  if (e.traits.length === 0) return;
  let cx = left - 8;
  for (const t of e.traits) {
    // ★ 고리에도 같은 테두리를 두른다 — 체력바만 툰이고 표식은 맨 선이면 나란히 붙어 있는
    //   둘의 화풍이 갈린다(티어 링에 윤곽선을 붙인 것과 같은 이유).
    ctx.beginPath();
    ctx.arc(cx, top + HP_H / 2, 4, 0, Math.PI * 2);
    ctx.lineWidth = 4.5;
    ctx.strokeStyle = OUTLINE_INK;
    ctx.stroke();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = TRAIT_COLOR[t];
    ctx.stroke();
    cx -= 11;
  }
}

/**
 * 떠오르는 글자와 표식. 2D 시절 `Effects.draw`에서 **그대로** 옮겨 왔다 — 알파 곡선("마지막
 * 구간에서만 사라진다")과 색 선택의 이유가 전부 그때 조정된 것이고, 3D가 됐다고 달라질 이유가
 * 하나도 없다. 바뀐 것은 화면 흔들림을 여기서 직접 더한다는 점뿐이다(예전에는 main.ts가
 * ctx.translate로 걸었다).
 */
function drawTextFx(ctx: CanvasRenderingContext2D, items: readonly Fx[], projector: Projector): void {
  const reduced = prefersReducedMotion();
  for (const f of items) {
    const k = 1 - f.t / f.ttl;
    // 보드 픽셀(판 위) → 화면. 그 뒤에 화면 공간 리프트를 더하고 위쪽으로 하한을 건다.
    const at = projector.toScreen(worldX(f.x), 0, worldZ(f.y));
    const x = at.x;
    const y = Math.max(TEXT_TOP_MARGIN, at.y - (TEXT_LIFT[f.kind] ?? 0));
    ctx.save();
    ctx.globalAlpha = k;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    switch (f.kind) {
      case 'frostTag': {         // 감속 진입 — 적 머리 위 "−30%"
        // coin과 같은 이유로 마지막 구간에서만 사라지게 한다 — 선형이면 읽기 전에 흐려진다.
        ctx.globalAlpha = Math.min(1, k / 0.35);
        ctx.font = 'bold 13px system-ui';
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(8,22,36,0.85)';
        ctx.strokeText(f.label!, x, y);
        ctx.fillStyle = SLOW_INK;
        ctx.fillText(f.label!, x, y);
        break;
      }
      case 'dmgNum': {           // 피해 숫자 — 위로 떠오르며 페이드
        ctx.globalAlpha = Math.min(1, k / 0.35);
        const dy = reduced ? 0 : (1 - k) * 22;
        ctx.font = 'bold 15px system-ui';
        ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(20,6,6,0.85)';
        const text = String(Math.round(f.amount ?? 0));
        ctx.strokeText(text, x, y - dy);
        ctx.fillStyle = '#ff8f7a';
        ctx.fillText(text, x, y - dy);
        break;
      }
      case 'blockMark': {        // 막힌 피격 — 숫자 대신 사선이 그어진 고리
        // 형태로 말한다: 고리(피격은 있었다) + 사선(들어가지 않았다). 색은 장갑형 표식과
        // 같은 회청이라 "무엇이 막았는가"가 적 유형 표식과 이어진다.
        ctx.globalAlpha = Math.min(1, k / 0.4);
        ctx.strokeStyle = TRAIT_COLOR.armored; ctx.lineWidth = 2.5;
        const r = 7;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x - r * 0.7, y + r * 0.7);
        ctx.lineTo(x + r * 0.7, y - r * 0.7);
        ctx.stroke();
        break;
      }
      case 'goldFly': {          // 처치 골드 — 적이 죽은 자리에서 HUD 골드로 날아간다
        // ★ 곡선으로 날린다. 직선이면 여러 개가 겹쳐 한 줄로 보이고, "어디로 가는가"가
        //   읽히지 않는다. 진행률을 ease-in으로 두어 처음엔 느리게 뜬 뒤 빨려 들어간다.
        const p = 1 - k;
        const e = p * p;
        // 도착점은 HUD 골드 표시의 **캔버스 좌표**라 이미 화면 공간이다 — 투영하지 않는다.
        const tx = f.tx ?? x, ty = f.ty ?? y;
        const mx = (x + tx) / 2;
        const my = Math.min(y, ty) - 70;      // 제어점을 위로 띄워 아치를 만든다
        const bx = (1 - e) * (1 - e) * x + 2 * (1 - e) * e * mx + e * e * tx;
        const by = (1 - e) * (1 - e) * y + 2 * (1 - e) * e * my + e * e * ty;
        ctx.globalAlpha = Math.min(1, k / 0.25);
        ctx.font = 'bold 13px system-ui';
        ctx.lineWidth = 3.5; ctx.strokeStyle = '#3a2c05';
        ctx.strokeText(`+${f.amount}`, bx, by);
        ctx.fillStyle = '#ffd34d';
        ctx.fillText(`+${f.amount}`, bx, by);
        break;
      }
      case 'coin': {             // 골드 획득 — 위로 떠오르며 사라지는 "+10G"
        // 마지막 30%에서만 서서히 사라지게 한다: 선형 알파(k)로 두면 뜨자마자 흐려져서
        // 숫자를 읽을 시간이 없다.
        ctx.globalAlpha = Math.min(1, k / 0.3);
        ctx.font = 'bold 20px system-ui';
        ctx.lineWidth = 4; ctx.strokeStyle = '#3a2c05';   // 밝은 칸 위에서도 읽히도록 테두리
        ctx.strokeText(`+${f.amount}G`, x, y - (1 - k) * 30);
        ctx.fillStyle = '#ffd34d';
        ctx.fillText(`+${f.amount}G`, x, y - (1 - k) * 30);
        break;
      }
      default:
        break;                   // 나머지는 판 위의 사건이라 3D 계층 몫이다
    }
    ctx.restore();
  }
}

/** 보스가 2랭크 진입 시 화면 가장자리 붉은 비네트 (스펙 7.9). 화면 전체에 거는 연출이라
 *  3D 씬이 아니라 여기가 맞다 — 카메라가 어디를 보든 "위험이 가깝다"는 화면의 말이다. */
function drawBossVignette(
  ctx: CanvasRenderingContext2D, state: GameState, view: BoardView,
): void {
  const near = state.enemies.some(e => e.isBoss && e.y >= rankToTopY(2));
  if (!near) return;
  const g = ctx.createRadialGradient(
    view.w / 2, view.h / 2, view.h * 0.45,
    view.w / 2, view.h / 2, view.h * 0.72,
  );
  g.addColorStop(0, 'rgba(200, 30, 30, 0)');
  g.addColorStop(1, 'rgba(200, 30, 30, 0.35)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, view.w, view.h);
}

