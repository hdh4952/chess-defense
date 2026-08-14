import { buyPiece, canBuy } from '../core/economy';
import type { UiAudio } from '../audio';
import type { GameState, PieceType } from '../types';
import type { Layout } from './layout';

/** 클릭 = 슬롯 빈칸에 기물 추가 (스펙 7.5). 배선은 1회만 호출.
 *  구매가 실제로 성공했을 때만 uiBuy를 울린다 — 버튼은 이미 canBuy로 비활성화되므로 실패 경로는
 *  정상적인 클릭으로는 도달하지 않지만, buyPiece의 반환값(성공한 Piece | 실패한 null)으로
 *  판정해 그 사실에 기대지 않는다. */
export function wireShop(layout: Layout, state: GameState, audio: UiAudio): void {
  for (const [type, btn] of layout.shopButtons) {
    btn.addEventListener('click', () => {
      if (buyPiece(state, type)) audio.playUi('uiBuy', performance.now());
    });
  }
}

/** 매 프레임: 골드 부족/만석/일시정지 → 비활성화 (스펙 7.4) */
export function updateShop(layout: Layout, state: GameState): void {
  for (const [type, btn] of layout.shopButtons) {
    btn.disabled = !canBuy(state, type as PieceType);
  }
}
