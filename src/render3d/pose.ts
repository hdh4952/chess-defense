/**
 * 각도 불일치의 상수와 계산 — **잎 모듈** (v1.28에 분리).
 *
 * 원래 `pieces.ts`에 있었다. 소비처가 넷이 되면서(기물 · 적 · 플레이어 킹 · 오버레이) 그대로
 * 두면 순환이 생긴다: `scene → playerKing → pieces → scene`(pieces가 스킨 판 각도 때문에
 * `TILT`를 읽는다). 값과 순수 함수만 있는 파일로 빼면 넷 다 **아래로만** 의존한다 —
 * `render/palette.ts`를 뺐을 때와 같은 사유다.
 *
 * 각도 불일치가 무엇이고 왜 이 방향인지는 `render3d/pieces.ts`의 `LEAN` 주석에 있다.
 */

const DEG = Math.PI / 180;

/** 기물을 카메라 **반대쪽**으로 눕히는 각. 방향이 직관과 반대라는 점이 핵심이다(pieces.ts). */
export const LEAN = 40 * DEG;

/** 원근 단축 보정 — 가파른 카메라가 누른 세로를 자기 축으로 되돌린다. 눈으로 맞춘 값. */
export const STRETCH_Y = 1.18;

/**
 * 눕히고 늘린 뒤의 **실제 꼭대기 위치**(로컬, 밑동 기준).
 *
 * ⚠️ 이걸 빠뜨리면 체력바와 버프 배지가 몸통에 파묻힌다 — 머리는 지오메트리의 높이가 아니라
 * 세로로 `STRETCH_Y`배 늘어난 뒤 `LEAN`만큼 −Z로 넘어가 있다.
 */
export function leanedApex(height: number): { y: number; z: number } {
  const h = height * STRETCH_Y;
  return { y: h * Math.cos(LEAN), z: -h * Math.sin(LEAN) };
}
