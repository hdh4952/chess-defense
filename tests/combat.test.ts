import { describe, expect, it } from 'vitest';
import { CONFIG, enemyHp } from '../src/config';
import { applyAttack, pieceDamage, updateCombat } from '../src/core/combat';
import type { GameEvent } from '../src/types';
import { boardPiece, enemyAt, waveState } from './helpers';

describe('pieceDamage (스펙 5.6)', () => {
  it('기본 × (1 + 퀸 수): 룩 5 → 버프 1개면 10', () => {
    const r = boardPiece('rook', 0, 1);
    expect(pieceDamage(r)).toBe(5);
    r.queenBuffCount = 1;
    expect(pieceDamage(r)).toBe(10);
    r.queenBuffCount = 3;
    expect(pieceDamage(r)).toBe(20);
  });
});

describe('applyAttack', () => {
  it('한 칸의 모든 적 동시 타격 (다중 타격, 스펙 5.1)', () => {
    const s = waveState();
    const a = enemyAt(1, 2, 5);
    const b = enemyAt(1, 2, 5);
    s.enemies.push(a, b);
    applyAttack(s, [{ file: 2, rank: 5 }], 3, []);
    expect(a.hp).toBe(7);
    expect(b.hp).toBe(7);
  });
  it('처치: 골드 = maxHp, 통계 갱신, enemyDied 이벤트 (스펙 4.1/6)', () => {
    const s = waveState();
    s.enemies.push(enemyAt(1, 2, 5, false, 'victim'));
    const ev: GameEvent[] = [];
    applyAttack(s, [{ file: 2, rank: 5 }], 10, ev);
    expect(s.enemies).toHaveLength(0);
    expect(s.gold).toBe(300 + 10);
    expect(s.stats.totalKills).toBe(1);
    expect(s.stats.totalGoldEarned).toBe(10);
    expect(ev).toContainEqual({
      kind: 'enemyDied', enemyId: 'victim', square: { file: 2, rank: 5 }, isBoss: false, reward: 10,
    });
  });
  it('범위 밖 적은 무피해', () => {
    const s = waveState();
    const far = enemyAt(1, 5, 5);
    s.enemies.push(far);
    applyAttack(s, [{ file: 2, rank: 5 }], 10, []);
    expect(far.hp).toBe(10);
  });
  it('한 번의 타격으로 여러 적 동시 처치 — 각각 보상·이벤트 지급, 제거 누락/중복 없음', () => {
    const s = waveState();
    s.enemies.push(enemyAt(1, 2, 5, false, 'v1'), enemyAt(1, 2, 5, false, 'v2'));
    const ev: GameEvent[] = [];
    applyAttack(s, [{ file: 2, rank: 5 }], 10, ev);
    expect(s.enemies).toHaveLength(0);
    expect(s.gold).toBe(300 + 20);
    expect(s.stats.totalKills).toBe(2);
    expect(s.stats.totalGoldEarned).toBe(20);
    expect(ev).toHaveLength(2);
    expect(ev).toContainEqual({
      kind: 'enemyDied', enemyId: 'v1', square: { file: 2, rank: 5 }, isBoss: false, reward: 10,
    });
    expect(ev).toContainEqual({
      kind: 'enemyDied', enemyId: 'v2', square: { file: 2, rank: 5 }, isBoss: false, reward: 10,
    });
  });
  it('보스 처치: 보상 = maxHp(420), enemyDied 이벤트에 isBoss: true', () => {
    const s = waveState();
    s.enemies.push(enemyAt(5, 2, 5, true, 'boss'));
    const ev: GameEvent[] = [];
    applyAttack(s, [{ file: 2, rank: 5 }], 420, ev);
    expect(s.enemies).toHaveLength(0);
    expect(s.gold).toBe(300 + 420);
    expect(s.stats.totalGoldEarned).toBe(420);
    expect(ev).toContainEqual({
      kind: 'enemyDied', enemyId: 'boss', square: { file: 2, rank: 5 }, isBoss: true, reward: 420,
    });
  });
});

describe('updateCombat — 주기 공격 (스펙 5.2/5.4/5.5)', () => {
  it('폰: 0.5초마다 전방 대각선의 적을 2씩 타격', () => {
    const s = waveState();
    const p = boardPiece('pawn', 3, 4);
    const e = enemyAt(1, 2, 5);           // (d4) 폰의 ↖ 대상 칸 c5
    s.pieces.push(p);
    s.enemies.push(e);
    updateCombat(s, 1 / 60, []);           // 쿨 0 + 적 존재 → 즉시 발사
    expect(e.hp).toBe(8);
    expect(p.cooldown).toBeCloseTo(0.5);
    for (let i = 0; i < 30; i++) updateCombat(s, 1 / 60, []); // +0.5초
    expect(e.hp).toBe(6);
  });
  it('사거리에 적이 없으면 쿨다운 0에서 대기 (허공 발사 없음)', () => {
    const s = waveState();
    const p = boardPiece('pawn', 3, 4);
    s.pieces.push(p);
    updateCombat(s, 1, []);
    expect(p.cooldown).toBe(0);
    s.enemies.push(enemyAt(1, 4, 5));      // 적 진입
    const ev: GameEvent[] = [];
    updateCombat(s, 1 / 60, ev);           // 즉시 발사
    expect(s.enemies[0].hp).toBe(8);
    expect(ev.some(x => x.kind === 'attack')).toBe(true);
  });
  it('룩: 같은 파일 전체 관통 — 여러 칸의 적을 한 번에 타격', () => {
    const s = waveState();
    s.pieces.push(boardPiece('rook', 3, 1));
    const near = enemyAt(1, 3, 3);
    const far = enemyAt(1, 3, 8);
    const other = enemyAt(1, 4, 3);
    s.enemies.push(near, far, other);
    updateCombat(s, 1 / 60, []);
    expect(near.hp).toBe(5);
    expect(far.hp).toBe(5);
    expect(other.hp).toBe(10);             // 다른 파일·다른 랭크 → 룩 범위 밖
  });
  it('비숍: 대각선 관통, 주기 3초', () => {
    const s = waveState();
    const b = boardPiece('bishop', 3, 4);  // d4
    s.pieces.push(b);
    const e = enemyAt(1, 6, 7);            // g7 — d4 대각선
    s.enemies.push(e);
    updateCombat(s, 1 / 60, []);
    // 비숍의 공격력은 경제 기물로 바뀌며 낮아졌고 앞으로도 다시 조정될 수 있다 — 여기서 고정하려는
    // 것은 "대각선 끝의 적이 실제로 맞는다"는 사실이지 특정 숫자가 아니므로 CONFIG에서 유도한다.
    expect(e.hp).toBe(enemyHp(1) - CONFIG.pieces.bishop.damage);
    expect(b.cooldown).toBeCloseTo(CONFIG.pieces.bishop.interval);
  });
  it('슬롯 기물: 쿨다운은 흐르지만 발사하지 않는다 (스펙 5.1 ID 유지)', () => {
    const s = waveState();
    const p = boardPiece('pawn', 3, 4);
    p.cooldown = 2.0;
    p.square = null; p.slotIndex = 0;      // 회수된 상태
    s.pieces.push(p);
    s.enemies.push(enemyAt(1, 2, 5));
    updateCombat(s, 1.5, []);
    expect(p.cooldown).toBeCloseTo(0.5);   // 계속 감소
    expect(s.enemies[0].hp).toBe(10);      // 발사는 없음
    updateCombat(s, 1.0, []);
    expect(p.cooldown).toBe(0);            // 0에서 멈춤 (음수 금지)
  });
  it('버프 반영: 퀸 버프 1개면 폰이 4씩 타격', () => {
    const s = waveState();
    const p = boardPiece('pawn', 3, 4);
    p.queenBuffCount = 1;
    s.pieces.push(p);
    const e = enemyAt(1, 2, 5);
    s.enemies.push(e);
    updateCombat(s, 1 / 60, []);
    expect(e.hp).toBe(6);
  });
  it('goldPerAttack: 발사 1회당 정액 골드 + goldGained 이벤트 (비숍)', () => {
    const s = waveState();
    const gold0 = s.gold;
    const b = boardPiece('bishop', 3, 4);
    s.pieces.push(b);
    s.enemies.push(enemyAt(1, 6, 7));
    const ev: GameEvent[] = [];
    updateCombat(s, 1 / 60, ev);
    const G = CONFIG.pieces.bishop.goldPerAttack;
    expect(s.gold).toBe(gold0 + G);
    expect(s.stats.totalGoldEarned).toBe(G);      // 통계에도 반영 (처치 골드와 같은 취급)
    expect(ev).toContainEqual({ kind: 'goldGained', square: { file: 3, rank: 4 }, amount: G });

    updateCombat(s, CONFIG.pieces.bishop.interval, ev);   // 쿨다운 만료 → 두 번째 발사
    expect(s.gold).toBe(gold0 + 2 * G);
  });
  it('goldPerAttack: 사거리에 적이 없으면 발사도 골드도 없다', () => {
    const s = waveState();
    const gold0 = s.gold;
    s.pieces.push(boardPiece('bishop', 3, 4));
    s.enemies.push(enemyAt(1, 3, 5));      // d5 — 같은 파일, 대각선 아님
    const ev: GameEvent[] = [];
    updateCombat(s, 10, ev);               // 쿨다운이 충분히 지나도
    expect(s.gold).toBe(gold0);
    expect(ev.some(e => e.kind === 'goldGained')).toBe(false);
  });
  it('goldPerAttack: 적을 죽이든 여러 마리를 맞히든 액수는 같다 (정액)', () => {
    const G = CONFIG.pieces.bishop.goldPerAttack;
    const many = waveState();
    many.pieces.push(boardPiece('bishop', 3, 4));
    many.enemies.push(enemyAt(1, 4, 5), enemyAt(1, 5, 6), enemyAt(1, 2, 3));   // 대각선 3마리
    updateCombat(many, 1 / 60, []);
    expect(many.stats.totalGoldEarned).toBe(G);

    // 처치가 일어나면 처치 보상(maxHp)이 별도로 더해질 뿐, 공격 골드 자체는 그대로다.
    const kill = waveState();
    const weak = enemyAt(1, 4, 5);
    weak.hp = 1;
    kill.pieces.push(boardPiece('bishop', 3, 4));
    kill.enemies.push(weak);
    updateCombat(kill, 1 / 60, []);
    expect(kill.stats.totalGoldEarned).toBe(G + weak.maxHp);
  });
  it('goldPerAttack: 퀸 버프는 공격력만 올리고 골드에는 적용되지 않는다', () => {
    const s = waveState();
    const b = boardPiece('bishop', 3, 4);
    b.queenBuffCount = 3;                  // 공격력 ×4
    s.pieces.push(b);
    const e = enemyAt(1, 6, 7);
    s.enemies.push(e);
    updateCombat(s, 1 / 60, []);
    expect(e.hp).toBe(enemyHp(1) - CONFIG.pieces.bishop.damage * 4);
    expect(s.stats.totalGoldEarned).toBe(CONFIG.pieces.bishop.goldPerAttack);
  });
  it('goldPerAttack: 슬롯의 비숍은 쿨다운만 흐르고 골드는 못 번다', () => {
    const s = waveState();
    const gold0 = s.gold;
    const b = boardPiece('bishop', 3, 4);
    b.square = null; b.slotIndex = 0;      // 회수된 상태
    s.pieces.push(b);
    s.enemies.push(enemyAt(1, 6, 7));
    updateCombat(s, 10, []);
    expect(s.gold).toBe(gold0);
  });
  it('goldPerAttack 0인 기물(폰·룩)은 골드를 벌지 않는다', () => {
    const s = waveState();
    const gold0 = s.gold;
    s.pieces.push(boardPiece('pawn', 3, 4), boardPiece('rook', 0, 1));
    s.enemies.push(enemyAt(1, 2, 5), enemyAt(1, 0, 3));
    const ev: GameEvent[] = [];
    updateCombat(s, 1 / 60, ev);
    expect(ev.some(e => e.kind === 'attack')).toBe(true);      // 공격은 분명히 했는데
    expect(ev.some(e => e.kind === 'goldGained')).toBe(false);  // 골드는 없다
    expect(s.gold).toBe(gold0);
  });
  it('나이트·퀸은 주기 발사가 없다', () => {
    const s = waveState();
    const n = boardPiece('knight', 3, 4);
    const q = boardPiece('queen', 3, 5);
    n.cooldown = 3.0;
    s.pieces.push(n, q);
    const e = enemyAt(1, 3, 4);            // 나이트 자신 칸
    s.enemies.push(e);
    updateCombat(s, 3.0, []);              // 쿨다운이 정확히 0에 도달 — 발사 게이트가 실제로 열리는 지점
    expect(e.hp).toBe(10);                 // 쿨 0이어도 나이트는 안 때림
    expect(n.cooldown).toBe(0);            // 이동 쿨다운은 0까지 감소 (나이트 예외로 재설정되지 않음)
  });
});
