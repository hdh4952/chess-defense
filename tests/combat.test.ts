import { describe, expect, it } from 'vitest';
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
    expect(e.hp).toBe(7);
    expect(b.cooldown).toBeCloseTo(3.0);
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
  it('나이트·퀸은 주기 발사가 없다', () => {
    const s = waveState();
    const n = boardPiece('knight', 3, 4);
    const q = boardPiece('queen', 3, 5);
    n.cooldown = 3.0;
    s.pieces.push(n, q);
    const e = enemyAt(1, 3, 4);            // 나이트 자신 칸
    s.enemies.push(e);
    updateCombat(s, 2.0, []);
    expect(e.hp).toBe(10);                 // 아무도 안 때림
    expect(n.cooldown).toBeCloseTo(1.0);   // 이동 쿨다운은 감소
  });
});
