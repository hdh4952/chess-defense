import './style.css';
import { createInitialState } from './core/state';
import { stepGame } from './core/step';
import { createTicker } from './core/ticker';
import { startWave } from './core/wave';
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

  for (const ev of events) banners.onEvent(ev);
  banners.update(state, realDt);

  const view = createFrameView();   // EMPTY_VIEW와 참조를 공유하지 않는 신규 인스턴스 (스펙 무관 — Task 17 리뷰 수정)
  const hl = buildHighlights(state, drag.interaction);   // 사거리/이동/퀸 라인 미리보기 (스펙 7.7, Task 18)
  view.highlights.push(...hl.highlights);
  view.lines.push(...hl.lines);
  if (banners.bossFlash) {                          // 파일 전체 붉은 강조 1초 (스펙 7.9)
    for (let rank = 1; rank <= 8; rank++) {
      view.highlights.push({ square: { file: banners.bossFlash.file, rank }, color: 'rgba(220,50,40,0.28)' });
    }
  }
  render(ctx, state, view);
  updateTooltip(tooltip, state, drag.interaction, mousePos);   // 기물 hover 툴팁 (스펙 7.7, Task 18)
  updateHud(layout, state);
  updateShop(layout, state);
  updateSlots(layout, state);
  events.length = 0;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
