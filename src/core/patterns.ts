import { CONFIG, TRAITS } from '../config';
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

export function bishopTargets(sq: Square): Square[] {
  return [{ ...sq }, ...DIAG.flatMap(([df, dr]) => ray(sq, df, dr))];
}

export function rookTargets(sq: Square): Square[] {
  return [{ ...sq }, ...ORTHO.flatMap(([df, dr]) => ray(sq, df, dr))];
}

export function queenLines(sq: Square): Square[] {
  return [{ ...sq }, ...[...DIAG, ...ORTHO].flatMap(([df, dr]) => ray(sq, df, dr))];
}

/**
 * 주기 공격이 닿는 칸. **오직 공격 사거리다** — 다른 능력의 범위를 여기 섞지 말 것.
 *
 * ⚠️ v1.10 이전에는 'none'이 나이트에게 폭발 범위(3×3)를 돌려주는 폴백이 있었다. 사거리
 * 그림이 그 값을 빌려 쓰고 있었기 때문인데, 그 폴백 때문에 "공격력 0인 기물의 사거리"라는
 * 모순된 값이 화면에 주황색(=여기 있으면 맞는다)으로 칠해졌다. 감속으로 바뀌면서 그 거짓말이
 * 더 커졌으므로(나이트는 이제 정말로 아무 피해도 주지 않는다) 폴백을 걷어냈다 — 감속 범위를
 * 원하는 호출부는 slowTargets를 직접 부른다.
 */
export function attackTargets(type: PieceType, sq: Square): Square[] {
  switch (TRAITS[type].pattern) {
    case 'pawn': return pawnTargets(sq);
    case 'bishop': return bishopTargets(sq);
    case 'rook': return rookTargets(sq);
    case 'none': return [];
  }
}

const L_OFFSETS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]] as const;

/** 나이트 행마 도착 후보. 8랭크 금지 (스펙 5.3). 점유 검사는 pieces.ts 담당 */
export function knightMoves(sq: Square): Square[] {
  return L_OFFSETS
    .map(([df, dr]) => ({ file: sq.file + df, rank: sq.rank + dr }))
    .filter(s => inBoard(s.file, s.rank) && s.rank <= CONFIG.board.ranks - 1);
}

/**
 * 감속 오라가 덮는 칸 — L자 오프셋 8칸 중 보드 안쪽 (v1.10).
 *
 * ★ **knightMoves()와 반드시 다른 함수여야 한다.** 오프셋 표는 공유하지만 필터가 다르다:
 * 저쪽은 **착지 후보**라 8랭크(스폰 구역)를 빼고, 이쪽은 **능력 범위**라 8랭크를 포함한다
 * (사용자 결정). 적은 8랭크에서 스폰돼 내려오므로, 빼면 판에 들어오는 바로 그 지점에 감속
 * 구멍이 생기고 6랭크 나이트는 8칸 중 2칸을 잃는다.
 *
 * 한 함수에 플래그(`includeSpawnRank`)로 합치고 싶어지는데, 그러면 두 호출부 중 하나는
 * 언젠가 틀린 쪽을 고른다 — 기본값이 어느 쪽이든 잘못 고르는 쪽이 조용히 동작하기 때문이다.
 * 이름이 갈라져 있으면 "이동"과 "감속" 중 무엇을 원하는지 호출부가 매번 명시하게 된다.
 */
export function slowSquares(sq: Square): Square[] {
  return L_OFFSETS
    .map(([df, dr]) => ({ file: sq.file + df, rank: sq.rank + dr }))
    .filter(s => inBoard(s.file, s.rank));
}

/**
 * 이 기물이 감속시키는 칸. 능력이 없으면 빈 배열.
 *
 * 미리보기(render/highlights.ts·ui/titleScreen.ts)와 실제 규칙(core/slow.ts)이 **이 함수
 * 하나만** 부른다. 어느 한쪽이 L자 오프셋을 직접 펼치는 순간 8랭크 포함 여부가 갈라져,
 * "칠해졌는데 안 느려지는 칸"이 생긴다.
 */
export function slowTargets(type: PieceType, sq: Square): Square[] {
  return TRAITS[type].slow ? slowSquares(sq) : [];
}
