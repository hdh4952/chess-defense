import './style.css';
import { createInitialState } from './core/state';
import { stepGame } from './core/step';
import { createTicker } from './core/ticker';
import { startWave } from './core/wave';
import { EMPTY_VIEW, render, type ViewState } from './render/renderer';
import { Banners } from './ui/banners';
import { wireControls } from './ui/controls';
import { updateHud } from './ui/hud';
import { createLayout } from './ui/layout';
import { updateShop, wireShop } from './ui/shop';
import { updateSlots } from './ui/slots';
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
const drag = new DragController(state, layout, events);   // interaction은 Task 18(하이라이트/툴팁)에서 사용
const banners = new Banners(layout);

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

  const view: ViewState = { ...EMPTY_VIEW, highlights: [] };
  if (banners.bossFlash) {                          // 파일 전체 붉은 강조 1초 (스펙 7.9)
    for (let rank = 1; rank <= 8; rank++) {
      view.highlights.push({ square: { file: banners.bossFlash.file, rank }, color: 'rgba(220,50,40,0.28)' });
    }
  }
  render(ctx, state, view);
  updateHud(layout, state);
  updateShop(layout, state);
  updateSlots(layout, state);
  events.length = 0;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
