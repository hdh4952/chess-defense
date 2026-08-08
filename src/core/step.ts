import type { GameEvent, GameState, Phase } from '../types';
import { updateCombat } from './combat';
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
  updateCombat(state, dt, events);          // 기물 쿨다운 → 공격 판정 → 처치/골드
  processLeaks(state, events);              // 1랭크 통과 → 체력 감소
  // 위 첫 줄의 이른 반환(state.phase === 'victory' | 'defeat')으로 TypeScript는 이 지점의
  // state.phase를 'prepare' | 'wave'로 좁혀 둔 채, 그 사이의 processLeaks(state, events) 호출이
  // 내부에서 state.phase = 'defeat'를 대입할 수 있다는 사실은 추적하지 못한다 — 객체 프로퍼티의
  // 좁혀진 타입은 그 프로퍼티를 바꿀 수도 있는 함수 호출을 지나도 자동으로 무효화되지 않는다.
  // 그래서 캐스트 없이 비교하면 "두 타입이 겹치지 않는다"는 TS2367 컴파일 에러가 난다 — 이 캐스트는
  // 오직 컴파일러를 설득하기 위한 것이고, 런타임에는 완전히 지워지며 값에는 아무 영향도 주지 않는다.
  // 미래에 "중복 검사처럼 보인다"며 지우면 그 컴파일 에러가 그대로 재발한다.
  if ((state.phase as Phase) === 'defeat') return;     // 즉시 정지 (스펙 10.5)
  checkWaveEnd(state, events);              // 웨이브 종료/승리 판정
}
