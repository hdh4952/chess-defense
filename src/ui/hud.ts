import { CONFIG, waveTotal } from '../config';
import { remainingEnemies } from '../core/wave';
import type { GameState } from '../types';
import type { Layout } from './layout';

export function updateHud(layout: Layout, state: GameState): void {
  const h = layout.hud;
  h.hp.textContent = String(state.hp);
  // 보스 여유 — **고정 표기가 아니라 유도값이다.** 일반 누수가 이 값을 갉아먹기 때문이다:
  // 체력 10·6이면 1회지만 체력 5면 0회다. 유도해야 두 패배 축(일반 누수와 보스 누수)이
  // 화면에서 하나로 연결된다. 규칙으로 "보스 2회 = 즉사"를 못박지 않는 이유도 같다 —
  // 체력 5 이하에서는 보스 1회로도 죽으므로 그 규칙이 오히려 거짓이 된다.
  const bossRoom = Math.max(0, Math.ceil(state.hp / CONFIG.player.hpLossBoss) - 1);
  h.bossRoom.textContent = `♚ 여유 ${bossRoom}`;
  h.bossRoom.classList.toggle('danger', bossRoom === 0);
  h.gold.textContent = String(state.gold);
  h.wave.textContent = `${state.wave}/${waveTotal(state.difficulty)}`;
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
