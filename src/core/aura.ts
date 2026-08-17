import { CONFIG } from '../config';
import type { GameEvent, GameState } from '../types';
import { killEnemy } from './combat';
import { enemySquare } from './grid';

/**
 * 오라 — 오라형 적이 주변 적에게 **추가 유효 체력**을 얹는다 (v1.14).
 *
 * 감속 오라(core/slow.ts)와 성질이 같다: 위치로 결정되는 지속 상태라 매 틱 재계산해야 하고,
 * 파생값을 별도 필드에 담는다. 다른 점은 **적이 적에게 건다**는 것뿐이다.
 *
 * ★ 이 파일의 규칙은 하나다: **피해는 낭비되지 않는다.**
 * 보너스를 hp에 더하지 않고 별도로 들기 때문에 hp는 음수로 내려갈 수 있고, 오라가 죽어
 * 보너스가 0이 되는 순간 적립된 음수가 한꺼번에 사망으로 바뀐다. 그래서 플레이어에게
 * **두 선택이 모두 성립한다** — 오라를 먼저 끊어 적립분을 터뜨릴 것인가, 그냥 뚫을 것인가.
 * 흡수(피해를 없앰) 방식으로 만들면 오라가 살아 있는 동안 넣은 피해가 전부 버려져 "오라를
 * 먼저 죽여라" 한 갈래만 남는다.
 *
 * ⚠️ **maxHp를 건드리지 않는 것도 규칙이다.** maxHp는 처치 보상 골드이므로 체력을 올리면
 * 골드가 함께 오른다(N1a·N1b가 그 값을 감시한다). 오라는 난이도만 올리고 수입은 건드리지
 * 않는다.
 */

/** 오라가 닿는 범위 — 체비쇼프 거리(칸). 파일과 랭크 중 **먼 쪽**으로 잰다. */
function withinRadius(a: { file: number; rank: number }, b: { file: number; rank: number }, r: number): boolean {
  return Math.max(Math.abs(a.file - b.file), Math.abs(a.rank - b.rank)) <= r;
}

/**
 * 매 틱 각 적의 `auraBonus`를 다시 계산하고, **보너스가 사라져 이제 죽은 적을 정산한다.**
 *
 * ★ 오라형은 **자기 자신에게는 걸지 않는다.** "주변 적"의 정의에 자기가 들어가면 오라형
 * 하나가 홀로 있어도 체력이 늘어, "우선 처치 대상"이라는 이 유형의 역할이 흐려진다.
 *
 * ★ 중첩은 **된다** — 오라형 둘의 범위가 겹치면 보너스가 합쳐진다. 감속(중첩 금지)과
 * 반대로 둔 이유는 역할이 다르기 때문이다: 감속은 플레이어가 쌓는 것이라 상한이 필요했고,
 * 오라는 적이 쌓는 것이라 "오라형이 몰려 있으면 더 위험하다"가 곧 의도다.
 *
 * ⚠️ 호출 위치가 규칙이다 — moveEnemies **뒤**, updateCombat **앞**이어야 한다(step.ts).
 * 뒤에 있으면 이번 틱의 피해가 낡은 보너스로 판정되고, processLeaks보다 뒤로 가면 적립분이
 * 성립하기 전에 적이 통과한다.
 *
 * 스윕이 한 틱 늦는 것은 의도다: 오라가 죽은 프레임에는 아직 옛 보너스가 남아 있고, 다음
 * 프레임에 한꺼번에 터진다. 그 한 프레임의 지연이 화면에서는 연쇄 반응으로 읽힌다.
 */
export function updateAura(state: GameState, events: GameEvent[]): void {
  const bonus = CONFIG.traitDefs.aura.auraBonusHp ?? 0;
  const radius = CONFIG.traitDefs.aura.auraRadius ?? 0;
  const sources = bonus > 0 && radius > 0
    ? state.enemies.filter(e => e.traits.includes('aura'))
    : [];

  for (const e of state.enemies) {
    let total = 0;
    if (sources.length > 0) {
      const at = enemySquare(e);
      for (const src of sources) {
        if (src === e) continue;                       // 자기 자신에게는 걸지 않는다
        if (withinRadius(at, enemySquare(src), radius)) total += bonus;
      }
    }
    e.auraBonus = total;
  }

  // 보너스가 줄어(또는 사라져) 이제 죽은 적을 정산한다. 배열을 복사해 순회하는 이유는
  // killEnemy가 state.enemies를 splice하고 분열형이면 push까지 하기 때문이다.
  for (const e of [...state.enemies]) {
    if (e.hp + e.auraBonus <= 0) killEnemy(state, e, events);
  }
}
