import {
  CONFIG, TRAITS, armorMultiplier, damageThresholdFor, ignoresFrontalDamage, tierMultiplier,
} from '../config';
import type { Enemy, GameEvent, GameState, Piece, Square } from '../types';
import { enemySquare, sameSquare } from './grid';
import { splitEnemies } from './enemy';
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
 * 원피해 → 이 적이 실제로 받는 피해. **게이트 순서가 규칙이다**(v1.14로 전면 교체).
 *
 *   ① 실드형 — 전방(적보다 낮은 랭크)에서 온 피해는 통째로 0이다.
 *   ② 장갑형 — 원피해가 문턱 미만이면 0, 이상이면 감산 없이 전량 통과한다.
 *   ③ 보스 배수 — 보스에게만 걸리는 비율(일반 적에게는 항상 1).
 *
 * `from`이 **선택 인자인 것이 의도적이다.** 방향을 모르는 호출부(테스트·미래의 광역 효과)는
 * 전방 판정을 건너뛰고 나머지 게이트만 탄다 — 방향을 모르는 피해를 "전방"으로 단정해 0으로
 * 만들면 그 침묵이 어디에서도 드러나지 않기 때문이다. 실전 경로(updateCombat)는 항상 넘긴다.
 *
 * ⚠️ v1.13까지는 ①이 흡수 풀이고 ②가 비율 곱셈이었다. 순서의 이유도 달랐다("장갑을 먼저 걸고
 * 그 뒤 풀에서 뺀다 — 반대로 하면 두 유형이 곱셈으로 겹친다"). 지금은 세 게이트가 전부
 * **곱셈이 아니라 관문**이라 그 상호작용 자체가 없다.
 */
export function resolveDamage(e: Enemy, raw: number, from?: Square): number {
  // ★ 적은 위에서 아래로 내려온다. 따라서 "적보다 낮은 랭크" = 그 적의 진행 방향 = 전방이다.
  //   폰은 rank+1을 때리므로(자기보다 위) 폰의 피해는 항상 전방에서 온다 — 실드형에게 0이다.
  //   룩이 같은 파일에서 때릴 때는 자기 랭크가 적보다 높아야(= 적의 뒤에서) 피해가 들어간다.
  if (from && ignoresFrontalDamage(e.traits) && from.rank < enemySquare(e).rank) return 0;
  const threshold = damageThresholdFor(e.traits, e.isBoss);
  if (threshold > 0 && raw < threshold) return 0;
  return raw * armorMultiplier(e.traits, e.isBoss);
}

/**
 * 대상 칸들의 모든 적에게 피해. 처치 시 골드 = maxHp (스펙 4.1/5.1/6)
 *
 * ⚠️ `damage` 인자의 의미가 **'감산 전 원피해'**다. 적마다 유형이 다르므로 실제 피해는 적별로
 * 갈라진다 — 같은 발사가 어떤 적에게는 전량, 어떤 적에게는 0이 된다(문턱·전방 무시).
 *
 * `from`은 **공격자의 칸**이다. 실드형의 전방 판정에만 쓰이고, 생략하면 그 판정을 건너뛴다. v1.10 이전에는 나이트 폭발(pieces.ts)도 이 함수를 공유했으나 그 능력이
 * 사라져, 지금 호출부는 아래 updateCombat 하나뿐이다.
 */
export function applyAttack(
  state: GameState, targets: Square[], damage: number, events: GameEvent[], from?: Square,
): void {
  const killed: typeof state.enemies = [];
  for (const e of state.enemies) {
    if (!targets.some(t => sameSquare(t, enemySquare(e)))) continue;
    const dealt = resolveDamage(e, damage, from);
    e.hp -= dealt;
    // 피해가 0이어도 알린다 — 막혔다는 사실이 화면에 드러나야 플레이어가 유형을 배운다.
    // `damage > 0 && dealt === 0`이 곧 "유형이 막았다"이고, 원피해가 0인 기물(퀸 등)은
    // 애초에 이 루프에 오지 않으므로 blocked가 거짓 양성이 되지 않는다.
    events.push({
      kind: 'enemyHit', enemyId: e.id, file: e.file, y: e.y,
      damage: dealt, blocked: dealt === 0 && damage > 0,
    });
    // ★ 사망 판정에 오라 보너스가 들어간다. hp는 음수로 내려갈 수 있고, 그 적립분은
    //   오라가 죽는 순간 core/aura.ts의 스윕이 성립시킨다.
    if (e.hp + e.auraBonus <= 0) killed.push(e);
  }
  for (const e of killed) killEnemy(state, e, events);
}

/**
 * 적 하나를 처치 정산한다 — 제거·골드·통계·이벤트·분열을 **한곳에서** 한다.
 *
 * 함수로 뺀 이유는 v1.14에서 처치가 일어나는 곳이 둘이 됐기 때문이다: 피해를 입어서
 * (applyAttack) 와, **오라가 죽어서 적립된 피해가 뒤늦게 성립해서**(core/aura.ts)다.
 * 두 곳이 각자 정산하면 골드·통계·분열 중 하나가 언젠가 한쪽에서만 빠진다.
 */
export function killEnemy(state: GameState, e: Enemy, events: GameEvent[]): void {
  const i = state.enemies.indexOf(e);
  if (i < 0) return;                     // 같은 틱에 두 경로가 겹쳐도 두 번 정산하지 않는다
  state.enemies.splice(i, 1);
  state.gold += e.maxHp;
  state.stats.totalKills++;
  state.killedThisWave++;
  state.stats.totalGoldEarned += e.maxHp;
  events.push({
    kind: 'enemyDied', enemyId: e.id, square: enemySquare(e), isBoss: e.isBoss, reward: e.maxHp,
  });
  // ★ 분열은 처치가 **전부 정산된 뒤**에 일어난다(골드·통계·이벤트 순서 그대로). 앞으로
  //   당기면 부모의 처치 보상이 분열체 생성 성공 여부에 얽힌다.
  //
  //   applyAttack이 `killed`를 먼저 모아 두고 이 함수를 나중에 부르는 것이 안전한 이유는,
  //   그 루프가 순회하는 배열이 state.enemies가 **아니라** killed이기 때문이다. 피해 루프에서
  //   바로 생성하면 순회 중인 배열에 push하게 되고, 새로 태어난 적이 같은 발사에 다시 맞는다.
  if (e.traits.includes('splitter')) {
    const born = splitEnemies(e, state.wave, state.difficulty);
    if (born.length > 0) {
      state.enemies.push(...born);
      events.push({ kind: 'enemySplit', square: enemySquare(e), count: born.length });
    }
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
    if (p.cooldown > 0) continue;
    const targets = attackTargets(p.type, p.square);
    if (!anyEnemyIn(state, targets)) continue;
    // ★ 공격자 칸을 넘긴다 — 실드형의 전방 판정이 이 값 하나에 달려 있다(v1.14).
    //   빠뜨리면 전방 무시가 조용히 꺼져 실드형이 평범한 적이 된다.
    applyAttack(state, targets, pieceDamage(p), events, p.square);
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
