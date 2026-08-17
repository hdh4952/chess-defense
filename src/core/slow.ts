import { slowMultiplier } from '../config';
import type { GameEvent, GameState, Piece, Square } from '../types';
import { enemySquare, squareKey } from './grid';
import { slowTargets } from './patterns';

/**
 * 감속 오라 — 나이트 계열이 L자 8칸의 적을 늦춘다 (v1.10, 폭발을 대체).
 *
 * 이 파일이 따로 있는 이유는 능력의 **시간 성질**이 다르기 때문이다. 폭발은 배치·이동
 * 순간의 사건이라 그 조작을 처리하는 pieces.ts 안에서 끝났지만, 감속은 서 있기만 하면
 * 걸리는 상태라 매 틱 재계산해야 한다 — 조작이 아니라 **틱 루프**에 속한다(step.ts).
 *
 * ★ 이 파일의 유일한 불변식: **중첩이 없다.** 여러 기물이 같은 칸을 덮어도 감속은 한 번만
 * 걸린다(사용자 결정). v1.13에서 티어별 세기가 생기면서 "한 번"의 뜻이 정확해졌다 —
 * **가장 높은 티어 하나**가 이기고, 나머지는 아무것도 더하지 않는다.
 *
 * 그 보장은 주의력이 아니라 자료구조에서 나온다. 아래 둘이 그 장치다.
 *   ① 칸 집합이 Map<칸, **티어**>다. 값이 최댓값 하나뿐이라 더하거나 곱할 대상이 없다.
 *   ② Enemy.slowTier도 **티어**지 배수가 아니다. 티어 둘을 곱하는 코드는 의미조차 없다.
 * v1.12까지는 ②가 boolean이었고 그것이 "티어 무관"을 강제했다. 세기 축이 생기면서 boolean은
 * 더 못 쓰지만, **배수 대신 티어를 담는다**는 선택이 같은 역할을 이어받는다 — 배수를 담으면
 * 언젠가 누군가 두 배수를 곱한다.
 */

/** 감속을 걸지 않는 상태. 티어는 1부터라 0이 "없음"을 뜻할 수 있다. */
export const NO_SLOW = 0;

/**
 * 지금 감속이 걸리는 칸과 그 칸을 지배하는 **티어**. 키는 squareKey.
 *
 * 값이 좌표가 아니라 티어인 것이 v1.13의 변화다 — 렌더가 좌표를 다시 만들어야 하지만
 * (squareKey를 파싱하지 않고 아래 slowFieldSquares가 함께 돌려준다), 대신 "이 칸이 얼마나
 * 느린가"라는 새 질문에 규칙과 그림이 **같은 값**으로 답하게 된다.
 *
 * `except` — 그 기물 하나를 없는 셈 치고 계산한다. 드래그 중인 기물을 원래 자리에서 빼고
 * "이 기물을 여기 놓으면 **새로** 덮이는 칸은 어디인가"를 그리는 데 쓴다.
 *
 * v1.12부터 모든 기물이 보드 위에 있으므로 트레이를 걸러내는 검사는 없다 — 타입이 보장한다.
 */
export function slowCoverage(state: GameState, except?: Piece | null): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of state.pieces) {
    if (p === except) continue;
    for (const sq of slowTargets(p.type, p.square)) {
      const k = squareKey(sq);
      // ★ 최댓값이다. 여기서 `+=`를 쓰면 중첩 금지가 그 자리에서 깨진다 — 이 한 줄이 규칙이다.
      const prev = out.get(k) ?? NO_SLOW;
      if (p.tier > prev) out.set(k, p.tier);
    }
  }
  return out;
}

/**
 * 감속 칸을 좌표와 함께 — 렌더 전용. slowCoverage와 **같은 순회**에서 나오므로 둘이 갈라질 수
 * 없다(칠해졌는데 안 느려지는 칸이 존재할 수 없다는 보장이 여기서 나온다).
 */
export function slowFieldSquares(state: GameState): { square: Square; tier: number }[] {
  const field = slowCoverage(state);
  const out: { square: Square; tier: number }[] = [];
  for (const p of state.pieces) {
    for (const sq of slowTargets(p.type, p.square)) {
      const tier = field.get(squareKey(sq));
      // 이 칸을 지배하는 기물이 자기 자신일 때만 담는다 → 칸당 정확히 한 번.
      if (tier === p.tier && !out.some(o => o.square.file === sq.file && o.square.rank === sq.rank)) {
        out.push({ square: sq, tier });
      }
    }
  }
  return out;
}

/**
 * 매 틱 각 적의 `slowTier`를 다시 판정하고, **감속이 새로 걸리거나 세진 적만** 알린다.
 *
 * 왜 매 틱 전체 재계산인가 — 감속은 적이 움직여서도, 기물이 움직여서도, 기물이 팔려서도,
 * **합성돼 티어가 올라서도** 바뀐다. 변화 지점마다 갱신 코드를 심으면 언젠가 한 경로가 빠지고
 * 원인 없이 계속 느린 적이 남는다.
 *
 * 왜 "세진" 경우도 알리는가 — v1.12까지는 걸림/안 걸림 둘뿐이라 false→true 전이만 사건이었다.
 * 티어가 생기면서 **T1 오라에서 T3 오라로 넘어가는 것도 실제로 일어난 일**이 됐고, 그때
 * 플레이어에게 새 수치(−40%)를 보여주지 않으면 화면이 옛 값을 말하게 된다. 반대로 약해질
 * 때는 알리지 않는다 — 표식의 목적이 "방금 무엇이 걸렸는가"이지 상태 중계가 아니기 때문이다.
 *
 * ⚠️ 호출 위치가 규칙이다 — moveEnemies **직전**이어야 한다(step.ts). 뒤로 밀면 이번 틱에
 * 오라로 들어온 적이 감속 없이 한 틱을 더 걷고, 앞의 updateSpawning보다 앞서면 이번 틱에
 * 갓 스폰된 적이 첫 틱을 감속 없이 걷는다.
 */
export function updateSlowAura(state: GameState, events: GameEvent[]): void {
  const field = slowCoverage(state);
  for (const e of state.enemies) {
    const now = field.get(squareKey(enemySquare(e))) ?? NO_SLOW;
    if (now > e.slowTier) {
      events.push({ kind: 'enemySlowed', enemyId: e.id, file: e.file, y: e.y, tier: now });
    }
    e.slowTier = now;
  }
}

/**
 * 이 칸에 서 있는 적이 받는 속도 배수 — 감속이 없으면 1.
 *
 * `updateSlowAura`가 쓰는 판정과 **같은 집합**에서 나오므로 둘이 갈라질 수 없다. 매 틱
 * 루프에서 쓰기에는 칸마다 집합을 새로 만들어 비효율이지만, 이 함수의 용도는 질의다 —
 * 테스트가 "이 칸이 정말 느린가, 얼마나"를 칸 단위로 묻는다.
 */
export function slowFactorAt(state: GameState, square: Square): number {
  const tier = slowCoverage(state).get(squareKey(square)) ?? NO_SLOW;
  return tier === NO_SLOW ? 1 : slowMultiplier(tier);
}

/**
 * 이 적이 지금 실제로 나아가는 속도. `speed`(영구 배수가 구워진 값)에 감속만 곱한다.
 *
 * createEnemy의 주석이 처음부터 이 형태를 요구했다 — "일시적 감속 같은 것이 생기면 speed가
 * 아니라 별도 상태로 둬야 한다. 여기 구우면 원래 속도로 되돌릴 방법이 사라진다."
 */
export function effectiveSpeed(e: { speed: number; slowTier: number }): number {
  return e.slowTier === NO_SLOW ? e.speed : e.speed * slowMultiplier(e.slowTier);
}
