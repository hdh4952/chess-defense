import { CONFIG } from '../config';
import type { GameState, Piece } from '../types';

/**
 * 시작 폰 배치 (v1.16). 가챠만으로 기물을 얻게 되면서 빈손으로는 w1을 넘길 수 없다.
 *
 * ★ **난수를 쓰지 않는다.** createInitialState는 이 저장소의 모든 헤드리스 측정이 부르는
 * 순수 함수이고, 여기에 난수가 들어오면 모든 기준선이 판마다 흔들린다. 판마다 다른 것은
 * 가챠가 만들면 충분하다 — 시작점은 고정이어야 비교가 성립한다.
 *
 * 파일은 **균등 분할**로 유도한다(8파일에 3기 → 1·4·7). 폰은 자기 파일이 아니라 전방
 * 대각선 두 칸을 때리므로, 몰아 두면 같은 파일을 두 번 덮고 나머지가 비어 버린다.
 * 랭크 1에 두는 이유는 폰이 rank+1만 때려서 어느 랭크에 있든 총 타격 수가 같기 때문이고
 * (적은 그 한 랭크를 반드시 지나간다), 그렇다면 가장 뒤가 "시작선"으로 읽힌다.
 */
function startingPawns(): Piece[] {
  const n = CONFIG.player.startPawns;
  const { files } = CONFIG.board;
  return Array.from({ length: n }, (_, i) => ({
    id: `start-${i}`,
    type: 'pawn' as const,
    square: { file: Math.min(files - 1, Math.round((i + 0.5) * files / n)), rank: 1 },
    cooldown: 0,
    queenBuffCount: 0,
    tier: 1,
  }));
}

export function createInitialState(): GameState {
  return {
    hp: CONFIG.player.startHp,
    gold: CONFIG.player.startGold,
    wave: 1,
    phase: 'prepare',
    prepareTimer: CONFIG.wave.prepareSeconds,
    spawnTimer: 0,
    spawnedCount: 0,
    killedThisWave: 0,
    speedMultiplier: 1,
    paused: false,
    pieces: startingPawns(),
    enemies: [],
    stats: { totalKills: 0, totalGoldEarned: 0 },
  };
}
