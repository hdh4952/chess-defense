import { CONFIG, drawCost } from '../config';
import { canDraw, drawPiece } from '../core/economy';
import type { UiAudio } from '../audio';
import type { GameEvent, GameState } from '../types';
import type { Layout } from './layout';

/**
 * 뽑기 버튼 배선 (v1.16). 배선은 1회만 호출.
 *
 * ★ 예전에는 기물별 구매 버튼 5개였다. 사용자 결정으로 **기물을 얻는 유일한 구매 경로가
 * 뽑기**가 되면서 버튼도 하나가 됐다 — 무엇이 나올지 고를 수 없으므로 고를 UI도 없다.
 *
 * 뽑기가 실제로 성공했을 때만 uiBuy를 울린다. 버튼은 이미 canDraw로 비활성화되므로 실패
 * 경로는 정상적인 클릭으로는 도달하지 않지만, drawPiece의 반환값으로 판정해 그 사실에
 * 기대지 않는다.
 *
 * ★ rng를 Math.random으로 **여기서** 고정한다. 뽑기는 UI 조작이라 stepGame 밖에서 일어나므로
 * 적 스폰 난수열과 애초에 섞이지 않는다(economy.randomEmptySquare 주석 참고). 테스트는
 * drawPiece를 직접 부르며 결정론적 난수를 주입한다.
 */
export function wireShop(
  layout: Layout, state: GameState, events: GameEvent[], audio: UiAudio,
): void {
  layout.drawBtn.addEventListener('click', () => {
    if (drawPiece(state, events, Math.random)) audio.playUi('uiBuy', performance.now());
  });
}

/**
 * 매 프레임: 가격 갱신 + 골드 부족 / 보드 만석 / 일시정지 → 비활성화 (스펙 7.4).
 *
 * ★ **가격을 매 프레임 다시 쓴다** (v1.18). 뽑기 값이 뽑은 횟수에 따라 오르므로 버튼에
 * 고정 문구를 두면 실제로 깎이는 금액과 화면이 어긋난다 — 가챠에서 그 어긋남은 곧
 * "속았다"로 읽힌다. 증가분도 함께 적어 **왜 비싸지는지**를 화면이 스스로 설명하게 한다.
 */
export function updateShop(layout: Layout, state: GameState): void {
  const price = drawCost(state.draws);
  const html = `기물 뽑기<br><small>${price}G`
    + (CONFIG.gacha.costStep > 0 ? ` · 다음 ${price + CONFIG.gacha.costStep}G` : '')
    + '</small>';
  if (layout.drawBtn.innerHTML !== html) layout.drawBtn.innerHTML = html;
  layout.drawBtn.disabled = !canDraw(state);
}
