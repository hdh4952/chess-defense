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

/** dt를 매 틱 반복해서 빼면 반올림 오차가 남아(~1e-16) 쿨다운이 정확히 0에 도달하지 못하고 발사가 한 틱 밀릴 수 있다 — 그 잔차를 0으로 스냅한다. */
const COOLDOWN_EPS = 1e-9;

/**
 * 쿨다운 진행 + 폰/비숍/룩 주기 발사.
 * - 쿨다운은 슬롯에 있어도 계속 흐른다 (기물 ID 종속, 스펙 5.1/10.5)
 * - 사거리 내 적이 없으면 쿨 0에서 대기, 적 진입 즉시 발사 (계획서 검토 노트 5)
 * - 나이트는 이동 쿨다운만 감소 (폭발은 pieces.ts), 퀸은 공격 없음
 * - goldPerAttack이 있는 기물(현재 비숍)은 발사할 때마다 정액 골드를 번다. 지급 지점이
 *   applyAttack이 아니라 여기인 이유: applyAttack은 나이트 폭발(pieces.ts)과 공유되는 "피해
 *   적용" 함수이고, 골드는 피해나 처치가 아니라 *발사 1회*에 묶인 보상이기 때문이다. 그래서
 *   적을 한 마리도 못 죽여도, 대각선에 몇 마리가 걸려 있어도 액수는 같다.
 */
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
    if (def.goldPerAttack > 0) {
      // pieceDamage(p)와 달리 퀸 버프(queenBuffCount)를 곱하지 않는다 — 골드는 버프 대상이
      // 아니다(사용자 결정). config 값을 그대로 쓰는 이 한 줄이 그 규칙의 유일한 근거다.
      state.gold += def.goldPerAttack;
      state.stats.totalGoldEarned += def.goldPerAttack;
      events.push({ kind: 'goldGained', square: { ...p.square }, amount: def.goldPerAttack });
    }
    p.cooldown = def.interval;
  }
}
