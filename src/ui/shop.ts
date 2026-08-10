import { buyPiece, canBuy } from '../core/economy';
import type { GameState, PieceType } from '../types';
import type { Layout } from './layout';

/** 클릭 = 슬롯 빈칸에 기물 추가 (스펙 7.5). 배선은 1회만 호출 */
export function wireShop(layout: Layout, state: GameState): void {
  for (const [type, btn] of layout.shopButtons) {
    btn.addEventListener('click', () => { buyPiece(state, type); });
  }
}

/** 매 프레임: 골드 부족/만석/일시정지 → 비활성화 (스펙 7.4) */
export function updateShop(layout: Layout, state: GameState): void {
  for (const [type, btn] of layout.shopButtons) {
    btn.disabled = !canBuy(state, type as PieceType);
  }
}
