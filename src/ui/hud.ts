import { CONFIG, waveTotal } from '../config';
import { remainingEnemies } from '../core/wave';
import type { GameState } from '../types';
import type { Layout } from './layout';

export function updateHud(layout: Layout, state: GameState): void {
  const h = layout.hud;
  // ★ **체력은 여기 없다** (v1.28, 사용자 결정). 판 밖에 선 플레이어 킹의 체력바가 그 값을
  //   보인다(render3d/overlay.ts) — "킹 = 플레이어"가 읽히려면 숫자가 HUD에 남아 있으면 안 된다.
  //   같은 값이 두 곳에 있으면 하나는 반드시 조용히 낡는다.
  //   ⚠️ `♚ 여유 N`(보스를 몇 번 더 놓쳐도 버티는가)도 함께 사라졌다 — 킹 막대 위의 숫자에서
  //   여전히 셀 수 있지만, 그 계산을 화면이 대신 해 주지는 않는다.
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
  // ★ **숨기지 않고 비활성화한다** (v1.32, 사용자 결정). 웨이브 중에 버튼이 사라지면 그 자리가
  //   비어 아래 조작 줄의 배치가 통째로 움직이고, 무엇보다 "지금은 못 누른다"와 "그런 기능이
  //   없다"가 구분되지 않는다. 회색으로 남겨 두면 둘 다 해결된다(style.css의 :disabled).
  layout.startBtn.disabled = state.phase !== 'prepare' || state.paused;
}
