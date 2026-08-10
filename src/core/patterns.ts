import { CONFIG } from '../config';
import type { PieceType, Square } from '../types';
import { inBoard } from './grid';

const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** 한 방향으로 보드 끝까지. 기물/적 차단 없음 = 완전 관통 (스펙 5.4/5.5) */
function ray(sq: Square, df: number, dr: number): Square[] {
  const out: Square[] = [];
  let f = sq.file + df, r = sq.rank + dr;
  while (inBoard(f, r)) {
    out.push({ file: f, rank: r });
    f += df;
    r += dr;
  }
  return out;
}

export function pawnTargets(sq: Square): Square[] {
  return [
    { file: sq.file - 1, rank: sq.rank + 1 },
    { file: sq.file + 1, rank: sq.rank + 1 },
  ].filter(s => inBoard(s.file, s.rank));
}

export function knightBlastTargets(sq: Square): Square[] {
  const out: Square[] = [];
  for (let df = -1; df <= 1; df++)
    for (let dr = -1; dr <= 1; dr++)
      if (inBoard(sq.file + df, sq.rank + dr)) out.push({ file: sq.file + df, rank: sq.rank + dr });
  return out;
}

export function bishopTargets(sq: Square): Square[] {
  return [{ ...sq }, ...DIAG.flatMap(([df, dr]) => ray(sq, df, dr))];
}

export function rookTargets(sq: Square): Square[] {
  return [{ ...sq }, ...ORTHO.flatMap(([df, dr]) => ray(sq, df, dr))];
}

export function queenLines(sq: Square): Square[] {
  return [{ ...sq }, ...[...DIAG, ...ORTHO].flatMap(([df, dr]) => ray(sq, df, dr))];
}

export function attackTargets(type: PieceType, sq: Square): Square[] {
  switch (type) {
    case 'pawn': return pawnTargets(sq);
    case 'knight': return knightBlastTargets(sq);
    case 'bishop': return bishopTargets(sq);
    case 'rook': return rookTargets(sq);
    case 'queen': return [];
  }
}

const L_OFFSETS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]] as const;

/** 나이트 행마 도착 후보. 8랭크 금지 (스펙 5.3). 점유 검사는 pieces.ts 담당 */
export function knightMoves(sq: Square): Square[] {
  return L_OFFSETS
    .map(([df, dr]) => ({ file: sq.file + df, rank: sq.rank + dr }))
    .filter(s => inBoard(s.file, s.rank) && s.rank <= CONFIG.board.ranks - 1);
}
