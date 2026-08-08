import './style.css';
import { createInitialState } from './core/state';
import { stepGame } from './core/step';
import { createTicker } from './core/ticker';
import { startWave } from './core/wave';
import { Effects } from './render/effects';
import { buildHighlights } from './render/highlights';
import { createFrameView, render } from './render/renderer';
import { Banners } from './ui/banners';
import { wireControls } from './ui/controls';
import { updateHud } from './ui/hud';
import { createLayout } from './ui/layout';
import { updateShop, wireShop } from './ui/shop';
import { updateSlots } from './ui/slots';
import { updateTooltip } from './ui/tooltip';
import { DragController } from './ui/drag';
import type { GameEvent } from './types';

const app = document.querySelector<HTMLDivElement>('#app')!;
const layout = createLayout(app);
const ctx = layout.canvas.getContext('2d')!;

const state = createInitialState();
const events: GameEvent[] = [];
const tick = createTicker();

wireShop(layout, state);
wireControls(layout, state);
layout.startBtn.addEventListener('click', () => { if (!state.paused) startWave(state); });
const drag = new DragController(state, layout, events);
const banners = new Banners(layout);
const fx = new Effects();   // 속성별 공격 이펙트 + 화면 진동, 렌더 전용 (스펙 8.2, Task 19)

const tooltip = document.createElement('div');   // 사거리 미리보기·툴팁 (스펙 7.7, Task 18)
tooltip.id = 'tooltip';
tooltip.hidden = true;
document.body.appendChild(tooltip);
let mousePos: { x: number; y: number } | null = null;
document.addEventListener('pointermove', e => { mousePos = { x: e.clientX, y: e.clientY }; });

if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__game = state;
  (window as unknown as Record<string, unknown>).__drag = drag;
}

let last = performance.now();
function frame(now: number): void {
  const realDt = (now - last) / 1000;
  tick(realDt, dt => stepGame(state, dt * state.speedMultiplier, events));
  last = now;

  for (const ev of events) { banners.onEvent(ev); fx.onEvent(ev); }
  banners.update(state, realDt);
  // 일시정지 중에는 이펙트도 멈춘다 — 그렇지 않으면 게임 상태는 얼어있는데 폭발/광선 페이드와
  // 화면 진동만 벽시계 기준으로 계속 진행돼 버린다 (banners.bossFlash의 Task 17 리뷰 수정과 동일한 사유).
  fx.update(state.paused ? 0 : realDt);

  const view = createFrameView();   // EMPTY_VIEW와 참조를 공유하지 않는 신규 인스턴스 (스펙 무관 — Task 17 리뷰 수정)
  const hl = buildHighlights(state, drag.interaction);   // 사거리/이동/퀸 라인 미리보기 (스펙 7.7, Task 18)
  view.highlights.push(...hl.highlights);
  view.lines.push(...hl.lines);
  if (banners.bossFlash) {                          // 파일 전체 붉은 강조 1초 (스펙 7.9)
    for (let rank = 1; rank <= 8; rank++) {
      view.highlights.push({ square: { file: banners.bossFlash.file, rank }, color: 'rgba(220,50,40,0.28)' });
    }
  }
  view.shake = fx.shakeOffset();   // 룩/나이트 공격의 화면 진동을 렌더러에 전달 (스펙 8.2)
  render(ctx, state, view);
  // render()가 이미 view.shake만큼 translate했다가 자신의 save()/restore() 안에서 복구했으므로,
  // 그 바깥에서 fx.draw()를 그대로 부르면 보드는 흔들리는데 이펙트만 고정된 것처럼 보인다.
  // 동일한 오프셋으로 다시 translate한 뒤 이펙트를 그려 보드와 함께 흔들리게 하고,
  // 그리기 중 예외가 나도 변환 스택이 어긋나지 않도록 try/finally로 restore를 보장한다.
  ctx.save();
  ctx.translate(view.shake.x, view.shake.y);
  try {
    fx.draw(ctx);          // 보드 위 오버레이로 그린다
  } finally {
    ctx.restore();
  }
  updateTooltip(tooltip, state, drag.interaction, mousePos);   // 기물 hover 툴팁 (스펙 7.7, Task 18)
  updateHud(layout, state);
  updateShop(layout, state);
  updateSlots(layout, state);
  events.length = 0;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
