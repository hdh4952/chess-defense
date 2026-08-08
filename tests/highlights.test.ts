import { describe, expect, it } from 'vitest';
import { buildHighlights } from '../src/render/highlights';
import { bishopTargets, knightBlastTargets, knightMoves, pawnTargets, queenLines, rookTargets } from '../src/core/patterns';
import type { Interaction } from '../src/ui/drag';
import type { Piece, PieceType, Square } from '../src/types';
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
    // range 하이라이트가 attackTargets 전체를 포함(자신 칸은 origin과 range 양쪽에 겹쳐 그려짐)
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

  it('나이트가 슬롯에서 드래그 중이면(보드 위가 아님) L자 이동 미리보기 대신 hover 칸의 폭발 범위(attackTargets)를 보여준다', () => {
    const s = waveState();
    const n = slotPiece('nk', 'knight', 0);
    s.pieces.push(n);
    const anchor = { file: 4, rank: 4 };
    const hl = buildHighlights(s, noInteraction({ dragging: { pieceId: n.id, from: 'slot' }, hoverSquare: anchor }));

    const blast = knightBlastTargets(anchor);
    const squares = highlightSquares(hl);
    for (const b of blast) expect(squares).toContainEqual(b);
    expect(squares).toContainEqual(anchor);   // origin 표시도 포함
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
