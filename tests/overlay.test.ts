import { describe, expect, it } from 'vitest';
import { boardPiece, cleanState } from './helpers';
import { fileCenterX, rankToTopY } from '../src/core/grid';
import { Effects } from '../src/render/effects';
import { drawOverlay, HP_H, HP_W } from '../src/render3d/overlay';
import { Enemies3D } from '../src/render3d/enemies';
import { leanedApex } from '../src/render3d/pose';
import { OUTLINE_INK } from '../src/render3d/outline';
import { createBoardCamera, createProjector } from '../src/render3d/scene';
import { enemyWorld, VIEW_H, VIEW_W, worldX, worldZ } from '../src/render3d/coords';
import type { Enemy } from '../src/types';
import { makeStubCtx, type Call } from './canvasStub';

/**
 * 화면 오버레이 (v1.21 신설) — 3D 위에 얹히는 정보 계층.
 *
 * 예전에는 이 검증들이 전부 renderer.test.ts에 있었다. 체력바·유형 표식·버프 배지·보스
 * 비네트가 기물/적 스프라이트와 **같은 캔버스**에 그려졌기 때문이다. 3D로 가면서 기물과 적은
 * 메시가 됐고, 이 정보들만 2D로 남았다 — 옮긴 것은 계층이지 규칙이 아니라서, 아래 단언은
 * 대부분 예전 그대로다.
 */

/**
 * ★ v1.24 — 오버레이는 이제 **실제 투영**을 거친다. 카메라는 WebGL 없이 세울 수 있으므로
 * (render3d/scene.ts의 `createBoardCamera`) 이 스위트는 여전히 헤드리스로 돈다.
 */
const projector = createProjector(createBoardCamera().camera);

function makeEnemy(overrides: Partial<Enemy>): Enemy {
  return {
    id: 'e', file: 0, y: 0, hp: 10, maxHp: 10, isBoss: false, speed: 26.6, jitterX: 0,
    traits: [], slowTier: 0, auraBonus: 0,
    ...overrides,
  };
}

/** 체력바의 **꽉 찬** 사각형들(빈 구간 + 남은 체력). ★ v1.26에서 치수가 바뀌었으므로
 *  리터럴이 아니라 export된 상수에서 유도한다 — 툰 폴리시로 굵기를 또 조정해도 따라온다. */
function hpBars(records: Call[]): Call[] {
  return records.filter(r => r.method === 'fillRect' && r.args[2] === HP_W && r.args[3] === HP_H);
}

describe('drawOverlay() — 체력바', () => {
  it('적마다 체력바(배경+체력, fillRect 2회)가 그려지고 아군 기물에는 체력바가 없다', () => {
    const { ctx, records } = makeStubCtx();
    const state = cleanState();
    state.enemies.push(
      makeEnemy({ id: 'n1', file: 2, y: 200 }),
      makeEnemy({ id: 'b1', file: 5, y: 100, isBoss: true, hp: 300, maxHp: 300 }),
    );
    state.pieces.push(boardPiece('knight', 3, 1));

    expect(() => drawOverlay(ctx as unknown as CanvasRenderingContext2D, state, [], projector)).not.toThrow();
    expect(hpBars(records)).toHaveLength(state.enemies.length * 2);
  });

  it('적은 y 오름차순으로 그려진다 (1랭크/방어선에 가까운 적이 마지막에 그려짐)', () => {
    const { ctx, records } = makeStubCtx();
    const state = cleanState();
    // 입력 순서를 뒤집어 정렬이 실제로 적용되는지 검증한다.
    state.enemies.push(makeEnemy({ id: 'near', file: 1, y: 500 }), makeEnemy({ id: 'far', file: 1, y: 40 }));

    drawOverlay(ctx as unknown as CanvasRenderingContext2D, state, [], projector);

    // 배경 막대(짝수 번째)의 y가 곧 그리기 순서다.
    const ys = hpBars(records).filter((_, i) => i % 2 === 0).map(r => r.args[1] as number);
    expect(ys).toHaveLength(2);
    expect(ys[0]).toBeLessThan(ys[1]);      // far(y=40)가 먼저, near(y=500)가 마지막
  });

  it('jitterX는 그려지는 x 좌표만 이동시킨다 (동일 file, 다른 jitterX → 투영된 그 차이만큼)', () => {
    const { ctx, records } = makeStubCtx();
    const state = cleanState();
    state.enemies.push(
      makeEnemy({ id: 'j1', file: 4, y: 150, jitterX: 0 }),
      makeEnemy({ id: 'j2', file: 4, y: 150, jitterX: 6 }),
    );

    drawOverlay(ctx as unknown as CanvasRenderingContext2D, state, [], projector);

    const xs = hpBars(records).filter((_, i) => i % 2 === 0).map(r => r.args[0] as number);
    expect(new Set(xs).size).toBe(2);
    // ★ v1.24 — 원근에서 보드 6px은 화면 6px이 아니다(랭크에 따라 배율이 다르다).
    //   기대값을 투영에서 유도해, "지터가 걸린다"는 규칙만 남기고 배율은 카메라에 맡긴다.
    // ⚠️ 체력바는 **머리 높이**에서 투영된다 — 지면(y=0)에서 재면 배율이 미세하게 달라
    //    맞지 않는다. 원근에서는 "같은 보드 거리라도 높이가 다르면 화면 거리가 다르다".
    const apex = leanedApex(Enemies3D.topOf(false));
    const z = worldZ(150) + apex.z;
    const expected = projector.toScreen(worldX(fileCenterX(4) + 6), apex.y, z).x
      - projector.toScreen(worldX(fileCenterX(4)), apex.y, z).x;
    expect(expected).toBeGreaterThan(0);
    expect(xs[1] - xs[0]).toBeCloseTo(expected, 6);
  });

  /**
   * ★ 3D가 되면서 새로 생긴 규칙이다. 체력바는 이제 적의 **머리 위**에 뜨는데, 머리 높이는
   * 메시의 실제 높이라 보스가 일반 적보다 훨씬 높다. 투영이 그 높이를 화면으로 되돌리므로
   * (`projectToBoard`), 같은 y에 선 보스의 체력바가 일반 적보다 화면에서 더 위에 있어야 한다 —
   * 그 차이 자체가 "저건 크다"는 단서다. 높이를 무시하고 그리면 이 단언이 깨진다.
   */
  it('체력바는 적 머리 높이만큼 화면 위로 올라간다 — 보스가 일반 적보다 더 위다', () => {
    const { ctx, records } = makeStubCtx();
    const state = cleanState();
    state.enemies.push(
      makeEnemy({ id: 'grunt', file: 1, y: 300 }),
      makeEnemy({ id: 'boss', file: 6, y: 300, isBoss: true }),
    );

    drawOverlay(ctx as unknown as CanvasRenderingContext2D, state, [], projector);

    // 보드 y가 같으면 정렬이 입력 순서를 보존하므로(안정 정렬) 배경 막대 순서는 grunt, boss다.
    const bars = hpBars(records).filter((_, i) => i % 2 === 0);
    const [gruntY, bossY] = bars.map(r => r.args[1] as number);
    expect(bossY).toBeLessThan(gruntY);
    // 같은 보드 y라도 파일이 다르면 원근에서 화면 y가 미세하게 달라지므로, 각 적의 자기
    // 자리에서 머리 높이만큼의 투영 차이를 따로 구해 비교한다.
    const lift = (file: number, isBoss: boolean): number => {
      const w = enemyWorld(makeEnemy({ file, y: 300 }));
      const apex = leanedApex(Enemies3D.topOf(isBoss));
      return projector.toScreen(w.x, 0, w.z).y - projector.toScreen(w.x, apex.y, w.z + apex.z).y;
    };
    expect(lift(6, true)).toBeGreaterThan(lift(1, false));
  });

  /**
   * ★ 3D가 만든 회귀를 막는 자리. 체력바가 머리 높이만큼 위로 올라가면서(위 테스트) 8랭크에
   * 갓 스폰한 적의 막대가 캔버스 위로 잘려 나갈 수 있게 됐다 — 하필 "무엇이 오는가"를 읽어야
   * 하는 순간에 사라진다. 감속 라벨은 예전부터 같은 이유로 하한을 갖고 있었다.
   */
  it('8랭크 최상단(y≈0)에 갓 스폰한 적의 체력바가 화면 위로 잘려 나가지 않는다', () => {
    const { ctx, records } = makeStubCtx();
    const state = cleanState();
    state.enemies.push(
      makeEnemy({ id: 'fresh', file: 3, y: 0 }),
      makeEnemy({ id: 'freshBoss', file: 5, y: 0, isBoss: true }),   // 머리가 더 높아 더 위험하다
    );

    drawOverlay(ctx as unknown as CanvasRenderingContext2D, state, [], projector);

    const tops = hpBars(records).map(r => r.args[1] as number);
    expect(tops).toHaveLength(4);
    for (const t of tops) expect(t).toBeGreaterThanOrEqual(0);
  });

  /**
   * ★ v1.26 — 체력바를 툰 렌더링에 맞췄다. 모양은 직사각형이므로(사용자 결정) 툰다움은
   * **테두리와 광택 둘이 전부 감당한다** — 하나라도 빠지면 막대가 다시 계기판처럼 보이는데,
   * 그건 색만 봐서는 드러나지 않는다. 테두리는 두께·색·**그리는 순서**까지 지킨다:
   * 막대보다 나중에 그리면 채움을 덮어 막대가 통째로 검게 된다.
   */
  it('체력바가 툰 형태로 그려진다 — 기물과 같은 잉크의 테두리 + 위쪽 광택 (직사각형)', () => {
    const { ctx, records } = makeStubCtx();
    const state = cleanState();
    state.enemies.push(makeEnemy({ id: 'n', file: 3, y: 300 }));

    drawOverlay(ctx as unknown as CanvasRenderingContext2D, state, [], projector);

    // ① 테두리 — 막대보다 한 겹 큰 어두운 사각형이 **뒤에** 깔린다. 색은 3D 윤곽선과 같아야
    //    한다(아니면 한 화면에 두 화풍이 섞인다). 두께는 네 변 모두 같다.
    const bar = records.find(r => r.method === 'fillRect' && r.args[2] === HP_W && r.args[3] === HP_H)!;
    const border = records.find(r => r.method === 'fillRect' && r.fillStyle === OUTLINE_INK)!;
    expect(border).toBeDefined();
    const pad = (bar.args[2] as number) - (border.args[2] as number);
    expect(pad).toBeLessThan(0);                                    // 테두리가 더 넓다
    expect((border.args[3] as number) - (bar.args[3] as number)).toBe(-pad);   // 가로·세로 여백이 같다
    expect((bar.args[0] as number) - (border.args[0] as number)).toBe(-pad / 2);
    // ② 테두리는 막대보다 **먼저** 그려져야 한다 — 뒤에 그리면 채움을 덮는다.
    expect(records.indexOf(border)).toBeLessThan(records.indexOf(bar));
    // ③ 광택 — 막대 전체 폭에 걸친 낮은 띠(HP_H의 40%).
    const gloss = records.find(r => r.method === 'fillRect' && r.args[3] === HP_H * 0.4);
    expect(gloss).toBeDefined();
    expect(gloss!.args[2]).toBe(HP_W);
  });

  it('오라 보너스가 있으면 그 구간이 오라 색으로 덧그려진다 (막대 하나가 더 늘어난다)', () => {
    const { ctx, records } = makeStubCtx();
    const state = cleanState();
    state.enemies.push(makeEnemy({ id: 'a', file: 3, y: 200, hp: 10, maxHp: 10, auraBonus: 6 }));

    drawOverlay(ctx as unknown as CanvasRenderingContext2D, state, [], projector);

    // ⚠️ 폭으로 거르면 안 된다 — 보너스 구간은 비율만큼만 넓어 HP_W가 아니다.
    const bars = records.filter(r => r.method === 'fillRect' && r.args[3] === HP_H);
    expect(bars).toHaveLength(3);                    // 빈 구간 + 체력 + 보너스
    expect(bars[2].fillStyle).toBe('#FFB454');       // TRAIT_COLOR.aura
    expect(bars[2].args[2]).toBeCloseTo(HP_W * 6 / 16);
  });
});

describe('drawOverlay() — 퀸 버프 뱃지 (스펙 7.7)', () => {
  it('queenBuffCount에 따라 ×N 텍스트가 그려지고, 0이면 뱃지가 없다', () => {
    const { ctx, records } = makeStubCtx();
    const state = cleanState();
    const q0 = boardPiece('queen', 0, 1); q0.queenBuffCount = 0;
    const q1 = boardPiece('queen', 1, 1); q1.queenBuffCount = 1;
    const q2 = boardPiece('queen', 2, 1); q2.queenBuffCount = 2;
    state.pieces.push(q0, q1, q2);

    drawOverlay(ctx as unknown as CanvasRenderingContext2D, state, [], projector);

    const badgeTexts = records
      .filter(r => r.method === 'fillText' && typeof r.args[0] === 'string' && (r.args[0] as string).startsWith('×'))
      .map(r => r.args[0]);
    expect(badgeTexts).toEqual(['×2', '×3']); // buffCount 0 → 뱃지 없음, 1 → ×2, 2 → ×3
  });
});

describe('drawOverlay() — 보스 비네트 (스펙 7.9)', () => {
  function vignetteDrawn(records: Call[], gradientStub: unknown): boolean {
    return records.some(
      r => r.method === 'fillRect' && r.args[2] === VIEW_W && r.args[3] === VIEW_H
        && r.fillStyle === gradientStub,
    );
  }

  it('보스가 3랭크(트리거 이전)에 있으면 비네트를 그리지 않는다', () => {
    const { ctx, records, gradientStub } = makeStubCtx();
    const state = cleanState();
    state.enemies.push(makeEnemy({ id: 'boss', file: 0, y: rankToTopY(3), isBoss: true }));
    drawOverlay(ctx as unknown as CanvasRenderingContext2D, state, [], projector);
    expect(records.some(r => r.method === 'createRadialGradient')).toBe(false);
    expect(vignetteDrawn(records, gradientStub)).toBe(false);
  });

  it('보스가 2랭크 이하로 진입하면 비네트를 그린다', () => {
    const { ctx, records, gradientStub } = makeStubCtx();
    const state = cleanState();
    state.enemies.push(makeEnemy({ id: 'boss', file: 0, y: rankToTopY(2), isBoss: true }));
    drawOverlay(ctx as unknown as CanvasRenderingContext2D, state, [], projector);
    expect(records.some(r => r.method === 'createRadialGradient')).toBe(true);
    expect(vignetteDrawn(records, gradientStub)).toBe(true);
  });

  it('보스가 아닌 적이 1랭크에 있어도 비네트를 그리지 않는다', () => {
    const { ctx, records, gradientStub } = makeStubCtx();
    const state = cleanState();
    state.enemies.push(makeEnemy({ id: 'grunt', file: 0, y: rankToTopY(1), isBoss: false }));
    drawOverlay(ctx as unknown as CanvasRenderingContext2D, state, [], projector);
    expect(records.some(r => r.method === 'createRadialGradient')).toBe(false);
    expect(vignetteDrawn(records, gradientStub)).toBe(false);
  });
});

/**
 * ★ 계층 분담의 핵심 단언. `Effects`의 목록은 두 소비자가 나눠 가지는데, 오버레이가 가져가야
 * 할 것은 **글자와 표식**뿐이다. 판 위의 사건(충격파·균열·광선·파편)까지 여기서 그리면
 * 3D 계층과 이중으로 그려지고, 반대로 글자를 3D에 넘기면 기물 뒤에서 읽히지 않는다.
 */
describe('drawOverlay() — 이펙트 분담', () => {
  it('글자 이펙트(골드 획득)는 오버레이가 그린다', () => {
    const fx = new Effects();
    fx.onEvent({ kind: 'goldGained', square: { file: 2, rank: 4 }, amount: 17 });

    const { ctx, records } = makeStubCtx();
    drawOverlay(ctx as unknown as CanvasRenderingContext2D, cleanState(), fx.items(), projector);

    const texts = records.filter(r => r.method === 'fillText').map(r => r.args[0]);
    expect(texts).toContain('+17G');
  });

  /**
   * ★ "떠오른다"는 **그리는 쪽**의 일이다. 이펙트 목록의 좌표는 칸 중앙에 그대로 머물고
   * (effects.test.ts가 그 사실을 못박는다), 진행률로 y를 밀어 올리는 것은 여기다. 그래서
   * 이 단언이 사라지면 "+10G"가 칸에 박혀 움직이지 않아도 아무 테스트가 깨지지 않는다.
   */
  it('골드 텍스트는 시간이 지나면 같은 x에서 위(y 감소)로 떠오른다', () => {
    const fx = new Effects();
    const square = { file: 3, rank: 4 };
    fx.onEvent({ kind: 'goldGained', square, amount: 10 });

    const at = (): { x: number; y: number } => {
      const { ctx, records } = makeStubCtx();
      drawOverlay(ctx as unknown as CanvasRenderingContext2D, cleanState(), fx.items(), projector);
      const t = records.find(r => r.method === 'fillText' && r.args[0] === '+10G')!;
      return { x: t.args[1] as number, y: t.args[2] as number };
    };

    // ★ v1.24 — 원근이라 화면 좌표가 보드 좌표와 더는 같지 않다. 기대값을 투영에서 유도한다.
    const c = projector.toScreen(worldX(fileCenterX(square.file)), 0, worldZ(rankToTopY(square.rank) + 40));
    const start = at();
    expect(start.x).toBeCloseTo(c.x, 6);
    expect(start.y).toBeCloseTo(c.y, 6);                  // 갓 생긴 이펙트는 칸 중앙에서 출발한다

    fx.update(0.5);
    const later = at();
    expect(later.x).toBe(start.x);
    expect(later.y).toBeLessThan(start.y);
  });

  /**
   * ★ v1.24에서 이 검증이 effects.test.ts에서 여기로 옮겨 왔다. 감속 범위는 8랭크를 포함하므로
   * 갓 스폰된 적(y≈0)이 곧바로 걸리는 경우가 실제로 생기고, 라벨은 적보다 **화면에서** 위에
   * 뜨므로 그대로 두면 캔버스 밖으로 잘려 "아무 일도 안 일어난" 것으로 보인다. 원근이 된
   * 지금 그 리프트와 하한은 둘 다 그리는 쪽의 일이다.
   */
  it('8랭크 최상단에서 감속돼도 라벨이 화면 위로 잘려 나가지 않는다', () => {
    const fx = new Effects();
    fx.onEvent({ kind: 'enemySlowed', enemyId: 'e1', file: 0, y: 0, tier: 3 });

    const { ctx, records } = makeStubCtx();
    drawOverlay(ctx as unknown as CanvasRenderingContext2D, cleanState(), fx.items(), projector);

    // ⚠️ 플레이어 킹의 체력바 숫자도 fillText라 함께 잡힌다 — 감속 라벨만 골라낸다.
    const label = records.filter(r => r.method === 'fillText' && String(r.args[0]).includes('%'));
    expect(label).toHaveLength(1);
    expect(label[0].args[2] as number).toBeGreaterThan(0);
  });

  it('판 위 이펙트(룩 균열·비숍 광선·처치 파편)는 오버레이가 **그리지 않는다** — 3D 계층 몫이다', () => {
    const fx = new Effects();
    fx.onEvent({
      kind: 'attack', pieceType: 'rook', from: { file: 3, rank: 3 },
      targets: [{ file: 3, rank: 7 }],
    });
    fx.onEvent({ kind: 'enemyDied', enemyId: 'x', square: { file: 3, rank: 7 }, isBoss: false, reward: 5 });
    expect(fx.items().length).toBeGreaterThan(0);      // 전제: 이펙트가 실제로 만들어졌다

    // ⚠️ 오버레이는 이펙트가 없어도 **플레이어 킹의 체력바**를 늘 그린다(v1.28). 그래서
    //    "아무것도 안 그린다"가 아니라 **"이펙트가 있어도 늘어나지 않는다"**를 재야 한다.
    const paint = (items: readonly ReturnType<Effects['items']>[number][]): number => {
      const { ctx, records } = makeStubCtx();
      drawOverlay(ctx as unknown as CanvasRenderingContext2D, cleanState(), items, projector);
      // save/restore는 목록을 **순회한 흔적**일 뿐 그린 것이 아니다 — 실제로 잉크가 나간
      // 호출만 센다.
      return records.filter(r => r.method !== 'save' && r.method !== 'restore').length;
    };
    expect(paint(fx.items())).toBe(paint([]));
  });
});
