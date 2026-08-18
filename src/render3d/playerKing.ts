import * as THREE from 'three';
import { BLOB_OFFSET, blobShadow } from './blob';
import { KING_SCALE, KING_WORLD } from './coords';
import { playerKingParts, playerKingRadius, playerKingTop } from './geometry';
import { ALLY_BODY } from './materials';
import { outlineMesh } from './outline';
import { leanedApex, LEAN, STRETCH_Y } from './pose';

/**
 * 플레이어 킹 — 보드 **바깥 우측 하단**에 서서 플레이어 자신을 나타낸다 (v1.28).
 *
 * ★ **왜 이걸 만드는가.** v1.27까지 플레이어 체력은 HUD 구석의 `♥10`이라는 숫자였다. 그 숫자는
 * 규칙상 가장 중요한 값인데(0이 되면 판이 끝난다) 화면에서는 웨이브 번호나 남은 적 수와
 * 나란한 텍스트 한 조각이라, **무엇이 걸려 있는지가 전혀 읽히지 않았다.**
 *
 * 킹을 세우고 그 위에 적과 **같은 모양의 체력바**를 달면 세 가지가 한꺼번에 성립한다:
 *   - 잃는 것이 **물건**이 된다 — 숫자가 줄어드는 게 아니라 내 킹이 맞는다.
 *   - 체력바 문법이 통일된다 — 적을 깎는 그 막대가 내 것에도 붙어 있다.
 *   - 위치가 규칙을 말한다 — 적이 넘어오는 1랭크 바로 옆이라, 뚫리면 누가 맞는지가 보인다.
 *
 * ⚠️ **이것은 `Piece`가 아니다.** 판 위에 있지 않고, 공격하지도 공격받지도 않으며,
 * `GameState.pieces`에 들어가지 않는다. 순수하게 `state.hp`를 비추는 **연출**이다 —
 * 코어는 이 킹의 존재를 모른다.
 */

export function createPlayerKing(): THREE.Group {
  const group = new THREE.Group();
  group.position.set(KING_WORLD.x, 0, KING_WORLD.z);

  // 판 위 기물과 **같은 각도 불일치**를 건다(render3d/pieces.ts의 LEAN). 킹만 똑바로 서 있으면
  // 같은 화면에서 혼자 다른 카메라로 찍힌 것처럼 보인다.
  const lean = new THREE.Group();
  lean.rotation.x = -LEAN;
  lean.scale.set(KING_SCALE, KING_SCALE * STRETCH_Y, KING_SCALE);
  group.add(lean);
  for (const part of playerKingParts()) {
    lean.add(outlineMesh(part.geometry));
    lean.add(new THREE.Mesh(part.geometry, ALLY_BODY));
  }

  const blob = blobShadow(playerKingRadius() * KING_SCALE * 1.5);
  blob.position.x += BLOB_OFFSET.x;
  blob.position.z += BLOB_OFFSET.z;
  group.add(blob);

  return group;
}

/**
 * 체력바가 뜰 자리(월드). 판 위 기물과 **같은 계산**을 쓴다 — 늘리고 눕힌 뒤의 실제 꼭대기다
 * (render3d/pieces.ts의 `leanedApex`). 킹만 배율이 하나 더 붙는다.
 */
export function playerKingApex(): { x: number; y: number; z: number } {
  const apex = leanedApex(playerKingTop() * KING_SCALE);
  return { x: KING_WORLD.x, y: apex.y, z: KING_WORLD.z + apex.z };
}
