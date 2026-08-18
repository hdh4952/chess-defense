import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { boardPiece, cleanState } from './helpers';
import { CONFIG } from '../src/config';
import { squareWorld } from '../src/render3d/coords';
import { pieceParts, pieceTop } from '../src/render3d/geometry';
import { Enemies3D } from '../src/render3d/enemies';
import { Pieces3D } from '../src/render3d/pieces';
import { LEAN, leanedApex, STRETCH_Y } from '../src/render3d/pose';
import { PieceFx } from '../src/render/pieceFx';
import { pawnTargets } from '../src/core/patterns';
import { createBoardCamera, createProjector, TILT } from '../src/render3d/scene';
import type { Enemy, PieceType } from '../src/types';


function makeEnemy(overrides: Partial<Enemy>): Enemy {
  return {
    id: 'e', file: 0, y: 0, hp: 10, maxHp: 10, isBoss: false, speed: 26.6, jitterX: 0,
    traits: [], slowTier: 0, auraBonus: 0,
    ...overrides,
  };
}

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * 투영 — 이 저장소에서 **가장 하중이 큰 단언**이다.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * v1.21~v1.23은 직교 투영이라 보드 좌표가 곧 화면 좌표였고, 그 항등이 드롭 판정을 공짜로
 * 맞춰 줬다. **v1.24에서 원근 쿼터뷰가 되면서 그 성질이 사라졌다** — 이제 "화면 좌표 →
 * 칸"은 역투영이고, 그것이 조금이라도 어긋나면 **드롭 판정이 조용히 틀린다**: 화면에는
 * 3랭크가 보이는데 기물은 4랭크에 놓이고, 렌더 테스트도 드래그 테스트도 각자의 좌표계
 * 안에서는 여전히 옳으므로 아무것도 잡지 못한다.
 *
 * 그래서 **왕복(칸 → 화면 → 칸)을 64칸 전수로** 못박는다. 카메라 각도·시야각·거리를 손대는
 * 사람이 반드시 밟게 될 지뢰선이며, WebGL 없이 도는 순수 행렬 연산이라 CI에서도 그대로 돈다.
 */
describe('원근 투영 — 칸 → 화면 → 칸 왕복', () => {
  const projector = createProjector(createBoardCamera().camera);

  it('64칸 전수: 칸 중심을 투영한 화면 좌표는 다시 그 칸으로 되돌아온다', () => {
    for (let file = 0; file < CONFIG.board.files; file++) {
      for (let rank = 1; rank <= CONFIG.board.ranks; rank++) {
        const w = squareWorld({ file, rank });
        const s = projector.toScreen(w.x, 0, w.z);
        expect(projector.squareAt(s.x, s.y)).toEqual({ file, rank });
      }
    }
  });

  it('판 네 귀는 화면 안에 들어온다 — 하나라도 잘리면 그 칸을 조작할 수 없다', () => {
    for (const file of [0, CONFIG.board.files - 1]) {
      for (const rank of [1, CONFIG.board.ranks]) {
        const w = squareWorld({ file, rank });
        const s = projector.toScreen(w.x, 0, w.z);
        expect(s.x).toBeGreaterThan(0);
        expect(s.x).toBeLessThan(640);
        expect(s.y).toBeGreaterThan(0);
        expect(s.y).toBeLessThan(640);
      }
    }
  });

  /**
   * ★ 직교 시절에는 캔버스 = 판이라 이 경우가 아예 없었다. 원근에서 판은 **사다리꼴**이라
   * 캔버스 네 귀퉁이는 판 밖이고, 거기를 눌러 드롭하면 원위치 복귀여야 한다.
   */
  it('캔버스 안이라도 판 밖이면 null이다 — 원근에서 판은 사다리꼴이다', () => {
    expect(projector.squareAt(2, 2)).toBeNull();
    expect(projector.squareAt(638, 2)).toBeNull();
  });

  it('원근이 실제로 걸려 있다 — 먼 랭크(8)가 가까운 랭크(1)보다 화면에서 좁다', () => {
    const width = (rank: number): number => {
      const a = squareWorld({ file: 0, rank }), b = squareWorld({ file: 7, rank });
      return projector.toScreen(b.x, 0, b.z).x - projector.toScreen(a.x, 0, a.z).x;
    };
    expect(width(8)).toBeLessThan(width(1));
    // ★ 그래도 **너무** 좁아지면 안 된다. 8랭크는 스폰 구역이라 "무엇이 오는가"를 읽어야
    //   하는 곳이고, 기울기 40°와 시야각 30°는 그 폭이 1랭크의 절반 아래로 떨어지지 않는
    //   선에서 고른 값이다(render3d/scene.ts).
    expect(width(8)).toBeGreaterThan(width(1) * 0.5);
  });

  /**
   * ⚠️ **"높이는 화면 위로 올린다"고 단언하면 안 된다.** 그건 카메라가 기울어져 있을 때만
   * 참이고, 지면 카메라를 완전 탑다운으로 세우면(TILT = 0) 올라간 점은 위가 아니라 **화면
   * 중심에서 바깥으로** 움직인다. 실제로 그 단언이 카메라 각도를 조정하자 깨졌다.
   *
   * 투영 방식과 각도에 무관하게 참인 것은 **"가까워지면 커진다"**다 — 원근 투영이라는 사실
   * 자체이고, 높이가 화면에 반영되지 않으면(예: 직교로 되돌아가거나 y를 버리면) 즉시 깨진다.
   */
  it('높이는 화면에 반영된다 — 올라간 물체는 카메라에 가까워져 화면에서 커진다', () => {
    const a = squareWorld({ file: 3, rank: 4 });
    const b = squareWorld({ file: 4, rank: 4 });
    const span = (h: number): number =>
      projector.toScreen(b.x, h, b.z).x - projector.toScreen(a.x, h, a.z).x;

    let prev = span(0);
    for (const h of [20, 46, 80]) {
      const s = span(h);
      expect(s).toBeGreaterThan(prev);
      prev = s;
    }
  });

  it('높이가 커질수록 화면 위치가 한 방향으로 계속 밀린다 — 값이 버려지면 제자리에 남는다', () => {
    const w = squareWorld({ file: 1, rank: 6 });
    const ground = projector.toScreen(w.x, 0, w.z);
    let prevShift = 0;
    for (const h of [20, 46, 80]) {
      const p = projector.toScreen(w.x, h, w.z);
      const shift = Math.hypot(p.x - ground.x, p.y - ground.y);
      expect(shift).toBeGreaterThan(prevShift);
      prevShift = shift;
    }
    expect(prevShift).toBeGreaterThan(1);
  });
});

/**
 * 실루엣 — 카메라가 거의 수직이라 기물 판독은 **꼭대기에 무엇이 얹혔는가**로 결정된다
 * (render3d/geometry.ts 상단 주석). 몸통만 있는 기물과 부속물이 있는 기물이 실제로 갈리는지,
 * 그리고 융합 기물 셋이 전부 말머리를 갖는지를 못박는다 — 후자는 융합 규칙 그 자체다.
 */
describe('pieceParts() — 기물 실루엣', () => {
  const ALL: PieceType[] = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'archbishop', 'chancellor', 'amazon'];

  it('여덟 종 모두 지오메트리를 만든다', () => {
    for (const t of ALL) expect(pieceParts(t).length).toBeGreaterThan(0);
  });

  it('같은 종류를 다시 물어도 **같은 지오메트리 인스턴스**가 온다 (타입당 한 번만 만든다)', () => {
    for (const t of ALL) expect(pieceParts(t)[0].geometry).toBe(pieceParts(t)[0].geometry);
  });

  it('폰·비숍은 몸통뿐이고, 룩·퀸·나이트와 융합 기물 셋은 부속물을 갖는다', () => {
    expect(pieceParts('pawn')).toHaveLength(1);
    expect(pieceParts('bishop')).toHaveLength(1);
    for (const t of ['knight', 'rook', 'queen', 'archbishop', 'chancellor', 'amazon'] as PieceType[]) {
      expect(pieceParts(t).length).toBeGreaterThan(1);
    }
  });

  it('꼭대기 높이가 종류마다 다르다 — 체력바·배지가 실루엣을 뚫지 않으려면 이 값이 실제 높이여야 한다', () => {
    expect(pieceTop('pawn')).toBeGreaterThan(0);
    expect(pieceTop('queen')).toBeGreaterThan(pieceTop('pawn'));
    expect(pieceTop('amazon')).toBeGreaterThan(pieceTop('queen'));   // 퀸 몸통 + 말머리
  });
});

describe('Pieces3D — 기물 메시 풀', () => {
  it('기물이 늘고 줄면 씬 그래프도 정확히 따라온다 (팔린 기물이 화면에 남지 않는다)', () => {
    const scene = new THREE.Scene();
    const pieces = new Pieces3D(scene);
    const state = cleanState();

    pieces.sync(state);
    expect(scene.children).toHaveLength(0);

    const a = boardPiece('rook', 1, 1);
    const b = boardPiece('pawn', 2, 2);
    state.pieces.push(a, b);
    pieces.sync(state);
    expect(scene.children).toHaveLength(2);

    state.pieces.splice(0, 1);                 // a를 판다
    pieces.sync(state);
    expect(scene.children).toHaveLength(1);

    pieces.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('칸이 바뀌면 **옮기기만** 한다 — 다시 만들지 않는다(그림자 재계산과 GC를 피한다)', () => {
    const scene = new THREE.Scene();
    const pieces = new Pieces3D(scene);
    const state = cleanState();
    const p = boardPiece('rook', 0, 1);
    state.pieces.push(p);

    pieces.sync(state);
    const first = scene.children[0];
    const start = first.position.clone();

    p.square = { file: 4, rank: 5 };
    pieces.sync(state);
    expect(scene.children[0]).toBe(first);     // 같은 인스턴스
    expect(first.position.equals(start)).toBe(false);
    const w = squareWorld(p.square);
    expect(first.position.x).toBeCloseTo(w.x);
    expect(first.position.z).toBeCloseTo(w.z);
  });

  it('T1은 링이 없고 T2 이상만 링을 갖는다 — 보드 전체가 상시 테두리로 덮이지 않게 (render/tiers.ts)', () => {
    const scene = new THREE.Scene();
    const pieces = new Pieces3D(scene);
    const state = cleanState();
    const p = boardPiece('rook', 3, 3, 1);
    state.pieces.push(p);

    // ⚠️ 재질까지 봐야 한다 — v1.23부터 링마다 **윤곽선 헐**이 하나 더 붙어 토러스가 둘이다.
    //    티어 색을 입은 쪽(툰 재질)만이 "링"이고, 나머지 하나는 그 링의 검은 테두리다.
    const rings = (): number => scene.children[0].children
      .filter(c => c instanceof THREE.Mesh && c.geometry instanceof THREE.TorusGeometry
        && c.material instanceof THREE.MeshToonMaterial).length;

    pieces.sync(state);
    expect(rings()).toBe(0);

    p.tier = 3;
    pieces.sync(state);                        // 티어가 바뀌면 모양이 바뀌므로 다시 만든다
    expect(rings()).toBe(1);
  });
});

/**
 * ★ 공격 모션이 **몸통에만** 걸린다는 것이 이 그룹 분리의 존재 이유다. 티어 링은 바닥에
 * 눕힌 데칼이라 기물이 찌를 때 딸려 나가면 칸을 벗어나 이웃 칸을 침범하고, 그 순간 "이 칸의
 * 기물이 T3다"라는 뜻이 깨진다. 기물은 발을 딛고 상체만 나간다.
 */
describe('Pieces3D — 공격 모션 (v1.22)', () => {
  function setup(tier: number) {
    const scene = new THREE.Scene();
    const pieces = new Pieces3D(scene);
    const state = cleanState();
    const p = boardPiece('pawn', 3, 3, tier);
    state.pieces.push(p);
    const fx = new PieceFx();
    return { scene, pieces, state, p, fx };
  }

  it('찌르는 동안 몸통은 앞으로 나가고 기울지만, 티어 링은 제자리에 남는다', () => {
    const { scene, pieces, state, p, fx } = setup(3);
    pieces.sync(state, fx);
    const group = scene.children[0];
    const body = group.children[0] as THREE.Group;
    const ring = group.children.find(
      c => c instanceof THREE.Mesh && c.geometry instanceof THREE.TorusGeometry
        && c.material instanceof THREE.MeshToonMaterial,
    )!;
    const ringAt = ring.position.clone();

    fx.onEvent({ kind: 'attack', pieceType: 'pawn', from: p.square, targets: pawnTargets(p.square) });
    fx.update(0.045);
    pieces.sync(state, fx);

    expect(body.position.z).toBeLessThan(0);          // −Z = 8랭크 쪽 = 적이 오는 방향
    expect(body.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(0.1);
    expect(ring.position.equals(ringAt)).toBe(true);  // 링은 미동도 하지 않는다
  });

  it('모션이 끝나면 몸통이 정확히 원위치로 돌아온다 — 조금이라도 남으면 매 공격마다 누적된다', () => {
    const { scene, pieces, state, p, fx } = setup(1);
    pieces.sync(state, fx);
    const body = scene.children[0].children[0] as THREE.Group;

    for (let i = 0; i < 3; i++) {
      fx.onEvent({ kind: 'attack', pieceType: 'pawn', from: p.square, targets: pawnTargets(p.square) });
      fx.update(0.3);
      pieces.sync(state, fx);
    }
    expect(body.position.length()).toBe(0);
    expect(body.quaternion.angleTo(new THREE.Quaternion())).toBe(0);
  });

  it('pieceFx를 넘기지 않아도 그대로 동작한다 (선택 인자 — 모션만 꺼진다)', () => {
    const { scene, pieces, state } = setup(1);
    expect(() => pieces.sync(state)).not.toThrow();
    const body = scene.children[0].children[0] as THREE.Group;
    expect(body.position.length()).toBe(0);
  });
});

describe('Enemies3D — 적 메시 풀', () => {
  it('감속 고리는 감속 중일 때만 붙는다 — 그리고 다시 풀리면 떨어진다', () => {
    const scene = new THREE.Scene();
    const enemies = new Enemies3D(scene);
    const state = cleanState();
    const e = makeEnemy({ id: 'e1', file: 2, y: 200 });
    state.enemies.push(e);

    enemies.sync(state);
    const group = scene.children[0];
    const base = group.children.length;

    e.slowTier = 2;
    enemies.sync(state);
    expect(group.children.length).toBe(base + 1);

    e.slowTier = 0;
    enemies.sync(state);
    expect(group.children.length).toBe(base);
  });

  /**
   * ★ **연출 자체가 규칙이다.** 고리의 위상을 벽시계가 아니라 `e.y`에서 뽑기 때문에, 고리는
   * 적이 실제로 나아가는 속도로 돌고 감속된 적의 고리는 그만큼 느리게 돈다. 시간 기반으로
   * 바뀌면 일시정지·준비 단계에서 혼자 계속 도는 결함이 함께 따라온다.
   */
  it('감속 고리의 회전각은 적의 진행 거리(e.y)에서만 나온다 — 시간이 흘러도 적이 멈춰 있으면 고리도 멈춘다', () => {
    const scene = new THREE.Scene();
    const enemies = new Enemies3D(scene);
    const state = cleanState();
    const e = makeEnemy({ id: 'e1', file: 2, y: 200, slowTier: 1 });
    state.enemies.push(e);

    enemies.sync(state);
    const group = scene.children[0];
    const ring = group.children[group.children.length - 1];
    const before = ring.rotation.y;

    enemies.sync(state);                       // 프레임만 흘렀고 적은 그대로다
    expect(ring.rotation.y).toBe(before);

    e.y = 280;
    enemies.sync(state);
    expect(ring.rotation.y).not.toBe(before);
  });

  it('실드형은 방향 표식을 하나 더 갖는다 (스폰 시 확정되는 정체성이라 생성 시 한 번만 붙인다)', () => {
    const scene = new THREE.Scene();
    const enemies = new Enemies3D(scene);
    const state = cleanState();
    state.enemies.push(
      makeEnemy({ id: 'plain', file: 0, y: 100 }),
      makeEnemy({ id: 'shield', file: 1, y: 100, traits: ['shielded'] }),
    );

    enemies.sync(state);
    const [plain, shielded] = scene.children;
    expect(shielded.children.length).toBe(plain.children.length + 1);
  });

  it('죽은 적은 씬에서 사라진다 — 한 판에 452마리가 지나가므로 정리를 빠뜨리면 단조 증가한다', () => {
    const scene = new THREE.Scene();
    const enemies = new Enemies3D(scene);
    const state = cleanState();
    for (let i = 0; i < 12; i++) state.enemies.push(makeEnemy({ id: `e${i}`, file: i % 8, y: 40 * i }));

    enemies.sync(state);
    expect(scene.children).toHaveLength(12);

    state.enemies.length = 0;
    enemies.sync(state);
    expect(scene.children).toHaveLength(0);
  });

  it('보스는 일반 적보다 머리가 높다 — 체력바가 그만큼 위에 뜬다(overlay.test.ts와 같은 근거)', () => {
    expect(Enemies3D.topOf(true)).toBeGreaterThan(Enemies3D.topOf(false));
  });
});

/**
 * ★★ **각도 불일치**(v1.25) — 지면은 가파르게, 기물은 낮은 각도로.
 *
 * 눕히는 **방향이 직관과 반대**라 여기서 못박는다: 기물의 옆모습이 더 보이려면 기물 축과
 * 시선이 이루는 각이 **커져야** 하고, 카메라가 +Z에 있으므로 −Z(적이 오는 쪽)로 눕혀야 한다.
 * 부호가 뒤집히면 화면상으로는 "조금 이상한데 왜인지 모르겠는" 상태가 되고, 아무 테스트도
 * 깨지지 않는다.
 */
describe('각도 불일치 — 기물을 눕혀 낮은 각도를 흉내낸다', () => {
  it('기물은 카메라 **반대쪽**(−Z)으로 눕는다 — 시선과 이루는 각이 커져야 옆모습이 보인다', () => {
    const scene = new THREE.Scene();
    const pieces = new Pieces3D(scene);
    const state = cleanState();
    state.pieces.push(boardPiece('queen', 3, 3));
    pieces.sync(state);

    const body = scene.children[0].children[0] as THREE.Group;
    const lean = body.children[0] as THREE.Group;
    expect(lean.rotation.x).toBeLessThan(0);            // −X 회전 = 꼭대기가 −Z로 넘어간다
    expect(lean.scale.y).toBeGreaterThan(1);            // 원근 단축 보정
  });

  /**
   * ★ **이 트릭이 성립하는 구간을 지킨다.** 시선은 수직에서 TILT이고, 기물을 반대쪽으로
   * LEAN만큼 눕히면 둘이 이루는 각은 TILT + LEAN — 지면 기준으로는 `90° − (TILT + LEAN)`에서
   * 본 것과 같다. 두 상수를 각각 조정할 수 있으므로 **합이 만드는 결과**를 못박는다.
   *
   * 위쪽(60°)을 넘으면 다시 정수리만 보여 회전체가 전부 원이 되고, 아래쪽(25°) 밑으로 내려가면
   * 기물이 서 있는 게 아니라 **넘어져 누운 것**으로 보이면서 뒤 칸을 가린다. 그 사이가
   * "낮은 각도에서 본 유닛"으로 읽히는 구간이다.
   */
  it('눕힌 결과가 "낮은 각도에서 본 유닛" 구간에 들어간다 — 그것이 이 트릭의 목표다', () => {
    const apparentFromGround = 90 - THREE.MathUtils.radToDeg(TILT + LEAN);
    expect(apparentFromGround).toBeGreaterThanOrEqual(25);
    expect(apparentFromGround).toBeLessThanOrEqual(60);
  });

  /**
   * ⚠️ 지면 카메라를 완전 탑다운(TILT = 0)까지 세울 수 있으므로, **기울임이 실제로 걸려
   * 있는지**는 따로 확인해야 한다 — 둘 다 0이면 위 단언은 90°가 되어 저절로 깨지지만,
   * LEAN만 0이 되면 각도가 TILT에 따라 우연히 구간에 들어올 수 있다.
   */
  it('기물 기울임이 실제로 걸려 있다 — 0이면 각도 불일치가 통째로 꺼진 것이다', () => {
    expect(LEAN).toBeGreaterThan(THREE.MathUtils.degToRad(10));
  });

  it('꼭대기 위치가 늘림과 기울임을 모두 반영한다 — 아니면 체력바가 몸통에 파묻힌다', () => {
    const h = 60;
    const apex = leanedApex(h);
    expect(apex.y).toBeCloseTo(h * STRETCH_Y * Math.cos(LEAN), 6);
    expect(apex.z).toBeCloseTo(-h * STRETCH_Y * Math.sin(LEAN), 6);
    expect(apex.z).toBeLessThan(0);                     // 눕힌 방향과 같은 쪽(−Z)으로 물러난다
  });
});
