import { CONFIG, TRAITS, armorMultiplier, tierMultiplier } from '../config';
import type { Enemy, GameEvent, GameState, Piece, Square } from '../types';
import { enemySquare, sameSquare } from './grid';
import { attackTargets } from './patterns';

/**
 * 최종 공격력 = 기본 공격력 × 강화 단계 × (1 + 퀸 버프).
 *
 * 티어 배수가 곱셈으로 들어가야 "능력치 합"이라는 합성 규칙이 실제로 성립한다: 퀸 라인 위의
 * T1 룩 2기는 각각 5 × (1+1) = 10이라 합계 20인데, 그 둘을 합친 T2 룩 한 기도 반드시 20이어야
 * 하고 5 × 2 × (1+1) = 20이 정확히 그 값이다. 덧셈으로 넣으면 버프받은 기물을 합칠 때만 값이
 * 어긋난다.
 */
export function pieceDamage(p: Piece): number {
  return CONFIG.pieces[p.type].damage * tierMultiplier(p.tier) * (1 + p.queenBuffCount);
}

/**
 * 공격 1회당 얻는 골드 = 기본값 × 강화 단계. 퀸 버프는 여전히 곱하지 않는다(v1.7 결정).
 *
 * tier를 곱하는 이유는 공격력과 같다 — 골드도 능력치이므로 합성되면 합해져야 한다. 이건 단순한
 * 일관성 문제가 아니라 함정 방지다: 비숍의 수입은 발사 "횟수"에 비례하는데 합성은 발사체 수를
 * 반으로 줄이므로, tier를 곱하지 않으면 같은 3,200G에서 20웨이브 총 수입이 T1 16기의 +19,940G
 * 에서 T2 8기의 +9,750G로 51% 증발한다(실측). 그런데 판매가와 툴팁은 가치가 보존된 것처럼
 * 표시하므로, 되돌릴 수 없는 손실이 어디에도 드러나지 않는다. tier배가 그 감소를 정확히 상쇄한다.
 */
export function pieceGold(p: Piece): number {
  return CONFIG.pieces[p.type].goldPerAttack * tierMultiplier(p.tier);
}

function anyEnemyIn(state: GameState, targets: Square[]): boolean {
  return state.enemies.some(e => targets.some(t => sameSquare(t, enemySquare(e))));
}

/**
 * 원피해 → 이 적이 실제로 받는 피해. **순서가 규칙이다: 장갑을 먼저 걸고 그 뒤 보호막 풀에서
 * 뺀다.** 반대로 하면 장갑 적이 풀을 더 오래 유지해 두 유형이 곱셈으로 겹친다.
 *
 * 장갑이 비율이라 결과가 0 이하로 내려가지 않으므로 "최소 피해 1" 같은 바닥이 필요 없다.
 * 보호막은 남은 **피해량**을 깎는다(횟수가 아니다) — 횟수면 합성이 피격 수를 절반으로 줄여
 * 골드 중립성이 깨진다.
 */
export function resolveDamage(e: Enemy, raw: number): number {
  let d = raw * armorMultiplier(e.traits, e.isBoss);
  if (e.shieldPool > 0) {
    const absorbed = Math.min(e.shieldPool, d);
    e.shieldPool -= absorbed;
    d -= absorbed;
  }
  return d;
}

/**
 * 대상 칸들의 모든 적에게 피해. 처치 시 골드 = maxHp (스펙 4.1/5.1/6)
 *
 * ⚠️ `damage` 인자의 의미가 **'감산 전 원피해'**다. 적마다 장갑·보호막이 다르므로 실제 피해는
 * 적별로 갈라진다. v1.10 이전에는 나이트 폭발(pieces.ts)도 이 함수를 공유했으나 그 능력이
 * 사라져, 지금 호출부는 아래 updateCombat 하나뿐이다.
 */
export function applyAttack(
  state: GameState, targets: Square[], damage: number, events: GameEvent[],
): void {
  const killed: typeof state.enemies = [];
  for (const e of state.enemies) {
    if (!targets.some(t => sameSquare(t, enemySquare(e)))) continue;
    e.hp -= resolveDamage(e, damage);
    if (e.hp <= 0) killed.push(e);
  }
  for (const e of killed) {
    state.enemies.splice(state.enemies.indexOf(e), 1);
    state.gold += e.maxHp;
    state.stats.totalKills++;
    state.killedThisWave++;
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
 * - 나이트·퀸·아마존은 공격이 없다(pattern 'none' + damage 0) — 쿨다운만 흐르고 발사하지 않는다
 * - goldPerAttack이 있는 기물(현재 비숍)은 발사할 때마다 정액 골드를 번다. 지급 지점이
 *   applyAttack이 아니라 여기인 이유: applyAttack은 "피해 적용"만 담당하는 함수이고, 골드는
 *   피해나 처치가 아니라 *발사 1회*에 묶인 보상이기 때문이다. 그래서
 *   적을 한 마리도 못 죽여도, 대각선에 몇 마리가 걸려 있어도 액수는 같다.
 */
export function updateCombat(state: GameState, dt: number, events: GameEvent[]): void {
  for (const p of state.pieces) {
    p.cooldown = Math.max(0, p.cooldown - dt);
    if (p.cooldown < COOLDOWN_EPS) p.cooldown = 0;
    const def = CONFIG.pieces[p.type];
    if (TRAITS[p.type].pattern === 'none' || def.damage === 0) continue;
    if (p.square === null || p.cooldown > 0) continue;
    const targets = attackTargets(p.type, p.square);
    if (!anyEnemyIn(state, targets)) continue;
    applyAttack(state, targets, pieceDamage(p), events);
    events.push({ kind: 'attack', pieceType: p.type, from: { ...p.square }, targets });
    if (def.goldPerAttack > 0) {
      // pieceGold(p)는 강화 단계는 곱하되 퀸 버프(queenBuffCount)는 곱하지 않는다 — 골드는
      // 버프 대상이 아니다(사용자 결정). 그 규칙의 유일한 근거는 pieceGold 하나다.
      const gold = pieceGold(p);
      state.gold += gold;
      state.stats.totalGoldEarned += gold;
      events.push({ kind: 'goldGained', square: { ...p.square }, amount: gold });
    }
    p.cooldown = def.interval;
  }
}
