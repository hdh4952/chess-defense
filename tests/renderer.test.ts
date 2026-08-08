import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { BOARD_H, BOARD_W, rankToTopY } from '../src/core/grid';
import { createInitialState } from '../src/core/state';
import { createFrameView, EMPTY_VIEW, render } from '../src/render/renderer';
import type { Enemy, Piece } from '../src/types';
import { makeStubCtx, type Call } from './canvasStub';

const SQ = CONFIG.board.squarePx;

function makeEnemy(overrides: Partial<Enemy>): Enemy {
  return {
    id: 'e', file: 0, y: 0, hp: 10, maxHp: 10, isBoss: false, speed: 26.6, jitterX: 0,
    ...overrides,
  };
}

function makePiece(overrides: Partial<Piece>): Piece {
  return {
    id: 'p', type: 'rook', square: { file: 0, rank: 1 }, slotIndex: null, cooldown: 0, queenBuffCount: 0,
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

  it('8랭크(최상단, y=0)의 스폰 구역에만 옅은 붉은 톤 오버레이가 덮인다', () => {
    const { ctx, records } = makeStubCtx();
    render(ctx as unknown as CanvasRenderingContext2D, createInitialState());
    expect(rankToTopY(8)).toBe(0); // 8랭크가 최상단 행
    const tint = records.filter(
      r => r.method === 'fillRect' && r.args[0] === 0 && r.args[1] === 0
        && r.args[2] === BOARD_W && r.args[3] === SQ,
    );
    expect(tint).toHaveLength(1);
    expect(tint[0].fillStyle).toBe('rgba(200, 60, 50, 0.10)');
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
