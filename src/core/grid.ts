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

export function fileLabel(file: number): string {
  return 'abcdefgh'[file];
}
