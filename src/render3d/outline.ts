import * as THREE from 'three';
import { VIEW_H, VIEW_W } from './coords';

/**
 * 윤곽선 — 인버티드 헐(inverted hull) (v1.23).
 *
 * ★ **카툰 신호 1순위다.** 셰이딩을 계단으로 바꾸는 것보다 윤곽선 하나가 "그림 같다"는
 * 인상에 더 크게 기여한다. 방법은 같은 지오메트리를 **뒷면만(`BackSide`)** 한 번 더 그리되
 * 정점을 법선 방향으로 밀어내는 것이다 — 밀려난 뒷면은 대부분 원래 앞면에 가려지고,
 * **실루엣에서만** 삐져나와 테두리가 된다.
 *
 * ★★ **v1.24(원근 쿼터뷰)에서 두께 계산이 바뀌었다.** 직교이던 v1.23까지는 월드 고정 두께가
 * 곧 화면 고정 두께라 정점을 법선 방향으로 밀기만 하면 됐다. 원근에서는 같은 월드 두께가
 * **가까운 기물에서 굵고 먼 기물에서 가늘어진다** — 만화 선은 어디서나 같은 굵기여야 하므로
 * 그대로 두면 선이 아니라 거리 표시가 된다.
 *
 * 그래서 **클립 공간에서 민다**: 법선을 클립 공간으로 옮겨 화면 방향을 얻고, 그 방향으로
 * `w`를 곱한 만큼 이동시킨다. `w`는 뒤이어 일어날 원근 나눗셈의 분모이므로, 곱해 두면
 * 나눗셈이 정확히 상쇄돼 **화면 픽셀 단위 고정 두께**가 남는다. 직교에서는 `w = 1`이라
 * 같은 식이 그대로 성립한다 — 투영 방식을 다시 바꿔도 이 셰이더는 손댈 필요가 없다.
 *
 * ⚠️ **각진 지오메트리에는 법선을 그대로 쓰면 안 된다.** 상자·압출물의 모서리는 면마다
 * 법선이 갈라져 있어서(하드 엣지) 그대로 밀면 모서리에서 헐이 **찢어져 구멍이 난다.**
 * 그래서 위치가 같은 정점들의 법선을 평균 낸 별도 속성을 미리 구워 두고 그것으로 민다
 * (`attachOutlineNormals`). 회전체는 원래 부드러워 영향이 없지만, 나이트 말머리·룩 성벽·
 * 보스 십자가가 정확히 그 함정에 걸린다.
 */

/**
 * 윤곽선 두께(월드 = 보드 픽셀).
 *
 * ⚠️ **두께의 상한을 정하는 것은 실루엣이 아니라 오목한 부분이다.** 인버티드 헐은 법선
 * 바깥으로 미는 방식이라, 기물의 **목처럼 잘록한 자리**에서는 밀려난 뒷면이 앞면을 뚫고
 * 나온다 — 처음 2.2로 뒀더니 폰·비숍·퀸의 칼라 아래에 의도하지 않은 **검은 띠**가 생겼다.
 * 1.8은 실루엣에서는 여전히 굵게 읽히면서 그 뚫림이 사라지는 지점이다.
 *
 * 단위는 **화면 픽셀**이다(CSS 기준 — 캔버스가 640px로 못박혀 있으므로 화면 밀도와 무관하다).
 */
export const OUTLINE_WIDTH = 1.8;

/**
 * 선 색. 순검정은 너무 강해 만화보다 스텐실처럼 보인다 — 아주 어두운 갈보라로 눕힌다.
 *
 * ★ **문자열로 export한다** (v1.26). 3D 윤곽선만 이 색을 쓰는 것이 아니라 화면 오버레이의
 * 체력바 테두리도 같은 잉크를 써야 하기 때문이다 — 두 계층이 각자 색을 들고 있으면 한쪽을
 * 조정할 때 반드시 다른 쪽이 옛 색으로 남고, 그 어긋남은 "한 화면에 두 화풍"으로 나타난다.
 * (티어 링에 윤곽선을 붙일 때와 같은 이유다.)
 */
export const OUTLINE_INK = '#2A2028';

const ATTR = 'aOutlineNormal';

/**
 * 위치가 같은 정점들의 법선을 평균 내 `aOutlineNormal` 속성으로 굽는다. **지오메트리를
 * 제자리에서 고치고 그대로 돌려준다** — 지오메트리는 타입당 하나뿐이라(geometry.ts) 한 번만
 * 구우면 그 타입의 모든 개체가 공유한다.
 */
export function attachOutlineNormals(g: THREE.BufferGeometry): THREE.BufferGeometry {
  if (g.getAttribute(ATTR)) return g;
  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  if (!pos || !nrm) return g;

  // 좌표를 소수 셋째 자리에서 끊어 키로 삼는다. 지오메트리가 절차적으로 생성돼 같은 자리의
  // 정점은 비트 단위로 같은 값을 갖지만, 압출물의 베벨처럼 계산을 거친 좌표는 미세하게
  // 어긋날 수 있어 반올림해서 묶는다.
  const sums = new Map<string, [number, number, number]>();
  const keys: string[] = new Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const k = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    keys[i] = k;
    const acc = sums.get(k);
    if (acc) {
      acc[0] += nrm.getX(i); acc[1] += nrm.getY(i); acc[2] += nrm.getZ(i);
    } else {
      sums.set(k, [nrm.getX(i), nrm.getY(i), nrm.getZ(i)]);
    }
  }

  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const [x, y, z] = sums.get(keys[i])!;
    const len = Math.hypot(x, y, z);
    if (len === 0) {
      // 정확히 반대인 법선들이 상쇄된 경우(퇴화 정점). 원래 법선을 그대로 쓴다.
      out[i * 3] = nrm.getX(i); out[i * 3 + 1] = nrm.getY(i); out[i * 3 + 2] = nrm.getZ(i);
    } else {
      out[i * 3] = x / len; out[i * 3 + 1] = y / len; out[i * 3 + 2] = z / len;
    }
  }
  g.setAttribute(ATTR, new THREE.BufferAttribute(out, 3));
  return g;
}

/**
 * 헐 재질. 조명을 전혀 계산하지 않는다(단색) — 윤곽선은 물체가 아니라 **선**이라, 빛을
 * 받으면 판 위 위치에 따라 굵기가 같은데 색만 달라져 오히려 어색하다.
 */
export const OUTLINE_MATERIAL = new THREE.ShaderMaterial({
  uniforms: {
    outlineWidth: { value: OUTLINE_WIDTH },
    outlineColor: { value: new THREE.Color(OUTLINE_INK) },
    // 캔버스 CSS 크기로 고정이다 — 화면 밀도가 바뀌어도 NDC ↔ CSS 픽셀 관계는 같으므로
    // (백킹 스토어만 커진다) 이 유니폼은 한 번 넣고 다시 건드리지 않는다.
    resolution: { value: new THREE.Vector2(VIEW_W, VIEW_H) },
  },
  vertexShader: `
    attribute vec3 ${ATTR};
    uniform float outlineWidth;
    uniform vec2 resolution;
    void main() {
      vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      // 평균 법선을 뷰 → 클립으로 옮겨 **화면상의 바깥 방향**을 얻는다.
      vec3 viewNormal = normalize(normalMatrix * ${ATTR});
      vec2 dir = (projectionMatrix * vec4(viewNormal, 0.0)).xy;
      float len = length(dir);
      // 법선이 카메라를 정면으로 보면 화면 방향이 없다(len≈0). 그 정점은 실루엣이 아니므로
      // 밀지 않는다 — 나누면 NaN이 되어 삼각형 하나가 통째로 사라진다.
      if (len > 1e-5) {
        // w를 곱해 두면 뒤이은 원근 나눗셈이 상쇄돼 화면 픽셀 고정 두께가 남는다.
        clip.xy += (dir / len) * (outlineWidth * 2.0 / resolution) * clip.w;
      }
      gl_Position = clip;
    }
  `,
  fragmentShader: `
    uniform vec3 outlineColor;
    void main() { gl_FragColor = vec4(outlineColor, 1.0); }
  `,
  side: THREE.BackSide,
});

/**
 * 한 조각의 윤곽선 메시. **그림자를 드리우지도 받지도 않는다** — 헐은 실제 물체보다 조금
 * 큰 껍데기라, 그림자를 드리우게 두면 기물마다 그림자가 두 겹으로 번져 윤곽이 흐려진다.
 */
export function outlineMesh(geometry: THREE.BufferGeometry): THREE.Mesh {
  attachOutlineNormals(geometry);
  const m = new THREE.Mesh(geometry, OUTLINE_MATERIAL);
  m.castShadow = false;
  m.receiveShadow = false;
  return m;
}
