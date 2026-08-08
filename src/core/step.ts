import type { GameEvent, GameState, Phase } from '../types';
import { moveEnemies, processLeaks } from './enemy';
import { checkWaveEnd, updatePrepare, updateSpawning } from './wave';

/**
 * 1틱 업데이트 — 스펙 10.2의 순서 그대로.
 * dt에는 speedMultiplier가 이미 곱해져 들어온다 (배속은 준비 시간·이동·쿨다운 모두 적용).
 */
export function stepGame(
  state: GameState, dt: number, events: GameEvent[], rng: () => number = Math.random,
): void {
  if (state.paused || state.phase === 'victory' || state.phase === 'defeat') return;
  updatePrepare(state, dt);                 // 준비 시간 카운트다운
  updateSpawning(state, dt, events, rng);   // 적 스폰 타이머
  moveEnemies(state, dt);                   // 적 위치 갱신
  // (Task 13) 여기에 updateCombat(state, dt, events) 호출이 추가된다
  processLeaks(state, events);              // 1랭크 통과 → 체력 감소
  if ((state.phase as Phase) === 'defeat') return;     // 즉시 정지 (스펙 10.5)
  checkWaveEnd(state, events);              // 웨이브 종료/승리 판정
}
