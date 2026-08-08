export type PieceType = 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen';

/** file 0(a)~7(h), rank 1~8 */
export interface Square { file: number; rank: number }

export interface Piece {
  id: string;              // 쿨다운은 이 ID 기준으로 유지된다
  type: PieceType;
  square: Square | null;   // null = 슬롯
  slotIndex: number | null;
  cooldown: number;        // 초. 이동/회수해도 초기화되지 않음
  queenBuffCount: number;
}

export interface Enemy {
  id: string;
  file: number;       // 스폰 파일 고정
  y: number;          // 픽셀 단위 세로 위치 (0 = 보드 상단, 연속값)
  hp: number;
  maxHp: number;      // = 처치 보상 골드
  isBoss: boolean;
  speed: number;      // px/s
  jitterX: number;    // 렌더 전용
}

export type Phase = 'prepare' | 'wave' | 'victory' | 'defeat';

export interface GameStats { totalKills: number; totalGoldEarned: number }

export interface GameState {
  hp: number;
  gold: number;
  wave: number;              // 1..20
  phase: Phase;
  prepareTimer: number;
  spawnTimer: number;
  spawnedCount: number;
  speedMultiplier: 1 | 2;
  paused: boolean;
  pieces: Piece[];
  enemies: Enemy[];
  stats: GameStats;
}

/** 코어 → 렌더/UI 단방향 알림. 매 프레임 소비 후 비운다. */
export type GameEvent =
  | { kind: 'attack'; pieceType: PieceType; from: Square; targets: Square[] }
  | { kind: 'knightBlast'; square: Square }
  | { kind: 'enemyDied'; enemyId: string; square: Square; isBoss: boolean; reward: number }
  | { kind: 'enemyLeaked'; enemyId: string; file: number; isBoss: boolean }
  | { kind: 'bossSpawned'; file: number }
  | { kind: 'waveCleared'; wave: number }
  | { kind: 'prepareStarted'; wave: number; isBossWave: boolean };
