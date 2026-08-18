import * as THREE from 'three';
import { CONFIG } from '../config';
import { squareWorld } from './coords';
import { pieceParts, pieceRadius, pieceTop } from './geometry';
import { ALLY_ACCENT, ALLY_BODY, tierMaterial } from './materials';
import { BLOB_OFFSET, blobShadow } from './blob';
import { outlineMesh } from './outline';
import type { PieceFx, StrikePose } from '../render/pieceFx';
import { DEFAULT_SKIN_ID, allySpriteUrl, selectedSkinId } from '../render/skins';
import { tierRingColor } from '../render/tiers';
import { LEAN, STRETCH_Y } from './pose';
import { TILT } from './scene';
import type { GameState, Piece, PieceType } from '../types';

/**
 * 아군 기물의 3D 메시 풀 (v1.21).
 *
 * ★ **풀이지 매 프레임 생성이 아니다.** 기물은 판에 최대 56기까지 서 있고 대부분의 프레임에서
 * 아무것도 바뀌지 않는다 — 매 프레임 Group을 새로 만들면 GC가 60Hz로 돌고 그림자 맵이 매번
 * 다시 계산된다. id로 키를 잡아 **위치만** 갱신하고, 모양이 실제로 바뀌었을 때만(종류·티어·
 * 스킨) 다시 만든다.
 *
 * ⚠️ **죽거나 팔린 기물의 노드를 반드시 지운다.** 지오메트리는 타입당 공유라 남아도 메모리가
 * 늘지 않지만, 씬 그래프에 남으면 **판에서 사라진 기물이 화면에 계속 서 있다.**
 */

const SQ = CONFIG.board.squarePx;

/**
 * 티어 링 반지름. 칸(80px) 안에 머무르되, **기물보다 커 보이면 안 된다** — 처음에는 31이라
 * 칸을 거의 채워, 기물이 훌라후프 안에 서 있는 것처럼 링이 주인공이 됐다. 기물 받침
 * (v1.23 치비 비율에서 반지름 19~23)을 조금 넘는 정도가 "이 기물에 달린 표식"으로 읽히는
 * 크기다. 윤곽선 헐이 받침을 2.2만큼 더 부풀린다는 것도 함께 고려한 값이다.
 */
const RING_RADIUS = 29;

interface Node {
  group: THREE.Group;
  /** 이 개체만의 정리 대상. 공유 자원(타입별 지오메트리·프로토타입·블롭)은 여기 들어가지
   *  않는다 — 넣으면 같은 종류의 다른 기물이 통째로 사라진다. */
  disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[];
  /**
   * 몸통만 담은 하위 그룹 — **공격 모션이 여기에만 걸린다.**
   *
   * ★ 티어 링을 그룹 바깥(형제)에 두는 것이 요점이다. 링은 바닥에 눕힌 **데칼**이라
   * 기물이 찌를 때 같이 딸려 나가면 안 된다 — 표식이 칸을 벗어나 이웃 칸을 침범하고,
   * "이 칸의 기물이 T3다"라는 뜻이 그 순간 깨진다. 기물은 발을 딛고 상체만 나간다.
   */
  body: THREE.Group;
  /** 다시 만들어야 하는지 판단하는 서명. 위치는 여기 들어가지 않는다 — 위치는 옮기면 되지
   *  다시 만들 이유가 아니다. */
  shape: string;
}

/** 기울기 축 계산용 재사용 벡터 — 매 프레임 기물마다 할당하지 않는다. */
const TILT_AXIS = new THREE.Vector3();

/**
 * ★★ **각도 불일치(angle mismatch)** — 이 파일에서 가장 이상하고 가장 중요한 두 줄 (v1.25).
 *
 * **문제.** 지면 카메라를 세울수록 판 전체가 한눈에 들어와 전황 파악은 좋아지는데,
 * **기물은 정수리만 보인다.** 회전체는 위에서 보면 전부 그냥 원이라 폰과 비숍이 구분되지
 * 않는다. 지금 지면은 완전 탑다운(수직 0°)이라 그 문제가 최대치다.
 *
 * **이 장르의 해법**은 지면과 유닛을 **다른 각도로 그리는 것**이다: 지면은 55~60°로 두고,
 * 유닛은 30~40°의 낮은 각도로 미리 렌더한 스프라이트를 지면에 수직으로 세워 둔다. 물리적으로는
 * 한 장면에 카메라가 둘인 셈인데, 눈으로는 전혀 어색하지 않고 오히려 이게 없으면 화면이
 * 밋밋해진다.
 *
 * **이 저장소는 실시간 3D라 스프라이트를 쓸 수 없으므로, 기물을 눕혀서 같은 결과를 만든다.**
 *
 * ⚠️ **눕히는 방향이 직관과 반대다.** 기물의 옆모습이 더 보이려면 **기물 축과 시선이 이루는
 * 각이 커져야** 한다. 카메라는 +Z 쪽 위에 있고 시선은 수직에서 `TILT`이므로:
 *   - 카메라 **쪽으로**(+Z) 눕히면 → `TILT − LEAN`. **더 정수리만 보인다.**
 *   - 카메라 **반대쪽으로**(−Z, 적이 오는 쪽) 눕히면 → `TILT + LEAN`.
 *     지면 기준으로는 `90° − (TILT + LEAN)`에서 본 모습이 된다.
 * 그래서 −Z로 눕힌다(`rotation.x`가 음수).
 *
 * 지금 값(TILT 0° · LEAN 40°)에서는 **지면 50°에서 본 유닛**이다. 두 상수를 따로 조정할 수
 * 있으므로 테스트는 개별 값이 아니라 **합이 만드는 결과**를 못박는다(tests/render3d.test.ts).
 *
 * `STRETCH_Y`는 원근 단축 보정이다. 가파른 카메라는 세로를 눌러 기물을 납작하게 만드는데,
 * 자기 축으로 늘려 두면 그 손실을 되돌린다. **눈으로 맞춘 값**이고, 기울기를 올릴수록 함께
 * 올려야 한다.
 */
// ★ 값과 계산은 `render3d/pose.ts`에 있다 — 소비처가 넷(기물·적·플레이어 킹·오버레이)이라
//   잎 모듈로 뺐다. **이 주석이 그 값의 근거지다.**

function shapeKey(p: Piece): string {
  return `${p.type}/${p.tier}/${selectedSkinId(p.type)}`;
}

/**
 * 스킨이 걸린 기물 — 텍스처를 입힌 판(standee)으로 세운다.
 *
 * ★ **왜 lathe가 아닌가.** 스킨은 2D 캐릭터 아트다(현재 '하트 프린세스' 하나). 회전체에
 * 감으면 옆으로 늘어나 형체가 사라진다. 그래서 스킨은 3D 형상이 아니라 **그림**으로 남기고,
 * 판을 카메라 쪽으로 눕혀 정면으로 보이게 한다.
 *
 * ★ **눕히는 각이 정확히 (90° − 기울기)인 것이 요점이다.** 그러면 판의 법선이 카메라를 정면으로
 * 향하므로 그림이 왜곡 없이, 2D 시절과 **똑같이** 보인다. 세워 두면 카메라가 거의 수직이라
 * 판이 종잇장처럼 사라진다.
 */
function skinStandee(url: string): THREE.Mesh {
  const tex = new THREE.TextureLoader().load(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(SQ * 0.9, SQ * 0.9),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  // 판을 눕힌다: 수평(−90°)에서 기울기만큼 되세우면 법선이 카메라를 정면으로 본다.
  mesh.rotation.x = -Math.PI / 2 + TILT;
  mesh.position.y = 6;                       // 바닥 데칼과 겹치지 않게 살짝 띄운다
  return mesh;
}

function buildGroup(p: Piece): {
  group: THREE.Group; body: THREE.Group;
  disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[];
} {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  const skinId = selectedSkinId(p.type);

  if (skinId === DEFAULT_SKIN_ID) {
    // ★ 각도 불일치 층 (위 LEAN 주석). **정적 변환이라 한 번 세우고 끝**이고, 공격 모션은
    //   그 바깥(body)에서 판 좌표계로 걸린다 — 순서가 반대면 찌르는 방향이 함께 기울어진다.
    const lean = new THREE.Group();
    lean.rotation.x = -LEAN;
    lean.scale.y = STRETCH_Y;
    body.add(lean);
    for (const part of pieceParts(p.type)) {
      // 티어가 오르면 부속물(퀸의 관 구슬 등)만 티어 색으로 갈아입는다 — 몸통까지 물들이면
      // 상아색이라는 진영 단서(스펙 8.1)가 사라진다.
      const mat = part.accent
        ? (p.tier > 1 ? tierMaterial(p.tier) : ALLY_ACCENT)
        : ALLY_BODY;
      // ★ 윤곽선이 **먼저** 들어간다. 뒷면 헐이라 깊이로 이미 갈리지만, 같은 깊이에서
      //   그려지는 픽셀이 생겼을 때 나중에 그린 쪽이 이기므로 실물이 뒤에 오는 편이 안전하다.
      lean.add(outlineMesh(part.geometry));
      lean.add(new THREE.Mesh(part.geometry, mat));
    }
  } else {
    // ⚠️ 스킨 판(standee)에는 윤곽선을 붙이지 않는다 — 평면의 헐은 그림 둘레가 아니라
    //    **사각형 테두리**라, 캐릭터 주위에 액자가 생긴다.
    // ⚠️ 그리고 **눕히지 않는다.** 이미 카메라를 정면으로 보도록 세워져 있어서(skinStandee)
    //    그 자체가 "낮은 각도에서 본 모습"이다 — 더 눕히면 오히려 어긋난다.
    const standee = skinStandee(allySpriteUrl(p.type));
    body.add(standee);
    disposables.push(standee.geometry, standee.material as THREE.Material);
    const map = (standee.material as THREE.MeshBasicMaterial).map;
    if (map) disposables.push(map);
  }

  // ★ 블롭 그림자 — **group에 직접** 붙는다. body(공격 모션)나 lean(각도 불일치)에 넣으면
  //   그림자가 기물을 따라 기울거나 튀어 나가고, 그러면 이걸 만든 이유가 사라진다(blob.ts).
  const blob = blobShadow(pieceRadius(p.type) * 1.5);
  blob.position.x += BLOB_OFFSET.x;
  blob.position.z += BLOB_OFFSET.z;
  group.add(blob);

  // 강화 단계 링 — 2D 시절과 같은 규칙으로 T1에는 그리지 않는다(render/tiers.ts).
  // 바닥에 눕힌 고리라 기물의 실루엣을 가리지 않으면서, 기물 그림자가 그 위에 떨어져
  // "링 위에 기물이 서 있다"가 깊이로 읽힌다.
  if (tierRingColor(p.tier)) {
    const ringGeo = new THREE.TorusGeometry(RING_RADIUS, 2.1, 8, 40);
    // ★ 링에도 같은 윤곽선을 준다. 없으면 기물만 선이 있고 링은 밋밋한 원반이라 **같은
    //   화면에 두 가지 화풍**이 섞인다 — 스타일라이즈드에서 가장 눈에 띄는 어긋남이다.
    const ringOutline = outlineMesh(ringGeo);
    ringOutline.rotation.x = -Math.PI / 2;
    ringOutline.position.y = 1.6;
    group.add(ringOutline);
    const ring = new THREE.Mesh(ringGeo, tierMaterial(p.tier));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 1.6;
    group.add(ring);                 // ★ body가 **아니라** group에 붙는다 (Node.body 주석 참고)
    disposables.push(ringGeo);       // 링과 그 윤곽선이 **같은 지오메트리를 공유**하므로 하나만
  }
  return { group, body, disposables };
}

/**
 * 공격 자세를 몸통에 건다.
 *
 * ★ **기물은 발을 딛고 상체만 나간다.** 회전 원점이 그룹 원점(= 판에 닿는 바닥 중심)이라
 * 기울기가 곧 "발끝을 축으로 상체를 숙이는" 동작이 된다 — 통째로 평행이동만 시키면 기물이
 * 미끄러지는 것처럼 보이고, 무게중심에서 돌리면 발이 판을 뚫는다.
 *
 * 기울기 축은 **진행 방향에 수직인 바닥 축**이다: `up × d`. 그 축으로 +각만큼 돌리면
 * 꼭대기가 진행 방향으로 넘어간다.
 */
function applyStrike(body: THREE.Group, pose: StrikePose | null): void {
  if (!pose) {
    body.position.set(0, 0, 0);
    body.quaternion.identity();
    return;
  }
  body.position.set(pose.dx * pose.offset, 0, pose.dy * pose.offset);
  TILT_AXIS.set(pose.dy, 0, -pose.dx);
  body.quaternion.setFromAxisAngle(TILT_AXIS, pose.pitch);
}

export class Pieces3D {
  private nodes = new Map<string, Node>();

  constructor(private scene: THREE.Scene) {}

  /**
   * 판 위 기물 목록을 씬에 반영한다. 매 프레임 호출한다.
   *
   * `pieceFx`는 **선택 인자**다 — 없으면 공격 모션이 꺼지고 기물이 제자리에 서 있는다.
   * `render()`가 `enemyFx`를 선택 인자로 받는 것과 같은 이유다(렌더러가 그 상태를 소유하지
   * 않는다는 계층 규칙을 지키면서, 그 상태를 못 가진 호출부도 그대로 동작하게 한다).
   */
  sync(state: GameState, pieceFx?: PieceFx): void {
    const live = new Set<string>();
    for (const p of state.pieces) {
      live.add(p.id);
      const key = shapeKey(p);
      let node = this.nodes.get(p.id);
      if (node && node.shape !== key) { this.remove(p.id); node = undefined; }
      if (!node) {
        const built = buildGroup(p);
        node = { group: built.group, body: built.body, disposables: built.disposables, shape: key };
        this.scene.add(node.group);
        this.nodes.set(p.id, node);
      }
      const { x, z } = squareWorld(p.square);
      node.group.position.set(x, 0, z);
      applyStrike(node.body, pieceFx?.poseAt(p.square) ?? null);
    }
    for (const id of [...this.nodes.keys()]) if (!live.has(id)) this.remove(id);
  }

  private remove(id: string): void {
    const node = this.nodes.get(id);
    if (!node) return;
    this.scene.remove(node.group);
    // ⚠️ 지오메트리는 대부분 **공유**다(타입당 하나 · 블롭 프로토타입) — 여기서 dispose하면
    // 같은 종류의 다른 기물이 통째로 사라진다. 그래서 씬 그래프를 뒤져 타입으로 짐작하지 않고
    // **생성 시점에 모아 둔 목록**만 정리한다. v1.25에서 블롭 그림자가 들어오면서 이 구분이
    // 필수가 됐다 — 블롭도 PlaneGeometry라, 예전의 "Plane이면 지운다"는 규칙에 걸렸다.
    for (const d of node.disposables) d.dispose();
    this.nodes.delete(id);
  }

  /** 버프 배지·툴팁이 뜰 기물 꼭대기의 높이 (오버레이가 화면 좌표로 되돌린다). */
  static topOf(type: PieceType): number {
    return pieceTop(type);
  }

  dispose(): void {
    for (const id of [...this.nodes.keys()]) this.remove(id);
  }
}
