/**
 * 아군 기물. 뒤 세 종(아치비숍·챈슬러·아마존)은 **융합으로만 얻는다** — 상점에 없고
 * 뽑기에도 나오지 않는다(TRAITS[·].purchasable = false).
 */
export type PieceType =
  | 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen'
  | 'archbishop' | 'chancellor' | 'amazon';

/** file 0(a)~7(h), rank 1~8 */
export interface Square { file: number; rank: number }

export interface Piece {
  id: string;              // 쿨다운은 이 ID 기준으로 유지된다
  type: PieceType;
  /**
   * ★ v1.12부터 **널이 아니다.** 기물 보관함(트레이)이 사라지면서 모든 기물이 항상 보드 위에
   * 있다 — 구매·지급 즉시 빈 칸에 무작위로 스폰된다(사용자 결정).
   *
   * 타입이 좁아진 것 자체가 이 변경의 핵심 이득이다. 예전에는 `square === null`(= 트레이에
   * 있음)을 확인하지 않고 쓴 코드가 조용히 틀린 답을 냈다 — 전투 루프·퀸 버프·감속 오라가
   * 전부 그 검사를 각자 들고 있었고, 새로 추가되는 코드는 그 검사를 빠뜨리기 쉬웠다.
   * 이제 컴파일러가 그 실수를 아예 표현할 수 없게 만든다.
   */
  square: Square;
  cooldown: number;        // 초. 이동해도 초기화되지 않음
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
  /**
   * 지금 감속 오라 안에 있는가 (v1.10). 매 틱 재계산되는 **파생 상태**이고, traits와 달리
   * 정체성이 아니다 — 적이 칸을 벗어나면 즉시 false로 돌아온다.
   *
   * ★ **boolean인 것이 중첩 금지 규칙 그 자체다.** 배수(0.7 / 0.49 …)를 담으면 언젠가
   * 누군가 곱하기 시작한다. 표현 가능한 값이 둘뿐이면 나이트가 몇 기든 결과가 같다는 것이
   * 타입 수준에서 보장되고, 배수는 CONFIG.slowAura 한 곳에만 산다.
   */
  slowed: boolean;
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
  /**
   * 적이 감속 오라에 **막 들어왔다** — false → true 전이에서만 발행한다 (v1.10).
   *
   * 매 틱 "느린 상태"를 알리지 않고 전이만 알리는 것이 규칙의 반영이다: 이미 감속된 적이
   * 다른 나이트의 범위로 넘어갈 때는 **아무 일도 일어나지 않으므로**(중첩 없음) 이 이벤트도
   * 나지 않는다. 즉 이 이벤트가 뜨는 횟수가 곧 실제로 일어난 감속의 횟수다.
   *
   * y가 칸이 아니라 픽셀인 이유: 적은 칸 사이를 연속으로 움직이므로 칸 중심에 라벨을 띄우면
   * 실제 위치와 최대 40px 어긋난다.
   */
  | { kind: 'enemySlowed'; enemyId: string; file: number; y: number }
  // 합성 성사 — square는 생존한 기물(합쳐진 결과)이 서 있는 칸, tier는 합성 *후* 단계다.
  | { kind: 'merged'; square: Square; pieceType: PieceType; tier: number }
  | { kind: 'enemyDied'; enemyId: string; square: Square; isBoss: boolean; reward: number }
  | { kind: 'enemyLeaked'; enemyId: string; file: number; isBoss: boolean }
  | { kind: 'bossSpawned'; file: number }
  | { kind: 'waveCleared'; wave: number }
  | { kind: 'prepareStarted'; wave: number; isBossWave: boolean }
  /**
   * 기물이 보드에 스폰됐다 — 구매(`bought: true`)와 무작위 지급(`false`) 둘 다 (v1.12).
   *
   * ★ `square`가 이 이벤트의 존재 이유다. 스폰 위치를 플레이어가 고르지 않으므로, **어디에
   * 생겼는지 화면이 말해 주지 않으면 56칸 중에서 직접 찾아야 한다.** 예전에는 트레이의 정해진
   * 칸에 들어와 찾을 필요가 없었다.
   */
  | { kind: 'pieceSpawned'; square: Square; pieceType: PieceType; bought: boolean }
  // 보드에 빈 칸이 없어 지급하지 못했다. 조용히 버리면 무음 실패가 하나 더 늘므로 환급하고 알린다.
  | { kind: 'grantDiscarded'; pieceType: PieceType; refund: number };

/**
 * 드래그/클릭 선택/hover 상호작용 상태 — DOM 이벤트 자체가 아니라 뷰모델이므로 core에 속하지는
 * 않지만, render/(highlights.ts)와 ui/(drag.ts, tooltip.ts) 양쪽이 함께 참조해야 한다. 원래
 * ui/drag.ts에 있었으나, 그러면 render/가 ui/의 타입에 의존하는 동시에 ui/도 render/에 의존하는
 * 역방향 계층 구조가 된다 (검토 Item 8). ui/drag.ts(DragController)가 소유·갱신하고,
 * render/highlights.ts와 ui/tooltip.ts는 읽기 전용으로 참조한다.
 */
export interface Interaction {
  /** 드래그 중인 기물. 출발지는 언제나 보드다 — v1.12에서 트레이가 사라져 `from`이 없어졌다. */
  dragging: { pieceId: string } | null;
  selectedPieceId: string | null;
  hoverSquare: Square | null;
}
