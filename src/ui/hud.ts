import { CONFIG } from '../config';
import { remainingEnemies } from '../core/wave';
import type { GameState } from '../types';
import type { Layout } from './layout';

export function updateHud(layout: Layout, state: GameState): void {
  const h = layout.hud;
  h.hp.textContent = String(state.hp);
  h.gold.textContent = String(state.gold);
  h.wave.textContent = `${state.wave}/${CONFIG.wave.total}`;
  // remainingEnemies()는 phase !== 'wave'일 때 웨이브 전체 수를 반환한다.
  // victory/defeat 화면 뒤에 "남은 적 N"이 그대로 남는 것을 막기 위해 여기서 0으로 덮어쓴다.
  h.remaining.textContent = String(
    state.phase === 'victory' || state.phase === 'defeat' ? 0 : remainingEnemies(state),
  );
  h.timer.textContent = state.phase === 'prepare'
    ? `${Math.max(0, state.prepareTimer).toFixed(1)}s` : '—';
  // 보스 웨이브 준비 중 보스 아이콘 상시 표기 (스펙 7.9)
  h.bossIcon.hidden = !(state.phase === 'prepare' && state.wave % CONFIG.wave.bossEvery === 0);
  h.pauseBtn.textContent = state.paused ? '▶' : '⏸';
  h.speedBtn.textContent = `▶▶${state.speedMultiplier}x`;
  layout.startBtn.hidden = state.phase !== 'prepare';
  layout.startBtn.disabled = state.paused;
}
