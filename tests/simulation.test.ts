import { describe, expect, it } from 'vitest';
import { CONFIG, enemyCount, enemyHp } from '../src/config';
import { moveOnBoard } from '../src/core/pieces';
import { createInitialState } from '../src/core/state';
import { stepGame } from '../src/core/step';
import { enemySquare } from '../src/core/grid';
import type { GameEvent, GameState, Phase } from '../src/types';
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
    expect(s.hp).toBe(30);
    expect(s.stats.totalKills).toBe(10);
  });

  it('풀런: 파일당 룩 2개면 일반 웨이브 전멸·보스 4회 누수로 승리 (엔진 무결성)', () => {
    const s = createInitialState();
    for (let f = 0; f < 8; f++) {
      s.pieces.push(boardPiece('rook', f, 1), boardPiece('rook', f, 2));
    }
    // 룩 2개/파일 = 종주당 80 ≥ 최대 일반 체력 49 → 일반 적 전멸.
    // 보스(420~1470)는 160으로 못 잡음 → 4회 누수 = 체력 -20.
    run(s, 60 * 60, cycleRng());
    expect(s.phase).toBe('victory');
    expect(s.hp).toBe(30 - 4 * 5);
    const bossHp = [5, 10, 15, 20].map(w => enemyHp(w) * 30).reduce((a, b) => a + b, 0);
    let killGold = 0;
    for (let w = 1; w <= 20; w++) killGold += enemyCount(w) * enemyHp(w) * (w % 5 === 0 ? 30 : 1);
    killGold -= bossHp;                                  // 보스 4마리는 놓침
    expect(s.stats.totalKills).toBe(452 - 4);
    expect(s.stats.totalGoldEarned).toBe(killGold + 300 * 20);  // 처치 + 클리어 보너스 (스펙 3.2)
  });

  it('20웨이브 보스 누수: 체력 6 이상이면 승리, 5 이하면 패배 우선 (스펙 3.1/10.5)', () => {
    for (const [hp, expected] of [[6, 'victory'], [5, 'defeat']] as const) {
      const s = createInitialState();
      s.wave = 20;
      s.hp = hp;
      s.phase = 'wave';
      s.spawnedCount = 1;                                // 보스 이미 스폰됨
      const boss = {
        id: 'b', file: 3, y: 639.9, hp: 1470, maxHp: 1470, isBoss: true,
        speed: 80 / 6, jitterX: 0,
      };
      s.enemies.push(boss);
      run(s, 2, () => 0);
      expect(s.phase).toBe(expected);
    }
  });

  it('[리포트] 웨이브 5 보스 vs 완벽 폰 추격 — 스펙 9.4 실측 (검토 노트 1)', () => {
    const s = createInitialState();
    s.wave = 5;
    const bossFile = 3;
    // 추격 폰 2개(보스 파일 양옆) + 보스 파일 룩 + 보스 경로 대각선의 비숍
    const left = boardPiece('pawn', bossFile - 1, 7);
    const right = boardPiece('pawn', bossFile + 1, 7);
    s.pieces.push(left, right, boardPiece('rook', bossFile, 1), boardPiece('bishop', 4, 4));
    s.phase = 'prepare';
    s.prepareTimer = 0.01;

    let bossMinHp = enemyHp(5) * 30;                     // 420
    const ev: GameEvent[] = [];
    // 웨이브 5가 끝나는 순간(웨이브 6 준비 진입) 루프 종료 — 다음 웨이브로 오염 방지
    for (let t = 0; t < 120 && s.wave === 5 && (s.phase as Phase) !== 'defeat'; t += DT) {
      stepGame(s, DT, ev, () => bossFile / 8);
      ev.length = 0;
      const boss = s.enemies.find(e => e.isBoss);
      if (boss) {
        bossMinHp = Math.min(bossMinHp, boss.hp);
        const wantRank = enemySquare(boss).rank - 1;     // 보스 바로 아랫랭크로 폰 유지 (완벽 추격)
        for (const p of [left, right]) {
          if (p.square && p.square.rank !== wantRank && wantRank >= 1) {
            moveOnBoard(s, p.id, p.square.file, wantRank, []);
          }
        }
      }
    }

    const killed = s.stats.totalKills === 1;
    const dealt = killed ? 420 : 420 - bossMinHp;
    // 완벽 추격 상한 추정: 폰 2×168 + 룩 80 + 비숍 12 = 428 vs 보스 420 → 아슬아슬한 처치권
    console.log(`[밸런스 리포트] 웨이브5 보스(420): ${killed ? '처치 성공' : `누수 — 총 피해 ${dealt}`}`);
    console.log('  → 스펙 9.4의 "폰 3개로 처치"는 기하학상 불가(한 칸 동시 타격 폰 최대 2개). 9.5 플레이테스트 항목으로 이관.');
    // 실측 404는 예측 428보다 24(밴드 1회분) 낮다: 비숍(4,4)이 오른쪽 추격 폰의 경로 칸과 겹쳐
    // 보스가 그 랭크를 지날 때 moveOnBoard가 점유 칸이라 실패하고 폰이 한 밴드(6초=24데미지)를
    // 놓친다. 밸런스 결함이 아니라 이 테스트의 좌표 선택이 만든 자기 방해(아래 확장 측정에서
    // 비숍을 (5,5)로 옮겨 충돌 없이 재측정 — 예측대로 420 처치, 마진 약 8).
    console.log(`  → 예측(428) 대비 실측(${dealt}) 차이 ${428 - dealt}: 비숍(4,4)이 우측 추격 폰의 경로와 같은 칸이라 한 밴드(24) 유실 (아래 확장 측정 참고).`);
    // 엔진 검증 목적의 단언 (밸런스 수치 자체는 단언하지 않음)
    expect(s.wave).toBe(6);                              // 처치든 누수든 웨이브는 종료된다 (스펙 4.2)
    expect(s.hp).toBe(killed ? 30 : 25);                 // 누수 시 보스 -5
    expect(dealt).toBeGreaterThan(300);                  // 추격 메커니즘이 실제로 동작했는지 하한 확인
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
    const bossHp = enemyHp(5) * CONFIG.enemy.bossHpMultiplier;         // 420, config 유도
    const { pawn, rook, bishop } = CONFIG.pieces;
    const buildCost = 2 * pawn.cost + rook.cost + bishop.cost;

    const s = createInitialState();
    s.wave = 5;
    const bossFile = 3;
    const left = boardPiece('pawn', bossFile - 1, 7);
    const right = boardPiece('pawn', bossFile + 1, 7);
    // 비숍을 (5,5)로 옮겨 추격 폰의 경로 칸(파일 2/4, 랭크 1~7)과 절대 겹치지 않게 한다 —
    // 바로 위 리포트에서 찾은 자기 충돌을 제거한 "깨끗한" 최선의 혼합 빌드.
    s.pieces.push(left, right, boardPiece('rook', bossFile, 1), boardPiece('bishop', 5, 5));
    s.phase = 'prepare';
    s.prepareTimer = 0.01;

    let bossMinHp = bossHp;
    let bossSpawnT = -1;
    let killT = -1;
    const ev: GameEvent[] = [];
    for (let t = 0; t < 120 && s.wave === 5 && (s.phase as Phase) !== 'defeat'; t += DT) {
      stepGame(s, DT, ev, () => bossFile / 8);
      for (const e of ev) if (e.kind === 'bossSpawned' && bossSpawnT < 0) bossSpawnT = t;
      ev.length = 0;
      const boss = s.enemies.find(e => e.isBoss);
      if (boss) {
        bossMinHp = Math.min(bossMinHp, boss.hp);
        const wantRank = enemySquare(boss).rank - 1;
        for (const p of [left, right]) {
          if (p.square && p.square.rank !== wantRank && wantRank >= 1) {
            moveOnBoard(s, p.id, p.square.file, wantRank, []);
          }
        }
      } else if (killT < 0 && bossSpawnT >= 0) {
        killT = t;
      }
    }

    const killed = s.stats.totalKills === 1;
    const dealt = killed ? bossHp : bossHp - bossMinHp;
    const descentSeconds = CONFIG.board.ranks * CONFIG.enemy.secondsPerSquare / CONFIG.enemy.bossSpeedMultiplier;
    console.log(
      `[밸런스 리포트-확장] 웨이브5 보스 게이트: 충돌 없는 빌드(폰2+룩1+비숍1, ${buildCost}G) → ` +
      `${killed ? `처치 성공 (경과 ${(killT - bossSpawnT).toFixed(1)}s / 완주 ${descentSeconds}s)` : `실패 — 총피해 ${dealt}/${bossHp}`}`,
    );
    console.log(
      `  → 이 시점 이론상 골드 상한(무누수·방어비 0 가정, config 유도치) ${ceiling}G ≥ 빌드비용 ${buildCost}G — ` +
      '골드는 병목이 아니다. 병목은 기하학(칸당 동시 타격 폰 최대 2개)이며, 충돌 없이 배치하면 소폭의 마진으로 처치 가능하다.',
    );

    expect(buildCost).toBeLessThan(ceiling);      // 예산 관점: 이론 상한 내에서 충분히 감당 가능 (config 유도)
    expect(s.wave).toBe(6);
    expect(s.hp).toBe(30);                        // 충돌 없이 배치하면 누수 없이 처치된다는 실측
    expect(killed).toBe(true);
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
      console.log(
        `[밸런스 리포트-확장] 대조군 — 룩 1개가 다른 룩과 랭크를 공유하지 않을 때(파일0 전용, 웨이브19): ` +
        `누수 ${isolatedLeaks}회 / 처치 ${s.stats.totalKills}회 (완주 ${transitSeconds}s 동안 3초 간격 최대 8~9회 타격 = 40~45 < 체력 46 → 고립 상태에선 못 잡음).`,
      );
      // 순수 고립 상태에서는 반드시 누수가 나야 한다 — 아래 8파일 실측과의 대비를 위한 대조군 단언
      expect(isolatedLeaks).toBeGreaterThan(0);
    }

    for (const w of [16, 17, 18, 19]) {
      const ceiling = goldCeilingBeforeWave(w);
      const toughestHp = enemyHp(w);
      // 분석적 하한(고립 가정): 자기 파일만 커버하는 룩 dps로 완주 시간 내 최댓값 적을 잡는 데 필요한 개수
      const analyticMinRooksPerFile = Math.ceil(toughestHp / transitSeconds / rookDps);

      const trials: { perFile: number; cost: number; leaks: number; kills: number; defeated: boolean }[] = [];
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
        trials.push({ perFile, cost, leaks: hpBefore - s.hp, kills: s.stats.totalKills, defeated });
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
          '  → 대조군은 누수가 나는데 8파일 동시배치에서 룩1/파일이 무누수인 이유: 파일은 8개인데 배치 가능 랭크는 ' +
          '1~7뿐이라 최소 두 룩이 랭크를 공유할 수밖에 없고(비둘기집), 룩의 랭크 공격은 자기 파일이 아닌 다른 파일도 ' +
          '전부 관통하므로 그 공유 랭크가 8파일 전체에 보너스 타격을 주는 우연한 시너지다 — 스펙 5.4/5.5의 "완전 관통"이 ' +
          '만드는 의도치 않은 상호작용이며 버그는 아니지만, 파일별 고립 dps만 보는 표(9.3)의 소요 화력 추정을 실제보다 ' +
          '보수적으로 만든다.',
        );
      }

      // 구조적 불변식: 같은 배치를 더 늘렸는데 누수가 늘어날 수는 없다 (안전한 단언)
      expect(twoEach.leaks).toBeLessThanOrEqual(oneEach.leaks);
      expect(twoEach.cost).toBeLessThan(ceiling);   // 이 시점 이론 상한 내에서 충분히 감당 가능 (config 유도)
    }
  });
});
