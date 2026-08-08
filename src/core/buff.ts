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
    if (q.type !== 'queen') continue;
    const covered = queenLines(q.square!);
    for (const p of onBoard) {
      if (p === q) continue;
      if (covered.some(sq => sameSquare(sq, p.square!))) p.queenBuffCount++;
    }
  }
}
