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
  /**
   * 강화 단계(레벨). 구매 직후 1이고, **같은 종류·같은 티어**끼리 합성하면 1 오른다
   * (상한 CONFIG.merge.maxTier). 흡수한 개수가 아니라 레벨이므로 T2+T2는 4가 아니라 3이다.
   * 실제 능력치 배수는 tierMultiplier(tier) = 2^(tier−1)이고, 공격력·비숍 골드·퀸 버프·
   * 판매가가 전부 그 배수를 탄다 (combat.ts / buff.ts / economy.ts).
   */
  tier: number;
}

/**
 * 적 유형. 스폰 시 확정되고 이후 바뀌지 않는다 — "정체성"이지 상태가 아니다.
 * 상태(남은 보호막)는 Enemy.shieldPool이 따로 들고 있다.
 */
export type EnemyTrait = 'armored' | 'swift' | 'shielded';

export interface Enemy {
  id: string;
  file: number;       // 스폰 파일 고정
  y: number;          // 픽셀 단위 세로 위치 (0 = 보드 상단, 연속값)
  hp: number;
  maxHp: number;      // = 처치 보상 골드
  isBoss: boolean;
  speed: number;      // px/s. 영구 배수(보스 감속·신속)는 여기 구워 넣는다
  jitterX: number;    // 렌더 전용
  traits: readonly EnemyTrait[];   // 스폰 시 확정, 이후 불변
  /** 남은 흡수 피해량. **횟수가 아니라 피해량**이다 — 횟수로 세면 합성이 피격 수를 절반으로
   *  줄이므로 "T1 둘 = T2 하나"라는 골드 중립성이 깨진다(실측 −23%). */
  shieldPool: number;
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
  /** 이번 웨이브에서 처치한 적 수. 클리어 보너스의 처치율 연동에 쓴다 — stats.totalKills는
   *  게임 전체 누적이라 웨이브별로는 쓸 수 없고, 웨이브별 누수 카운터도 따로 없다. */
  killedThisWave: number;
  speedMultiplier: 1 | 2;
  paused: boolean;
  pieces: Piece[];
  enemies: Enemy[];
  stats: GameStats;
}

/** 코어 → 렌더/UI 단방향 알림. 매 프레임 소비 후 비운다. */
export type GameEvent =
  | { kind: 'attack'; pieceType: PieceType; from: Square; targets: Square[] }
  // 공격이 골드를 낳았을 때만(= CONFIG.pieces[type].goldPerAttack > 0) attack 바로 뒤에 따라온다.
  // square는 골드를 번 기물의 칸 — 렌더가 그 자리에 "+10G"를 띄운다.
  | { kind: 'goldGained'; square: Square; amount: number }
  | { kind: 'knightBlast'; square: Square }
  // 합성 성사 — square는 생존한 기물(합쳐진 결과)이 서 있는 칸, tier는 합성 *후* 단계다.
  | { kind: 'merged'; square: Square; pieceType: PieceType; tier: number }
  | { kind: 'enemyDied'; enemyId: string; square: Square; isBoss: boolean; reward: number }
  | { kind: 'enemyLeaked'; enemyId: string; file: number; isBoss: boolean }
  | { kind: 'bossSpawned'; file: number }
  | { kind: 'waveCleared'; wave: number }
  | { kind: 'prepareStarted'; wave: number; isBossWave: boolean };

/**
 * 드래그/클릭 선택/hover 상호작용 상태 — DOM 이벤트 자체가 아니라 뷰모델이므로 core에 속하지는
 * 않지만, render/(highlights.ts)와 ui/(drag.ts, tooltip.ts) 양쪽이 함께 참조해야 한다. 원래
 * ui/drag.ts에 있었으나, 그러면 render/가 ui/의 타입에 의존하는 동시에 ui/도 render/에 의존하는
 * 역방향 계층 구조가 된다 (검토 Item 8). ui/drag.ts(DragController)가 소유·갱신하고,
 * render/highlights.ts와 ui/tooltip.ts는 읽기 전용으로 참조한다.
 */
export interface Interaction {
  dragging: { pieceId: string; from: 'slot' | 'board' } | null;
  selectedPieceId: string | null;
  hoverSquare: Square | null;
}
