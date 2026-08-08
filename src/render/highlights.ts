import { findPiece, pieceAt } from '../core/pieces';
import { attackTargets, knightMoves, queenLines } from '../core/patterns';
import { sameSquare } from '../core/grid';
import type { GameState, Piece, Square } from '../types';
import type { Interaction } from '../ui/drag';
import type { ViewState } from './renderer';

const C = {
  range: 'rgba(80, 160, 255, 0.35)',     // 공격 범위
  move: 'rgba(90, 200, 90, 0.40)',       // 나이트 이동 가능 칸
  queenLine: 'rgba(255, 213, 74, 0.55)', // 퀸 8방향 라인
  origin: 'rgba(255, 255, 255, 0.25)',   // 기준 칸
};

/** 활성 기물: 드래그 중 우선, 없으면 클릭 선택 */
function activePiece(state: GameState, it: Interaction): Piece | null {
  const id = it.dragging?.pieceId ?? it.selectedPieceId;
  return id ? findPiece(state, id) ?? null : null;
}

/**
 * 퀸의 8방향 라인을 anchor→각 방향 최원거리 칸의 선분으로 변환한다 (스펙 7.7 "8방향 라인 표시").
 * queenLines()가 반환하는 평탄화된 칸 목록을 anchor 기준 방향 부호(dx,dy)로 그룹핑해 방향당
 * 가장 먼 칸만 남긴다 — DIAG/ORTHO 오프셋을 여기서 다시 정의하지 않고 patterns.ts의 결과만으로
 * 방향을 복원하므로, 이 선분이 실제 버프 범위(queenLines)와 어긋날 수 없다.
 */
function queenLineSegments(anchor: Square): { from: Square; to: Square }[] {
  const furthest = new Map<string, { sq: Square; dist: number }>();
  for (const sq of queenLines(anchor)) {
    if (sameSquare(sq, anchor)) continue;
    const dx = Math.sign(sq.file - anchor.file);
    const dy = Math.sign(sq.rank - anchor.rank);
    const dist = Math.max(Math.abs(sq.file - anchor.file), Math.abs(sq.rank - anchor.rank));
    const key = `${dx},${dy}`;
    const cur = furthest.get(key);
    if (!cur || dist > cur.dist) furthest.set(key, { sq, dist });
  }
  return [...furthest.values()].map(({ sq }) => ({ from: anchor, to: sq }));
}

export function buildHighlights(
  state: GameState, it: Interaction,
): Pick<ViewState, 'highlights' | 'lines'> {
  const highlights: ViewState['highlights'] = [];
  const lines: ViewState['lines'] = [];
  const piece = activePiece(state, it);
  if (!piece) return { highlights, lines };

  const onBoard = piece.square !== null;
  const anchor: Square | null = it.hoverSquare ?? piece.square;   // 미리보기 기준 칸
  if (!anchor) return { highlights, lines };

  if (piece.type === 'queen') {
    for (const sq of queenLines(anchor)) highlights.push({ square: sq, color: C.queenLine });
    for (const seg of queenLineSegments(anchor)) lines.push({ ...seg, color: C.queenLine });
    return { highlights, lines };
  }
  if (piece.type === 'knight' && onBoard) {
    const moves = knightMoves(piece.square!);
    for (const m of moves) if (!pieceAt(state, m.file, m.rank)) highlights.push({ square: m, color: C.move });
    if (it.hoverSquare && moves.some(m => sameSquare(m, it.hoverSquare!))) {
      for (const sq of attackTargets('knight', it.hoverSquare)) highlights.push({ square: sq, color: C.range });
    }
    return { highlights, lines };
  }
  highlights.push({ square: anchor, color: C.origin });
  for (const sq of attackTargets(piece.type, anchor)) highlights.push({ square: sq, color: C.range });
  return { highlights, lines };
}
