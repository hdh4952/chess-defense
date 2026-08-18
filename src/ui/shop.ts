import { drawCost } from '../config';
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
 * 매 프레임: 보유/필요 골드 갱신 + 골드 부족 / 보드 만석 / 일시정지 → 비활성화 (스펙 7.4).
 *
 * ★ **가격을 매 프레임 다시 쓴다** (v1.18). 뽑기 값이 뽑은 횟수에 따라 오르므로 버튼에
 * 고정 문구를 두면 실제로 깎이는 금액과 화면이 어긋난다 — 가챠에서 그 어긋남은 곧
 * "속았다"로 읽힌다.
 *
 * ★ **v1.27부터 보유 골드가 여기 함께 산다** (사용자 결정 — HUD에서 옮겨 왔다).
 * `보유 / 필요` 한 줄이면 "지금 뽑을 수 있나"가 두 수의 대소로 즉시 읽힌다 — 화면 반대편
 * 끝의 HUD 숫자와 버튼의 가격을 눈으로 오가며 비교할 필요가 없어진다.
 *
 * ⚠️ **`textContent`만 갈아 끼운다.** 골드는 초당 여러 번 바뀌므로(비숍 수입) 버튼 전체를
 * innerHTML로 다시 쓰면 그때마다 DOM을 재파싱한다. 구조는 `createLayout`이 한 번 만든다.
 */
export function updateShop(layout: Layout, state: GameState): void {
  const price = drawCost(state.draws);
  const text = `${state.gold} / ${price}`;
  if (layout.drawCost.textContent !== text) layout.drawCost.textContent = text;
  // ★ 골드 부족도 canDraw가 막으므로 버튼은 어차피 비활성이 된다 — 이 클래스가 하는 일은
  //   **비활성 사유를 가르는 것**이다. 회색 버튼만으로는 "돈이 모자라서"인지 "일시정지·보드
  //   만석이라서"인지 구분되지 않고, 그 둘은 플레이어가 해야 할 행동이 정반대다(기다린다 /
  //   자리를 만든다). 숫자를 붉게 물들여 전자만 따로 말한다(style.css).
  layout.drawBtn.classList.toggle('poor', state.gold < price);
  layout.drawBtn.disabled = !canDraw(state);
}
