import { COMPACT_VIEW, WIDE_VIEW, type BoardView } from './coords';

/**
 * 이 화면이 어느 뷰를 받는가 (v1.36 — 모바일).
 *
 * ★ **CSS의 좁은 화면 판정과 글자 그대로 같은 질문**이다. 여백·글자 크기를 줄이는 규칙
 * (style.css의 `max-width: 560px` / `max-height: 560px`)과 킹 자리를 떼는 결정이 서로 다른
 * 문턱에서 일어나면, 그 사이 폭에서는 "빽빽한데 킹은 있다"거나 그 반대인 화면이 나온다.
 * 문자열을 여기 한 번만 적고 CSS와 맞춰 둔다.
 *
 * **짧은 쪽을 본다**는 것이 요점이다: 세로로 든 폰은 폭이, 가로로 눕힌 폰은 높이가 먼저
 * 동난다 — 어느 쪽이든 판에 내줄 자리가 없다는 뜻은 같다.
 */
export const COMPACT_MEDIA = '(max-width: 560px), (max-height: 560px)';

/**
 * ⚠️ `matchMedia`가 없는 환경(테스트·헤드리스)에서는 **넓은 뷰**로 떨어진다. 이 저장소의
 * 기존 측정·테스트가 전부 그 기하 위에 서 있으므로, 모르는 환경에서 조용히 다른 것을 재게
 * 두지 않는다.
 */
export function pickBoardView(): BoardView {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return WIDE_VIEW;
  return window.matchMedia(COMPACT_MEDIA).matches ? COMPACT_VIEW : WIDE_VIEW;
}
