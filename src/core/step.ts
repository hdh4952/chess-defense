import type { GameEvent, GameState, Phase } from '../types';
import { updateCombat } from './combat';
import { moveEnemies, processLeaks } from './enemy';
import { updateSlowAura } from './slow';
import { checkWaveEnd, updatePrepare, updateSpawning } from './wave';

/**
 * 1틱 업데이트 — 스펙 10.2의 순서 그대로.
 * dt에는 speedMultiplier가 이미 곱해져 들어온다 (배속은 준비 시간·이동·쿨다운 모두 적용).
 */
export function stepGame(
  state: GameState, dt: number, events: GameEvent[],
  rng: () => number = Math.random,
  // ★ 지급 추첨은 **별도 난수원**이다. `= rng`로 두면 스폰 난수열에 draw가 끼어들어 파일
  // 시퀀스가 통째로 달라지고, 기존 헤드리스 측정이 조용히 다른 것을 재게 된다.
  grantRng: () => number = Math.random,
): void {
  if (state.paused || state.phase === 'victory' || state.phase === 'defeat') return;
  updatePrepare(state, dt);                 // 준비 시간 카운트다운
  updateSpawning(state, dt, events, rng);   // 적 스폰 타이머
  // ★ 순서가 규칙이다. 스폰 뒤여야 갓 나온 적이 첫 틱부터 감속 판정을 받고, 이동 앞이어야
  // 이번 틱에 오라로 들어온 적이 감속되지 않은 채 한 틱을 더 걷지 않는다.
  updateSlowAura(state, events);            // 감속 오라 재판정 (진입한 적만 이벤트)
  moveEnemies(state, dt);                   // 적 위치 갱신 (감속이 곱해진 속도로)
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
  checkWaveEnd(state, events, grantRng);    // 웨이브 종료/승리 판정 + 무작위 지급
}
