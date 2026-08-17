import { TRAITS } from '../config';
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

/**
 * 나이트 L자 오프셋 8방향.
 *
 * ⚠️ v1.11까지는 이 표를 **행마(knightMoves)와 감속(slowSquares)이 함께** 썼고, 둘은 필터가
 * 달랐다(행마는 8랭크 제외, 감속은 포함). 나이트의 L자 이동 제약이 사라지면서 행마 쪽
 * 소비자가 없어져, 지금 이 표를 읽는 것은 감속 하나뿐이다 — 즉 **L자는 이제 이동 규칙이
 * 아니라 능력 범위다.**
 */
const L_OFFSETS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]] as const;

/**
 * 감속 오라가 덮는 칸 — L자 오프셋 8칸 중 보드 안쪽 (v1.10).
 *
 * 필터가 `inBoard` **하나뿐이라는 것**이 규칙이다. 8랭크(적 스폰 구역)를 포함한다(사용자
 * 결정) — 적은 거기서 스폰돼 내려오므로, 빼면 판에 들어오는 바로 그 지점에 감속 구멍이
 * 생기고 6랭크 나이트는 8칸 중 2칸을 잃는다. 배치 금지 규칙(inLandableBounds, pieces.ts)을
 * 여기로 끌어오고 싶어지는 자리인데, **그 둘은 다른 축이다**: 저쪽은 "기물이 설 수 있는가",
 * 이쪽은 "능력이 닿는가"다.
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
