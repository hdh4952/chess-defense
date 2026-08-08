// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { updateTooltip } from '../src/ui/tooltip';
import { pieceDamage } from '../src/core/combat';
import { sellPrice } from '../src/core/economy';
import { PIECE_NAME } from '../src/ui/layout';
import type { Interaction } from '../src/ui/drag';
import { boardPiece, waveState } from './helpers';

// updateTooltip은 DOM 요소를 직접 조작하므로 happy-dom 환경에서만 테스트할 수 있다 (컨트롤러
// 결정, 브리프 Step 4의 수동 검증 5번 항목을 자동화한다).

function noInteraction(overrides: Partial<Interaction> = {}): Interaction {
  return { dragging: null, selectedPieceId: null, hoverSquare: null, ...overrides };
}

function makeEl(): HTMLElement {
  return document.createElement('div');
}

describe('updateTooltip (스펙 7.7 — 기물 hover 툴팁)', () => {
  it('hover 중인 기물이 없으면 숨긴다', () => {
    const el = makeEl();
    const state = waveState();
    updateTooltip(el, state, noInteraction(), { x: 10, y: 10 });
    expect(el.hidden).toBe(true);
  });

  it('hoverSquare는 있지만 그 칸에 기물이 없으면 숨긴다', () => {
    const el = makeEl();
    const state = waveState();
    updateTooltip(el, state, noInteraction({ hoverSquare: { file: 2, rank: 2 } }), { x: 10, y: 10 });
    expect(el.hidden).toBe(true);
  });

  it('mouse 좌표가 없으면 hover 대상이 있어도 숨긴다', () => {
    const el = makeEl();
    const state = waveState();
    state.pieces.push(boardPiece('rook', 2, 2));
    updateTooltip(el, state, noInteraction({ hoverSquare: { file: 2, rank: 2 } }), null);
    expect(el.hidden).toBe(true);
  });

  it('드래그 중에는 hoverSquare가 있어도 툴팁을 띄우지 않는다 (드래그 제스처와 충돌 방지)', () => {
    const el = makeEl();
    const state = waveState();
    const p = boardPiece('rook', 2, 2);
    state.pieces.push(p);
    const dragging: Interaction = {
      dragging: { pieceId: p.id, from: 'board' }, selectedPieceId: null, hoverSquare: { file: 2, rank: 2 },
    };
    updateTooltip(el, state, dragging, { x: 10, y: 10 });
    expect(el.hidden).toBe(true);
  });

  it('버프된 기물: 기본 공격력·배율·최종 공격력이 pieceDamage()와 일치하고 남은 쿨다운·판매가가 표시된다', () => {
    const el = makeEl();
    const state = waveState();
    const p = boardPiece('rook', 4, 4);
    p.queenBuffCount = 2;
    p.cooldown = 2.4;
    state.pieces.push(p);

    updateTooltip(el, state, noInteraction({ hoverSquare: { file: 4, rank: 4 } }), { x: 100, y: 200 });

    expect(el.hidden).toBe(false);
    expect(pieceDamage(p)).toBe(15);   // 기본 5 × (1+2) = 15 — 회귀 시 아래 assert들이 이 값을 따라간다
    expect(el.innerHTML).toContain(PIECE_NAME.rook);
    expect(el.innerHTML).toContain('기본 공격력 5');
    expect(el.innerHTML).toContain('배율 ×3');
    expect(el.innerHTML).toContain(`최종 ${pieceDamage(p)}`);
    expect(el.innerHTML).toContain('남은 쿨다운 2.4s');
    expect(el.innerHTML).toContain(`판매가 ${sellPrice('rook')}G`);
    expect(el.style.left).toBe('114px');   // mouse.x + 14
    expect(el.style.top).toBe('214px');    // mouse.y + 14
  });

  it('버프 없는 기물은 배율 ×1, 최종 공격력 = 기본 공격력', () => {
    const el = makeEl();
    const state = waveState();
    const p = boardPiece('pawn', 1, 1);
    state.pieces.push(p);
    updateTooltip(el, state, noInteraction({ hoverSquare: { file: 1, rank: 1 } }), { x: 0, y: 0 });

    expect(el.innerHTML).toContain('배율 ×1');
    expect(el.innerHTML).toContain(`최종 ${pieceDamage(p)}`);
    expect(pieceDamage(p)).toBe(2);
  });

  it('나이트는 공격 주기 대신 이동 쿨다운으로 표시된다', () => {
    const el = makeEl();
    const state = waveState();
    const p = boardPiece('knight', 1, 1);
    p.cooldown = 1.5;
    state.pieces.push(p);
    updateTooltip(el, state, noInteraction({ hoverSquare: { file: 1, rank: 1 } }), { x: 0, y: 0 });

    expect(el.innerHTML).toContain('이동 쿨다운');
    expect(el.innerHTML).toContain('남은 쿨다운 1.5s');
    expect(el.innerHTML).not.toContain('공격 주기');
  });

  it('퀸은 공격력을 0인 수치처럼 표기하지 않고 버퍼임을 명시한다', () => {
    const el = makeEl();
    const state = waveState();
    const p = boardPiece('queen', 3, 3);
    state.pieces.push(p);
    updateTooltip(el, state, noInteraction({ hoverSquare: { file: 3, rank: 3 } }), { x: 0, y: 0 });

    expect(el.hidden).toBe(false);
    expect(el.innerHTML).toContain(PIECE_NAME.queen);
    expect(el.innerHTML).not.toContain('기본 공격력 0');
    expect(el.innerHTML).not.toContain('최종 0');
    expect(el.innerHTML).not.toContain('최종');   // "최종 공격력" 수치 자체를 아예 표기하지 않는다
    expect(el.innerHTML).toContain('버퍼');
    expect(el.innerHTML).toContain(`판매가 ${sellPrice('queen')}G`);
  });

  it('퀸 버프 설명은 겹치는 퀸마다 배율이 누적된다는 것을 알려준다 (리뷰 Finding 3 — 고정 ×2 표기는 오해 소지)', () => {
    const el = makeEl();
    const state = waveState();
    const p = boardPiece('queen', 3, 3);
    state.pieces.push(p);
    updateTooltip(el, state, noInteraction({ hoverSquare: { file: 3, rank: 3 } }), { x: 0, y: 0 });

    // "×2"로 고정 표기하면 두 번째·세 번째 퀸이 겹쳤을 때도 배율이 그대로라고 오해할 수 있다.
    // recalcQueenBuffs는 겹치는 퀸 1기당 queenBuffCount를 1씩 늘리므로(퀸 2기 = ×3, 3기 = ×4),
    // 문구는 고정 배율이 아니라 "퀸 1기당 증가분"으로 표현해야 한다.
    expect(el.innerHTML).not.toContain('×2');
    expect(el.innerHTML).toContain('버프 효과');
    expect(el.innerHTML).toContain('퀸마다');
  });
});
