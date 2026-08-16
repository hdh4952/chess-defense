// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { updateTooltip } from '../src/ui/tooltip';
import { pieceDamage } from '../src/core/combat';
import { sellPrice } from '../src/core/economy';
import { PIECE_NAME } from '../src/ui/layout';
import type { Interaction } from '../src/types';
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

  it('골드를 버는 기물만 "공격당 +NG" 줄을 갖는다 (비숍 O, 룩 X)', () => {
    const state = waveState();
    const bishop = boardPiece('bishop', 1, 1);
    const rook = boardPiece('rook', 2, 2);
    state.pieces.push(bishop, rook);

    const bishopEl = makeEl();
    updateTooltip(bishopEl, state, noInteraction({ hoverSquare: { file: 1, rank: 1 } }), { x: 0, y: 0 });
    expect(bishopEl.innerHTML).toContain(`공격당 +${CONFIG.pieces.bishop.goldPerAttack}G`);
    // 골드에는 퀸 버프가 붙지 않는다는 사실을 툴팁에서도 명시한다 — 바로 윗줄에 공격력 배율이
    // 함께 떠 있어서 "배율이 골드에도 걸린다"고 읽힐 여지를 없앤다.
    expect(bishopEl.innerHTML).toContain('버프 미적용');

    const rookEl = makeEl();
    updateTooltip(rookEl, state, noInteraction({ hoverSquare: { file: 2, rank: 2 } }), { x: 0, y: 0 });
    expect(rookEl.innerHTML).not.toContain('공격당');
  });

  it('나이트는 공격 주기 대신 이동 쿨다운으로 표시되고, interval 0에서는 "남은 쿨다운" 줄이 억제된다', () => {
    const el = makeEl();
    const state = waveState();
    const p = boardPiece('knight', 1, 1);
    // 실제 게임플레이에서는 interval 0인 나이트가 양수 cooldown을 가질 수 없다(재무장이 항상
    // 즉시 0으로 돌아가므로) — 여기서는 억제 여부가 p.cooldown이 아니라 def.interval(config)로
    // 결정된다는 것 자체를 증명하려고 인위적으로 1.5를 강제한다(리뷰 Minor 3).
    p.cooldown = 1.5;
    state.pieces.push(p);
    updateTooltip(el, state, noInteraction({ hoverSquare: { file: 1, rank: 1 } }), { x: 0, y: 0 });

    expect(el.innerHTML).toContain('이동 쿨다운');
    expect(el.innerHTML).not.toContain('공격 주기');
    // "이동 쿨다운 없음" 바로 아래 "남은 쿨다운 0.0s"를 또 보여주면 중복이다 — interval이 0이면
    // p.cooldown 값과 무관하게 "남은 쿨다운" 줄 자체를 그리지 않는다.
    expect(el.innerHTML).not.toContain('남은 쿨다운');
  });

  it('나이트 이동 쿨다운 수치는 "없음"으로 표시된다 (게임 규칙 변경 — interval 0, 사용자 승인)', () => {
    // 이전: CONFIG.pieces.knight.interval이 3.0이라 "이동 쿨다운 3s"처럼 실제 값을 그대로 보여줬다.
    // 이제 interval이 0이므로, def.interval을 그대로 보간해 "이동 쿨다운 0s"라고 표시하면 마치
    // "0초만 기다리면 된다"는 거짓 정보가 된다 — updateTooltip은 이 경우 "없음"으로 대체해야 한다.
    // 이 문구는 def.interval 값으로 분기하므로(하드코딩이 아니므로), CONFIG를 되돌리면 문구도
    // 자동으로 원래대로 돌아온다.
    const el = makeEl();
    const state = waveState();
    const p = boardPiece('knight', 1, 1);
    state.pieces.push(p);
    updateTooltip(el, state, noInteraction({ hoverSquare: { file: 1, rank: 1 } }), { x: 0, y: 0 });

    expect(el.innerHTML).toContain('이동 쿨다운 없음');
    expect(el.innerHTML).not.toContain('이동 쿨다운 0s');
    expect(el.innerHTML).not.toContain('남은 쿨다운');   // 위와 같은 이유로 중복 줄이 없다 (리뷰 Minor 3)
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
