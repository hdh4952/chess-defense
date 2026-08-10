import type { GameState } from '../types';
import type { Layout } from './layout';

/**
 * 일시정지 / 배속 2x / 탭 이탈 자동 일시정지 배선 (스펙 7.7). 배선은 1회만 호출.
 * 버튼 라벨(⏸/▶, ▶▶Nx)은 매 프레임 updateHud가 state로부터 다시 그린다 — 여기서는 state만 변경한다.
 */
export function wireControls(layout: Layout, state: GameState): void {
  layout.hud.pauseBtn.addEventListener('click', () => {
    if (state.phase === 'victory' || state.phase === 'defeat') return;
    state.paused = !state.paused;
  });
  layout.hud.speedBtn.addEventListener('click', () => {
    state.speedMultiplier = state.speedMultiplier === 1 ? 2 : 1;   // 이동·쿨다운·준비 시간 모두 적용
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && (state.phase === 'prepare' || state.phase === 'wave')) {
      state.paused = true;    // 자동 일시정지 (수동 해제만 가능, 스펙 7.7 — 절대 자동 재개하지 않는다)
    }
  });
}
