import { describe, expect, it } from 'vitest';
import { CONFIG, clearBonus, enemyCount } from '../src/config';
import { createEnemy } from '../src/core/enemy';
import { BOARD_H } from '../src/core/grid';
import { stepGame } from '../src/core/step';
import type { GameEvent } from '../src/types';
import { boardPiece, waveState, cleanState } from './helpers';

describe('웨이브 1 엔드투엔드 (스펙 4.5 대조)', () => {
  it('a파일 룩 1개로 웨이브 1 전멸 — 무피해, 종료 시 700G', () => {
    const s = cleanState();
    s.gold = 0;                              // 골드 흐름만 따로 검증
    s.pieces.push(boardPiece('rook', 0, 1));
    const events: GameEvent[] = [];
    const dt = 1 / 60;
    const rngA = () => 0;                    // 전부 a파일 스폰
    for (let t = 0; t < 60 && s.wave === 1; t += dt) stepGame(s, dt, events, rngA);
    expect(s.wave).toBe(2);                  // 클리어
    expect(s.phase).toBe('prepare');
    expect(s.hp).toBe(CONFIG.player.startHp); // 누수 0
    expect(s.stats.totalKills).toBe(10);
    // 전멸이므로 보너스는 곡선의 전액이다 (처치율 1.0)
    expect(s.gold).toBe(100 + clearBonus(1));   // 처치 100 + 보너스 (시작골드 제외)
    expect(s.stats.totalGoldEarned).toBe(100 + clearBonus(1));
    expect(events.some(e => e.kind === 'waveCleared')).toBe(true);
  });

  it('방어가 없으면 같은 조건에서 10마리 전부 누수한 채 웨이브 2 진입', () => {
    const s = cleanState();
    // 검증 대상은 "방어가 없으면 웨이브1 10마리가 전부 통과한다"는 것 하나다. startHp가 누수
    // 10회보다 적으면 도중에 defeat로 끊겨 그 사실 자체를 볼 수 없으므로, 체력만 넉넉히 올려
    // 밸런스 재조정과 무관하게 통과 횟수를 세도록 한다.
    s.hp = 100;
    const dt = 1 / 60;
    for (let t = 0; t < 60 && s.wave === 1; t += dt) stepGame(s, dt, [], () => 0);
    expect(s.wave).toBe(2);
    expect(s.hp).toBe(100 - enemyCount(1) * CONFIG.player.hpLossNormal);
  });

  it('전투가 통과보다 먼저 처리된다 (스펙 10.2 순서) — 통과 직전 적도 처치로 집계', () => {
    const s = waveState();
    s.spawnTimer = CONFIG.wave.spawnIntervalMax;   // 이번 틱에 자동 스폰이 끼어들지 않도록
    const dt = 1 / 60;
    const rook = boardPiece('rook', 0, 1);
    rook.queenBuffCount = 1;                    // 데미지 5*(1+1)=10 — 적 체력과 같아 1방 처치
    s.pieces.push(rook);
    const enemy = createEnemy(1, 0, false, 'leak-race');
    enemy.y = BOARD_H - enemy.speed * dt;       // 이번 틱 이동 후 정확히 통과선 도달
    s.enemies.push(enemy);
    const events: GameEvent[] = [];
    stepGame(s, dt, events, () => 0);
    expect(s.stats.totalKills).toBe(1);
    expect(s.gold).toBe(CONFIG.player.startGold + enemy.maxHp);
    expect(events.some(e => e.kind === 'enemyDied')).toBe(true);
    expect(s.hp).toBe(CONFIG.player.startHp);   // 누수로 집계되지 않음
    expect(events.some(e => e.kind === 'enemyLeaked')).toBe(false);
  });
});
