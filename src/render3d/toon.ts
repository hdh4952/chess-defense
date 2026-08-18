import * as THREE from 'three';

/**
 * 툰(셀) 셰이딩의 계조 램프 (v1.23).
 *
 * ★ **이 파일 하나가 "실사 → 카툰"의 절반이다.** `MeshStandardMaterial`은 빛의 세기를
 * 연속된 그라디언트로 칠해서 표면이 부드럽게 굴러가고, 그것이 곧 "실사 체스말"로 읽힌다.
 * `MeshToonMaterial`은 그 세기를 **계단으로 양자화**한다 — 명암이 뚝뚝 끊기면 눈은 그것을
 * 물체가 아니라 **그림**으로 읽는다.
 *
 * three는 그 계단을 **텍스처 한 장**으로 받는다. 픽셀 개수가 곧 단계 수이고, 필터는 반드시
 * `NearestFilter`여야 한다 — 선형 보간을 쓰면 계단이 다시 그라디언트로 뭉개져서 툰 재질을
 * 쓴 의미가 통째로 사라진다.
 */

/**
 * 3단계 램프 — 그늘 · 중간 · 광원면.
 *
 * ★ **왜 3단인가.** 2단은 조명 방향만 남고 형태가 사라져 기물이 종이 실루엣처럼 보인다
 * (카메라가 거의 수직이라 이 게임에서는 특히 치명적이다 — 판독 단서가 윗면 명암뿐이다).
 * 4단 이상은 다시 그라디언트에 가까워져 툰 느낌이 옅어진다. 3단이 "형태는 읽히되 계단은
 * 보이는" 지점이다.
 *
 * ★ **가장 어두운 단이 0이 아니다.** 0으로 두면 그늘진 면이 새까매져 흰 기물의 그늘과
 * 검은 적이 같은 색이 된다 — 진영 구분(스펙 8.1)이 그늘에서 무너진다. 0.55는 흰 기물의
 * 그늘이 여전히 "밝은 것의 그늘"로 남는 하한이다.
 */
const STEPS = [0.55, 0.8, 1.0];

let cached: THREE.DataTexture | null = null;

export function toonGradient(): THREE.DataTexture {
  if (cached) return cached;
  const data = new Uint8Array(STEPS.length * 4);
  STEPS.forEach((v, i) => {
    const b = Math.round(v * 255);
    data[i * 4] = b; data[i * 4 + 1] = b; data[i * 4 + 2] = b; data[i * 4 + 3] = 255;
  });
  const tex = new THREE.DataTexture(data, STEPS.length, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;      // ⚠️ 둘 다 Nearest여야 한다 (위 주석)
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  cached = tex;
  return tex;
}
