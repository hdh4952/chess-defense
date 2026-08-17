import { CONFIG } from '../config';
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
 * ★ 이 파일의 유일한 불변식: **중첩이 없다.** 나이트가 몇 기든, 티어가 몇이든, 감속당한
 * 적의 배수는 정확히 CONFIG.slowAura.multiplier 한 번이다(사용자 결정). 그 보장은 주의력이
 * 아니라 자료구조에서 나온다 — 아래 두 장치가 그것이다.
 *   ① 칸 집합이 Map<string, Square>다. 같은 칸을 셋이 덮어도 원소는 하나다.
 *   ② Enemy.slowed가 boolean이다. 배수를 담을 자리가 아예 없다.
 * 배수를 곱해 쌓는 코드는 이 두 타입 위에서 **쓸 수가 없다.**
 */

/**
 * 지금 감속이 걸리는 칸 전부. 키는 squareKey, 값은 그 칸 자체(렌더가 좌표를 다시 만들지
 * 않도록).
 *
 * `except` — 그 기물 하나를 없는 셈 치고 계산한다. 드래그 중인 기물을 원래 자리에서 빼고
 * "이 기물을 여기 놓으면 **새로** 덮이는 칸은 어디인가"를 그리는 데 쓴다. 이 인자가 없으면
 * 미리보기가 제자리 기물의 오라를 자기 자신과 겹쳐 세어, 이미 덮인 칸을 새 칸처럼 보여준다.
 *
 * ⚠️ v1.12 이전에는 트레이 기물(square === null)을 걸러내는 검사가 여기 있었다. 기물 보관함이
 * 사라져 모든 기물이 보드 위에 있으므로 그 검사가 필요 없다 — 타입이 그것을 보장한다.
 */
export function slowCoverage(state: GameState, except?: Piece | null): Map<string, Square> {
  const out = new Map<string, Square>();
  for (const p of state.pieces) {
    if (p === except) continue;
    for (const sq of slowTargets(p.type, p.square)) out.set(squareKey(sq), sq);
  }
  return out;
}

/**
 * 매 틱 각 적의 `slowed`를 다시 판정하고, **막 걸린 적만** 이벤트로 알린다.
 *
 * 왜 매 틱 전체 재계산인가 — 감속은 적이 움직여서도, 기물이 움직여서도, 기물이 팔려서도
 * 바뀐다. 변화 지점마다 갱신 코드를 심으면 언젠가 한 경로가 빠지고 **원인 없이 계속 느린
 * 적**이 남는다. 재계산은 O(기물 × 8 + 적)이라 최악(기물 64 · 적 46)에도 프레임당 550회
 * 남짓이고, 이 게임의 다른 매 틱 순회들과 같은 자릿수다.
 *
 * 왜 전이에서만 이벤트를 내는가 — 매 틱 발행하면 60fps × 적 수만큼 쏟아져 이펙트도 소리도
 * 쓸 수 없다. 더 중요한 것은 **전이만이 실제로 일어난 사건**이라는 점이다: 이미 감속된 적이
 * 다른 나이트의 범위로 넘어갈 때는 중첩이 없으므로 정말 아무 일도 일어나지 않는다.
 *
 * ⚠️ 호출 위치가 규칙이다 — moveEnemies **직전**이어야 한다(step.ts). 뒤로 밀면 이번 틱에
 * 오라로 들어온 적이 감속 없이 한 틱을 더 걷고, 앞의 updateSpawning보다 앞서면 이번 틱에
 * 갓 스폰된 적이 첫 틱을 감속 없이 걷는다.
 */
export function updateSlowAura(state: GameState, events: GameEvent[]): void {
  const field = slowCoverage(state);
  for (const e of state.enemies) {
    const now = field.has(squareKey(enemySquare(e)));
    if (now && !e.slowed) {
      events.push({ kind: 'enemySlowed', enemyId: e.id, file: e.file, y: e.y });
    }
    e.slowed = now;
  }
}

/**
 * 이 칸에 서 있는 적이 받는 속도 배수 — 감속이면 multiplier, 아니면 1.
 *
 * `updateSlowAura`가 쓰는 판정과 **같은 집합**에서 나오므로 둘이 갈라질 수 없다. 매 틱
 * 루프에서 쓰기에는 칸마다 집합을 새로 만들어 비효율이지만, 이 함수의 용도는 질의다 —
 * 테스트가 "이 칸이 정말 느린가"를 칸 단위로 묻고, 그 답이 렌더가 칠하는 칸과 일치하는지
 * 확인한다. 틱 루프는 updateSlowAura가 집합을 한 번만 만들어 쓴다.
 */
export function slowFactorAt(state: GameState, square: Square): number {
  return slowCoverage(state).has(squareKey(square)) ? CONFIG.slowAura.multiplier : 1;
}

/**
 * 이 적이 지금 실제로 나아가는 속도. `speed`(영구 배수가 구워진 값)에 감속만 곱한다.
 *
 * createEnemy의 주석이 처음부터 이 형태를 요구했다 — "일시적 감속 같은 것이 생기면 speed가
 * 아니라 별도 상태로 둬야 한다. 여기 구우면 원래 속도로 되돌릴 방법이 사라진다." 감속은
 * 적이 칸을 벗어나면 풀려야 하므로 그 경고가 정확히 이 능력을 가리키고 있었다.
 */
export function effectiveSpeed(e: { speed: number; slowed: boolean }): number {
  return e.slowed ? e.speed * CONFIG.slowAura.multiplier : e.speed;
}
