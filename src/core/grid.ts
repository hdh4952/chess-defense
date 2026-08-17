import { CONFIG } from '../config';
import type { Square } from '../types';

const SQ = CONFIG.board.squarePx;

export const BOARD_W = CONFIG.board.files * SQ;
export const BOARD_H = CONFIG.board.ranks * SQ;

/** rank r 칸의 상단 y (rank 8 = 최상단 행) */
export function rankToTopY(rank: number): number {
  return (CONFIG.board.ranks - rank) * SQ;
}

/** 세로 픽셀 → 랭크. 보드 밖은 가장자리 랭크로 클램프 */
export function yToRank(y: number): number {
  const row = Math.min(CONFIG.board.ranks - 1, Math.max(0, Math.floor(y / SQ)));
  return CONFIG.board.ranks - row;
}

export function fileCenterX(file: number): number {
  return file * SQ + SQ / 2;
}

export function inBoard(file: number, rank: number): boolean {
  return file >= 0 && file < CONFIG.board.files && rank >= 1 && rank <= CONFIG.board.ranks;
}

/** 적의 현재 칸 = 중심 좌표가 속한 칸 (스펙 2.2) */
export function enemySquare(e: { file: number; y: number }): Square {
  return { file: e.file, rank: yToRank(e.y) };
}

export function sameSquare(a: Square, b: Square): boolean {
  return a.file === b.file && a.rank === b.rank;
}

/**
 * 칸의 집합 키. Set/Map에 칸을 넣을 때 쓴다 — Square는 객체라 값이 같아도 참조가 달라
 * `Set<Square>`는 중복을 걸러내지 못한다.
 *
 * 감속 오라(core/slow.ts)에서 이것이 **중첩 금지의 구조적 보증**이다: 나이트 셋이 같은 칸을
 * 덮어도 키가 하나라 원소가 하나뿐이고, 그래서 규칙(감속 판정)도 그림(칸 칠하기)도 중첩을
 * 만들 방법이 없다. 여러 곳에서 같은 문자열 조립을 반복하지 않도록 여기 한 번만 둔다.
 */
export function squareKey(sq: Square): string {
  return `${sq.file},${sq.rank}`;
}

export function fileLabel(file: number): string {
  return 'abcdefgh'[file];
}
