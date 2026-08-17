import { buyPiece, canBuy } from '../core/economy';
import type { UiAudio } from '../audio';
import type { GameEvent, GameState, PieceType } from '../types';
import type { Layout } from './layout';

/**
 * 클릭 = **보드의 빈 칸 하나에 기물을 무작위 스폰**한다 (v1.12 — 예전에는 트레이 빈칸이었다).
 * 배선은 1회만 호출.
 *
 * 구매가 실제로 성공했을 때만 uiBuy를 울린다 — 버튼은 이미 canBuy로 비활성화되므로 실패 경로는
 * 정상적인 클릭으로는 도달하지 않지만, buyPiece의 반환값으로 판정해 그 사실에 기대지 않는다.
 *
 * ★ rng를 Math.random으로 **여기서** 고정한다. 구매는 UI 조작이라 stepGame 밖에서 일어나므로
 * 적 스폰 난수열과 애초에 섞이지 않는다(economy.randomEmptySquare 주석 참고). 테스트는
 * buyPiece를 직접 부르며 결정론적 난수를 주입한다.
 */
export function wireShop(
  layout: Layout, state: GameState, events: GameEvent[], audio: UiAudio,
): void {
  for (const [type, btn] of layout.shopButtons) {
    btn.addEventListener('click', () => {
      if (buyPiece(state, type, events, Math.random)) audio.playUi('uiBuy', performance.now());
    });
  }
}

/** 매 프레임: 골드 부족 / 보드 만석 / 일시정지 → 비활성화 (스펙 7.4) */
export function updateShop(layout: Layout, state: GameState): void {
  for (const [type, btn] of layout.shopButtons) {
    btn.disabled = !canBuy(state, type as PieceType);
  }
}
