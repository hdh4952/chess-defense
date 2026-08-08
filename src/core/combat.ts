import { CONFIG } from '../config';
import type { GameEvent, GameState, Piece, Square } from '../types';
import { enemySquare, sameSquare } from './grid';
import { attackTargets } from './patterns';

export function pieceDamage(p: Piece): number {
  return CONFIG.pieces[p.type].damage * (1 + p.queenBuffCount);
}

function anyEnemyIn(state: GameState, targets: Square[]): boolean {
  return state.enemies.some(e => targets.some(t => sameSquare(t, enemySquare(e))));
}

/** 대상 칸들의 모든 적에게 데미지. 처치 시 골드 = maxHp (스펙 4.1/5.1/6) */
export function applyAttack(
  state: GameState, targets: Square[], damage: number, events: GameEvent[],
): void {
  const killed: typeof state.enemies = [];
  for (const e of state.enemies) {
    if (!targets.some(t => sameSquare(t, enemySquare(e)))) continue;
    e.hp -= damage;
    if (e.hp <= 0) killed.push(e);
  }
  for (const e of killed) {
    state.enemies.splice(state.enemies.indexOf(e), 1);
    state.gold += e.maxHp;
    state.stats.totalKills++;
    state.stats.totalGoldEarned += e.maxHp;
    events.push({
      kind: 'enemyDied', enemyId: e.id, square: enemySquare(e), isBoss: e.isBoss, reward: e.maxHp,
    });
  }
}

/**
 * 쿨다운 진행 + 폰/비숍/룩 주기 발사.
 * - 쿨다운은 슬롯에 있어도 계속 흐른다 (기물 ID 종속, 스펙 5.1/10.5)
 * - 사거리 내 적이 없으면 쿨 0에서 대기, 적 진입 즉시 발사 (계획서 검토 노트 5)
 * - 나이트는 이동 쿨다운만 감소 (폭발은 pieces.ts), 퀸은 공격 없음
 */
const COOLDOWN_EPS = 1e-9;

export function updateCombat(state: GameState, dt: number, events: GameEvent[]): void {
  for (const p of state.pieces) {
    p.cooldown = Math.max(0, p.cooldown - dt);
    if (p.cooldown < COOLDOWN_EPS) p.cooldown = 0;
    const def = CONFIG.pieces[p.type];
    if (def.damage === 0 || p.type === 'knight') continue;
    if (p.square === null || p.cooldown > 0) continue;
    const targets = attackTargets(p.type, p.square);
    if (!anyEnemyIn(state, targets)) continue;
    applyAttack(state, targets, pieceDamage(p), events);
    events.push({ kind: 'attack', pieceType: p.type, from: { ...p.square }, targets });
    p.cooldown = def.interval;
  }
}
