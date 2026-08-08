import './style.css';
import { CONFIG } from './config';
import { BOARD_H, BOARD_W } from './core/grid';
import { createInitialState } from './core/state';
import { stepGame } from './core/step';
import { createTicker } from './core/ticker';
import { remainingEnemies } from './core/wave';
import { render } from './render/renderer';
import type { GameEvent } from './types';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <div id="debug-hud" style="color:#eee;font:14px monospace;padding:6px"></div>
  <canvas id="board" width="${BOARD_W}" height="${BOARD_H}"></canvas>
`;
const canvas = document.querySelector<HTMLCanvasElement>('#board')!;
const ctx = canvas.getContext('2d')!;
const debugHud = document.querySelector<HTMLDivElement>('#debug-hud')!;

const state = createInitialState();
const events: GameEvent[] = [];
const tick = createTicker();

if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__game = state; // 콘솔 디버그용
}

let last = performance.now();
function frame(now: number): void {
  tick((now - last) / 1000, dt => stepGame(state, dt * state.speedMultiplier, events));
  last = now;
  render(ctx, state);
  debugHud.textContent =
    `♥${state.hp} 💰${state.gold} 웨이브 ${state.wave}/${CONFIG.wave.total} ` +
    `남은 적 ${remainingEnemies(state)} ⏱${Math.max(0, state.prepareTimer).toFixed(1)}s ${state.phase}`;
  events.length = 0; // 소비자는 Task 17/19에서 연결
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
