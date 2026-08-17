import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { BOARD_H, BOARD_W, fileCenterX, rankToTopY } from '../src/core/grid';
import { createInitialState } from '../src/core/state';
import { createFrameView, EMPTY_VIEW, render, SPAWN_BORDER_PX } from '../src/render/renderer';
import type { Enemy, Piece } from '../src/types';
import { makeStubCtx, type Call } from './canvasStub';

const SQ = CONFIG.board.squarePx;

function makeEnemy(overrides: Partial<Enemy>): Enemy {
  return {
    id: 'e', file: 0, y: 0, hp: 10, maxHp: 10, isBoss: false, speed: 26.6, jitterX: 0,
    traits: [], slowTier: 0, auraBonus: 0,
    ...overrides,
  };
}

function makePiece(overrides: Partial<Piece>): Piece {
  return {
    id: 'p', type: 'rook', square: { file: 0, rank: 1 }, cooldown: 0, queenBuffCount: 0, tier: 1,
    ...overrides,
  };
}

describe('render() (Task 7 — 캔버스 렌더러)', () => {
  it('예외 없이 렌더되고, 보드 64칸을 모두 그린다 (8×8)', () => {
    const { ctx, records } = makeStubCtx();
    const state = createInitialState();
    expect(() => render(ctx as unknown as CanvasRenderingContext2D, state)).not.toThrow();
    const squareFills = records.filter(
      r => r.method === 'fillRect' && r.args[2] === SQ && r.args[3] === SQ,
    );
    expect(squareFills).toHaveLength(64);
  });

  it('8랭크(최상단, y=0)의 스폰 구역에 명도 오버레이 + 7랭크 경계의 불투명 경계선이 이중으로 덮인다', () => {
    // 재검토 수정: 예전에는 옅은 붉은 틴트(rgba(200,60,50,0.10)) 하나뿐이었는데, 나무색 보드
    // 위에서는 색상(hue)만 다르고 명도(luminance)는 거의 그대로라 인접 랭크와 육안으로
    // 구분되지 않는 결함이 있었다(SVG-report.md 참조). 지금은 명도 오버레이 + 불투명 경계선
    // 두 개의 fillRect로 이중 표식한다 — 이 테스트는 그 두 개가 모두 있는지, 정확한 색상인지,
    // 경계선이 7랭크를 침범하지 않고 8랭크 칸 안쪽에서 정확히 그 경계에 맞닿는지까지 고정한다.
    const { ctx, records } = makeStubCtx();
    render(ctx as unknown as CanvasRenderingContext2D, createInitialState());
    expect(rankToTopY(8)).toBe(0); // 8랭크가 최상단 행

    // 보드 폭(BOARD_W) 전체를 가로지르는 fillRect는 이 두 표식뿐이다(개별 64칸은 SQ×SQ,
    // 보스 비네트는 기본 상태엔 그려지지 않음 — 아래에서 길이 2로 못박아 그 전제를 검증한다).
    const spawnMarks = records.filter(r => r.method === 'fillRect' && r.args[2] === BOARD_W);
    expect(spawnMarks).toHaveLength(2);

    const overlay = spawnMarks.find(r => r.args[1] === 0);
    expect(overlay).toBeDefined();
    expect(overlay!.args).toEqual([0, 0, BOARD_W, SQ]);
    expect(overlay!.fillStyle).toBe('rgba(0, 0, 0, 0.14)');

    const border = spawnMarks.find(r => r.args[1] !== 0);
    expect(border).toBeDefined();
    expect(border!.fillStyle).toBe('#C83C32');
    const [bx, by, bw, bh] = border!.args as number[];
    expect(bx).toBe(0);
    expect(bw).toBe(BOARD_W);
    // 재검토 Important 1: by>0 && by+bh===SQ만으로는 두께 0(by=SQ, bh=0)짜리 "보이지 않는" 경계선도
    // 통과한다 — 이 결함을 고치는 커밋의 테스트가 정확히 그 결함을 놓치면 안 된다. SPAWN_BORDER_PX를
    // 리터럴로 못박아(자기 참조가 아니라 실제 의도한 값 4를 고정) 두께가 실제로 양수임을 보장한다.
    expect(SPAWN_BORDER_PX).toBe(4);
    expect(bh).toBe(SPAWN_BORDER_PX);
    expect(by).toBeGreaterThan(0);           // 8랭크 칸(y=0) 내부, 맨 위가 아니라 아래쪽 가장자리
    expect(by + bh).toBe(SQ);                // 경계선 하단이 정확히 7랭크와 맞닿는 지점 — 7랭크를 침범하지 않음
  });

  it('적마다 체력바(배경+체력, fillRect 2회)가 그려지고 아군 기물에는 체력바가 없다', () => {
    const { ctx, records } = makeStubCtx();
    const state = createInitialState();
    const normal = makeEnemy({ id: 'n1', file: 2, y: 200 });
    const boss = makeEnemy({ id: 'b1', file: 5, y: 100, isBoss: true, hp: 300, maxHp: 300 });
    state.enemies.push(normal, boss);
    state.pieces.push(makePiece({ id: 'p1', type: 'knight', square: { file: 3, rank: 1 } }));

    expect(() => render(ctx as unknown as CanvasRenderingContext2D, state)).not.toThrow();

    const hpBars = records.filter(r => r.method === 'fillRect' && r.args[2] === 40 && r.args[3] === 4);
    // 적 1마리당 배경+체력 2개의 fillRect. 아군 기물(1개)은 여기 기여분이 없어야 한다.
    expect(hpBars).toHaveLength(state.enemies.length * 2);
  });

  it('적은 y 오름차순으로 그려진다 (1랭크/방어선에 가까운 적이 마지막에 그려짐)', () => {
    const { ctx, records } = makeStubCtx();
    const state = createInitialState();
    const near = makeEnemy({ id: 'near', file: 1, y: 500 }); // 방어선(1랭크)에 가까움
    const far = makeEnemy({ id: 'far', file: 1, y: 40 });    // 스폰(8랭크)에 가까움
    state.enemies.push(near, far); // 입력 순서를 뒤집어 정렬이 실제로 적용되는지 검증

    render(ctx as unknown as CanvasRenderingContext2D, state);

    const enemyGlyphDraws = records.filter(r => r.method === 'fillText' && r.args[0] === '♟');
    expect(enemyGlyphDraws).toHaveLength(2);
    const yOrder = enemyGlyphDraws.map(r => r.args[2]);
    expect(yOrder).toEqual([40, 500]); // far(y=40) 먼저 그려지고, near(y=500)가 마지막(맨 위)
  });

  it('jitterX는 그려지는 x 좌표만 이동시킨다 (동일 file, 다른 jitterX → 다른 x)', () => {
    const { ctx, records } = makeStubCtx();
    const state = createInitialState();
    const e1 = makeEnemy({ id: 'j1', file: 4, y: 150, jitterX: 0 });
    const e2 = makeEnemy({ id: 'j2', file: 4, y: 150, jitterX: 6 });
    state.enemies.push(e1, e2);

    render(ctx as unknown as CanvasRenderingContext2D, state);

    const enemyGlyphDraws = records.filter(r => r.method === 'fillText' && r.args[0] === '♟');
    expect(enemyGlyphDraws).toHaveLength(2);
    const xs = enemyGlyphDraws.map(r => r.args[1] as number);
    expect(new Set(xs).size).toBe(2);
    expect(Math.abs(xs[1] - xs[0])).toBeCloseTo(6);
  });

  describe('보스 비네트 (스펙 7.9)', () => {
    function vignetteDrawn(records: Call[], gradientStub: unknown): boolean {
      return records.some(
        r => r.method === 'fillRect' && r.args[2] === BOARD_W && r.args[3] === BOARD_H
          && r.fillStyle === gradientStub,
      );
    }

    it('보스가 3랭크(트리거 이전)에 있으면 비네트를 그리지 않는다', () => {
      const { ctx, records, gradientStub } = makeStubCtx();
      const state = createInitialState();
      state.enemies.push(makeEnemy({ id: 'boss', file: 0, y: rankToTopY(3), isBoss: true }));

      render(ctx as unknown as CanvasRenderingContext2D, state);

      expect(records.some(r => r.method === 'createRadialGradient')).toBe(false);
      expect(vignetteDrawn(records, gradientStub)).toBe(false);
    });

    it('보스가 2랭크 이하로 진입하면 비네트를 그린다', () => {
      const { ctx, records, gradientStub } = makeStubCtx();
      const state = createInitialState();
      state.enemies.push(makeEnemy({ id: 'boss', file: 0, y: rankToTopY(2), isBoss: true }));

      render(ctx as unknown as CanvasRenderingContext2D, state);

      expect(records.some(r => r.method === 'createRadialGradient')).toBe(true);
      expect(vignetteDrawn(records, gradientStub)).toBe(true);
    });

    it('보스가 아닌 적이 1랭크에 있어도 비네트를 그리지 않는다', () => {
      const { ctx, records, gradientStub } = makeStubCtx();
      const state = createInitialState();
      state.enemies.push(makeEnemy({ id: 'grunt', file: 0, y: rankToTopY(1), isBoss: false }));

      render(ctx as unknown as CanvasRenderingContext2D, state);

      expect(records.some(r => r.method === 'createRadialGradient')).toBe(false);
      expect(vignetteDrawn(records, gradientStub)).toBe(false);
    });
  });

  describe('createFrameView / EMPTY_VIEW 참조 격리 (Task 17 리뷰 수정)', () => {
    it('createFrameView()가 반환하는 highlights/lines/shake는 매번 새 인스턴스이며 EMPTY_VIEW와 참조를 공유하지 않는다', () => {
      const a = createFrameView();
      const b = createFrameView();
      expect(a.highlights).not.toBe(EMPTY_VIEW.highlights);
      expect(a.lines).not.toBe(EMPTY_VIEW.lines);
      expect(a.shake).not.toBe(EMPTY_VIEW.shake);
      // 두 번 호출한 결과끼리도 서로 다른 인스턴스여야 한다 (프레임마다 새로 만든다는 계약).
      expect(a.highlights).not.toBe(b.highlights);
      expect(a.lines).not.toBe(b.lines);
      expect(a.shake).not.toBe(b.shake);
    });

    it('createFrameView()의 lines에 push해도 EMPTY_VIEW.lines는 비어 있는 채로 남는다 (Task 18/19 회귀 방지)', () => {
      const view = createFrameView();
      view.lines.push({ from: { file: 0, rank: 1 }, to: { file: 0, rank: 2 }, color: '#fff' });
      expect(view.lines).toHaveLength(1);
      expect(EMPTY_VIEW.lines).toHaveLength(0);
    });

    it('EMPTY_VIEW와 그 내부 배열/객체는 freeze되어 있어 실수로 뮤테이션하면 즉시 실패한다', () => {
      expect(Object.isFrozen(EMPTY_VIEW)).toBe(true);
      expect(Object.isFrozen(EMPTY_VIEW.highlights)).toBe(true);
      expect(Object.isFrozen(EMPTY_VIEW.lines)).toBe(true);
      expect(Object.isFrozen(EMPTY_VIEW.shake)).toBe(true);
      // ES 모듈은 기본 strict mode이므로 frozen 배열에 push하면 TypeError.
      expect(() => EMPTY_VIEW.lines.push({ from: { file: 0, rank: 1 }, to: { file: 0, rank: 2 }, color: '#fff' })).toThrow(TypeError);
      expect(() => { EMPTY_VIEW.shake.x = 5; }).toThrow(TypeError);
    });

    it('freeze 이후에도 render(ctx, state) 기본 인자 경로(view 생략)는 정상 동작한다', () => {
      const { ctx } = makeStubCtx();
      const state = createInitialState();
      expect(() => render(ctx as unknown as CanvasRenderingContext2D, state)).not.toThrow();
    });
  });

  describe('ViewState → 픽셀 변환 (Item 2 — EMPTY_VIEW만으로는 검증되지 않던 실제 렌더 경로)', () => {
    // 기존 스위트는 전부 EMPTY_VIEW(기본 인자)로만 render()를 호출해, 하이라이트 fillRect·라인
    // moveTo/lineTo·화면 흔들림 translate 세 경로가 한 번도 실행되지 않았다. buildHighlights()의
    // *출력*은 highlights.test.ts가 잘 검증하지만, 그 출력이 실제로 어떤 픽셀 좌표에 그려지는지는
    // 이 파일이 처음 검증한다 — 기대값은 하드코딩된 픽셀이 아니라 grid.ts/CONFIG에서 직접
    // 유도해, 보드 반전이나 랭크 off-by-one 같은 회귀를 실제로 잡아낼 수 있게 한다.
    it('하이라이트 fillRect는 file*squarePx와 rankToTopY(rank)로 그려진다', () => {
      const { ctx, records } = makeStubCtx();
      const state = createInitialState();
      // file=5, rank=3은 일부러 피한다: file+rank === CONFIG.board.ranks(8)인 칸은
      // file*SQ === rankToTopY(rank)가 우연히 성립해(둘 다 같은 값), fillRect(x, y, …)의 x/y가
      // 뒤바뀌어도(transpose 버그) 이 단언을 그대로 통과시킨다 — 즉 그런 회귀를 절대 못 잡는
      // 좌표였다 (회귀 4). file+rank !== 8인 칸을 골라 x/y가 서로 다른 값이 되게 한다.
      const square = { file: 5, rank: 2 };
      expect(square.file * SQ).not.toBe(rankToTopY(square.rank));   // 전제 확인: x/y가 실제로 다르다
      const color = 'rgba(11, 22, 33, 0.5)';
      const view = createFrameView();
      view.highlights.push({ square, color });

      render(ctx as unknown as CanvasRenderingContext2D, state, view);

      const hit = records.find(r => r.method === 'fillRect' && r.fillStyle === color);
      expect(hit).toBeDefined();
      expect(hit!.args).toEqual([square.file * SQ, rankToTopY(square.rank), SQ, SQ]);
    });

    it('라인 moveTo/lineTo는 fileCenterX(file)와 rankToTopY(rank)+squarePx/2로 그려진다', () => {
      const { ctx, records } = makeStubCtx();
      const state = createInitialState();
      const from = { file: 1, rank: 2 };
      const to = { file: 6, rank: 7 };
      const color = '#abcdef';
      const view = createFrameView();
      view.lines.push({ from, to, color });

      render(ctx as unknown as CanvasRenderingContext2D, state, view);

      const moveTo = records.find(r => r.method === 'moveTo' && r.strokeStyle === color);
      const lineTo = records.find(r => r.method === 'lineTo' && r.strokeStyle === color);
      expect(moveTo).toBeDefined();
      expect(lineTo).toBeDefined();
      expect(moveTo!.args).toEqual([fileCenterX(from.file), rankToTopY(from.rank) + SQ / 2]);
      expect(lineTo!.args).toEqual([fileCenterX(to.file), rankToTopY(to.rank) + SQ / 2]);
    });

    it('shake가 {0,0}이 아니면 그 값 그대로 translate가 호출된다', () => {
      const { ctx, records } = makeStubCtx();
      const state = createInitialState();
      const view = createFrameView();
      view.shake = { x: 4.5, y: -2.25 };

      render(ctx as unknown as CanvasRenderingContext2D, state, view);

      const translate = records.find(r => r.method === 'translate');
      expect(translate).toBeDefined();
      expect(translate!.args).toEqual([4.5, -2.25]);
    });
  });

  describe('퀸 버프 뱃지 (스펙 7.7)', () => {
    it('queenBuffCount에 따라 ×N 텍스트가 그려지고, 0이면 뱃지가 없다', () => {
      const { ctx, records } = makeStubCtx();
      const state = createInitialState();
      state.pieces.push(makePiece({ id: 'q0', type: 'queen', square: { file: 0, rank: 1 }, queenBuffCount: 0 }));
      state.pieces.push(makePiece({ id: 'q1', type: 'queen', square: { file: 1, rank: 1 }, queenBuffCount: 1 }));
      state.pieces.push(makePiece({ id: 'q2', type: 'queen', square: { file: 2, rank: 1 }, queenBuffCount: 2 }));

      render(ctx as unknown as CanvasRenderingContext2D, state);

      const badgeTexts = records
        .filter(r => r.method === 'fillText' && typeof r.args[0] === 'string' && (r.args[0] as string).startsWith('×'))
        .map(r => r.args[0]);
      expect(badgeTexts).toEqual(['×2', '×3']); // buffCount 0 → 뱃지 없음, 1 → ×2, 2 → ×3
    });
  });
});
