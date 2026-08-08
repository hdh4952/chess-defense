import { CONFIG } from '../src/config';
import { createEnemy } from '../src/core/enemy';
import { rankToTopY } from '../src/core/grid';
import { createInitialState } from '../src/core/state';
import type { Enemy, GameState, Piece, PieceType } from '../src/types';

let seq = 0;

/** 특정 칸 중앙에 정지해 있는 적 (테스트에서는 moveEnemies를 호출하지 않는 한 안 움직임) */
export function enemyAt(wave: number, file: number, rank: number, isBoss = false, id?: string): Enemy {
  const e = createEnemy(wave, file, isBoss, id ?? `t-${seq++}`);
  e.y = rankToTopY(rank) + CONFIG.board.squarePx / 2;
  return e;
}

export function boardPiece(type: PieceType, file: number, rank: number): Piece {
  return {
    id: `bp-${seq++}`, type, square: { file, rank }, slotIndex: null,
    cooldown: 0, queenBuffCount: 0,
  };
}

export function waveState(): GameState {
  const s = createInitialState();
  s.phase = 'wave';
  return s;
}
