import * as THREE from 'three';
import { CONFIG } from '../config';
import { HALF_D, HALF_W } from './coords';
import { TILT } from './scene';
import type { Fx } from '../render/effects';
import { TRAIT_COLOR } from '../render/palette';

/**
 * 판 위에서 벌어지는 이펙트를 실제 3D 물체로 그린다 (v1.21).
 *
 * ★ **무엇이 여기 오고 무엇이 오버레이로 가는가.** 기준은 "판 위의 사건인가, 플레이어에게
 * 보내는 쪽지인가"다. 충격파·균열·광선·파편·스폰 표식은 **그 칸에서 실제로 일어난 일**이라
 * 기물에 가려지고 그림자 진 곳에서 어둡게 보여야 옳다 — 3D다. 데미지 숫자·골드·감속 라벨은
 * 무엇에도 가려지면 안 되는 정보라 화면 오버레이에 남는다(render3d/overlay.ts).
 *
 * ★ **풀링이 이 파일의 유일한 복잡성이다.** 후반 웨이브는 초당 수십 마리를 처치해 파편만
 * 수백 개가 동시에 산다. 프레임마다 Mesh를 새로 만들면 GC가 60Hz로 돌므로, 종류별로 메시를
 * 재사용하고 남는 것은 `visible = false`로 눕혀 둔다. 재질도 개체마다 복제해 둔다 —
 * 알파가 이펙트마다 다르기 때문이다(공유하면 마지막 하나의 알파가 전부에 걸린다).
 */

const SQ = CONFIG.board.squarePx;

/** 타격 섬광이 터지는 높이 — 적(폰) 몸통의 한복판이다. 바닥(y≈0)에서 터뜨리면 발밑을
 *  때린 것처럼 보인다. */
const IMPACT_Y = 18;

/** 보드 픽셀 → 월드. 이펙트 좌표는 전부 보드 픽셀이라(render/effects.ts) 한 곳에서만 바꾼다. */
const wx = (x: number): number => x - HALF_W;
const wz = (y: number): number => y - HALF_D;

/**
 * 한 종류의 메시를 돌려 쓰는 풀. `begin()`으로 초기화하고 `take()`로 꺼내 쓴 뒤
 * `end()`가 안 쓰인 것을 눕힌다 — 프레임마다 개수가 출렁여도 할당이 일어나지 않는다.
 */
class Pool<T extends THREE.Object3D> {
  private items: T[] = [];
  private used = 0;

  constructor(private scene: THREE.Scene, private make: () => T) {}

  begin(): void { this.used = 0; }

  take(): T {
    let item = this.items[this.used];
    if (!item) {
      item = this.make();
      this.items.push(item);
      this.scene.add(item);
    }
    item.visible = true;
    this.used++;
    return item;
  }

  end(): void {
    for (let i = this.used; i < this.items.length; i++) this.items[i].visible = false;
  }

  dispose(): void {
    for (const item of this.items) {
      this.scene.remove(item);
      item.traverse(o => {
        if (!(o instanceof THREE.Mesh)) return;
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      });
    }
    this.items.length = 0;
  }
}

function flatRing(color: number): THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> {
  // 반지름 1의 단위 고리 — 실제 크기는 scale로 준다. 그래야 지오메트리를 다시 만들지 않는다.
  const g = new THREE.RingGeometry(0.86, 1, 40);
  g.rotateX(-Math.PI / 2);
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({
    color, transparent: true, side: THREE.DoubleSide, depthWrite: false,
  }));
}

function bar(color: number, additive: boolean): THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial> {
  return new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({
    color, transparent: true, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  }));
}

/** 두 점을 잇는 막대를 놓는다 — 길이·각도·두께를 scale/rotation으로만 준다. */
function layBar(
  mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>,
  f: Fx, height: number, thickness: number, alpha: number,
): void {
  const x1 = wx(f.x), z1 = wz(f.y), x2 = wx(f.x2!), z2 = wz(f.y2!);
  const dx = x2 - x1, dz = z2 - z1;
  const len = Math.hypot(dx, dz);
  mesh.position.set((x1 + x2) / 2, height, (z1 + z2) / 2);
  mesh.rotation.y = -Math.atan2(dz, dx);
  mesh.scale.set(len, thickness, thickness);
  mesh.material.opacity = alpha;
}

export class Effects3D {
  private rings: Pool<THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>>;
  private bursts: Pool<THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>>;
  private cracks: Pool<THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>>;
  private beams: Pool<THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>>;
  private puffs: Pool<THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>>;
  private shards: Pool<THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>>;
  private frames: Pool<THREE.Group>;
  private wedges: Pool<THREE.Mesh<THREE.ConeGeometry, THREE.MeshBasicMaterial>>;

  constructor(scene: THREE.Scene) {
    // ★ 폰의 충격파만 **카메라를 정면으로 본다.** 바닥에 눕힌 고리는 "저 칸에서 뭔가 났다"로
    //   읽히지 "맞았다"로는 읽히지 않는다 — 타격은 적의 몸에서 일어나는 일이라 적의 높이에서
    //   화면을 향해 터져야 한다. 눕히는 각이 정확히 `기울기`인 것이 요점이다(스킨 판과 같은
    //   계산): 그래야 고리의 법선이 카메라를 정면으로 봐서 완전한 원으로 보인다.
    this.rings = new Pool(scene, () => {
      const m = flatRing(0xF4F1E4);
      m.rotation.x = TILT;
      return m;
    });
    this.bursts = new Pool(scene, () => flatRing(0xFFFFFF));
    this.cracks = new Pool(scene, () => bar(0xF0E0C0, false));
    this.beams = new Pool(scene, () => bar(0xFFF6CF, true));
    this.puffs = new Pool(scene, () => new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0x999999, transparent: true, depthWrite: false }),
    ));
    this.shards = new Pool(scene, () => new THREE.Mesh(
      new THREE.BoxGeometry(3.4, 3.4, 3.4),
      new THREE.MeshBasicMaterial({ color: 0x8A8A8A, transparent: true }),
    ));
    // 스폰 표식 — 칸을 감싸며 **조여드는** 사각 테두리. 확장이 아니라 수축인 이유는
    // render/effects.ts의 spawnMark 주석에 있다(시선을 그 칸 안으로 모으는 것이 목적).
    this.frames = new Pool(scene, () => {
      const g = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: 0xFFE27A, transparent: true, depthWrite: false });
      for (let i = 0; i < 4; i++) {
        const side = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
        side.rotation.y = (i / 4) * Math.PI * 2;
        g.add(side);
      }
      return g;
    });
    this.wedges = new Pool(scene, () => new THREE.Mesh(
      new THREE.ConeGeometry(6, 14, 4),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(TRAIT_COLOR.splitter), transparent: true, depthWrite: false,
      }),
    ));
  }

  /** 매 프레임: 살아 있는 이펙트 중 **판 위의 것**만 골라 그린다. */
  sync(items: readonly Fx[]): void {
    for (const p of [this.rings, this.bursts, this.cracks, this.beams,
      this.puffs, this.shards, this.frames, this.wedges]) p.begin();

    for (const f of items) {
      const k = 1 - f.t / f.ttl;              // 1 → 0. 2D 시절과 같은 진행률 정의
      switch (f.kind) {
        case 'shock': {                       // 폰 — 적의 몸에서 터지는 타격 섬광
          const m = this.rings.take();
          const r = 7 + (1 - k) * 17;
          m.position.set(wx(f.x), IMPACT_Y, wz(f.y));
          // ⚠️ 눕혀 놨어도 **스케일 축은 지오메트리의 것**이다. `flatRing`이 XZ 평면에 구워
          //   두었으므로(생성 시 rotateX) 평면 축은 여전히 x·z다 — `(r, r, 1)`로 주면 z가
          //   안 커져서 고리가 얇은 타원으로 찌그러진다. 회전은 스케일 뒤에 걸린다(TRS).
          m.scale.set(r, 1, r);
          m.material.opacity = k;
          break;
        }
        case 'mergeBurst': {                  // 합성 성사 — 결과 티어 색으로 퍼지는 링
          const m = this.bursts.take();
          const r = 16 + (1 - k) * 30;
          m.position.set(wx(f.x), 1.8, wz(f.y));
          m.scale.set(r, 1, r);
          m.material.color.set(f.color!);
          m.material.opacity = k;
          break;
        }
        case 'crack':                         // 룩 — 땅을 가르는 균열. 바닥에 붙는다
          layBar(this.cracks.take(), f, 1.2, 3 + k * 4, k);
          break;
        case 'beam':                          // 비숍 — 빛. 판 위를 지나가므로 띄운다
          layBar(this.beams.take(), f, 26, 2.5 + k * 5, k * 0.95);
          break;
        case 'puff': {                        // 처치 연출
          const m = this.puffs.take();
          const r = (1 - k) * 14 + 2;
          m.position.set(wx(f.x), 14, wz(f.y));
          m.scale.setScalar(r);
          m.material.opacity = k * 0.8;
          break;
        }
        case 'shard': {                       // 처치 파편
          const m = this.shards.take();
          // ★ 높이는 이펙트 상태에 없다 — 목록은 보드 평면 좌표만 들고 있다(render/effects.ts).
          //   여기서 진행률로 포물선을 만들어 준다: 튀어 올랐다 떨어지는 것이 "부서졌다"로 읽힌다.
          const p = 1 - k;
          m.position.set(wx(f.x), Math.max(1.5, Math.sin(p * Math.PI) * 26), wz(f.y));
          m.rotation.set(p * 6, p * 4.5, 0);
          m.scale.setScalar(0.5 + k);
          m.material.opacity = k;
          break;
        }
        case 'spawnMark': {                   // 기물 스폰 — 조여드는 사각 테두리
          const g = this.frames.take();
          const r = SQ * 0.5 + (1 - k) * SQ * 0.9;
          g.position.set(wx(f.x), 2.2, wz(f.y));
          for (const side of g.children as THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>[]) {
            // 각 변은 자기 회전각 방향으로 r만큼 밀려나 정사각 테두리를 이룬다. 길이(scale.x)는
            // 변의 로컬 X축을 따르고, 그 축은 rotation.y만큼 이미 돌아가 있다.
            side.scale.set(r * 2, 2.5, 3);
            side.position.set(Math.sin(side.rotation.y) * r, 0, Math.cos(side.rotation.y) * r);
            side.material.opacity = k;
          }
          break;
        }
        case 'splitArrow': {                  // 분열 — 양옆으로 벌어지는 쐐기 둘
          const spread = (1 - k) * SQ * 0.7;
          for (const dir of [-1, 1]) {
            const m = this.wedges.take();
            m.position.set(wx(f.x) + dir * spread, 10, wz(f.y));
            m.rotation.z = -dir * Math.PI / 2;   // 원뿔 끝이 벌어지는 방향을 가리킨다
            m.material.opacity = k;
          }
          break;
        }
        default:
          // dmgNum · coin · goldFly · frostTag · blockMark — 전부 글자/표식이라 오버레이 몫이다.
          break;
      }
    }

    for (const p of [this.rings, this.bursts, this.cracks, this.beams,
      this.puffs, this.shards, this.frames, this.wedges]) p.end();
  }

  dispose(): void {
    for (const p of [this.rings, this.bursts, this.cracks, this.beams,
      this.puffs, this.shards, this.frames, this.wedges]) p.dispose();
  }
}
