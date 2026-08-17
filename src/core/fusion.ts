import type { PieceType } from '../types';

/**
 * 이종 융합 레시피 — 서로 다른 종류의 기물을 겹쳐 **제3의 기물**을 만든다.
 *
 * 동종 합성(같은 종류·같은 티어 → 티어 +1)이 화력을 **압축**한다면, 이종 융합은 역할을
 * **겸업**시킨다. 셋 다 나이트를 재료로 쓰는 것이 핵심이다 — 나이트는 자동 공격이 없어
 * 칸을 차지하는 값을 못 하는데, 융합물은 재료의 주기 공격과 나이트의 감속을 한 칸에서
 * 겸한다 (v1.10 — 예전에는 이동 폭발이었다). 그래서 능력치를 재료 합으로 둬도(= 골드 중립) 만들 이유가 생긴다.
 *
 * 레시피는 페어리 체스의 실제 기물을 그대로 쓴다. 체스를 아는 사람은 "나이트+비숍"이
 * 아치비숍이라는 것을 설명 없이 짐작할 수 있다.
 *
 * ⚠️ **동종 조합을 여기 넣지 말 것.** resolveLanding은 동종 분기를 먼저 보고, 이 표는 그
 * 뒤에만 참조된다. 동종 키를 넣어도 도달하지 않으므로 규칙이 두 곳으로 갈라질 뿐이다.
 */
const RECIPES: ReadonlyArray<readonly [PieceType, PieceType, PieceType]> = [
  ['knight', 'bishop', 'archbishop'],
  ['knight', 'rook', 'chancellor'],
  ['knight', 'queen', 'amazon'],
];

/**
 * 두 기물 종류의 융합 결과. 레시피가 없으면 null.
 *
 * **교환법칙이 성립해야 한다** — 플레이어는 나이트를 비숍 위로 끌 수도, 비숍을 나이트 위로
 * 끌 수도 있고 둘 다 같은 아치비숍이 나와야 한다. 방향에 따라 결과가 갈리면 그 자체가 규칙
 * 구멍이고, 미리보기와 실제 결과가 어긋나는 경로가 된다.
 */
export function fusionResult(a: PieceType, b: PieceType): PieceType | null {
  for (const [x, y, result] of RECIPES) {
    if ((a === x && b === y) || (a === y && b === x)) return result;
  }
  return null;
}

/** 이 기물이 어떤 레시피의 재료로든 쓰이는가 — 설명 UI가 힌트를 띄울지 정하는 데 쓴다. */
export function isFusionMaterial(type: PieceType): boolean {
  return RECIPES.some(([x, y]) => x === type || y === type);
}

/** 레시피 전체 (설명 화면·테스트용). 표를 두 곳에 적지 않기 위해 읽기 전용으로 내보낸다. */
export const FUSION_RECIPES = RECIPES;
