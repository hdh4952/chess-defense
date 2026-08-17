// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { CONFIG, slowPercent, tierMultiplier } from '../src/config';
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

  it('강화 단계는 티어 숫자가 아니라 실제 배수로 표시된다 (T3 = ×4)', () => {
    // 티어는 레벨(1~6)이고 배수는 2^(tier-1)이라 두 값이 다르다 — "강화 ×3"처럼 티어를 그대로
    // 적으면 최종 공격력과 곱셈이 맞아떨어지지 않아 툴팁이 거짓말을 한다.
    const el = makeEl();
    const state = waveState();
    const p = boardPiece('rook', 1, 1, 3);
    state.pieces.push(p);
    updateTooltip(el, state, noInteraction({ hoverSquare: { file: 1, rank: 1 } }), { x: 0, y: 0 });

    expect(el.innerHTML).toContain(`강화 ×${tierMultiplier(3)}`);
    expect(el.innerHTML).toContain(`최종 ${pieceDamage(p)}`);
    expect(el.innerHTML).toContain('T3');                       // 이름 옆 단계 표기
    expect(pieceDamage(p)).toBe(CONFIG.pieces.rook.damage * 4);
  });

  it('T1 기물에는 강화 항과 단계 표기가 아예 없다 (정보가 없는 항)', () => {
    const el = makeEl();
    const state = waveState();
    state.pieces.push(boardPiece('rook', 1, 1));
    updateTooltip(el, state, noInteraction({ hoverSquare: { file: 1, rank: 1 } }), { x: 0, y: 0 });
    expect(el.innerHTML).not.toContain('강화');
    expect(el.innerHTML).not.toContain('T1');
  });

  it('★ 나이트는 감속 능력을 표시하고, 공격 주기·남은 쿨다운 줄은 없다', () => {
    // 나이트는 v1.10부터 **공격 수단이 없다.** 이 줄이 없으면 툴팁 어디에도 "이 기물이 무엇을
    // 하는가"가 나오지 않는다 — 공격력 줄도 골드 줄도 없기 때문이다.
    //
    // p.cooldown을 인위적으로 1.5로 강제하는 것은 예전 테스트에서 물려받았다: 억제 판정이
    // p.cooldown이 아니라 **기물의 성질**(pattern === 'none')로 결정된다는 것을 증명한다.
    // 실제로는 주기 공격이 없는 기물의 cooldown이 0에서 움직이지 않는다.
    const el = makeEl();
    const state = waveState();
    const p = boardPiece('knight', 1, 1);
    p.cooldown = 1.5;
    state.pieces.push(p);
    updateTooltip(el, state, noInteraction({ hoverSquare: { file: 1, rank: 1 } }), { x: 0, y: 0 });

    expect(el.innerHTML).toContain(`−${slowPercent()}%`);
    expect(el.innerHTML).toContain('L자 8칸');
    expect(el.innerHTML).toContain('8랭크 포함');
    // ⚠️ 폭발과 이동 쿨다운은 능력과 함께 사라졌다. 문구가 남으면 없는 규칙을 설명하게 된다.
    expect(el.innerHTML).not.toContain('폭발');
    expect(el.innerHTML).not.toContain('이동 쿨다운');
    expect(el.innerHTML).not.toContain('공격 주기');
    expect(el.innerHTML).not.toContain('남은 쿨다운');
  });

  it('★ 중첩·강화가 소용없다는 것을 툴팁이 직접 말한다', () => {
    // 이 줄이 없으면 플레이어는 나이트를 겹쳐 놓거나 합성해서 더 느리게 만들려고 한다. 둘 다
    // 효과가 없고 합성은 오히려 덮는 칸이 줄어 손해라, 규칙을 말해 주는 편이 낫다.
    // 게임 안에서 이 사실을 알 수 있는 유일한 자리다.
    const el = makeEl();
    const state = waveState();
    state.pieces.push(boardPiece('knight', 1, 1));
    updateTooltip(el, state, noInteraction({ hoverSquare: { file: 1, rank: 1 } }), { x: 0, y: 0 });
    expect(el.innerHTML).toContain('중첩');
  });

  it('★ 감속 문구의 수치는 CONFIG에서 유도된다 — 리터럴 30이 아니다', () => {
    // multiplier를 바꾸면 툴팁·시작 화면·"−30%" 라벨 셋이 함께 따라와야 한다. 리터럴을 박으면
    // 그 어긋남은 테스트가 아니라 플레이어가 발견한다.
    const el = makeEl();
    const state = waveState();
    state.pieces.push(boardPiece('knight', 1, 1));
    updateTooltip(el, state, noInteraction({ hoverSquare: { file: 1, rank: 1 } }), { x: 0, y: 0 });
    expect(slowPercent()).toBe(Math.round((1 - CONFIG.slowAura.multiplier) * 100));
    expect(el.innerHTML).toContain(`−${slowPercent()}%`);
  });

  it('★ 융합물은 공격 주기와 감속을 둘 다 보여준다 — 겸업이 툴팁에서 읽힌다', () => {
    // 아치비숍의 가치 명제가 "비숍처럼 벌면서 늦춘다"인데, 한쪽 줄이 빠지면 그 명제가
    // 화면에서 사라진다. 가산 구조(배타 분기가 아님)가 유지되는지 확인하는 자리이기도 하다.
    const el = makeEl();
    const state = waveState();
    state.pieces.push(boardPiece('archbishop', 1, 1));
    updateTooltip(el, state, noInteraction({ hoverSquare: { file: 1, rank: 1 } }), { x: 0, y: 0 });
    expect(el.innerHTML).toContain('공격 주기');
    expect(el.innerHTML).toContain(`−${slowPercent()}%`);
    expect(el.innerHTML).toContain('공격당 +');        // 비숍에서 온 골드 수입
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

  it('퀸 버프 설명은 자기 강화 단계에서 유도된 실제 버프량과 누적 규칙을 함께 알려준다', () => {
    // "×2"나 "+100%"로 고정 표기하면 두 가지를 동시에 오해하게 된다: 겹치는 퀸이 늘어도 배율이
    // 그대로라는 오해(recalcQueenBuffs는 퀸 1기당 tierMultiplier만큼 늘린다)와, 합성한 퀸도
    // 같은 양을 준다는 오해다. 두 값 모두 문구가 코드에서 유도해야 한다.
    const state = waveState();
    const t1 = boardPiece('queen', 3, 3);
    const t3 = boardPiece('queen', 5, 5, 3);
    state.pieces.push(t1, t3);

    const el1 = makeEl();
    updateTooltip(el1, state, noInteraction({ hoverSquare: { file: 3, rank: 3 } }), { x: 0, y: 0 });
    expect(el1.innerHTML).toContain('버프 효과: +100%');
    expect(el1.innerHTML).toContain('겹치면');

    const el3 = makeEl();
    updateTooltip(el3, state, noInteraction({ hoverSquare: { file: 5, rank: 5 } }), { x: 0, y: 0 });
    expect(el3.innerHTML).toContain(`버프 효과: +${tierMultiplier(3) * 100}%`);   // T3 = +400%
    expect(el3.innerHTML).not.toContain('+100%');
  });
});
