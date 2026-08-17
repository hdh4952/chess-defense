import { describe, expect, it } from 'vitest';
import { buildHighlights, HIGHLIGHT_COLORS } from '../src/render/highlights';
import { bishopTargets, knightMoves, pawnTargets, queenLines, rookTargets, slowSquares } from '../src/core/patterns';
import { isKnightMove } from '../src/core/pieces';
import { sameSquare } from '../src/core/grid';
import { CONFIG } from '../src/config';
import type { Interaction, Piece, PieceType, Square } from '../src/types';
import { boardPiece, waveState } from './helpers';

// buildHighlights는 순수 함수 — DOM 없이 (state, interaction)만으로 테스트할 수 있다 (컨트롤러 결정,
// 브리프 Step 4의 수동 검증을 대체). 기대값은 가능한 한 patterns.ts에서 직접 파생시켜, 미리보기가
// 실제 공격/버프/감속 계산과 어긋날 수 없게 한다.
//
// ⚠️ v1.10에서 knightBlastTargets(3×3)가 사라졌다. 나이트 계열의 능력이 배치·이동 직후 터지는
// 폭발에서 서 있는 동안 계속 걸리는 감속 오라로 바뀌었기 때문이다(사용자 결정). 미리보기 쪽
// 기대값의 출처도 그에 맞춰 slowSquares(L자 8칸)로 옮겨졌다.

function slotPiece(id: string, type: PieceType, slotIndex: number): Piece {
  return { id, type, square: null, slotIndex, cooldown: 0, queenBuffCount: 0, tier: 1 };
}

function noInteraction(overrides: Partial<Interaction> = {}): Interaction {
  return { dragging: null, selectedPieceId: null, hoverSquare: null, ...overrides };
}

function highlightSquares(hl: ReturnType<typeof buildHighlights>): Square[] {
  return hl.highlights.map(h => h.square);
}

/** 배열의 마지막 원소 — tsconfig의 lib 타깃이 Array.prototype.at을 포함하지 않아 인덱싱으로 대체 */
function last<T>(arr: T[]): T {
  return arr[arr.length - 1];
}

describe('buildHighlights (스펙 7.7 사거리 미리보기) — 활성 기물 없음', () => {
  it('드래그도 선택도 없으면 하이라이트/라인이 모두 비어 있다', () => {
    const s = waveState();
    s.pieces.push(boardPiece('rook', 3, 3));   // 보드에 기물이 있어도 상호작용이 없으면 무관
    expect(buildHighlights(s, noInteraction())).toEqual({ highlights: [], lines: [], mergePreview: null });
  });

  it('hoverSquare만 있고 드래그/선택 대상이 없으면 여전히 비어 있다', () => {
    const s = waveState();
    expect(buildHighlights(s, noInteraction({ hoverSquare: { file: 3, rank: 3 } })))
      .toEqual({ highlights: [], lines: [], mergePreview: null });
  });
});

describe('buildHighlights — 폰/비숍/룩 (hover 칸 기준 attackTargets)', () => {
  it('드래그 중인 폰: hover 칸의 전방 대각선 2칸이 사거리 색으로 표시된다', () => {
    const s = waveState();
    const p = slotPiece('pw', 'pawn', 0);
    s.pieces.push(p);
    const anchor = { file: 3, rank: 4 };   // d4
    const hl = buildHighlights(s, noInteraction({ dragging: { pieceId: p.id, from: 'slot' }, hoverSquare: anchor }));

    const expectedTargets = pawnTargets(anchor);
    expect(expectedTargets).toHaveLength(2);
    const squares = highlightSquares(hl);
    // 기준 칸(origin) + 두 대각선(range) = 3개
    expect(squares).toHaveLength(3);
    for (const t of expectedTargets) expect(squares).toContainEqual(t);
    expect(hl.lines).toEqual([]);
  });

  it('a파일 가장자리에서는 대각선이 1칸만 나온다 (스펙 5.2 경계 처리)', () => {
    const s = waveState();
    const p = slotPiece('pw2', 'pawn', 0);
    s.pieces.push(p);
    const anchor = { file: 0, rank: 4 };   // a4
    const hl = buildHighlights(s, noInteraction({ dragging: { pieceId: p.id, from: 'slot' }, hoverSquare: anchor }));

    const expectedTargets = pawnTargets(anchor);
    expect(expectedTargets).toHaveLength(1);
    const squares = highlightSquares(hl);
    expect(squares).toHaveLength(2);   // origin + 대각선 1칸
    expect(squares).toContainEqual(expectedTargets[0]);
  });

  it('드래그 중인 비숍: hover 칸 기준 4방향 대각선 전체(관통)가 표시된다', () => {
    const s = waveState();
    const p = slotPiece('bp', 'bishop', 0);
    s.pieces.push(p);
    const anchor = { file: 3, rank: 4 };   // d4
    const hl = buildHighlights(s, noInteraction({ dragging: { pieceId: p.id, from: 'slot' }, hoverSquare: anchor }));

    const expected = bishopTargets(anchor);   // 자신 칸 포함 14칸
    expect(expected).toHaveLength(14);
    const squares = highlightSquares(hl);
    // range 하이라이트가 attackTargets 전체를 포함한다. attackTargets가 이미 자신 칸을 포함하므로
    // origin을 별도로 중복 push하지 않는다 (리뷰 Finding 2) — 총 개수는 attackTargets와 정확히 같다.
    expect(squares).toHaveLength(expected.length);
    for (const t of expected) expect(squares).toContainEqual(t);
    expect(hl.lines).toEqual([]);
  });

  it('보드 위 룩을 클릭 선택: hover 칸 기준 파일+랭크 전체가 표시되고, 룩이 실제로 서 있는 칸에 선택 표식이 따로 남는다', () => {
    const s = waveState();
    const p = boardPiece('rook', 2, 2);
    s.pieces.push(p);
    const anchor = { file: 3, rank: 4 };   // 선택 후 다른 칸(d4)에 hover — 룩의 실제 칸(2,2)과는 다르다
    const hl = buildHighlights(s, noInteraction({ selectedPieceId: p.id, hoverSquare: anchor }));

    const expected = rookTargets(anchor);   // 자신 칸 포함 15칸
    expect(expected).toHaveLength(15);
    const squares = highlightSquares(hl);
    // range 15칸(hover 기준 미리보기) + 선택 표식 1칸(룩이 실제로 서 있는 칸, anchor와는 다른 칸)
    expect(squares).toHaveLength(expected.length + 1);
    for (const t of expected) expect(squares).toContainEqual(t);
    // 선택 표식은 anchor(hover 칸)가 아니라 룩의 실제 square(2,2)에 찍힌다 — anchor를 표시하는
    // 버그였다면 이 좌표는 나오지 않는다(anchor(3,4)는 이미 range 15칸에 포함돼 구분이 안 됨).
    expect(last(hl.highlights)).toEqual({ square: { file: 2, rank: 2 }, color: HIGHLIGHT_COLORS.selected });
  });

  it('hoverSquare가 없으면 기물의 현재 칸을 기준으로 미리보기한다', () => {
    const s = waveState();
    const p = boardPiece('rook', 2, 2);
    s.pieces.push(p);
    const hl = buildHighlights(s, noInteraction({ selectedPieceId: p.id }));

    const expected = rookTargets({ file: 2, rank: 2 });
    const squares = highlightSquares(hl);
    for (const t of expected) expect(squares).toContainEqual(t);
  });
});

describe('buildHighlights — 나이트 (2계층: 초록 이동 칸 + hover 시 얼음 감속 링)', () => {
  it('보드 위 나이트 선택: 점유된 L자 칸도 이제 이동(맞교환) 대상으로 포함된다 (게임 규칙 변경 — 점유 칸은 더 이상 실격 사유가 아니다)', () => {
    // 이전에는 점유된 L자 칸(e6)이 초록 하이라이트에서 제외됐다(moveOnBoard가 거부했으므로). 이제
    // moveOnBoard는 점유 칸으로의 이동을 맞교환으로 허용하므로, 미리보기도 그 칸을 정상 이동 칸으로
    // 그대로 보여줘야 한다 — 그러지 않으면 미리보기가 실제로 가능한 이동을 숨기게 된다.
    const s = waveState();
    const n = boardPiece('knight', 3, 4);   // d4
    const blocker = boardPiece('pawn', 4, 6);   // d4에서 나이트 이동 가능한 칸 중 하나(e6)를 점유
    s.pieces.push(n, blocker);

    const allMoves = knightMoves({ file: 3, rank: 4 });
    expect(allMoves).toContainEqual({ file: 4, rank: 6 });

    const hl = buildHighlights(s, noInteraction({ selectedPieceId: n.id }));
    const squares = highlightSquares(hl);

    expect(squares).toHaveLength(allMoves.length + 1);        // 점유 칸을 빼지 않은 전체 L자 칸 + 선택 표식
    for (const m of allMoves) expect(squares).toContainEqual(m);
    expect(squares).toContainEqual({ file: 4, rank: 6 });      // 점유 칸도 더 이상 제외되지 않는다
    expect(last(hl.highlights)).toEqual({ square: { file: 3, rank: 4 }, color: HIGHLIGHT_COLORS.selected });
    expect(hl.lines).toEqual([]);
  });

  it('7랭크 근처 나이트: 8랭크로 향하는 이동 칸은 애초에 knightMoves에서 제외된다', () => {
    // hover가 없으면 감속 링은 아예 그려지지 않으므로(착지 예정 칸이 정해지지 않았다) 이 단언이
    // 성립한다. 반대편 — 감속 링은 8랭크를 덮는다 — 은 바로 아래 ★ 테스트가 고정한다.
    const s = waveState();
    const n = boardPiece('knight', 3, 7);   // d7
    s.pieces.push(n);
    const hl = buildHighlights(s, noInteraction({ selectedPieceId: n.id }));
    const squares = highlightSquares(hl);
    for (const sq of squares) expect(sq.rank).toBeLessThanOrEqual(CONFIG.board.ranks - 1);
  });

  it('★ 초록 이동 칸과 얼음 감속 칸은 서로 다른 집합이다 — 감속만 8랭크(스폰 구역)를 덮는다', () => {
    // 두 집합은 같은 L자 오프셋 표에서 나오지만 필터가 다르다: knightMoves는 착지 후보라
    // 8랭크를 빼고, slowSquares는 능력 범위라 8랭크를 포함한다(patterns.ts). 한 색으로 합쳐
    // 그리면 "여기로 갈 수 있다"와 "여기를 늦춘다"가 화면에서 구분되지 않고, 무엇보다 적이
    // 쏟아져 내려오는 바로 그 랭크가 미리보기에서 통째로 빠져 능력이 약해 보인다.
    const s = waveState();
    const n = boardPiece('knight', 3, 4);   // d4
    s.pieces.push(n);
    const dest = { file: 4, rank: 6 };      // e6 — 여기 착지하면 감속 링이 8랭크까지 닿는다
    expect(knightMoves({ file: 3, rank: 4 })).toContainEqual(dest);

    const hl = buildHighlights(s, noInteraction({ selectedPieceId: n.id, hoverSquare: dest }));
    const green = hl.highlights.filter(h => h.color === HIGHLIGHT_COLORS.move).map(h => h.square);
    const ice = hl.highlights.filter(h => h.color === HIGHLIGHT_COLORS.slow).map(h => h.square);

    expect(green).toEqual(knightMoves({ file: 3, rank: 4 }));
    expect(ice).toEqual(slowSquares(dest));
    // 감속 링만 스폰 랭크를 덮는다. 이동 칸에는 8랭크가 한 칸도 없다.
    expect(ice.some(sq => sq.rank === CONFIG.board.ranks)).toBe(true);
    for (const sq of green) expect(sq.rank).toBeLessThanOrEqual(CONFIG.board.ranks - 1);
    // 두 집합은 겹치지도 않는다 — 초록은 나이트의 **현재** 칸 기준이고 얼음은 **착지 예정** 칸
    // 기준이라, 애초에 다른 원점에서 뻗은 링이다.
    for (const sq of ice) expect(green.some(g => sameSquare(g, sq))).toBe(false);
  });

  it('이동 가능 칸 중 하나에 hover하면 그 칸에 착지했을 때의 감속 링 8칸이 얼음색으로 추가된다', () => {
    const s = waveState();
    const n = boardPiece('knight', 3, 4);   // d4
    s.pieces.push(n);
    const dest = { file: 5, rank: 5 };   // d4에서 갈 수 있는 L자 칸 중 하나
    expect(knightMoves({ file: 3, rank: 4 })).toContainEqual(dest);

    const hl = buildHighlights(s, noInteraction({ selectedPieceId: n.id, hoverSquare: dest }));
    const squares = highlightSquares(hl);

    const ring = slowSquares(dest);
    expect(ring).toHaveLength(8);   // 보드 한가운데라 L자 8칸이 하나도 잘리지 않는다
    for (const sq of ring) expect(hl.highlights).toContainEqual({ square: sq, color: HIGHLIGHT_COLORS.slow });
    // 나이트는 이제 공격 수단이 하나도 없다(pattern 'none', damage 0). 감속 링을 주황(사거리)으로
    // 칠하면 "여기 있으면 맞는다"는 거짓말이 되므로, 주황은 단 한 칸도 나오면 안 된다.
    expect(hl.highlights.some(h => h.color === HIGHLIGHT_COLORS.range)).toBe(false);
    // 이동 칸(초록, 중복 제거 없음) + 감속 링(얼음) + 선택 표식(나이트의 실제 칸) 1개
    const moves = knightMoves({ file: 3, rank: 4 });
    expect(squares).toHaveLength(moves.length + ring.length + 1);
    expect(last(hl.highlights)).toEqual({ square: { file: 3, rank: 4 }, color: HIGHLIGHT_COLORS.selected });
  });

  it('hover 칸이 이동 가능 칸이 아니면 감속 미리보기가 추가되지 않는다', () => {
    const s = waveState();
    const n = boardPiece('knight', 3, 4);
    s.pieces.push(n);
    const notAMove = { file: 3, rank: 5 };   // 나이트 L자 이동이 아닌 칸
    expect(knightMoves({ file: 3, rank: 4 })).not.toContainEqual(notAMove);

    const hl = buildHighlights(s, noInteraction({ selectedPieceId: n.id, hoverSquare: notAMove }));
    const squares = highlightSquares(hl);
    expect(squares).toHaveLength(knightMoves({ file: 3, rank: 4 }).length + 1);   // + 선택 표식
  });

  it('점유된 L자 칸을 hover하면 이제 감속 미리보기가 뜬다 (게임 규칙 변경 — 점유 칸도 맞교환 대상)', () => {
    // 이 테스트는 원래 "점유돼 도달 불가능한 L자 칸을 hover해도 폭발 미리보기가 뜨지 않는다"였다
    // (리뷰 Finding 1 회귀 방지). 점유 칸이 moveOnBoard에서 실격 사유였던 시절에는 옳은 단언이었지만,
    // 이제 점유 칸은 맞교환 대상으로 허용되므로 이 hover에서 미리보기가 뜨는 쪽이 실제 규칙과
    // 맞다 — 뜨지 않으면 오히려 미리보기가 실제로 가능한 이동/감속을 숨기는 셈이 된다.
    const s = waveState();
    const n = boardPiece('knight', 3, 4);        // d4
    const occupiedDest = { file: 4, rank: 6 };   // e6 — d4에서 갈 수 있는 L자 칸
    const blocker = boardPiece('pawn', 4, 6);    // e6을 점유
    s.pieces.push(n, blocker);
    expect(knightMoves({ file: 3, rank: 4 })).toContainEqual(occupiedDest);

    const hl = buildHighlights(s, noInteraction({ selectedPieceId: n.id, hoverSquare: occupiedDest }));
    const squares = highlightSquares(hl);

    const ring = slowSquares(occupiedDest);
    for (const sq of ring) expect(squares).toContainEqual(sq);   // 감속 링 미리보기가 그려진다
    const allMoves = knightMoves({ file: 3, rank: 4 });
    expect(squares).toHaveLength(allMoves.length + ring.length + 1);   // 이동 칸(점유 칸 포함) + 감속 칸 + 선택 표식
  });

  it('8랭크로 향하는 L자 칸을 hover해도 감속 미리보기가 뜨지 않는다 (착지 자체가 불가능하므로)', () => {
    // moveOnBoard가 여전히 거부하는 대상(8랭크, 스폰 구역)을 hover했을 때 미리보기가 그걸 약속하지
    // 않는지 확인한다. 여기서 걸러지는 것은 **착지**이지 감속이 아니다 — 나이트가 실제로 저기
    // 설 수 없으니 "저기 서면 이렇게 늦춘다"는 그림도 그리면 안 된다는 뜻이고, 8랭크가 감속
    // 범위에서 빠진다는 뜻이 아니다(위 ★ 테스트가 그 반대편을 고정한다).
    //
    // 단, 이 테스트는 "hover 판정이 필터링 이전 knightMoves()를 참조하는 회귀"는 잡지 못한다 —
    // knightMoves() 자체가 이미 8랭크를 무조건 걸러내므로(스펙 5.3) (5,8)은 필터 전/후 목록 어느
    // 쪽에도 애초에 없다. ⚠️ v1.10 이전에는 그 회귀를 잡는 케이스가 하나 있었다(쿨다운 중인
    // 나이트 — knightMoves()가 모르는 조건이라 필터 전/후가 실제로 달라졌다). 이동 쿨다운 게이트가
    // 삭제되면서 그 커버리지는 사라졌고, 지금은 보드 위 나이트에 대해 canLandAt이 L자 칸을 거부할
    // 사유가 하나도 남지 않았다 — 즉 legalMoves 필터는 현재 항상 항등이다. 되살릴 방법이 생기면
    // (새 착지 제약이 추가되면) 그 조건으로 이 커버리지를 복원할 것.
    const s = waveState();
    const n = boardPiece('knight', 3, 7);        // d7
    s.pieces.push(n);
    const rank8Dest = { file: 5, rank: 8 };      // d7에서 L자 관계이지만 8랭크라 여전히 착지 불가
    expect(isKnightMove({ file: 3, rank: 7 }, rank8Dest)).toBe(true);
    expect(knightMoves({ file: 3, rank: 7 })).not.toContainEqual(rank8Dest);   // 8랭크라 애초에 제외

    const hl = buildHighlights(s, noInteraction({ selectedPieceId: n.id, hoverSquare: rank8Dest }));
    const squares = highlightSquares(hl);

    expect(squares).not.toContainEqual(rank8Dest);
    expect(hl.highlights.some(h => h.color === HIGHLIGHT_COLORS.slow)).toBe(false);
    expect(squares).toHaveLength(knightMoves({ file: 3, rank: 7 }).length + 1);   // 감속 8칸은 안 섞이고, 선택 표식만 +1
  });

  it('쿨다운이 남아 있어도 이동 칸과 감속 미리보기가 그대로 그려진다 (v1.10 — 이동 쿨다운 게이트 삭제)', () => {
    // 이 테스트는 원래 정반대를 단언했다: 쿨다운 중인 나이트는 legalMoves가 통째로 비어
    // 하이라이트에 선택 표식 하나만 남는다는 것. 그 게이트의 근거는 "미리보기가 약속한 폭발을
    // 실제로도 터뜨린다"였는데, 폭발이 사라지면서 막을 대상 자체가 없어져 RejectReason의
    // 'knightCooldown'과 함께 삭제됐다(core/pieces.ts). 감속은 서 있기만 하면 걸리는 상태라
    // "언제 움직였는가"와 아무 관계가 없다.
    //
    // 지우지 않고 뒤집어 남겨 두는 이유: 쿨다운 게이트가 되살아나면 나이트가 조용히 다시 못
    // 움직이게 되는데(사용자가 불쾌하다고 지적해 걷어낸 바로 그 감각), 그 회귀를 잡는 테스트가
    // 이것 하나뿐이다.
    const s = waveState();
    const n = boardPiece('knight', 3, 4);   // d4
    n.cooldown = 1.5;
    s.pieces.push(n);
    const dest = { file: 5, rank: 5 };      // 예전이라면 쿨다운 때문에 거부됐을 L자 이동 칸
    expect(knightMoves({ file: 3, rank: 4 })).toContainEqual(dest);

    const hl = buildHighlights(s, noInteraction({ selectedPieceId: n.id, hoverSquare: dest }));
    const green = hl.highlights.filter(h => h.color === HIGHLIGHT_COLORS.move).map(h => h.square);
    const ice = hl.highlights.filter(h => h.color === HIGHLIGHT_COLORS.slow).map(h => h.square);

    expect(green).toEqual(knightMoves({ file: 3, rank: 4 }));   // 한 칸도 깎이지 않는다
    expect(ice).toEqual(slowSquares(dest));
    expect(last(hl.highlights)).toEqual({ square: { file: 3, rank: 4 }, color: HIGHLIGHT_COLORS.selected });
    expect(hl.lines).toEqual([]);
  });

  it('나이트가 슬롯에서 드래그 중이면(보드 위가 아님) L자 이동 미리보기 대신 hover 칸의 감속 링을 보여준다', () => {
    const s = waveState();
    const n = slotPiece('nk', 'knight', 0);
    s.pieces.push(n);
    const anchor = { file: 4, rank: 4 };
    const hl = buildHighlights(s, noInteraction({ dragging: { pieceId: n.id, from: 'slot' }, hoverSquare: anchor }));

    const ring = slowSquares(anchor);
    // ★ 3×3 폭발과 달리 감속 링은 **자기 칸을 포함하지 않는다.** 그래서 origin 표식이 따로
    // 찍히는 것이 맞다(리뷰 Finding 2의 "중복 금지"와 충돌하지 않는다) — 안 찍으면 링만 뜨고
    // 정작 기물이 어디에 서는지가 화면에서 사라진다. 폭발 시절과 달라진 의도된 동작이다.
    expect(ring.some(sq => sameSquare(sq, anchor))).toBe(false);
    expect(hl.highlights).toContainEqual({ square: anchor, color: HIGHLIGHT_COLORS.origin });
    for (const sq of ring) expect(hl.highlights).toContainEqual({ square: sq, color: HIGHLIGHT_COLORS.slow });
    // 링 8칸 + origin 1칸. 트레이 기물이라 선택 표식은 찍히지 않는다(보드 칸이 없다).
    expect(hl.highlights).toHaveLength(ring.length + 1);
  });
});

describe('buildHighlights — 감속 칸은 사거리와 갈라진 축이다 (previewRange가 두 배열을 돌려준다)', () => {
  // previewRange는 예전에 사거리 ∪ 폭발의 **합집합 하나**를 돌려줬다. 그때는 둘 다 "여기 있으면
  // 맞는다"라 한 색이 맞았지만, 감속은 피해를 전혀 주지 않으므로 같은 주황으로 칠하면 거짓말이
  // 된다. 색이 갈라지려면 배열부터 갈라져 있어야 하고, 아래 테스트들이 그 분리를 고정한다 —
  // 합집합으로 되돌리는 회귀는 "얼음 칸이 0개"로 즉시 드러난다.

  it.each<[string, PieceType, (sq: Square) => Square[]]>([
    ['아치비숍', 'archbishop', bishopTargets],
    ['챈슬러', 'chancellor', rookTargets],
  ])('보드 위 %s를 선택하면 재료의 사거리는 주황으로, L자 8칸은 얼음으로 따로 칠해진다', (_label, type, pattern) => {
    const s = waveState();
    const anchor = { file: 3, rank: 4 };   // d4
    const p = boardPiece(type, anchor.file, anchor.rank);
    s.pieces.push(p);
    const hl = buildHighlights(s, noInteraction({ selectedPieceId: p.id }));

    const orange = hl.highlights.filter(h => h.color === HIGHLIGHT_COLORS.range).map(h => h.square);
    const ice = hl.highlights.filter(h => h.color === HIGHLIGHT_COLORS.slow).map(h => h.square);
    expect(orange).toEqual(pattern(anchor));       // 재료의 주기 공격 사거리 그대로
    expect(ice).toEqual(slowSquares(anchor));      // 나이트에게 물려받은 감속 범위
    expect(orange.length).toBeGreaterThan(0);      // 한쪽이 비면 합집합 시절로 되돌아간 것이다
    expect(ice).toHaveLength(8);
    // 같은 칸이 두 색으로 겹쳐 칠해지는 일은 없다 — L자 오프셋은 대각선에도 직선에도 속하지 않는다.
    for (const sq of ice) expect(orange.some(o => sameSquare(o, sq))).toBe(false);
    // 융합물은 moveL을 물려받지 않으므로(보드 어디로든 간다) 초록 이동 칸은 나오지 않는다.
    expect(hl.highlights.some(h => h.color === HIGHLIGHT_COLORS.move)).toBe(false);
    expect(last(hl.highlights)).toEqual({ square: anchor, color: HIGHLIGHT_COLORS.selected });
  });

  it('아마존을 선택하면 파란 퀸 라인과 얼음 감속 칸이 한 화면에 동시에 나오고, 두 색이 서로 다르다', () => {
    // 아마존은 buffFactor > 0이면서 감속도 하는 유일한 기물이다 — 한 번의 선택으로 두 파랑
    // 계열이 같은 보드에 그려진다. 색이 같으면 "버프 칸"과 "감속 칸"이 화면에서 한 덩어리로
    // 합쳐져, 어느 쪽이 아군을 강화하고 어느 쪽이 적을 늦추는지 읽을 수 없게 된다.
    expect(HIGHLIGHT_COLORS.slow).not.toBe(HIGHLIGHT_COLORS.queenLine);

    const s = waveState();
    const anchor = { file: 3, rank: 4 };
    const a = boardPiece('amazon', anchor.file, anchor.rank);
    s.pieces.push(a);
    const hl = buildHighlights(s, noInteraction({ selectedPieceId: a.id }));

    const blue = hl.highlights.filter(h => h.color === HIGHLIGHT_COLORS.queenLine).map(h => h.square);
    const ice = hl.highlights.filter(h => h.color === HIGHLIGHT_COLORS.slow).map(h => h.square);
    expect(blue).toEqual(queenLines(anchor));
    expect(ice).toEqual(slowSquares(anchor));
    expect(hl.lines).toHaveLength(8);   // 8방향 버프 라인은 감속이 생겨도 그대로다
    // 아마존은 퀸(0) + 나이트(0)이라 공격력이 0이다 — 주황 사거리는 한 칸도 없어야 한다.
    expect(hl.highlights.some(h => h.color === HIGHLIGHT_COLORS.range)).toBe(false);
    // 퀸 라인이 이미 anchor를 덮으므로 origin은 따로 찍히지 않는다 (감속 링은 anchor를 비워 둔다).
    expect(hl.highlights.some(h => h.color === HIGHLIGHT_COLORS.origin)).toBe(false);
    expect(highlightSquares(hl)).toHaveLength(blue.length + ice.length + 1);   // + 선택 표식
  });

  it('감속 능력이 없는 기물(룩)에는 얼음 칸이 한 칸도 없다 — slowTargets의 게이트', () => {
    // slowSquares를 무조건 부르는 회귀(게이트 누락)를 잡는다. 룩에 L자 링이 뜨면 플레이어는
    // 있지도 않은 능력을 믿고 배치를 정하게 된다.
    const s = waveState();
    const r = boardPiece('rook', 3, 4);
    s.pieces.push(r);
    const hl = buildHighlights(s, noInteraction({ selectedPieceId: r.id }));
    expect(hl.highlights.some(h => h.color === HIGHLIGHT_COLORS.slow)).toBe(false);
  });
});

describe('buildHighlights — 착지 불가능한 hover 칸은 미리보기를 그리지 않는다 (검토 Item 1)', () => {
  // moveOnBoard/placeFromSlot이 실제로 거부할 칸(8랭크·점유·범위 밖)에 hover해도 종전에는 전체
  // 사거리가 그대로 칠해져, "이 칸으로 이동/배치하면 이렇게 된다"는 미리보기가 실제로는 실행 불가능한
  // 약속을 하고 있었다. canLandAt 도입 이후에는 이런 hover에서 하이라이트가 전혀 그려지지 않는다.
  it('보드 위 룩을 선택하고 8랭크(스폰 구역)에 hover하면 사거리 하이라이트는 없지만 선택 표식은 남는다', () => {
    const s = waveState();
    const p = boardPiece('rook', 2, 2);
    s.pieces.push(p);
    const hl = buildHighlights(s, noInteraction({ selectedPieceId: p.id, hoverSquare: { file: 2, rank: 8 } }));
    // 착지 불가 hover라 사거리 미리보기는 전부 접히지만, 룩이 실제로 서 있는 칸(2,2)의 선택
    // 표식은 살아남는다 — 잘못된 칸에 hover했다고 "무엇이 선택됐는지"까지 사라지면 안 된다.
    expect(hl.highlights).toEqual([{ square: { file: 2, rank: 2 }, color: HIGHLIGHT_COLORS.selected }]);
    expect(hl.lines).toEqual([]);
  });

  it('슬롯의 폰을 점유된 칸 위에 hover하면 사거리 하이라이트가 전혀 없다', () => {
    const s = waveState();
    const p = slotPiece('p-blocked', 'pawn', 0);
    const blocker = boardPiece('bishop', 3, 4);
    s.pieces.push(p, blocker);
    const hl = buildHighlights(
      s, noInteraction({ dragging: { pieceId: p.id, from: 'slot' }, hoverSquare: { file: 3, rank: 4 } }),
    );
    expect(hl.highlights).toEqual([]);
    expect(hl.lines).toEqual([]);
  });
});

describe('buildHighlights — hover 칸이 기물 자신의 현재 칸이면 미리보기가 사라지지 않는다 (회귀 1)', () => {
  // canLandAt이 예전에는 pieceAt을 통해 "자기 자신이 점유한 칸"도 점유 칸으로 판정해 거부했다.
  // DragController.onMove는 커서 아래 칸을 그대로 hoverSquare에 넣고, 클릭 선택/드래그 시작 모두
  // 기물이 서 있는 바로 그 칸 위에서 일어난다 — 즉 "기물을 클릭해서 사거리를 본다"는 가장 흔한
  // 조작에서 hoverSquare가 항상 자기 자신의 칸과 같다. Item 1의 가드가 이 경우까지 canLandAt으로
  // 걸러 버리면, 기물을 선택하는 그 순간 미리보기가 통째로 사라진다 — 그래서 당시 highlights.ts는
  // hoveringOwnSquare라는 별도 예외로 이 케이스를 가려냈다.
  // 게임 규칙 변경(점유 칸 맞교환 허용) 이후에는 canLandAt 자체가 보드 위 기물에게 점유 칸을 더
  // 이상 실격 사유로 보지 않으므로 — "자기 자신이 점유한 칸"도 예외 없이 통과한다 — 저 예외가
  // 필요 없어졌다. highlights.ts에서 hoveringOwnSquare를 지웠는데도 아래 테스트들이 그대로 통과하는
  // 것으로 이를 확인한다 (즉, 이 describe 블록이 지금은 canLandAt 자체의 새 의미를 검증하는 셈이다).
  it('보드 위 룩을 클릭 선택하고 커서가 그 칸 위에 그대로 있으면 사거리 15칸이 그대로 보인다', () => {
    const s = waveState();
    const p = boardPiece('rook', 2, 2);
    s.pieces.push(p);
    const hl = buildHighlights(s, noInteraction({ selectedPieceId: p.id, hoverSquare: { file: 2, rank: 2 } }));

    const expected = rookTargets({ file: 2, rank: 2 });
    expect(expected).toHaveLength(15);
    const squares = highlightSquares(hl);
    // hover가 룩 자신의 칸과 같으므로 range 15칸 안에 이미 그 칸이 들어 있다. 선택 표식은
    // 그 위에 마지막으로 한 번 더 찍혀 겹친다(중복 origin은 안 찍힘) — 총 16개.
    expect(squares).toHaveLength(16);
    for (const t of expected) expect(squares).toContainEqual(t);
    expect(last(hl.highlights)).toEqual({ square: { file: 2, rank: 2 }, color: HIGHLIGHT_COLORS.selected });
  });

  it('보드 위 퀸을 클릭 선택하고 커서가 그 칸 위에 그대로 있으면 8방향 라인이 그대로 보인다', () => {
    const s = waveState();
    const q = boardPiece('queen', 2, 2);
    s.pieces.push(q);
    const hl = buildHighlights(s, noInteraction({ selectedPieceId: q.id, hoverSquare: { file: 2, rank: 2 } }));

    const expectedSquares = queenLines({ file: 2, rank: 2 });
    const squares = highlightSquares(hl);
    expect(squares).toHaveLength(expectedSquares.length + 1);   // queenLine 28칸 + 선택 표식 1칸
    for (const sq of expectedSquares) expect(squares).toContainEqual(sq);
    expect(hl.lines.length).toBeGreaterThan(0);   // 8방향 라인도 여전히 그려진다 (빈 배열이 아님)
    expect(last(hl.highlights)).toEqual({ square: { file: 2, rank: 2 }, color: HIGHLIGHT_COLORS.selected });
  });

  it('보드 위 비숍을 드래그 시작하고 커서가 원래 칸 위에 그대로 있으면 사거리 12칸이 그대로 보인다', () => {
    const s = waveState();
    const b = boardPiece('bishop', 4, 3);
    s.pieces.push(b);
    const hl = buildHighlights(
      s, noInteraction({ dragging: { pieceId: b.id, from: 'board' }, hoverSquare: { file: 4, rank: 3 } }),
    );

    // 길이는 bishopTargets에서 그대로 유도한다(하드코딩하지 않음) — 핵심은 "0으로 비지 않고
    // attackTargets 전체가 그대로 남아 있다"는 것이지, 특정 좌표에서의 정확한 칸 수가 아니다.
    const expected = bishopTargets({ file: 4, rank: 3 });
    const squares = highlightSquares(hl);
    expect(squares.length).toBeGreaterThan(0);
    expect(squares).toHaveLength(expected.length + 1);   // + 선택 표식
    for (const t of expected) expect(squares).toContainEqual(t);
    expect(last(hl.highlights)).toEqual({ square: { file: 4, rank: 3 }, color: HIGHLIGHT_COLORS.selected });
  });

  it('다른 칸으로 hover를 옮기면(자기 칸이 아님) 여전히 착지 불가 검증이 적용된다', () => {
    // 회귀 수정이 "자기 자신의 칸일 때만" 예외이지 canLandAt 검증 자체를 무력화한 게 아님을 확인한다.
    // 예전에는 점유 칸(다른 기물이 있는 칸)을 "여전히 착지 불가"한 예시로 썼지만, 게임 규칙 변경으로
    // 보드 위 기물에게 점유 칸은 더 이상 착지 실격 사유가 아니다(맞교환 대상) — 그래서 그 예시로는
    // 이 단언이 더 이상 성립하지 않는다. 여전히 착지 불가능한 8랭크(스폰 구역)로 예시를 교체한다.
    const s = waveState();
    const p = boardPiece('rook', 2, 2);
    s.pieces.push(p);
    const hl = buildHighlights(s, noInteraction({ selectedPieceId: p.id, hoverSquare: { file: 4, rank: 8 } }));
    // 미리보기는 접히지만 선택 표식(룩의 실제 칸)은 남는다.
    expect(hl.highlights).toEqual([{ square: { file: 2, rank: 2 }, color: HIGHLIGHT_COLORS.selected }]);
    expect(hl.lines).toEqual([]);
  });

  it('점유된 칸으로 hover를 옮기면(자기 칸이 아님) 이제 그 칸 기준 사거리가 그대로 보인다 (게임 규칙 변경 — 맞교환 대상)', () => {
    // 위 테스트가 예시를 8랭크로 교체하며 잃은 커버리지를 보충한다: 점유 칸은 더 이상 미리보기를
    // 지우는 사유가 아니라는 것 자체를 별도로 고정해 둔다.
    const s = waveState();
    const p = boardPiece('rook', 2, 2);
    const blocker = boardPiece('pawn', 4, 4);
    s.pieces.push(p, blocker);
    const hl = buildHighlights(s, noInteraction({ selectedPieceId: p.id, hoverSquare: { file: 4, rank: 4 } }));

    const expected = rookTargets({ file: 4, rank: 4 });
    const squares = highlightSquares(hl);
    expect(squares).toHaveLength(expected.length + 1);   // range(hover 기준) + 선택 표식(룩의 실제 칸 2,2)
    for (const t of expected) expect(squares).toContainEqual(t);
    expect(last(hl.highlights)).toEqual({ square: { file: 2, rank: 2 }, color: HIGHLIGHT_COLORS.selected });
  });
});

describe('buildHighlights — 기준 칸 중복 방지 (리뷰 Finding 2)', () => {
  it('폰처럼 attackTargets에 자기 칸이 없는 기물은 origin이 정확히 한 번만 추가된다', () => {
    const s = waveState();
    const p = slotPiece('p-origin', 'pawn', 0);
    s.pieces.push(p);
    const anchor = { file: 3, rank: 4 };
    const hl = buildHighlights(s, noInteraction({ dragging: { pieceId: p.id, from: 'slot' }, hoverSquare: anchor }));
    const squares = highlightSquares(hl);

    expect(pawnTargets(anchor).some(t => sameSquare(t, anchor))).toBe(false);   // 전제: 폰은 자기 칸을 공격하지 않음
    expect(squares.filter(sq => sameSquare(sq, anchor))).toHaveLength(1);        // origin 1회
    expect(squares).toHaveLength(pawnTargets(anchor).length + 1);
  });

  it('비숍/룩처럼 attackTargets에 자기 칸이 포함된 기물은 anchor가 정확히 한 번만 나타난다', () => {
    const s = waveState();
    const b = slotPiece('b-origin', 'bishop', 0);
    s.pieces.push(b);
    const anchor = { file: 3, rank: 4 };
    const hl = buildHighlights(s, noInteraction({ dragging: { pieceId: b.id, from: 'slot' }, hoverSquare: anchor }));
    const squares = highlightSquares(hl);

    expect(bishopTargets(anchor).some(t => sameSquare(t, anchor))).toBe(true);   // 전제: 비숍은 자기 칸도 공격
    expect(squares.filter(sq => sameSquare(sq, anchor))).toHaveLength(1);         // 중복 없음
    expect(squares).toHaveLength(bishopTargets(anchor).length);
  });
});

describe('buildHighlights — 퀸 (8방향 라인, 스펙 7.7)', () => {
  it('드래그/선택 중인 퀸: hover(또는 현재) 칸 기준 8방향 라인과 그 칸들이 모두 표시된다', () => {
    const s = waveState();
    const q = boardPiece('queen', 2, 2);
    s.pieces.push(q);
    const anchor = { file: 3, rank: 4 };   // d4
    const hl = buildHighlights(s, noInteraction({ selectedPieceId: q.id, hoverSquare: anchor }));

    const expectedSquares = queenLines(anchor);   // 자신 칸 포함 28칸
    expect(expectedSquares).toHaveLength(28);
    const squares = highlightSquares(hl);
    // queenLine 28칸(hover 기준 미리보기) + 선택 표식 1칸(퀸이 실제로 서 있는 칸, 2,2 — anchor와 다르다)
    expect(squares).toHaveLength(29);
    for (const sq of expectedSquares) expect(squares).toContainEqual(sq);
    expect(last(hl.highlights)).toEqual({ square: { file: 2, rank: 2 }, color: HIGHLIGHT_COLORS.selected });

    // 8방향 각각 anchor→최원거리 칸으로 이어지는 선분 8개 (d4 기준 수기로 계산한 8개 끝점)
    expect(hl.lines).toHaveLength(8);
    const endpoints = hl.lines.map(l => l.to);
    const expectedEndpoints: Square[] = [
      { file: 3, rank: 8 }, // 위
      { file: 3, rank: 1 }, // 아래
      { file: 0, rank: 4 }, // 왼쪽
      { file: 7, rank: 4 }, // 오른쪽
      { file: 0, rank: 7 }, // 좌상 대각선
      { file: 7, rank: 8 }, // 우상 대각선
      { file: 0, rank: 1 }, // 좌하 대각선
      { file: 6, rank: 1 }, // 우하 대각선
    ];
    for (const e of expectedEndpoints) expect(endpoints).toContainEqual(e);
    for (const l of hl.lines) expect(l.from).toEqual(anchor);
  });

  it('hoverSquare가 없으면 퀸의 현재 칸을 기준으로 라인을 그린다', () => {
    const s = waveState();
    const q = boardPiece('queen', 0, 1);   // a1 — 구석
    s.pieces.push(q);
    const hl = buildHighlights(s, noInteraction({ selectedPieceId: q.id }));

    // a1(구석)에서는 유효한 방향이 3개뿐이다 (위/오른쪽/우상 대각선)
    expect(hl.lines).toHaveLength(3);
    for (const l of hl.lines) expect(l.from).toEqual({ file: 0, rank: 1 });
  });
});

describe('buildHighlights — 선택 기물 표식 (사용자 요청: 보드에서 선택 중인 기물의 칸을 색으로 표시)', () => {
  // 클릭-투-무브에서는 사거리 미리보기가 마우스(hoverSquare)를 따라가고, 기물의 실제 칸(piece.square)과는
  // 클릭 사이에 서로 다른 칸이 될 수 있다. 이 표식은 anchor가 아니라 piece.square를 표시해야 한다 —
  // 그래야 두 클릭 사이에도 "무엇이 선택됐는지"가 화면에 남는다.

  it.each<[string, PieceType, [number, number]]>([
    ['폰', 'pawn', [1, 3]],
    ['룩', 'rook', [5, 5]],
    ['퀸', 'queen', [4, 2]],
    ['나이트', 'knight', [3, 4]],
  ])('보드 위 %s를 선택하면 기물이 서 있는 칸에 선택 표식(C.selected)이 찍힌다', (_label, type, [file, rank]) => {
    const s = waveState();
    const p = boardPiece(type, file, rank);
    s.pieces.push(p);
    const hl = buildHighlights(s, noInteraction({ selectedPieceId: p.id }));

    const marker = hl.highlights.find(h => sameSquare(h.square, { file, rank }) && h.color === HIGHLIGHT_COLORS.selected);
    expect(marker).toBeDefined();
  });

  it('hoverSquare가 기물의 현재 칸과 다른 곳을 가리켜도, 선택 표식은 anchor가 아니라 piece.square에 찍힌다', () => {
    // anchor(hover 칸)를 표시하는 회귀가 있었다면 이 테스트는 실패한다 — 표식이 (1,3)이 아니라
    // hoverSquare인 (6,6)에 찍히기 때문이다.
    const s = waveState();
    const p = boardPiece('bishop', 1, 3);
    s.pieces.push(p);
    const hoverSquare = { file: 6, rank: 6 };
    const hl = buildHighlights(s, noInteraction({ selectedPieceId: p.id, hoverSquare }));

    expect(hl.highlights).toContainEqual({ square: { file: 1, rank: 3 }, color: HIGHLIGHT_COLORS.selected });
    expect(hl.highlights).not.toContainEqual({ square: hoverSquare, color: HIGHLIGHT_COLORS.selected });
  });

  it('퀸을 선택하고 착지 불가능한 8랭크(스폰 구역)에 hover해도 선택 표식은 남는다 (퀸 브랜치의 조기 반환 경로)', () => {
    const s = waveState();
    const q = boardPiece('queen', 3, 3);
    s.pieces.push(q);
    const hl = buildHighlights(s, noInteraction({ selectedPieceId: q.id, hoverSquare: { file: 3, rank: 8 } }));

    // 8방향 라인 미리보기는 전부 접히지만, 선택 표식 하나만은 남아야 한다.
    expect(hl.highlights).toEqual([{ square: { file: 3, rank: 3 }, color: HIGHLIGHT_COLORS.selected }]);
    expect(hl.lines).toEqual([]);
  });

  it('트레이(슬롯)의 기물을 선택/드래그해도 선택 표식은 찍히지 않는다 — piece.square가 없으므로 표시할 보드 칸이 없다', () => {
    const s = waveState();
    const p = slotPiece('tray-rook', 'rook', 0);
    s.pieces.push(p);
    const hl = buildHighlights(s, noInteraction({ dragging: { pieceId: p.id, from: 'slot' }, hoverSquare: { file: 3, rank: 3 } }));

    expect(hl.highlights.some(h => h.color === HIGHLIGHT_COLORS.selected)).toBe(false);
  });

  it('아무것도 선택/드래그되지 않으면 선택 표식도 없다', () => {
    const s = waveState();
    s.pieces.push(boardPiece('rook', 3, 3));
    const hl = buildHighlights(s, noInteraction());
    expect(hl.highlights.some(h => h.color === HIGHLIGHT_COLORS.selected)).toBe(false);
  });

  it('선택 표식은 같은 칸의 다른 하이라이트보다 항상 나중(배열 마지막)에 그려져 range 채우기에 묻히지 않는다', () => {
    // 비숍은 attackTargets에 자기 칸을 포함하므로(range), hover를 자기 칸에 두면 같은 칸에
    // range와 selected 두 하이라이트가 겹친다. render()는 배열 순서대로 알파 블렌드하므로,
    // selected가 먼저 push됐다면 range 밑에 묻혀 화면에 보이지 않는다 — 배열 순서로 이를 고정한다.
    const s = waveState();
    const b = boardPiece('bishop', 4, 4);
    s.pieces.push(b);
    const hl = buildHighlights(s, noInteraction({ selectedPieceId: b.id, hoverSquare: { file: 4, rank: 4 } }));

    const atOwnSquare = hl.highlights.filter(h => sameSquare(h.square, { file: 4, rank: 4 }));
    expect(atOwnSquare).toHaveLength(2);              // range 1개 + selected 1개, origin 중복 없음
    expect(last(atOwnSquare).color).toBe(HIGHLIGHT_COLORS.selected);   // 마지막(= 가장 위)이 selected
    expect(last(hl.highlights)).toEqual({ square: { file: 4, rank: 4 }, color: HIGHLIGHT_COLORS.selected });
  });
});
