import './style.css';
import { createInitialState } from './core/state';
import { stepGame } from './core/step';
import { createTicker } from './core/ticker';
import { startWave } from './core/wave';
import { render } from './render/renderer';
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
layout.startBtn.addEventListener('click', () => { if (!state.paused) startWave(state); });
const drag = new DragController(state, layout, events);   // interaction은 Task 18(하이라이트/툴팁)에서 사용

if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__game = state;
  (window as unknown as Record<string, unknown>).__drag = drag;
}

let last = performance.now();
function frame(now: number): void {
  tick((now - last) / 1000, dt => stepGame(state, dt * state.speedMultiplier, events));
  last = now;
  render(ctx, state);
  updateHud(layout, state);
  updateShop(layout, state);
  updateSlots(layout, state);
  events.length = 0;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
