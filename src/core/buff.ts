import { TRAITS, tierMultiplier } from '../config';
import type { GameState } from '../types';
import { sameSquare } from './grid';
import { queenLines } from './patterns';

/**
 * 퀸 버프 전체 재계산.
 * 트리거: 배치/이동/회수/판매/나이트 이동 직후 (스펙 10.5 — 매 프레임 금지).
 * 경로 차단 없음. 퀸 자신은 자기 버프 계산에서 명시적으로 제외된다(if (p === q) continue) —
 * "포함되지만 실효가 없는" 것이 아니라 애초에 대상에서 빠진다 (스펙 5.6).
 */
export function recalcQueenBuffs(state: GameState): void {
  for (const p of state.pieces) p.queenBuffCount = 0;
  const onBoard = state.pieces.filter(p => p.square !== null);
  for (const q of onBoard) {
    const factor = TRAITS[q.type].buffFactor;
    if (factor === 0) continue;
    const covered = queenLines(q.square!);
    for (const p of onBoard) {
      if (p === q) continue;
      // 퀸의 유일한 능력치가 버프이므로 합성되면 버프가 합해진다 — T2 퀸 하나가 T1 퀸 둘과
      // 정확히 같은 +2를 준다(비용도 1,800G로 같다). 합성이 손해도 이득도 아니게 만드는 조건이다.
      if (covered.some(sq => sameSquare(sq, p.square!))) p.queenBuffCount += tierMultiplier(q.tier) * factor;
    }
  }
}
