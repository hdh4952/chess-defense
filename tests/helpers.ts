import { CONFIG, enemyCount, enemyHp, enemyTraits, tierMultiplier } from '../src/config';
import { createEnemy } from '../src/core/enemy';
import { stepGame } from '../src/core/step';
import { recalcQueenBuffs } from '../src/core/buff';
import { moveOnBoard } from '../src/core/pieces';
import { enemySquare } from '../src/core/grid';
import { rankToTopY } from '../src/core/grid';
import { createInitialState } from '../src/core/state';
import type { Enemy, EnemyTrait, GameEvent, GameState, Phase, Piece, PieceType } from '../src/types';

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
    id: `bp-${seq++}`, type, square: { file, rank },
    cooldown: 0, queenBuffCount: 0, tier,
  };
}

export function waveState(): GameState {
  const s = createInitialState();
  s.phase = 'wave';
  return s;
}

// ---------------------------------------------------------------------------
// 회귀 신호 하네스 (S0). 개선 시리즈가 밸런스를 건드릴 때 무엇이 움직였는지 보기 위한 것.
//
// 왜 신설했는가 — 기존 두 신호로는 감시가 안 된다. §9.5의 "룩1/파일 = 누수 0" 대조군은
// 모든 적을 파일 하나로만 스폰시켜도 w16·w19 누수가 0이라 판별력이 없고(포화 신호),
// w5 게이트는 `killed === true` 하나뿐이라 200G짜리 기물이 통째로 빠져도 초록이다.
// 아래 헬퍼는 전부 **연속량**(총피해·처치 여부·draw 횟수)을 돌려줘 해상도를 갖는다.
// ---------------------------------------------------------------------------

const DT = 1 / 60;

/** rng draw 횟수를 세는 프록시. 난수 소비 지점이 하나라도 늘면 즉시 드러난다 —
 *  스폰 파일 추첨은 호출 "순서"에만 의존하므로, draw가 한 번 더 일어나면 헤드리스
 *  측정이 조용히 다른 것을 재게 된다. */
export function countingRng(inner: () => number): (() => number) & { count(): number } {
  let n = 0;
  const f = Object.assign(
    (): number => { n++; return inner(); },
    { count: () => n },
  );
  return f;
}

/** a~h 파일을 순환하는 결정론적 rng (기존 simulation.test.ts의 관용구) */
export function cycleRng(): () => number {
  let i = 0;
  return () => (i++ % CONFIG.board.files) / CONFIG.board.files;
}

/**
 * 적 1마리가 자기 파일을 종주하는 동안 build가 실제로 넣은 총 피해.
 *
 * 이 게임의 처치는 계단 함수다 — 종주 중 받는 총 피해가 적 체력을 넘으면 죽고, 못 넘으면
 * 그 피해는 **전량 폐기**된다(§1.3). 그래서 "누수 몇 마리"는 포화되기 쉬운 반면 이 값은
 * 화력·감산·속도 어느 축을 건드려도 선형으로 반응한다.
 */
export function transitDamage(
  wave: number, pieces: Piece[], spawnFile: number,
  traits: readonly EnemyTrait[] = [],
): number {
  const s = waveState();
  s.hp = Number.MAX_SAFE_INTEGER;          // 누수로 게임이 끝나 측정이 잘리지 않게
  s.wave = wave;
  s.spawnedCount = enemyCount(wave);       // updateSpawning이 더 스폰하지 않도록
  s.pieces.push(...pieces);
  recalcQueenBuffs(s);   // 직접 push하는 경로는 재계산 책임을 스스로 진다 (기획안 §4.7)
  const e = createEnemy(wave, spawnFile, false, 'transit', traits);
  s.enemies.push(e);
  const maxHp = e.maxHp;
  let minHp = maxHp;
  let killed = false;
  const ev: GameEvent[] = [];
  for (let t = 0; t < 120 && !killed && s.enemies.length > 0; t += DT) {
    stepGame(s, DT, ev, () => 0);
    for (const x of ev) if (x.kind === 'enemyDied' && x.enemyId === 'transit') killed = true;
    ev.length = 0;
    const alive = s.enemies.find(x => x.id === 'transit');
    if (alive) minHp = Math.min(minHp, alive.hp);
  }
  return killed ? maxHp : maxHp - minHp;
}

/**
 * 보스 1마리를 지정 파일에 스폰해 종주 전 구간을 실제 엔진으로 돌린다.
 * 이 시리즈의 난이도 축이 일반 웨이브가 아니라 보스라는 실측 때문에 신설했다 — 일반 웨이브
 * 누수는 룩 2기/파일 이상에서 포화되지만, 보스 처치 여부는 화력에 선형으로 반응한다.
 */
export function bossTransit(
  wave: number, spawnFile: number, pieces: Piece[],
): { dealt: number; killed: boolean; killT: number } {
  const s = waveState();
  s.hp = Number.MAX_SAFE_INTEGER;
  s.wave = wave;
  s.spawnedCount = enemyCount(wave);
  s.pieces.push(...pieces);
  recalcQueenBuffs(s);   // 없으면 퀸 12기가 통째로 놀고 보스 화력이 실제의 절반 아래가 된다
  // 실제 스폰 경로(wave.ts)와 같은 유형을 붙인다. 안 붙이면 이 신호가 적 유형 단계에
  // 통째로 눈이 먼다 — 실제로 그렇게 만들었다가 8/8이 안 움직여서 알아챘다.
  const boss = createEnemy(wave, spawnFile, true, 'boss', enemyTraits(wave, 0, true));
  s.enemies.push(boss);
  const maxHp = boss.maxHp;
  let minHp = maxHp;
  let killed = false;
  let killT = -1;
  const ev: GameEvent[] = [];
  for (let t = 0; t < 200 && !killed && s.enemies.length > 0; t += DT) {
    stepGame(s, DT, ev, () => 0);
    for (const x of ev) if (x.kind === 'enemyDied' && x.isBoss) { killed = true; killT = t; }
    ev.length = 0;
    const alive = s.enemies.find(x => x.id === 'boss');
    if (alive) minHp = Math.min(minHp, alive.hp);
  }
  return { dealt: killed ? maxHp : maxHp - minHp, killed, killT };
}

/**
 * 최소 승리 빌드 — 룩 16기(2기/파일, 랭크 1·2) + 퀸 12기(랭크 3 전체 + 랭크 4 중앙 4칸).
 * 비용은 CONFIG에서 유도한다(하드코딩 금지). 배치는 이 함수가 유일한 출처이므로, 신호가
 * 흔들리면 수치가 아니라 이 배치가 바뀐 것인지부터 확인할 것.
 */
export function minWinBuild(): Piece[] {
  const out: Piece[] = [];
  for (let f = 0; f < CONFIG.board.files; f++) {
    out.push(boardPiece('rook', f, 1), boardPiece('rook', f, 2));
  }
  for (let f = 0; f < CONFIG.board.files; f++) out.push(boardPiece('queen', f, 3));
  for (let f = 2; f <= 5; f++) out.push(boardPiece('queen', f, 4));
  return out;
}

export function buildCost(pieces: Piece[]): number {
  return pieces.reduce((sum, p) => sum + CONFIG.pieces[p.type].cost * tierMultiplier(p.tier), 0);
}

export interface RunReport {
  phase: GameState['phase']; kills: number; leaks: number; bossLeaks: number;
  gold: number; earned: number; seconds: number;
  // ── 아래 다섯은 N1b·N5 전용이다(구현 계획서 §S0의 신호 표). S5에서 만들기로 했다가
  //    끝내 구현되지 않았고, 그 사이 v1.12가 지급 기물을 보드에 직접 스폰하도록 바꾸면서
  //    **정확히 이 신호가 감시하려던 축이 크게 움직였다.** 뒤늦게라도 눈을 단다.
  /** 한 판 동안 관측된 최대 보유 골드. N1b의 첫 항. */
  peakGold: number;
  /** 지급받은 기물 수 (환급된 것은 제외 — 실제로 판에 놓인 것만). */
  granted: number;
  /** 지급 기물의 **원가 합**. 무상으로 얻은 구매력이라 N1b의 둘째 항이다. */
  grantedValue: number;
  /** 자리가 없어 폐기된 지급 횟수. **이것이 N5다.** */
  discarded: number;
  /** 폐기 환급의 골드 합. discarded가 0이면 이 값도 0이고, 그때 환급 경로는 죽은 코드다. */
  refunded: number;
  /** 각 웨이브 **시작 시점**의 보유 골드(index 0 = w1). 계획서 §6이 N1b의 목표를
   *  "w5 시작 전 ≤ 3,000G"로 적었으므로 웨이브별 스냅샷이 필요하다. */
  goldAtWaveStart: number[];
}

/** 20웨이브 완주 풀런. 엔진 무결성 확인용 — rng를 감시하지는 못한다(대칭 빌드에서는
 *  스폰 파일이 결과에 영향을 주지 않는다). rng 감시는 countingRng가 담당한다. */
export function fullRun(
  pieces: Piece[], rng: () => number, grantRng: () => number = Math.random,
): RunReport {
  const s = createInitialState();
  // 체력을 무한대로 둔다 — 여기서 보려는 것은 "이 빌드가 이기는가"가 아니라 20웨이브가 끝까지
  // 정상 진행되는가(엔진 무결성)이고, 누수는 체력이 아니라 이벤트로 직접 센다.
  s.hp = Number.MAX_SAFE_INTEGER;
  s.pieces.push(...pieces);
  recalcQueenBuffs(s);
  const ev: GameEvent[] = [];
  let leaks = 0, bossLeaks = 0, t = 0;
  let peakGold = s.gold, granted = 0, grantedValue = 0, discarded = 0, refunded = 0;
  const goldAtWaveStart: number[] = [];
  let seenWave = 0;
  for (; t < 3000 && s.phase !== 'victory' && s.phase !== 'defeat'; t += DT) {
    // 웨이브가 넘어가는 순간의 보유 골드를 찍는다. checkWaveEnd가 보너스를 주고 wave를
    // 올린 **직후**가 곧 "다음 웨이브 시작 시점"이므로, stepGame 뒤에 번호 변화로 잡는다.
    if (s.wave !== seenWave) { seenWave = s.wave; goldAtWaveStart[s.wave - 1] = s.gold; }
    stepGame(s, DT, ev, rng, grantRng);
    for (const x of ev) {
      if (x.kind === 'enemyLeaked') { leaks++; if (x.isBoss) bossLeaks++; }
      // 구매는 이 하네스에 없으므로 pieceSpawned는 전부 지급이다 — 그래도 bought를 확인해
      // 나중에 구매 경로가 들어와도 이 집계가 조용히 오염되지 않게 한다.
      else if (x.kind === 'pieceSpawned' && !x.bought) {
        granted++;
        grantedValue += CONFIG.pieces[x.pieceType].cost;
      } else if (x.kind === 'grantDiscarded') { discarded++; refunded += x.refund; }
    }
    ev.length = 0;
    if (s.gold > peakGold) peakGold = s.gold;
  }
  return {
    phase: s.phase, kills: s.stats.totalKills, leaks, bossLeaks,
    gold: s.gold, earned: s.stats.totalGoldEarned, seconds: t,
    peakGold, granted, grantedValue, discarded, refunded, goldAtWaveStart,
  };
}

/** N6/N8 전용 대조 빌드 — 퀸 없이 룩 2기/파일. 퀸이 없으므로 보스를 못 잡고, 그 사실이
 *  "보스 3/4 처치가 사실상의 두 번째 패배 조건"이라는 이 시리즈의 전제를 그대로 드러낸다. */
export function rooksTwoPerFile(): Piece[] {
  const out: Piece[] = [];
  for (let f = 0; f < CONFIG.board.files; f++) {
    out.push(boardPiece('rook', f, 1), boardPiece('rook', f, 2));
  }
  return out;
}

// --- simulation.test.ts에서 이관 (본문 무변경). 두 스위트가 같은 하네스를 쓰지 않으면
// --- 기준선이 조용히 갈라진다.
export function bossHpFor(wave: number): number {
  return enemyHp(wave) * CONFIG.enemy.bossHpMultiplier;
}

/**
 * 웨이브5 보스를 향해 chasePieces를 "보스 바로 아랫랭크"로 계속 따라 붙이며(완벽 추격)
 * staticPieces(고정 기물)와 함께 실측한다. 보스 파일과 비인접한 폰을 chasePieces에 넣으면
 * 추격을 시도해도 실제로는 전혀 명중하지 못하는 것까지 그대로 측정된다(리뷰 파인딩 1).
 * bossHp/dealt 모두 config에서 유도한다 — 하드코딩 금지(리뷰 파인딩 2).
 */
export function chaseWave5Boss(
  chasePieces: Piece[], staticPieces: Piece[] = [],
): { dealt: number; killed: boolean; hp: number; wave: number; bossHp: number; bossSpawnT: number; bossKillT: number } {
  const s = createInitialState();
  s.wave = 5;
  const bossFile = 3;
  s.pieces.push(...chasePieces, ...staticPieces);
  s.phase = 'prepare';
  s.prepareTimer = 0.01;
  const bossHp = bossHpFor(5);
  let bossMinHp = bossHp;
  let bossSpawnT = -1;
  let bossKillT = -1;
  const ev: GameEvent[] = [];
  for (let t = 0; t < 120 && s.wave === 5 && (s.phase as Phase) !== 'defeat'; t += DT) {
    stepGame(s, DT, ev, () => bossFile / 8);
    for (const e of ev) {
      if (e.kind === 'bossSpawned' && bossSpawnT < 0) bossSpawnT = t;
      // 실제 '처치' 이벤트로만 킬 시각을 잡는다 — 보스가 사라진 시각(누수 포함)을 킬 시각으로
      // 오인하던 예전 로직을 교체 (리뷰 파인딩 5 마지막 항목).
      if (e.kind === 'enemyDied' && e.isBoss && bossKillT < 0) bossKillT = t;
    }
    ev.length = 0;
    const boss = s.enemies.find(e => e.isBoss);
    if (boss) {
      bossMinHp = Math.min(bossMinHp, boss.hp);
      const wantRank = enemySquare(boss).rank - 1;     // 보스 바로 아랫랭크로 폰 유지 (완벽 추격)
      for (const p of chasePieces) {
        if (p.square && p.square.rank !== wantRank && wantRank >= 1) {
          moveOnBoard(s, p.id, p.square.file, wantRank, []);
        }
      }
    }
  }
  const killed = s.stats.totalKills === 1;
  const dealt = killed ? bossHp : bossHp - bossMinHp;
  return { dealt, killed, hp: s.hp, wave: s.wave, bossHp, bossSpawnT, bossKillT };
}
