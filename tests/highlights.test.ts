import { describe, expect, it } from 'vitest';
import { buildHighlights } from '../src/render/highlights';
import { bishopTargets, knightBlastTargets, knightMoves, pawnTargets, queenLines, rookTargets } from '../src/core/patterns';
import { sameSquare } from '../src/core/grid';
import type { Interaction, Piece, PieceType, Square } from '../src/types';
import { boardPiece, waveState } from './helpers';

// buildHighlights는 순수 함수 — DOM 없이 (state, interaction)만으로 테스트할 수 있다 (컨트롤러 결정,
// 브리프 Step 4의 수동 검증을 대체). 기대값은 가능한 한 patterns.ts에서 직접 파생시켜, 미리보기가
// 실제 공격/버프 계산과 어긋날 수 없게 한다.

function slotPiece(id: string, type: PieceType, slotIndex: number): Piece {
  return { id, type, square: null, slotIndex, cooldown: 0, queenBuffCount: 0 };
}

function noInteraction(overrides: Partial<Interaction> = {}): Interaction {
  return { dragging: null, selectedPieceId: null, hoverSquare: null, ...overrides };
}

function highlightSquares(hl: ReturnType<typeof buildHighlights>): Square[] {
  return hl.highlights.map(h => h.square);
}

describe('buildHighlights (스펙 7.7 사거리 미리보기) — 활성 기물 없음', () => {
  it('드래그도 선택도 없으면 하이라이트/라인이 모두 비어 있다', () => {
    const s = waveState();
    s.pieces.push(boardPiece('rook', 3, 3));   // 보드에 기물이 있어도 상호작용이 없으면 무관
    expect(buildHighlights(s, noInteraction())).toEqual({ highlights: [], lines: [] });
  });

  it('hoverSquare만 있고 드래그/선택 대상이 없으면 여전히 비어 있다', () => {
    const s = waveState();
    expect(buildHighlights(s, noInteraction({ hoverSquare: { file: 3, rank: 3 } })))
      .toEqual({ highlights: [], lines: [] });
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

  it('보드 위 룩을 클릭 선택: hover 칸 기준 파일+랭크 전체가 표시된다', () => {
    const s = waveState();
    const p = boardPiece('rook', 2, 2);
    s.pieces.push(p);
    const anchor = { file: 3, rank: 4 };   // 선택 후 다른 칸(d4)에 hover
    const hl = buildHighlights(s, noInteraction({ selectedPieceId: p.id, hoverSquare: anchor }));

    const expected = rookTargets(anchor);   // 자신 칸 포함 15칸
    expect(expected).toHaveLength(15);
    const squares = highlightSquares(hl);
    expect(squares).toHaveLength(expected.length);   // origin 중복 없음 (리뷰 Finding 2)
    for (const t of expected) expect(squares).toContainEqual(t);
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

describe('buildHighlights — 나이트 (2계층: 이동 칸 + hover 시 폭발 미리보기)', () => {
  it('보드 위 나이트 선택: 점유되지 않은 L자 이동 칸만 초록으로 표시된다', () => {
    const s = waveState();
    const n = boardPiece('knight', 3, 4);   // d4
    const blocker = boardPiece('pawn', 4, 6);   // d4에서 나이트 이동 가능한 칸 중 하나(e6)를 점유
    s.pieces.push(n, blocker);

    const allMoves = knightMoves({ file: 3, rank: 4 });
    expect(allMoves).toContainEqual({ file: 4, rank: 6 });

    const hl = buildHighlights(s, noInteraction({ selectedPieceId: n.id }));
    const squares = highlightSquares(hl);

    const freeMoves = allMoves.filter(m => !(m.file === 4 && m.rank === 6));
    expect(squares).toHaveLength(freeMoves.length);
    for (const m of freeMoves) expect(squares).toContainEqual(m);
    expect(squares).not.toContainEqual({ file: 4, rank: 6 });   // 점유 칸은 제외
    expect(hl.lines).toEqual([]);
  });

  it('7랭크 근처 나이트: 8랭크로 향하는 이동 칸은 애초에 knightMoves에서 제외된다', () => {
    const s = waveState();
    const n = boardPiece('knight', 3, 7);   // d7
    s.pieces.push(n);
    const hl = buildHighlights(s, noInteraction({ selectedPieceId: n.id }));
    const squares = highlightSquares(hl);
    for (const sq of squares) expect(sq.rank).toBeLessThanOrEqual(7);
  });

  it('이동 가능 칸 중 하나에 hover하면 그 칸에 착지했을 때의 3×3 폭발 범위가 추가된다', () => {
    const s = waveState();
    const n = boardPiece('knight', 3, 4);   // d4
    s.pieces.push(n);
    const dest = { file: 5, rank: 5 };   // d4에서 갈 수 있는 L자 칸 중 하나
    expect(knightMoves({ file: 3, rank: 4 })).toContainEqual(dest);

    const hl = buildHighlights(s, noInteraction({ selectedPieceId: n.id, hoverSquare: dest }));
    const squares = highlightSquares(hl);

    const blast = knightBlastTargets(dest);
    expect(blast).toHaveLength(9);
    for (const b of blast) expect(squares).toContainEqual(b);
    // 이동 칸 하이라이트(초록, 중복 제거 없음) + 폭발 하이라이트(파랑) 두 배열을 그대로 이어붙인 만큼만 존재한다
    const moves = knightMoves({ file: 3, rank: 4 });
    expect(squares).toHaveLength(moves.length + blast.length);
  });

  it('hover 칸이 이동 가능 칸이 아니면 폭발 미리보기가 추가되지 않는다', () => {
    const s = waveState();
    const n = boardPiece('knight', 3, 4);
    s.pieces.push(n);
    const notAMove = { file: 3, rank: 5 };   // 나이트 L자 이동이 아닌 칸
    expect(knightMoves({ file: 3, rank: 4 })).not.toContainEqual(notAMove);

    const hl = buildHighlights(s, noInteraction({ selectedPieceId: n.id, hoverSquare: notAMove }));
    const squares = highlightSquares(hl);
    expect(squares).toHaveLength(knightMoves({ file: 3, rank: 4 }).length);
  });

  it('점유돼 도달 불가능한 L자 칸을 hover해도 폭발 미리보기가 뜨지 않는다 (리뷰 Finding 1 회귀 방지)', () => {
    // 이 테스트는 highlights.ts의 hover 일치 판정이 미필터링된 knightMoves() 그대로를 쓰던 시절에는
    // 실패했다: occupiedDest는 knightMoves()에는 있지만(점유돼 이동 불가) 초록 하이라이트에서는
    // 제외되는데, hover 판정만은 필터 이전 목록을 참조해 "이동 가능한 칸"으로 오인하고 9칸 폭발
    // 미리보기를 그렸다 — moveOnBoard가 canPlaceAt에서 거부할 칸에 피해를 약속하는 셈이었다.
    // 고친 코드는 점유 필터를 거친 legalMoves 하나만 두 곳에 공유하므로, 되돌리면 아래 두 단언이
    // 모두 깨진다 (occupiedDest가 highlights에 나타나고, 총 길이가 9칸 더 많아짐).
    const s = waveState();
    const n = boardPiece('knight', 3, 4);        // d4
    const occupiedDest = { file: 4, rank: 6 };   // e6 — d4에서 갈 수 있는 L자 칸
    const blocker = boardPiece('pawn', 4, 6);    // e6을 점유
    s.pieces.push(n, blocker);
    expect(knightMoves({ file: 3, rank: 4 })).toContainEqual(occupiedDest);

    const hl = buildHighlights(s, noInteraction({ selectedPieceId: n.id, hoverSquare: occupiedDest }));
    const squares = highlightSquares(hl);

    expect(squares).not.toContainEqual(occupiedDest);   // 초록 마커도, 폭발 중심도 없다 (blast는 항상 자기 칸 포함)
    const freeMoves = knightMoves({ file: 3, rank: 4 }).filter(m => !sameSquare(m, occupiedDest));
    expect(squares).toHaveLength(freeMoves.length);      // 폭발 9칸이 섞여 들어오지 않았다
  });

  it('쿨다운 중인 나이트를 클릭 선택하면 이동 하이라이트도 폭발 미리보기도 뜨지 않는다 (검토 Item 1)', () => {
    // drag.ts는 쿨다운 중인 보드 위 나이트의 드래그 "시작"은 거부하지만, onUp이 클릭-투-무브로
    // 새어나가면 selectedPieceId가 채워질 수 있었다. buildHighlights가 canPlaceAt만 보고 쿨다운을
    // 보지 않던 시절에는, 그 상태에서 moveOnBoard가 거부할 이동 전체가 그대로 초록으로 칠해지고
    // hover한 칸에는 일어나지 않을 폭발까지 미리 그렸다. canLandAt으로 통합한 뒤에는 쿨다운 중인
    // 나이트의 모든 후보 칸이 canLandAt에서 걸러져 legalMoves가 통째로 비어야 한다.
    const s = waveState();
    const n = boardPiece('knight', 3, 4);   // d4
    n.cooldown = 1.5;
    s.pieces.push(n);
    const dest = { file: 5, rank: 5 };      // 쿨다운만 아니면 정상적인 L자 이동 칸
    expect(knightMoves({ file: 3, rank: 4 })).toContainEqual(dest);

    const hl = buildHighlights(s, noInteraction({ selectedPieceId: n.id, hoverSquare: dest }));

    expect(hl.highlights).toEqual([]);   // 초록 이동 칸도, 파란 폭발 미리보기도 전혀 없다
    expect(hl.lines).toEqual([]);
  });

  it('나이트가 슬롯에서 드래그 중이면(보드 위가 아님) L자 이동 미리보기 대신 hover 칸의 폭발 범위(attackTargets)를 보여준다', () => {
    const s = waveState();
    const n = slotPiece('nk', 'knight', 0);
    s.pieces.push(n);
    const anchor = { file: 4, rank: 4 };
    const hl = buildHighlights(s, noInteraction({ dragging: { pieceId: n.id, from: 'slot' }, hoverSquare: anchor }));

    const blast = knightBlastTargets(anchor);   // 3×3 블록은 항상 자기 칸(anchor)을 포함한다
    const squares = highlightSquares(hl);
    // attackTargets(knight, anchor)가 이미 anchor를 포함하므로 origin이 별도로 중복 push되지
    // 않는다 (리뷰 Finding 2) — 총 개수는 attackTargets(=blast)와 정확히 같다.
    expect(squares).toHaveLength(blast.length);
    for (const b of blast) expect(squares).toContainEqual(b);
    expect(squares).toContainEqual(anchor);
  });
});

describe('buildHighlights — 착지 불가능한 hover 칸은 미리보기를 그리지 않는다 (검토 Item 1)', () => {
  // moveOnBoard/placeFromSlot이 실제로 거부할 칸(8랭크·점유·범위 밖)에 hover해도 종전에는 전체
  // 사거리가 그대로 칠해져, "이 칸으로 이동/배치하면 이렇게 된다"는 미리보기가 실제로는 실행 불가능한
  // 약속을 하고 있었다. canLandAt 도입 이후에는 이런 hover에서 하이라이트가 전혀 그려지지 않는다.
  it('보드 위 룩을 선택하고 8랭크(스폰 구역)에 hover하면 사거리 하이라이트가 전혀 없다', () => {
    const s = waveState();
    const p = boardPiece('rook', 2, 2);
    s.pieces.push(p);
    const hl = buildHighlights(s, noInteraction({ selectedPieceId: p.id, hoverSquare: { file: 2, rank: 8 } }));
    expect(hl.highlights).toEqual([]);
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
  // canLandAt은 pieceAt을 통해 "자기 자신이 점유한 칸"도 점유 칸으로 판정해 거부한다. 그런데
  // DragController.onMove는 커서 아래 칸을 그대로 hoverSquare에 넣고, 클릭 선택/드래그 시작
  // 모두 기물이 서 있는 바로 그 칸 위에서 일어난다 — 즉 "기물을 클릭해서 사거리를 본다"는 가장
  // 흔한 조작에서 hoverSquare가 항상 자기 자신의 칸과 같다. Item 1의 가드가 이 경우까지
  // canLandAt으로 걸러 버리면, 기물을 선택하는 그 순간 미리보기가 통째로 사라진다.
  it('보드 위 룩을 클릭 선택하고 커서가 그 칸 위에 그대로 있으면 사거리 15칸이 그대로 보인다', () => {
    const s = waveState();
    const p = boardPiece('rook', 2, 2);
    s.pieces.push(p);
    const hl = buildHighlights(s, noInteraction({ selectedPieceId: p.id, hoverSquare: { file: 2, rank: 2 } }));

    const expected = rookTargets({ file: 2, rank: 2 });
    expect(expected).toHaveLength(15);
    const squares = highlightSquares(hl);
    expect(squares).toHaveLength(15);
    for (const t of expected) expect(squares).toContainEqual(t);
  });

  it('보드 위 퀸을 클릭 선택하고 커서가 그 칸 위에 그대로 있으면 8방향 라인이 그대로 보인다', () => {
    const s = waveState();
    const q = boardPiece('queen', 2, 2);
    s.pieces.push(q);
    const hl = buildHighlights(s, noInteraction({ selectedPieceId: q.id, hoverSquare: { file: 2, rank: 2 } }));

    const expectedSquares = queenLines({ file: 2, rank: 2 });
    const squares = highlightSquares(hl);
    expect(squares).toHaveLength(expectedSquares.length);
    for (const sq of expectedSquares) expect(squares).toContainEqual(sq);
    expect(hl.lines.length).toBeGreaterThan(0);   // 8방향 라인도 여전히 그려진다 (빈 배열이 아님)
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
    expect(squares).toHaveLength(expected.length);
    for (const t of expected) expect(squares).toContainEqual(t);
  });

  it('다른 칸으로 hover를 옮기면(자기 칸이 아님) 여전히 착지 불가 검증이 적용된다', () => {
    // 회귀 수정이 "자기 자신의 칸일 때만" 예외이지 canLandAt 검증 자체를 무력화한 게 아님을 확인한다.
    const s = waveState();
    const p = boardPiece('rook', 2, 2);
    const blocker = boardPiece('pawn', 4, 4);
    s.pieces.push(p, blocker);
    const hl = buildHighlights(s, noInteraction({ selectedPieceId: p.id, hoverSquare: { file: 4, rank: 4 } }));
    expect(hl.highlights).toEqual([]);
    expect(hl.lines).toEqual([]);
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
    expect(squares).toHaveLength(28);
    for (const sq of expectedSquares) expect(squares).toContainEqual(sq);

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
