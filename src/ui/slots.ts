import { ALLY_SPRITE_URL } from '../render/sprites';
import { tierRingColor } from '../render/tiers';
import { PIECE_NAME } from './layout';
import type { GameState } from '../types';
import type { Layout } from './layout';

/** 매 프레임: 슬롯 칸에 기물 이미지 표시. data-piece-id는 드래그(Task 15)에서 사용 */
export function updateSlots(layout: Layout, state: GameState): void {
  const cells = layout.slotGrid.children;
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i] as HTMLElement;
    const piece = state.pieces.find(p => p.slotIndex === i);
    const html = piece
      ? `<img class="piece-icon slot-icon" src="${ALLY_SPRITE_URL[piece.type]}" alt="${PIECE_NAME[piece.type]}" draggable="false">`
      : '';
    if (cell.innerHTML !== html) cell.innerHTML = html;
    cell.dataset.pieceId = piece?.id ?? '';
    // 강화 단계 링. box-shadow inset을 쓰는 이유는 border가 .slot-cell(content-box)의 칸 크기를
    // 바꿔 그리드가 밀리기 때문이다. innerHTML diff와 달리 style은 매번 대입해도 되지만(같은 값
    // 대입은 브라우저가 무시한다), 링이 없을 때는 빈 문자열로 확실히 지운다.
    const ring = piece ? tierRingColor(piece.tier) : null;
    cell.style.boxShadow = ring ? `inset 0 0 0 2px ${ring}` : '';
  }
}
