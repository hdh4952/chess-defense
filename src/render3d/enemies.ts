import * as THREE from 'three';
import { CONFIG } from '../config';
import { NO_SLOW } from '../core/slow';
import { enemyWorld } from './coords';
import { enemyParts, enemyRadius, enemyTop } from './geometry';
import { createEnemyMaterial } from './materials';
import { BLOB_OFFSET, blobShadow } from './blob';
import { outlineMesh } from './outline';
import { LEAN, STRETCH_Y } from './pose';
import { SLOW_INK } from '../render/palette';
import { TRAIT_COLOR } from '../render/palette';
import type { EnemyFx } from '../render/enemyFx';
import type { Enemy, GameState } from '../types';

/**
 * 적의 3D 메시 풀 (v1.21). 구조는 Pieces3D와 같지만 세 가지가 다르다:
 *   1. **재질을 개체마다 복제한다** — 피격 플래시가 개체별이다(materials.ts의 ★).
 *   2. 감속 고리·실드 아크처럼 **상태에 따라 붙었다 떨어지는** 부속물이 있다.
 *   3. 회전율이 훨씬 높다 — 한 판에 452마리 + 분열체가 지나간다. 정리를 빠뜨리면 씬 그래프가
 *      단조 증가한다.
 */

const SQ = CONFIG.board.squarePx;

/** 감속 고리 반지름. 적 몸통(반지름 ~15) 바깥을 넉넉히 돈다. */
const SLOW_RING_R = 22;

const SLOW_MAT = new THREE.MeshBasicMaterial({
  color: new THREE.Color(SLOW_INK), transparent: true, opacity: 0.9, side: THREE.DoubleSide,
});
const SHIELD_MAT = new THREE.MeshBasicMaterial({
  color: new THREE.Color(TRAIT_COLOR.shielded), transparent: true, opacity: 0.75, side: THREE.DoubleSide,
});

/**
 * 감속 고리의 **원형(prototype)** — 점선 여덟 조각을 바닥에 눕혀 만든다. 개체는 이것을
 * `clone()`해서 쓰므로 지오메트리와 재질은 전부 공유되고, 개체마다 다른 것은 회전각뿐이다.
 *
 * 점선인 것이 핵심이다: 통 고리는 아무리 돌려도 도는 것이 안 보인다. 그리고 **도는 속도가
 * 곧 규칙이다** — 아래 sync()가 위상을 벽시계가 아니라 `e.y`에서 뽑으므로, 감속된 적의
 * 고리는 정확히 그 비율만큼 느리게 돈다. 일시정지·준비 단계에서 저절로 멈추는 것도 같은 이유다.
 */
const SLOW_RING_PROTO = (() => {
  const dash = new THREE.RingGeometry(SLOW_RING_R - 2.6, SLOW_RING_R + 2.6, 6, 1, 0, Math.PI / 8);
  dash.rotateX(-Math.PI / 2);
  const g = new THREE.Group();
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Mesh(dash, SLOW_MAT);
    m.rotation.y = (i / 8) * Math.PI * 2;
    g.add(m);
  }
  g.position.y = 0.9;
  return g;
})();

/**
 * 실드 아크 — 진행 방향(+Z = 낮은 랭크 쪽)에만 걸린 반원.
 *
 * v1.14에서 실드형이 "흡수 풀"에서 "전방 피해 무시"로 재정의되면서, 보여야 하는 것이
 * "얼마나 남았는가"에서 **"어느 쪽에서 때려야 먹히는가"**로 바뀌었다. 그래서 게이지가 아니라
 * 방향을 가리키는 호다 — 막히는 반쪽이 잠겨 있음을 그 자리에 그려서 말한다.
 */
const SHIELD_PROTO = (() => {
  const g = new THREE.RingGeometry(19, 25, 20, 1, -Math.PI / 2, Math.PI);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, SHIELD_MAT);
  m.position.y = 1.1;
  return m;
})();

interface Node {
  group: THREE.Group;
  material: THREE.MeshToonMaterial;
  slowRing: THREE.Group | null;
  isBoss: boolean;
}

export class Enemies3D {
  private nodes = new Map<string, Node>();

  constructor(private scene: THREE.Scene) {}

  sync(state: GameState, enemyFx?: EnemyFx): void {
    const live = new Set<string>();
    for (const e of state.enemies) {
      live.add(e.id);
      let node = this.nodes.get(e.id);
      if (!node) { node = this.create(e); this.nodes.set(e.id, node); }

      const { x, z } = enemyWorld(e);
      node.group.position.set(x, 0, z);

      // ── 감속 고리: 상태에 따라 붙었다 떨어진다 ────────────────────────────
      const slowed = e.slowTier !== NO_SLOW;
      if (slowed && !node.slowRing) {
        node.slowRing = SLOW_RING_PROTO.clone();
        node.group.add(node.slowRing);
      } else if (!slowed && node.slowRing) {
        node.group.remove(node.slowRing);
        node.slowRing = null;
      }
      // 위상을 **e.y에서** 뽑는다 — 벽시계가 아니다(SLOW_RING_PROTO 주석의 ★).
      if (node.slowRing) node.slowRing.rotation.y = (e.y / SQ) * 0.9;

      // ── 피격 플래시 ────────────────────────────────────────────────────────
      // 2D 시절에는 흰색을 스프라이트 위에 덮었다(source-atop). 3D에서는 자체 발광을 올리는
      // 것이 같은 뜻이면서 더 정확하다 — 형태가 유지된 채로 번쩍이므로 어떤 적이 맞았는지가
      // 실루엣과 함께 읽힌다.
      const flash = enemyFx?.flashAmount(e.id) ?? 0;
      if (flash > 0) {
        node.material.emissive.setRGB(1, 1, 1);
        node.material.emissiveIntensity = Math.min(1, flash) * 0.9;
      } else if (node.isBoss) {
        node.material.emissive.setHex(0x5A0E14);
        node.material.emissiveIntensity = 0.18;
      } else {
        node.material.emissiveIntensity = 0;
      }
    }
    for (const id of [...this.nodes.keys()]) if (!live.has(id)) this.remove(id);
  }

  private create(e: Enemy): Node {
    const group = new THREE.Group();
    const material = createEnemyMaterial(e.isBoss);
    // ★ 적도 아군과 **같은 각도로 눕는다** (v1.25 각도 불일치 — render3d/pieces.ts의 LEAN).
    //   한쪽만 눕히면 같은 판 위에서 두 진영이 서로 다른 카메라로 찍힌 것처럼 보인다.
    const lean = new THREE.Group();
    lean.rotation.x = -LEAN;
    lean.scale.y = STRETCH_Y;
    group.add(lean);
    for (const part of enemyParts(e.isBoss)) {
      lean.add(outlineMesh(part.geometry));
      lean.add(new THREE.Mesh(part.geometry, material));
    }
    // 블롭 그림자·실드 표식·감속 고리는 **눕지 않는다** — 전부 지면에 깔리는 것들이다.
    const blob = blobShadow(enemyRadius(e.isBoss) * 1.5);
    blob.position.x += BLOB_OFFSET.x;
    blob.position.z += BLOB_OFFSET.z;
    group.add(blob);
    // 실드는 스폰 시 확정되고 바뀌지 않는다(types.ts — "정체성이지 상태가 아니다").
    // 그래서 매 프레임 확인하지 않고 생성 시 한 번만 붙인다.
    if (e.traits.includes('shielded')) group.add(SHIELD_PROTO.clone());
    this.scene.add(group);
    return { group, material, slowRing: null, isBoss: e.isBoss };
  }

  private remove(id: string): void {
    const node = this.nodes.get(id);
    if (!node) return;
    this.scene.remove(node.group);
    // ⚠️ 지오메트리는 전부 공유(타입당 하나 · 프로토타입 clone)라 dispose 대상이 아니다.
    // 개체마다 새로 만든 것은 재질 하나뿐이고, 그것만 반드시 정리한다 — 한 판에 452마리가
    // 지나가므로 재질을 흘리면 그만큼 GPU 프로그램/유니폼이 쌓인다.
    node.material.dispose();
    this.nodes.delete(id);
  }

  /** 체력바·유형 표식이 뜰 높이. */
  static topOf(isBoss: boolean): number {
    return enemyTop(isBoss);
  }

  dispose(): void {
    for (const id of [...this.nodes.keys()]) this.remove(id);
  }
}
