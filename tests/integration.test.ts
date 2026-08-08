import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/core/state';
import { stepGame } from '../src/core/step';
import type { GameEvent } from '../src/types';
import { boardPiece } from './helpers';

describe('웨이브 1 엔드투엔드 (스펙 4.5 대조)', () => {
  it('a파일 룩 1개로 웨이브 1 전멸 — 무피해, 종료 시 700G', () => {
    const s = createInitialState();
    s.gold = 0;                              // 골드 흐름만 따로 검증
    s.pieces.push(boardPiece('rook', 0, 1));
    const events: GameEvent[] = [];
    const dt = 1 / 60;
    const rngA = () => 0;                    // 전부 a파일 스폰
    for (let t = 0; t < 60 && s.wave === 1; t += dt) stepGame(s, dt, events, rngA);
    expect(s.wave).toBe(2);                  // 클리어
    expect(s.phase).toBe('prepare');
    expect(s.hp).toBe(30);                   // 누수 0
    expect(s.stats.totalKills).toBe(10);
    expect(s.gold).toBe(100 + 300);          // 처치 100 + 보너스 300 (시작골드 제외)
    expect(s.stats.totalGoldEarned).toBe(400);
    expect(events.some(e => e.kind === 'waveCleared')).toBe(true);
  });

  it('방어가 없으면 같은 조건에서 체력 20으로 웨이브 2 진입', () => {
    const s = createInitialState();
    const dt = 1 / 60;
    for (let t = 0; t < 60 && s.wave === 1; t += dt) stepGame(s, dt, [], () => 0);
    expect(s.wave).toBe(2);
    expect(s.hp).toBe(20);
  });
});
