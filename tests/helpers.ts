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

/** tier는 선택 인자다 — 149개 기존 호출부는 기본값 1(구매 직후 상태)로 그대로 동작하고,
 *  합성 테스트만 강화된 기물을 직접 만들 수 있다. */
export function boardPiece(type: PieceType, file: number, rank: number, tier = 1): Piece {
  return {
    id: `bp-${seq++}`, type, square: { file, rank }, slotIndex: null,
    cooldown: 0, queenBuffCount: 0, tier,
  };
}

export function waveState(): GameState {
  const s = createInitialState();
  s.phase = 'wave';
  return s;
}
