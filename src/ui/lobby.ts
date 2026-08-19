import { DIFFICULTIES } from '../config';
import { selectedDifficulty, setDifficulty } from '../difficulty';
import type { Difficulty } from '../types';
import { CREDIT_HTML } from './layout';
// 로고는 Vite가 URL로 바꿔 준다(기물 스프라이트와 같은 방식 — render/skins.ts).
import logoUrl from '../assets/logo.png';

/**
 * 로비 — 난이도 셋과 BATTLE, 그게 전부다 (v1.37, 사용자 결정).
 *
 * ⚠️ **예전 시작 화면(`ui/titleScreen.ts`)은 지우지 않고 보관한다**(사용자 요청). 기물 8종
 * 설명 탭·사거리 그림·스킨 선택이 거기 있고, 그 화면이 유일한 자리였던 것도 있다(스킨 선택).
 * 되살릴 때는 `main.ts`의 호출 한 줄만 바꾸면 된다 — 그래서 여기서도 **같은 계약**을 지킨다:
 * `(app, onBattle)`을 받고, 고른 난이도를 누른 순간에 넘긴다.
 *
 * ★ **이름은 난이도 키에서 유도한다.** `DIFFICULTY_NAME`(이지/노멀/하드)이 아니라 키를
 * 대문자로 쓴 것은 사용자가 EASY/NORMAL/HARD라고 지정했기 때문이고, 목록 자체를
 * `DIFFICULTIES`에서 뽑는 것은 난이도를 하나 더 넣어도 이 파일이 그대로이기 위해서다.
 */
export function createLobby(app: HTMLElement, onBattle: (difficulty: Difficulty) => void): void {
  // 게임 화면 전용 높이 고정(#app.in-game)을 반드시 푼다 — createLayout이 붙인 채로 돌아오는
  // 경로가 생기면 로비가 그 규칙 아래 놓인다(style.css).
  app.classList.remove('in-game');

  const buttons = DIFFICULTIES
    .map(d => `<button class="lobby-diff" type="button" data-difficulty="${d}"`
      + ` aria-pressed="false">${d.toUpperCase()}</button>`)
    .join('');

  app.innerHTML = `
    <div id="lobby">
      <!-- ★ 로고 (v1.37.1). alt는 그림 안의 글자를 그대로 옮긴다 — 그림이 뜨지 않거나
           화면 낭독기로 읽을 때 이 화면에 남는 유일한 이름이다. 크기를 속성으로 함께
           적어 두면 로고가 늦게 도착해도 아래 버튼들이 밀려 올라갔다 내려오지 않는다.
           ⚠️ 이 문자열은 템플릿 리터럴 안이라 역따옴표를 쓸 수 없다. -->
      <img id="lobby-logo" src="${logoUrl}" alt="CHESS RANDOM DEFENSE"
           width="2172" height="724" decoding="async" draggable="false">
      <div id="lobby-difficulty" role="group" aria-label="난이도">${buttons}</div>
      <button id="battle" type="button">BATTLE</button>
      ${CREDIT_HTML}
    </div>`;

  const picks = [...app.querySelectorAll<HTMLButtonElement>('.lobby-diff')];
  /** 고른 것 하나만 눌린 상태로 둔다. 상태의 출처는 DOM이 아니라 `selectedDifficulty()`다 —
   *  저장값이 있으면 다시 열었을 때도 그 선택이 그대로 살아 있어야 한다. */
  const sync = (): void => {
    const now = selectedDifficulty();
    for (const b of picks) b.setAttribute('aria-pressed', String(b.dataset.difficulty === now));
  };

  for (const b of picks) {
    b.addEventListener('click', () => {
      setDifficulty(b.dataset.difficulty as Difficulty);
      sync();
    });
  }
  sync();

  app.querySelector<HTMLButtonElement>('#battle')!
    // ⚠️ 넘기는 값은 **누른 순간에** 읽는다. 클로저에 미리 담아 두면 그 뒤에 바꾼 선택이
    //    반영되지 않는다(archive된 시작 화면도 같은 이유로 이렇게 돼 있다).
    .addEventListener('click', () => onBattle(selectedDifficulty()));
}
