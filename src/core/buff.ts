import type { GameState } from '../types';
import { sameSquare } from './grid';
import { queenLines } from './patterns';

/**
 * 퀸 버프 전체 재계산.
 * 트리거: 배치/이동/회수/판매/나이트 이동 직후 (스펙 10.5 — 매 프레임 금지).
 * 경로 차단 없음. 퀸 자신 칸 포함이지만 자기 자신은 공격이 없어 실효 없음 (스펙 5.6).
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
