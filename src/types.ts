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
export type EnemyTrait =
  | 'armored'    // 공격력이 문턱 미만이면 피해 0 (v1.14 — 예전에는 피해 ×0.625)
  | 'swift'      // 속도 ×2.0 = 1.5초/칸 (v1.14 — 예전에는 ×1.5)
  | 'shielded'   // 전방(낮은 랭크) 피해 무시 (v1.14 — 예전에는 흡수 풀)
  | 'splitter'   // 사망 시 인접 파일로 분열 (v1.14 신설)
  | 'aura';      // 주변 적의 유효 체력 +N (v1.14 신설)

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
  /*
   * ⚠️ v1.14에서 shieldPool(흡수 피해량 풀)이 사라졌다. 실드형이 "흡수 풀"에서 "전방 피해
   * 무시"로 재정의되면서(사용자 결정) 상태로 들고 있을 값이 없어졌다 — 방향 판정은 공격자
   * 위치와 적 위치만으로 매번 결정되므로 순수 함수다.
   *
   * 그 풀은 원래 "횟수가 아니라 피해량"이어야 했다(횟수로 세면 합성이 피격 수를 절반으로
   * 줄여 골드 중립성이 −23% 깨진다). 흡수 방식을 되살릴 일이 있으면 그 함정을 다시 볼 것.
   */
  /**
   * 지금 이 적을 감속시키고 있는 기물의 **티어** — 0이면 감속 없음(core/slow.ts의 NO_SLOW).
   * 매 틱 재계산되는 **파생 상태**이고, traits와 달리 정체성이 아니다 — 적이 칸을 벗어나면
   * 즉시 0으로 돌아온다.
   *
   * ★ **배수가 아니라 티어를 담는 것이 중첩 금지 규칙 그 자체다.** v1.12까지는 boolean이었고
   * 그것이 "티어 무관"을 강제했다(사용자 결정). v1.13에서 티어별 세기가 생겨 boolean으로는
   * 표현할 수 없게 됐지만, **배수(0.70 / 0.65 …) 대신 티어를 담는다**는 선택이 같은 역할을
   * 이어받는다: 티어 둘을 곱하는 코드는 의미조차 없으므로 실수로 중첩시킬 방법이 없다.
   * 여러 기물이 겹치면 **가장 높은 티어 하나**가 이긴다(slowCoverage).
   */
  slowTier: number;
  /**
   * 오라형이 이 적에게 얹어 주는 **추가 유효 체력** — 0이면 오라 밖이다 (v1.14).
   * 매 틱 재계산되는 파생 상태다(core/aura.ts).
   *
   * ★ **hp를 직접 올리지 않는 것이 규칙 그 자체다.** hp를 올리면 오라가 죽을 때 그 체력을
   * 어떻게 되돌릴지가 문제가 되고(깎을 것인가? 그러면 이미 넣은 피해는 어디로?), 무엇보다
   * maxHp가 처치 보상 골드라서 체력을 올리면 **골드가 늘어난다.** 별도 필드로 두면 보상은
   * maxHp 그대로이고, 사망 판정만 `hp + auraBonus <= 0`으로 바뀐다.
   *
   * ★ 그 결과 **피해가 낭비되지 않는다.** hp는 음수로 내려갈 수 있고, 오라가 죽어 bonus가
   * 0이 되는 순간 적립된 음수가 한꺼번에 사망으로 바뀐다 — "오라를 먼저 죽일 것인가,
   * 그냥 뚫을 것인가"가 둘 다 성립하는 선택이 되는 이유다.
   */
  auraBonus: number;
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
   * 매 틱 "느린 상태"를 알리지 않고 **세지는 순간만** 알리는 것이 규칙의 반영이다: 이미
   * 같거나 더 센 감속을 받고 있는 적이 다른 오라로 넘어갈 때는 아무 일도 일어나지 않으므로
   * (중첩 없음 — 최댓값 하나만 적용된다) 이 이벤트도 나지 않는다. 반대로 T1 오라에서 T3
   * 오라로 넘어가는 것은 실제로 일어난 일이라 알린다.
   *
   * `tier`는 그 순간 적용된 티어다 — 화면이 "−30%"인지 "−40%"인지를 이 값에서 유도한다.
   *
   * y가 칸이 아니라 픽셀인 이유: 적은 칸 사이를 연속으로 움직이므로 칸 중심에 라벨을 띄우면
   * 실제 위치와 최대 40px 어긋난다.
   */
  | { kind: 'enemySlowed'; enemyId: string; file: number; y: number; tier: number }
  // 합성 성사 — square는 생존한 기물(합쳐진 결과)이 서 있는 칸, tier는 합성 *후* 단계다.
  | { kind: 'merged'; square: Square; pieceType: PieceType; tier: number }
  /**
   * 적이 피해 판정을 한 번 받았다 (v1.15). **피해가 0이어도 발행된다** — 그것이 이 이벤트의
   * 절반이다: 장갑형 문턱에 막혔는지(`blocked`) 화면이 말해 주지 않으면 플레이어는 폰이
   * 왜 아무것도 못 하는지 알 수 없다.
   *
   * 좌표가 칸이 아니라 픽셀(file + y)인 이유는 enemySlowed와 같다 — 적은 칸 사이를 연속으로
   * 움직이므로 칸 중심에 숫자를 띄우면 실제 위치와 최대 40px 어긋난다.
   *
   * ⚠️ 발행량이 이 이벤트만 다르다. 한 프레임에 기물 수 × 사거리 안 적 수만큼 나올 수 있으므로
   * 소비하는 쪽이 반드시 병합·상한을 걸어야 한다(render/effects.ts가 적별로 합친다).
   */
  | { kind: 'enemyHit'; enemyId: string; file: number; y: number; damage: number; blocked: boolean }
  | { kind: 'enemyDied'; enemyId: string; square: Square; isBoss: boolean; reward: number }
  /**
   * 분열형이 죽어 분열체가 태어났다 (v1.14). 같은 프레임의 enemyDied **바로 뒤**에 온다.
   * square는 부모가 죽은 칸 — 화면이 "여기서 갈라졌다"를 그 자리에 보여야 한다.
   */
  | { kind: 'enemySplit'; square: Square; count: number }
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
