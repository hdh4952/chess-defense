import { describe, expect, it } from 'vitest';
import { CONFIG, enemyCount, enemyHp } from '../src/config';
import { moveOnBoard } from '../src/core/pieces';
import { createInitialState } from '../src/core/state';
import { stepGame } from '../src/core/step';
import { BOARD_H, enemySquare } from '../src/core/grid';
import type { GameEvent, GameState, Phase, Piece } from '../src/types';
import { boardPiece } from './helpers';

const DT = 1 / 60;
const cycleRng = () => { let i = 0; return () => (i++ % 8) / 8; };   // a~h 순환 스폰

function run(s: GameState, seconds: number, rng: () => number, onTick?: () => void): void {
  const ev: GameEvent[] = [];
  for (let t = 0; t < seconds; t += DT) {
    if (s.phase === 'victory' || s.phase === 'defeat') return;
    stepGame(s, DT, ev, rng);
    ev.length = 0;
    onTick?.();
  }
}

function bossHpFor(wave: number): number {
  return enemyHp(wave) * CONFIG.enemy.bossHpMultiplier;
}

/**
 * 웨이브5 보스를 향해 chasePieces를 "보스 바로 아랫랭크"로 계속 따라 붙이며(완벽 추격)
 * staticPieces(고정 기물)와 함께 실측한다. 보스 파일과 비인접한 폰을 chasePieces에 넣으면
 * 추격을 시도해도 실제로는 전혀 명중하지 못하는 것까지 그대로 측정된다(리뷰 파인딩 1).
 * bossHp/dealt 모두 config에서 유도한다 — 하드코딩 금지(리뷰 파인딩 2).
 */
function chaseWave5Boss(
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

describe('전 게임 시뮬레이션', () => {
  it('웨이브 1: 폰 4개(b4/c4/f4/g4)가 8파일 전부 커버 — 무누수 클리어 (스펙 9.3)', () => {
    const s = createInitialState();
    // 폰 (f,r)은 (f±1, r+1) 공격 → b,c,f,g 배치로 a~h 전 파일 커버
    for (const file of [1, 2, 5, 6]) s.pieces.push(boardPiece('pawn', file, 4));
    // 브리핑 원안은 run(s, 60, ...)으로 60초 고정 실행이었으나, 실측 결과 웨이브1은 ~30초에
    // 클리어되고 웨이브2 준비(10초) 후 첫 웨이브2 스폰이 ~40초, 첫 처치가 ~51초에 일어나
    // 60초 시점 총 처치는 10이 아니라 19(웨이브2 처치 9건 혼입)였다 — 밸런스 문제가 아니라
    // 테스트 종료 시점 선택의 문제. 웨이브 전환 순간 정지로 웨이브2 오염을 배제한다
    // ([리포트] 테스트가 이미 쓰는 `s.wave === N` 패턴과 동일).
    const rng = cycleRng();
    const ev: GameEvent[] = [];
    for (let t = 0; t < 90 && s.wave === 1; t += DT) {
      stepGame(s, DT, ev, rng);
      ev.length = 0;
    }
    expect(s.wave).toBe(2);
    expect(s.hp).toBe(CONFIG.player.startHp);
    expect(s.stats.totalKills).toBe(10);
  });

  it('풀런: 파일당 룩 2개면 일반 웨이브 전멸·보스 4회 누수로 승리 (엔진 무결성)', () => {
    const s = createInitialState();
    for (let f = 0; f < 8; f++) {
      s.pieces.push(boardPiece('rook', f, 1), boardPiece('rook', f, 2));
    }
    // 이 테스트가 보는 것은 엔진 무결성(전멸·누수·골드 정산이 20웨이브 내내 일관된가)이지 이
    // 빌드가 현재 밸런스에서 살아남는가가 아니다. 보스 누수 4회 = -20이라 startHp(10)로는 웨이브10
    // 에서 defeat로 끊겨 풀런 자체를 관측할 수 없으므로, 체력만 넉넉히 올려 20웨이브를 완주시킨다.
    s.hp = 100;
    // 룩 2개/파일(랭크 1·2에 8파일 전부) — 파일 커버만 보면 종주당 80이지만, 이 배치는 랭크 1과
    // 랭크 2를 8개 룩이 각각 전부 공유하므로(아래 확장 측정이 다루는 랭크 관통 시너지) 보스에게는
    // 실제로 그보다 훨씬 큰 피해(대략 300 안팎)를 준다. 그래도 최댓값 보스 체력(420~1770)에는
    // 못 미쳐 매 보스 웨이브 1회씩(총 4회) 누수한다. 일반 적 최댓값 체력은 웨이브19의 55이며
    // (웨이브20은 보스 전용이라 일반 적이 없다), 파일 커버 화력(80)만으로도 충분히 웃돌아 일반
    // 적은 전멸한다.
    run(s, 60 * 60, cycleRng());
    expect(s.phase).toBe('victory');
    expect(s.hp).toBe(100 - 4 * CONFIG.player.hpLossBoss);

    const bossWaveCount = Math.floor(CONFIG.wave.total / CONFIG.wave.bossEvery);
    const bossWaves = Array.from({ length: bossWaveCount }, (_, i) => (i + 1) * CONFIG.wave.bossEvery);
    const bossHpTotal = bossWaves.map(w => enemyHp(w) * CONFIG.enemy.bossHpMultiplier).reduce((a, b) => a + b, 0);
    let killGold = 0;
    let totalEnemies = 0;
    for (let w = 1; w <= CONFIG.wave.total; w++) {
      const isBoss = w % CONFIG.wave.bossEvery === 0;
      totalEnemies += enemyCount(w);
      killGold += enemyCount(w) * enemyHp(w) * (isBoss ? CONFIG.enemy.bossHpMultiplier : 1);
    }
    killGold -= bossHpTotal;                                  // 보스 4마리는 놓침(골드 미획득)

    // 452는 스펙이 명시한 20웨이브 전체 적 수 — config 유도치(enemyCount 합)와 별도로 스펙 표기
    // 자체가 여전히 맞는지 교차검증하려고 의도적으로 하드코딩해 둔다. 재조정 시 이 줄만 깨지는
    // 게 정상이며, 아래 실측 단언들은 totalEnemies(유도치)를 그대로 써서 재조정에 영향받지 않는다.
    expect(totalEnemies).toBe(452);
    expect(s.stats.totalKills).toBe(totalEnemies - bossWaves.length);
    expect(s.stats.totalGoldEarned).toBe(killGold + CONFIG.wave.clearBonus * CONFIG.wave.total);
  });

  it('20웨이브 보스 누수: 체력 6 이상이면 승리, 5 이하면 패배 우선 (스펙 3.1/10.5)', () => {
    // hp/maxHp/speed/y 모두 config에서 유도한다 — 예전에는 1470·80/6·639.9가 리터럴로 박혀 있어
    // (검토 Item 10) enemyHp/bossHpMultiplier나 보드 치수가 재조정되면 이 테스트가 실제 게임과
    // 조용히 어긋날 수 있었다. bossHpFor(20)와 이하 계산이 각각 1470/(80/6)과 정확히 같은 값으로
    // 나옴을 확인했다 — 유도 전후로 실측값의 차이는 없다.
    const bossHp = bossHpFor(20);
    const bossSpeed = (CONFIG.board.squarePx / CONFIG.enemy.secondsPerSquare) * CONFIG.enemy.bossSpeedMultiplier;
    for (const [hp, expected] of [[6, 'victory'], [5, 'defeat']] as const) {
      const s = createInitialState();
      s.wave = 20;
      s.hp = hp;
      s.phase = 'wave';
      s.spawnedCount = 1;                                // 보스 이미 스폰됨
      const boss = {
        id: 'b', file: 3, y: BOARD_H - 0.1, hp: bossHp, maxHp: bossHp, isBoss: true,
        speed: bossSpeed, jitterX: 0,
      };
      s.enemies.push(boss);
      run(s, 2, () => 0);
      expect(s.phase).toBe(expected);
    }
  });

  it('[리포트] 웨이브 5 보스 vs 완벽 폰 추격 — 스펙 9.4 실측 (검토 노트 1)', () => {
    const bossFile = 3;

    // (a) 폰 단독 추격(2개, 보스 파일 양옆) — 스펙 9.4가 주장하는 "추격 시 보스 피해"의 실측판
    const pawnsOnly = chaseWave5Boss([
      boardPiece('pawn', bossFile - 1, 7),
      boardPiece('pawn', bossFile + 1, 7),
    ]);

    // (b) 폰 3개 — (a)에 더해 보스 파일과 비인접한 파일(bossFile-2)에도 "추격" 폰을 추가한다.
    //     폰은 좌우 대각선 1칸만 공격하므로 보스가 있는 파일과 결코 인접할 수 없는 파일의 폰은,
    //     아무리 완벽히 같은 방식으로 추격을 흉내내도 명중할 수 없다 — 스펙 9.4 "폰 3개로 처치"를
    //     문자 그대로 재현해서 직접 반증한다(리뷰 파인딩 1).
    const threePawns = chaseWave5Boss([
      boardPiece('pawn', bossFile - 1, 7),
      boardPiece('pawn', bossFile + 1, 7),
      boardPiece('pawn', bossFile - 2, 7),
    ]);

    // (c) 룩 단독(보스 파일) / 비숍 단독(보스 경로 대각선) — 혼합 빌드 분석의 개별 기여도 실측.
    // 비숍은 (5,5)를 쓴다 — (4,4)는 우측 추격 폰의 경로 칸(파일4, 랭크1~7)과 겹쳐서, 점유 칸
    // 맞교환 도입(Change 2) 이후에는 추격 도중 실제로 스왑이 일어나 버린다(별도 "겹침 배치" 리포트
    // 참고). "개별 기여도"를 순수하게 재려면 애초에 다른 기물과 상호작용하지 않는 좌표가 필요하다.
    const rookOnly = chaseWave5Boss([], [boardPiece('rook', bossFile, 1)]);
    const bishopOnly = chaseWave5Boss([], [boardPiece('bishop', 5, 5)]);
    const additiveEstimate = pawnsOnly.dealt + rookOnly.dealt + bishopOnly.dealt;

    console.log(
      `[밸런스 리포트] 웨이브5 보스(${pawnsOnly.bossHp}) 개별 실측: 폰2추격 ${pawnsOnly.dealt} | ` +
      `폰3개째 추가 후 ${threePawns.dealt}(증가분 ${threePawns.dealt - pawnsOnly.dealt}) | ` +
      `룩단독(자기파일) ${rookOnly.dealt} | 비숍단독(대각선) ${bishopOnly.dealt} | 가산 추정 ${additiveEstimate}`,
    );
    console.log(
      `  → 3번째 폰의 실측 기여는 ${threePawns.dealt - pawnsOnly.dealt}(=0): 보스 파일과 비인접이라 ` +
      '완벽 추격을 흉내내도 결코 명중하지 못한다. 스펙 9.4의 "폰 3개로 처치"는 실측으로도 반증됨 ' +
      '(한 칸을 동시 타격할 수 있는 폰은 최대 2개). 9.5 플레이테스트 항목으로 이관.',
    );
    expect(threePawns.dealt).toBe(pawnsOnly.dealt);          // 3번째 폰의 기여는 정확히 0 — 재조정에도 불변인 기하학적 사실
    expect(pawnsOnly.dealt).toBeLessThan(pawnsOnly.bossHp);  // 폰만으로는 보스를 잡을 수 없다

    // (d) 브리핑 원안의 혼합 빌드(폰2 추격 + 룩 + 비숍) — 비숍을 (5,5)에 둬 추격 폰의 경로 칸과
    // 애초에 겹치지 않게 한다. staticPieces로 넘긴 룩·비숍이 시뮬레이션 도중 실제로 정적으로
    // 남아 있어야 이 측정이 "고정 지원 기물 + 추격 폰 2기"라는 이름값을 한다 — 겹치는 좌표
    // ((4,4))를 썼을 때 무슨 일이 일어나는지는 바로 아래 "겹침 배치" 리포트가 별도로, 정직하게
    // 다룬다(점유 칸 맞교환 도입 이후 결과 자체가 뒤바뀐 사례).
    const mixed = chaseWave5Boss(
      [boardPiece('pawn', bossFile - 1, 7), boardPiece('pawn', bossFile + 1, 7)],
      [boardPiece('rook', bossFile, 1), boardPiece('bishop', 5, 5)],
    );
    console.log(`[밸런스 리포트] 웨이브5 보스(${mixed.bossHp}): ${mixed.killed ? '처치 성공' : `누수 — 총 피해 ${mixed.dealt}`}`);
    // killed일 때 dealt는 정의상 bossHp로 클램프되므로(위 chaseWave5Boss의 `dealt = killed ? bossHp
    // : bossHp - bossMinHp`), additiveEstimate와의 차이를 "잃은 데미지"처럼 보도하면 안 된다 — 그건
    // 누수(killed:false)일 때만 실제 손실을 의미한다. killed일 때는 그 차이를 아예 로그하지 않는다.
    if (!mixed.killed) {
      console.log(
        `  → 가산 추정(${additiveEstimate}) 대비 실측(${mixed.dealt}) 차이 ${additiveEstimate - mixed.dealt} ` +
        '(누수 — 실제로 놓친 데미지).',
      );
    }
    // 엔진 검증 목적의 단언 (밸런스 수치 자체는 단언하지 않음)
    expect(mixed.wave).toBe(6);                              // 처치든 누수든 웨이브는 종료된다 (스펙 4.2)
    expect(mixed.hp).toBe(mixed.killed ? CONFIG.player.startHp : CONFIG.player.startHp - CONFIG.player.hpLossBoss);
    expect(mixed.dealt).toBeGreaterThan(300);                 // 추격 메커니즘이 실제로 동작했는지 하한 확인
    // 겹치지 않는 좌표에서는 실측상 처치까지 성공한다 (2026-08-14 실측: dealt 420 = bossHp, 가산
    // 추정 428과의 마진은 8 — 이게 이 프로젝트의 웨이브5 보스 밸런스 헤드라인 수치다).
    expect(mixed.killed).toBe(true);
  });

  it('[리포트] 겹침 배치(비숍이 추격 경로를 점유) — 실격이 아니라 맞교환되고, 처치 결과 자체가 뒤바뀐다 (Change 2 결과)', () => {
    // 브리핑 원안이 실제로 썼던 좌표는 비숍 (4,4)였다 — 우측 추격 폰(파일4)의 경로 칸(파일4,
    // 랭크1~7)과 정확히 겹친다. 점유 칸 맞교환(Change 2) 도입 *이전*(base 720cf71)에는
    // moveOnBoard가 이 칸에서 실패해 폰이 밴드 하나(6초=24데미지)를 놓쳤다 — 이 파일이 원래 갖고
    // 있던 주석과 리뷰어가 720cf71을 직접 체크아웃해 재현한 실측이 일치한다: dealt 404
    // (가산 추정 428 대비 -24), killed: false(누수). Change 2 도입 이후에는 그 실패가 성공(맞교환)
    // 으로 바뀌어 폰이 그 밴드를 놓치지 않고, 그 결과 처치 여부 자체가 누수 → 처치 성공으로
    // 뒤집힌다. 이건 우연한 숫자 일치가 아니라(이전 리포트가 잘못 결론 냈던 부분 — 초기 리포트는
    // 이 스크립트를 실행하지 않고 코드에 남아 있던 옛 주석 텍스트만 보고 "우연히 같다"고 오판했다)
    // 실제 게임플레이 결과가 바뀐 사례다.
    const bossFile = 3;
    const bishop = boardPiece('bishop', 4, 4);
    const collision = chaseWave5Boss(
      [boardPiece('pawn', bossFile - 1, 7), boardPiece('pawn', bossFile + 1, 7)],
      [boardPiece('rook', bossFile, 1), bishop],
    );
    // 맞교환이 실제로 일어났다는 직접 증거 — 비숍은 더 이상 원래 자리(4,4)에 없고, 폰의 이전
    // 자리(4,5)로 밀려나 있다 (t≈17.98s에 발생, 2026-08-14 실측).
    expect(bishop.square).toEqual({ file: 4, rank: 5 });
    console.log(
      `[밸런스 리포트] 겹침 배치(비숍 (4,4)) 실측: ${collision.killed ? '처치 성공' : `누수 — 총피해 ${collision.dealt}`} ` +
      `(맞교환으로 비숍이 (4,5)로 밀려남) — base(720cf71) 실측은 dealt 404 / 누수였다.`,
    );
    expect(collision.killed).toBe(true);              // base에서는 false였다 — 결과가 실제로 뒤집혔다
    expect(collision.dealt).toBe(collision.bossHp);   // killed 시 dealt는 정의상 bossHp로 클램프된다
  });
});

/**
 * Task 20 디스패치의 "승인된 조정 사항" — 브리핑 3단계(수동 플레이테스트)는 헤드리스로
 * 수행할 수 없으므로, 스펙 9.5의 질문 중 기계적으로 답할 수 있는 부분만 실측으로 이관한다.
 * 모든 밸런스 수치는 config.ts에서 유도한다 (하드코딩 금지, Task 20 디스패치 계약 5).
 */
describe('밸런스 확장 측정 — 후반 웨이브 & 보스 게이트 (Task 20 승인 확장)', () => {
  /** 무누수 진행 시 해당 웨이브 "시작 전"까지 벌 수 있는 이론적 골드 상한.
   *  방어 지출이 전혀 없다고 가정한 상한선이므로, 실제 가용 자금은 이보다 작다 — 비교용 캡. */
  function grossKillGold(uptoWaveExclusive: number): number {
    let g = 0;
    for (let w = 1; w < uptoWaveExclusive; w++) {
      const isBoss = w % CONFIG.wave.bossEvery === 0;
      g += enemyCount(w) * enemyHp(w) * (isBoss ? CONFIG.enemy.bossHpMultiplier : 1);
    }
    return g;
  }
  function goldCeilingBeforeWave(wave: number): number {
    return CONFIG.player.startGold + grossKillGold(wave) + CONFIG.wave.clearBonus * (wave - 1);
  }

  it('[리포트] 웨이브 5 보스 게이트 — 충돌 없는 배치 재측정 + 예산 대비 (스펙 9.5-4)', () => {
    const ceiling = goldCeilingBeforeWave(5);
    const bossHp = bossHpFor(5);
    const { pawn, rook, bishop } = CONFIG.pieces;
    const buildCost = 2 * pawn.cost + rook.cost + bishop.cost;
    const bossFile = 3;

    // 개별 기여도(충돌 없는 좌표로) — 실측 가산 상한(potentialDealt)과 실제 처치 시의 데미지
    // 여유(damageMargin)를 함께 계산하기 위함. 세 실측 모두 이 build와 같은 좌표를 쓴다.
    const pawnsOnly = chaseWave5Boss([
      boardPiece('pawn', bossFile - 1, 7), boardPiece('pawn', bossFile + 1, 7),
    ]);
    const rookOnly = chaseWave5Boss([], [boardPiece('rook', bossFile, 1)]);
    const bishopOnly = chaseWave5Boss([], [boardPiece('bishop', 5, 5)]);
    const potentialDealt = pawnsOnly.dealt + rookOnly.dealt + bishopOnly.dealt;

    const left = boardPiece('pawn', bossFile - 1, 7);
    const right = boardPiece('pawn', bossFile + 1, 7);
    // 비숍을 (5,5)에 둬 추격 폰의 경로 칸(파일 2/4, 랭크 1~7)과 애초에 겹치지 않게 한다 — 위
    // "웨이브 5 보스 vs 완벽 폰 추격" 리포트의 (d)와 같은 좌표다. 겹치는 좌표((4,4))를 썼을 때
    // 무슨 일이 일어나는지는 그 리포트 바로 다음의 "겹침 배치" 테스트가 별도로 다룬다(점유 칸
    // 맞교환 도입 이후 결과가 누수→처치 성공으로 뒤집힌 사례).
    const build = chaseWave5Boss([left, right], [boardPiece('rook', bossFile, 1), boardPiece('bishop', 5, 5)]);

    const descentSeconds = CONFIG.board.ranks * CONFIG.enemy.secondsPerSquare / CONFIG.enemy.bossSpeedMultiplier;
    const timeMargin = build.killed ? descentSeconds - (build.bossKillT - build.bossSpawnT) : null;
    const damageMargin = potentialDealt - bossHp;   // 시간 여유가 아니라 "체력 여유" — 실제 밸런스 마진

    console.log(
      `[밸런스 리포트-확장] 웨이브5 보스 게이트: 충돌 없는 빌드(폰2+룩1+비숍1, ${buildCost}G) → ` +
      `${build.killed
        ? `처치 성공 (경과 ${(build.bossKillT - build.bossSpawnT).toFixed(1)}s / 완주 ${descentSeconds}s, ` +
          `시간 여유 ${timeMargin!.toFixed(1)}s)`
        : `실패 — 총피해 ${build.dealt}/${bossHp}`}`,
    );
    console.log(
      `  → 가산 추정 피해 ${potentialDealt} vs 보스 체력 ${bossHp}: 데미지 마진 ${damageMargin}` +
      `(${((damageMargin / bossHp) * 100).toFixed(1)}%) — 위 시간 여유만 보면 널널해 보이지만(완주 대비 ` +
      '10%대), 실제 밸런스 여유는 데미지 기준으로 보면 훨씬 얇다.',
    );
    console.log(
      `  → 이 시점 이론상 골드 상한(무누수·방어비 0 가정, config 유도치) ${ceiling}G ≥ 빌드비용 ${buildCost}G — ` +
      '골드는 병목이 아니다. 병목은 기하학(칸당 동시 타격 폰 최대 2개)이며, 충돌 없이 배치하면 소폭의 마진으로 처치 가능하다.',
    );

    expect(buildCost).toBeLessThan(ceiling);      // 예산 관점: 이론 상한 내에서 충분히 감당 가능 (config 유도)
    expect(build.wave).toBe(6);
    expect(build.hp).toBe(CONFIG.player.startHp);  // 충돌 없이 배치하면 누수 없이 처치된다는 실측
    // 데미지 마진이 보스 체력의 몇 % 안팎(위 로그의 damageMargin)에 불과한 아슬아슬한 처치라,
    // 데미지·체력 관련 수치가 조금만 바뀌어도 이 단언은 깨질 수 있다 — 의도된 회귀 신호다
    // (스펙 9.4/9.5의 재조정 여지를 이 단언의 실패로 감지한다).
    expect(build.killed).toBe(true);
  });

  it('[리포트] 후반 웨이브(16~19) 무누수 방어선 실측 vs 누적 골드 상한 (스펙 9.5-3)', () => {
    const { rook } = CONFIG.pieces;
    const transitSeconds = CONFIG.board.ranks * CONFIG.enemy.secondsPerSquare;   // 24 (일반 적 완주 시간)
    const rookDps = rook.damage / rook.interval;

    // 진짜 고립된 룩 1개(다른 룩과 랭크를 절대 공유하지 않음) vs 웨이브19 최대 체력 적 —
    // "파일당 룩 1개면 충분한가"에 대한 순수 대조군. 파일 0에만 적을 스폰시켜 다른 파일 간섭을 배제한다.
    {
      const s = createInitialState();
      s.wave = 19; s.phase = 'wave'; s.spawnedCount = 0; s.spawnTimer = 0;
      s.pieces.push(boardPiece('rook', 0, 1));
      const ev: GameEvent[] = [];
      const hpBefore = s.hp;
      for (let t = 0; t < 150 && s.wave === 19 && (s.phase as Phase) !== 'defeat'; t += DT) {
        stepGame(s, DT, ev, () => 0);   // 파일 0에만 스폰
        ev.length = 0;
      }
      const isolatedLeaks = hpBefore - s.hp;
      const defeated = (s.phase as Phase) === 'defeat';
      console.log(
        `[밸런스 리포트-확장] 대조군 — 룩 1개가 다른 룩과 랭크를 공유하지 않을 때(파일0 전용, 웨이브19): ` +
        `누수 ${isolatedLeaks}회 / 처치 ${s.stats.totalKills}회` +
        (defeated
          ? ` — 체력(${CONFIG.player.startHp}) 소진으로 패배해 조기 종료됨: 이 수치는 "몇 마리가 ` +
            '샜는가"가 아니라 체력이 다 닳는 데 걸린 누수 횟수의 상한이다(46마리 전부가 실제로 샐 기회를 ' +
            '갖기 전에 게임이 끝났다는 뜻).'
          : '') +
        ` (완주 ${transitSeconds}s 동안 3초 간격 최대 8~9회 타격 = 40~45 < 체력 46 → 고립 상태에선 못 잡음).`,
      );
      // 순수 고립 상태에서는 반드시 누수가 나야 한다 — 아래 8파일 실측과의 대비를 위한 대조군 단언
      expect(isolatedLeaks).toBeGreaterThan(0);
    }

    for (const w of [16, 17, 18, 19]) {
      const ceiling = goldCeilingBeforeWave(w);
      const toughestHp = enemyHp(w);
      // 분석적 하한(고립 가정): 자기 파일만 커버하는 룩 dps로 완주 시간 내 최댓값 적을 잡는 데 필요한 개수
      const analyticMinRooksPerFile = Math.ceil(toughestHp / transitSeconds / rookDps);

      const trials: { cost: number; leaks: number; defeated: boolean }[] = [];
      for (const perFile of [1, 2]) {
        const s = createInitialState();
        s.wave = w;
        s.phase = 'wave';
        s.spawnedCount = 0;
        s.spawnTimer = 0;
        for (let f = 0; f < CONFIG.board.files; f++) {
          for (let k = 0; k < perFile; k++) s.pieces.push(boardPiece('rook', f, k + 1));
        }
        const rng = cycleRng();
        const ev: GameEvent[] = [];
        const hpBefore = s.hp;
        for (let t = 0; t < 150 && s.wave === w && (s.phase as Phase) !== 'defeat'; t += DT) {
          stepGame(s, DT, ev, rng);
          ev.length = 0;
        }
        const defeated = (s.phase as Phase) === 'defeat';
        const cost = perFile * CONFIG.board.files * rook.cost;
        trials.push({ cost, leaks: hpBefore - s.hp, defeated });
        // 안전한 단언: 시뮬레이션이 실제로 이 웨이브를 끝냈는지(멈추거나 무한정 도는 게 아닌지)만 확인
        if (!defeated) expect(s.wave).toBe(w + 1);
      }

      const [oneEach, twoEach] = trials;
      console.log(
        `[밸런스 리포트-확장] 웨이브${w}(적 최대체력 ${toughestHp}, ${enemyCount(w)}마리, 완주 ${transitSeconds}s): ` +
        `분석적(고립 가정) 필요 룩/파일 ≥${analyticMinRooksPerFile} | ` +
        `실측 8파일 동시배치 룩1/파일(${oneEach.cost}G)→누수 ${oneEach.leaks}회 | 룩2/파일(${twoEach.cost}G)→누수 ${twoEach.leaks}회 | ` +
        `골드상한(무누수·방어비 0 가정) ${ceiling}G`,
      );
      if (oneEach.leaks === 0 && analyticMinRooksPerFile > 1) {
        console.log(
          '  → 대조군은 누수가 나는데 8파일 동시배치에서 룩1/파일이 무누수인 이유: 이 배치는 파일당 룩을 ' +
          '전부 같은 랭크(1)에 두어 8개 룩이 그 랭크를 100% 공유하는 최대공유 구성이다(비둘기집 원리가 ' +
          '보장하는 "최소 한 랭크 공유"보다 훨씬 많이 공유한 경우). 룩의 랭크 공격은 자기 파일이 아닌 다른 ' +
          '파일도 전부 관통하므로, 그 공유 랭크가 8파일 전체에 보너스 타격을 주는 시너지가 생긴다 — 스펙 ' +
          '5.4/5.5의 "완전 관통"이 만드는 의도치 않은 상호작용이며 버그는 아니다. 일반화하면: 파일은 8개인데 ' +
          '배치 가능 랭크는 1~7뿐이므로 "파일당 룩 1개" 배치는 어떤 랭크를 고르든 비둘기집 원리로 최소 한 ' +
          '랭크는 반드시 공유되지만, 이 실측은 그 최소치가 아니라 최댓값(전부 공유)을 썼다. 결과적으로 ' +
          '파일별 고립 dps만 보는 표(9.3)의 소요 화력 추정은 실제보다 보수적이다.',
        );
      }

      // 핵심 실측 단언: "룩 1개/파일이면 후반 웨이브도 무누수"라는 이 측정의 결론 자체를 고정한다.
      // 위 대조군(완전 고립)은 새지만, 8파일 동시배치에서는 공유 랭크 시너지가 여유 있게 메운다
      // (리뷰에서 확인된 사실). 엔진이 이 시너지를 잃으면(회귀) 여기서 실패해야 한다.
      expect(oneEach.leaks).toBe(0);
      // 구조적 불변식: 같은 배치를 더 늘렸는데 누수가 늘어날 수는 없다 (안전한 단언)
      expect(twoEach.leaks).toBeLessThanOrEqual(oneEach.leaks);
      expect(twoEach.cost).toBeLessThan(ceiling);   // 이 시점 이론 상한 내에서 충분히 감당 가능 (config 유도)
    }
  });
});
