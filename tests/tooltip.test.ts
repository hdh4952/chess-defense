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
      dragging: { pieceId: p.id }, selectedPieceId: null, hoverSquare: { file: 2, rank: 2 },
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

    expect(el.innerHTML).toContain(`−${slowPercent(p.tier)}%`);
    expect(el.innerHTML).toContain('L자 8칸');
    expect(el.innerHTML).toContain('8랭크 포함');
    // ⚠️ 폭발과 이동 쿨다운은 능력과 함께 사라졌다. 문구가 남으면 없는 규칙을 설명하게 된다.
    expect(el.innerHTML).not.toContain('폭발');
    expect(el.innerHTML).not.toContain('이동 쿨다운');
    expect(el.innerHTML).not.toContain('공격 주기');
    expect(el.innerHTML).not.toContain('남은 쿨다운');
  });

  it('★ 강화는 듣고 중첩은 안 듣는다 — 툴팁이 두 규칙을 나란히 말한다', () => {
    // v1.10~v1.12에서는 이 자리가 "중첩도 강화도 소용없다"였다. v1.13에서 **강화 쪽만**
    // 뒤집혔고(단계마다 +5%p) 중첩 금지는 그대로다(사용자 결정). 남은 절반과 뒤집힌 절반이
    // 한 줄 차이라 플레이어가 가장 헷갈리는 지점이므로, 툴팁도 이 테스트도 둘을 **함께**
    // 보여준다 — 한쪽만 단언하면 나머지 절반이 조용히 반대로 바뀌어도 초록이다.
    const el = makeEl();
    const state = waveState();
    const p = boardPiece('knight', 1, 1);
    state.pieces.push(p);
    updateTooltip(el, state, noInteraction({ hoverSquare: { file: 1, rank: 1 } }), { x: 0, y: 0 });

    // ① 강화는 듣는다. 다음 단계 수치까지 보여주지 않으면 합성 여부를 판단할 근거가 없다.
    expect(el.innerHTML).toContain(`합성하면 −${slowPercent(p.tier + 1)}%`);
    expect(slowPercent(p.tier + 1)).toBeGreaterThan(slowPercent(p.tier));
    // ② 중첩은 안 듣는다(가장 높은 티어 하나만 적용된다). 이 줄이 없으면 플레이어는 나이트를
    //    겹쳐 놓아 더 느리게 만들려고 한다 — 게임 안에서 이 사실을 알 수 있는 유일한 자리다.
    expect(el.innerHTML).toContain('중첩되지 않는다');
  });

  it('★ T1 나이트와 T3 나이트는 서로 다른 수치를 보여준다 — 자기 티어에서 유도한다', () => {
    // 모든 나이트에 같은 문구를 찍던 것이 v1.12까지는 옳았지만 지금은 T3 앞에서 그 자리에서
    // 거짓말이 된다(실제 −40%인데 −30%라고 적힘). 두 기물을 같은 보드에 놓고 각각 hover해
    // **문구가 갈라지는지**를 본다.
    const state = waveState();
    state.pieces.push(boardPiece('knight', 1, 1), boardPiece('knight', 5, 5, 3));

    const t1 = makeEl();
    updateTooltip(t1, state, noInteraction({ hoverSquare: { file: 1, rank: 1 } }), { x: 0, y: 0 });
    const t3 = makeEl();
    updateTooltip(t3, state, noInteraction({ hoverSquare: { file: 5, rank: 5 } }), { x: 0, y: 0 });

    expect(t1.innerHTML).toContain(`−${slowPercent(1)}%`);
    expect(t3.innerHTML).toContain(`−${slowPercent(3)}%`);
    // 교차로도 확인한다 — "둘 다 −30%"로 되돌아가는 회귀는 위 두 줄만으로 잡히지 않는다.
    // 각 툴팁에는 다음 단계 수치(−35% / −45%)도 함께 떠 있어서 문자열이 겹칠 여지가 있는데,
    // 서로의 값만은 절대 나타나지 않는다는 것이 "자기 티어에서 유도한다"의 관측 가능한 형태다.
    expect(t1.innerHTML).not.toContain(`−${slowPercent(3)}%`);
    expect(t3.innerHTML).not.toContain(`−${slowPercent(1)}%`);
    expect(t1.innerHTML).toContain(`합성하면 −${slowPercent(2)}%`);
    expect(t3.innerHTML).toContain(`합성하면 −${slowPercent(4)}%`);
    // ★ 수치는 갈라져도 중첩 금지는 티어와 무관하게 둘 다 말한다 — 강화되는 축과 그대로인
    //   축이 한 툴팁 안에 같이 있다는 것이 이 규칙 쌍의 전부다.
    expect(t1.innerHTML).toContain('중첩되지 않는다');
    expect(t3.innerHTML).toContain('중첩되지 않는다');
  });

  it('★ 최대 단계에서는 "합성하면" 대신 "최대 단계"라고 말한다 — 중첩 금지는 남는다', () => {
    // 상한에서 다음 단계를 안내하면 존재하지 않는 강화를 파는 셈이 된다. 그리고 더 강화할 수
    // 없게 된 플레이어가 가장 먼저 시도하는 것이 겹쳐 놓기라, 중첩 금지는 여기서 오히려 더
    // 필요하다 — 상한 분기에서 그 문구를 함께 떨어뜨리는 실수를 이 줄이 잡는다.
    const maxTier = CONFIG.merge.maxTier.knight;
    const el = makeEl();
    const state = waveState();
    state.pieces.push(boardPiece('knight', 1, 1, maxTier));
    updateTooltip(el, state, noInteraction({ hoverSquare: { file: 1, rank: 1 } }), { x: 0, y: 0 });

    expect(el.innerHTML).toContain('최대 단계');
    expect(el.innerHTML).not.toContain('합성하면');
    expect(el.innerHTML).toContain(`−${slowPercent(maxTier)}%`);
    expect(el.innerHTML).not.toContain(`−${slowPercent(maxTier + 1)}%`);   // 없는 단계(−60%)
    expect(el.innerHTML).toContain('중첩되지 않는다');
  });

  it('★ 감속 수치는 CONFIG에서 유도되고, 사용자가 정한 표는 여기서 한 번 못박는다', () => {
    // 계수를 바꾸면 툴팁·시작 화면·"−30%" 라벨 셋이 함께 따라와야 한다. 리터럴을 박으면 그
    // 어긋남은 테스트가 아니라 플레이어가 발견한다 — 그래서 다른 단언은 전부 유도한다.
    // 다만 **전부** 유도하면 basePercent를 잘못 고쳐도 단언이 같이 움직여 아무것도 지키지
    // 못하므로, 사용자가 정한 표(T1 30% · 단계마다 +5%p · 상한 55%)를 이 한 자리에서만 박는다.
    expect(CONFIG.merge.maxTier.knight).toBe(6);                        // 아래 표가 전 구간을 덮는다
    expect([1, 2, 3, 4, 5, 6].map(t => slowPercent(t))).toEqual([30, 35, 40, 45, 50, 55]);
    expect(slowPercent(1)).toBe(CONFIG.slowAura.basePercent);
    expect(slowPercent(2) - slowPercent(1)).toBe(CONFIG.slowAura.perTierPercent);

    // 그리고 그 숫자가 실제로 화면에 나온다 — 표를 못박아 봐야 툴팁이 다른 값을 그리면 소용없다.
    const el = makeEl();
    const state = waveState();
    state.pieces.push(boardPiece('knight', 1, 1));
    updateTooltip(el, state, noInteraction({ hoverSquare: { file: 1, rank: 1 } }), { x: 0, y: 0 });
    expect(el.innerHTML).toContain('−30%');                             // 못박은 T1 값 그대로
    expect(el.innerHTML).toContain(`−${slowPercent(1)}%`);
  });

  it('★ 융합물은 공격 주기와 감속을 둘 다 보여준다 — 겸업이 툴팁에서 읽힌다', () => {
    // 아치비숍의 가치 명제가 "비숍처럼 벌면서 늦춘다"인데, 한쪽 줄이 빠지면 그 명제가
    // 화면에서 사라진다. 가산 구조(배타 분기가 아님)가 유지되는지 확인하는 자리이기도 하다.
    const el = makeEl();
    const state = waveState();
    const p = boardPiece('archbishop', 1, 1);
    state.pieces.push(p);
    updateTooltip(el, state, noInteraction({ hoverSquare: { file: 1, rank: 1 } }), { x: 0, y: 0 });
    expect(el.innerHTML).toContain('공격 주기');
    // 감속량은 나이트에서 물려받은 능력이지만 수치는 **이 기물 자신의 티어**를 탄다(v1.13).
    expect(el.innerHTML).toContain(`−${slowPercent(p.tier)}%`);
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
