import * as THREE from 'three';

/**
 * 블롭 그림자 — 밑동에 까는 반투명 원판 (v1.25).
 *
 * ★ **왜 실제 그림자 맵을 버렸는가.** v1.25에서 기물을 카메라 반대쪽으로 20° 눕혔다
 * (render3d/pieces.ts의 각도 불일치 주석). 그런데 **그림자는 눕으면 안 된다** — 실제
 * 그림자 맵을 쓰면 기울어진 형태가 그대로 바닥에 찍혀서, 기물이 "서 있는데 낮은 각도로
 * 보이는 것"이 아니라 **정말로 넘어지고 있는 것**으로 읽힌다. 각도 불일치 트릭은 그림자가
 * 정직해지는 순간 들통난다.
 *
 * 그래서 지면에 정직하게 깔리는 원판을 따로 붙인다. 캐주얼 3D에서 널리 쓰는 방식이고, 부수적으로
 * 그림자 맵 렌더 패스가 통째로 사라진다 — 한 판에 452마리가 지나가는 이 게임에서는
 * 성능으로도 이쪽이 낫다.
 *
 * ⚠️ **블롭은 기울어지는 그룹 밖에 붙여야 한다.** 기물과 함께 눕거나 공격 모션을 따라가면
 * 애초에 이걸 만든 이유가 사라진다 — `Pieces3D`의 `group`(위치·링·블롭) / `body`(모션) /
 * `lean`(각도 불일치) 세 겹이 그 분리를 구조로 강제한다.
 */

/** 그림자의 진하기. 툰 화면이라 실제 그림자보다 옅게 — 진하면 만화가 아니라 얼룩이 된다. */
const BLOB_ALPHA = 0.4;

let sharedTexture: THREE.Texture | null = null;
let sharedGeometry: THREE.PlaneGeometry | null = null;
let sharedMaterial: THREE.MeshBasicMaterial | null = null;

/**
 * 그라디언트를 굽는 데 캔버스가 필요하다. 테스트 기본 환경(node)에는 `document`가 없으므로
 * 그때는 텍스처 없이 만든다 — 메시는 그대로 생기고(자식 개수를 세는 테스트가 어긋나지 않는다)
 * 그림만 빠진다. `sprites.ts`가 쓰던 `browserAvailable` 가드와 같은 성격이다.
 */
function blobTexture(): THREE.Texture | null {
  if (sharedTexture) return sharedTexture;
  if (typeof document === 'undefined') return null;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  // 가운데는 진하고 가장자리로 갈수록 사라진다. 중간을 한 번 꺾어 두면 경계가 부드러우면서도
  // 원판의 크기가 또렷하게 읽힌다 — 순수 선형 그라디언트는 흐릿한 안개처럼 보인다.
  g.addColorStop(0, `rgba(30, 22, 34, ${BLOB_ALPHA})`);
  g.addColorStop(0.55, `rgba(30, 22, 34, ${BLOB_ALPHA * 0.75})`);
  g.addColorStop(1, 'rgba(30, 22, 34, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  sharedTexture = tex;
  return tex;
}

/**
 * 밑동 그림자 하나. 지오메트리·재질·텍스처가 **전부 공유**라 개체를 지울 때 정리할 것이 없다
 * (그래서 `Pieces3D.remove`의 폐기 목록에 들어가지 않는다).
 *
 * `radius`는 기물 받침 반지름에서 유도한다 — 굵은 룩과 가는 폰이 같은 크기 그림자를 지면
 * 두 기물이 같은 무게로 보인다.
 */
export function blobShadow(radius: number): THREE.Mesh {
  if (!sharedGeometry) {
    sharedGeometry = new THREE.PlaneGeometry(1, 1);
    sharedGeometry.rotateX(-Math.PI / 2);
  }
  if (!sharedMaterial) {
    sharedMaterial = new THREE.MeshBasicMaterial({
      map: blobTexture(), transparent: true, depthWrite: false,
      opacity: sharedTexture ? 1 : 0,      // 텍스처가 없으면(비-브라우저) 아무것도 그리지 않는다
    });
  }
  const m = new THREE.Mesh(sharedGeometry, sharedMaterial);
  m.scale.set(radius * 2, 1, radius * 2);
  // 데칼 평면(y=0.35)보다 아래에 둔다 — 하이라이트·감속 오라는 규칙을 말하는 UI라
  // 그림자에 가려지면 안 된다.
  m.position.set(0, 0.2, 0);
  return m;
}

/** ★ 키 라이트 방향과 맞춘 오프셋. 광원이 왼쪽 위(−x, −z)에 있으므로 그림자는 오른쪽 아래로
 *  조금 밀린다 — 정확히 발밑에 있으면 붙여 놓은 스티커처럼 보인다. */
export const BLOB_OFFSET = { x: 5, z: 5 };
