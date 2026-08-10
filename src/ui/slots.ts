import { ALLY_GLYPH } from '../render/renderer';
import type { GameState } from '../types';
import type { Layout } from './layout';

/** 매 프레임: 슬롯 칸에 기물 글리프 표시. data-piece-id는 드래그(Task 15)에서 사용 */
export function updateSlots(layout: Layout, state: GameState): void {
  const cells = layout.slotGrid.children;
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i] as HTMLElement;
    const piece = state.pieces.find(p => p.slotIndex === i);
    const html = piece ? `<span class="glyph ally">${ALLY_GLYPH[piece.type]}</span>` : '';
    if (cell.innerHTML !== html) cell.innerHTML = html;
    cell.dataset.pieceId = piece?.id ?? '';
  }
}
