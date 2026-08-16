/**
 * 강화 단계(tier) 색 — 캔버스(renderer.ts)와 DOM(ui/slots.ts, ui/drag.ts)이 함께 참조하는 단일
 * 출처. 사용자가 지정한 팔레트다: 흰(기본) → 녹 → 파 → 보 → 노 → 빨.
 *
 * 인덱스 = tier - 1. [0](T1 = 합성되지 않은 기본 기물)은 **어디에서도 그려지지 않는다** — T1까지
 * 링을 그리면 보드 위 모든 기물에 상시 테두리가 붙어, 선택(노랑)·이동 가능(초록)·사거리(주황)
 * 하이라이트와 매 프레임 경쟁하면서 정작 "이 기물은 강화됐다"는 신호가 묻힌다. 배열에 흰색을
 * 남겨 두는 것은 사용자가 지정한 6단계 팔레트를 그대로 보존하기 위해서이고, 그리지 않는다는
 * 규칙은 tierRingColor() 하나가 강제한다.
 *
 * 4단계 노랑은 선택 하이라이트(rgba(255,255,0,.5))·퀸 버프 배지(#ffd54a)와, 6단계 빨강은 8랭크
 * 스폰 경계선(#C83C32)과 색이 가깝다. 링에는 어두운 바깥 테두리를 함께 그려(renderer.ts의
 * drawTierRing) 반투명 하이라이트 위에서도 링이 독립적으로 읽히게 한다.
 */
export const TIER_COLORS = [
  '#FFFFFF',   // T1 기본 — 그리지 않는다 (tierRingColor가 null 반환)
  '#3BA55C',   // T2 녹
  '#3B82D6',   // T3 파
  '#8B5CF6',   // T4 보
  '#E0B400',   // T5 노
  '#DC3B3B',   // T6 빨
] as const;

/** tier에 해당하는 링 색. T1과 범위 밖은 null = 링 없음. */
export function tierRingColor(tier: number): string | null {
  if (tier <= 1) return null;
  return TIER_COLORS[Math.min(tier, TIER_COLORS.length) - 1];
}
