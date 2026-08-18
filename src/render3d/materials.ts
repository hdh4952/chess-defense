import * as THREE from 'three';
import { TIER_COLORS } from '../render/tiers';
import { toonGradient } from './toon';

/**
 * 재질 — ★ v1.23에서 전부 툰(셀) 셰이딩으로 갈아탔다.
 *
 * 색은 2D 시절의 팔레트를 그대로 잇는다 — 아군은 화이트 세트, 적은 블랙 세트라는 진영
 * 구분(스펙 8.1)이 스타일이 바뀌어도 첫 번째 단서다(사용자 결정: "진영 구분은 화이트/블랙
 * 그대로"). 바뀐 것은 **명암을 칠하는 방식**이지 무엇이 무슨 색인가가 아니다.
 *
 * ★ **`roughness`·`metalness`가 사라진 것이 이 전환의 요약이다.** 둘은 "표면이 빛을 물리적으로
 * 어떻게 되던지는가"를 말하는 값이고, 툰 셰이딩은 애초에 그 질문을 하지 않는다 — 빛의 세기를
 * 계단으로 끊어 칠할 뿐이다. 남은 손잡이는 색과 계조 램프(toon.ts) 둘뿐이다.
 *
 * ★ **공유와 복제를 나누는 기준은 그대로다**: "이 개체만 바뀌는 값이 있는가". 아군 몸통은
 * 모든 기물이 같은 상아색이라 하나를 공유하고, 적 몸통은 피격 플래시(emissive)가 개체마다
 * 따로 켜지므로 반드시 복제한다. 공유 재질에 플래시를 걸면 한 마리가 맞을 때 판 위 모든
 * 적이 번쩍인다.
 */

/**
 * 아군 몸통 — 상아.
 *
 * ★ **v1.22의 `#F8F1E2`보다 밝고 채도를 조금 올렸다.** 툰은 가장 밝은 면을 램프 최상단(1.0)
 * 으로 칠하므로 PBR 시절보다 중간톤이 사라진다 — 원래 색이 어중간하면 기물이 회색으로
 * 읽힌다. 캐주얼 아트에서 흰 말은 "회색빛 상아"가 아니라 **크림색**이다.
 */
export const ALLY_BODY = new THREE.MeshToonMaterial({
  color: 0xFCF3E0, gradientMap: toonGradient(),
});

/** 아군 부속물(퀸·아마존의 관 구슬). 몸통과 확실히 갈리도록 한 단계 더 진한 크림. */
export const ALLY_ACCENT = new THREE.MeshToonMaterial({
  color: 0xE8D3A6, gradientMap: toonGradient(),
});

const tierCache = new Map<number, THREE.MeshToonMaterial>();

/**
 * 티어 링 재질. 색은 render/tiers.ts의 단일 출처를 그대로 쓴다 — DOM(드래그 고스트)과
 * 3D 보드가 같은 표를 보므로 티어 색이 두 곳에서 갈라질 수 없다.
 *
 * ★ 툰이 되면서 **자체 발광이 필요 없어졌다.** PBR에서는 링이 어두운 면에서 탁해져 색을
 * 알아보기 어려워 emissive를 조금 섞었는데, 툰 램프는 가장 어두운 단도 0.55라 색이 그대로
 * 남는다 — 램프가 하던 일을 emissive로 대신하고 있었던 셈이다.
 */
export function tierMaterial(tier: number): THREE.MeshToonMaterial {
  let m = tierCache.get(tier);
  if (!m) {
    const hex = TIER_COLORS[Math.min(tier, TIER_COLORS.length) - 1];
    m = new THREE.MeshToonMaterial({ color: new THREE.Color(hex), gradientMap: toonGradient() });
    tierCache.set(tier, m);
  }
  return m;
}

/**
 * 적 몸통 — **개체마다 새로 만든다**(위 ★ 참고).
 *
 * ★ 순검정이 아니라 **아주 어두운 청보라**다. 캐주얼 아트에서 순검정(#000 계열)은 구멍처럼
 * 보이고 형태가 사라진다 — 색조를 조금 넣으면 툰 램프의 세 단이 실제로 구분돼 실루엣 안쪽의
 * 형태가 읽힌다. 그래도 밝은 칸 위에서 "검은 말"로 읽히는 명도는 그대로 지킨다.
 */
export function createEnemyMaterial(isBoss: boolean): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({
    color: isBoss ? 0x3A2033 : 0x2B2836,
    gradientMap: toonGradient(),
    emissive: new THREE.Color(isBoss ? 0x6B1220 : 0x000000),
    emissiveIntensity: isBoss ? 0.22 : 0,
  });
}

/** 보드 슬래브 옆면 — 윗면 체커보다 한 단계 진한 나무색. */
export const SLAB_SIDE = new THREE.MeshToonMaterial({
  color: 0x6B4A32, gradientMap: toonGradient(),
});
