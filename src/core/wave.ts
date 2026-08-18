import { CONFIG, clearBonus, enemyCount, enemyTraits, pickGrantType, waveTotal } from '../config';
import { grantPiece, sellPrice } from './economy';
import type { GameEvent, GameState } from '../types';
import { createEnemy } from './enemy';

export function updatePrepare(state: GameState, dt: number): void {
  if (state.phase !== 'prepare') return;
  state.prepareTimer -= dt;
  if (state.prepareTimer <= 0) startWave(state);
}

/** 준비 중 수동/자동 시작 (스펙 4.4 — 조기 시작 보너스 없음) */
export function startWave(state: GameState): void {
  if (state.phase !== 'prepare') return;
  state.phase = 'wave';
  state.prepareTimer = 0;
  state.spawnTimer = 0;      // 첫 스폰은 즉시
  state.spawnedCount = 0;
  state.killedThisWave = 0;
}

export function updateSpawning(
  state: GameState, dt: number, events: GameEvent[], rng: () => number,
): void {
  if (state.phase !== 'wave') return;
  const total = enemyCount(state.wave, state.difficulty);
  if (state.spawnedCount >= total) return;
  state.spawnTimer -= dt;
  while (state.spawnTimer <= 0 && state.spawnedCount < total) {
    const file = Math.min(CONFIG.board.files - 1, Math.floor(rng() * CONFIG.board.files));
    const isBoss = state.wave % CONFIG.wave.bossEvery === 0;
    // ★ 유형은 enemyTraits가 결정론적 쿼터로 정한다 — 여기서 rng()를 추가로 뽑으면 스폰 파일
    // 시퀀스가 통째로 달라져 기존 헤드리스 측정이 조용히 다른 것을 잰다(signals의 N8이 잡는다).
    const traits = enemyTraits(state.wave, state.spawnedCount, isBoss);
    state.enemies.push(
      createEnemy(
        state.wave, file, isBoss, `e-${state.wave}-${state.spawnedCount}`, traits, state.difficulty,
      ),
    );
    state.spawnedCount++;
    if (isBoss) events.push({ kind: 'bossSpawned', file });
    state.spawnTimer += CONFIG.wave.spawnInterval;
  }
}

/** 모든 적이 사망 또는 통과 → 클리어 보너스, 다음 웨이브 또는 승리 (스펙 3/4.4) */
export function checkWaveEnd(
  state: GameState, events: GameEvent[], grantRng: () => number = Math.random,
): void {
  if (state.phase !== 'wave') return;
  const total = enemyCount(state.wave, state.difficulty);
  if (state.spawnedCount < total || state.enemies.length > 0) return;
  // 보너스는 지금 막 끝난 웨이브(state.wave) 기준이다 — 지급이 state.wave++보다 앞에 있다.
  // ⚠️ 처치율의 분모도 난이도를 탄 마릿수다 — 여기만 이지 기준으로 두면 하드에서 전멸시켜도
  // 처치율이 0.5로 계산돼 클리어 보너스가 반토막 난다.
  const bonus = clearBonus(state.wave, state.killedThisWave / total);
  state.gold += bonus;
  state.stats.totalGoldEarned += bonus;
  events.push({ kind: 'waveCleared', wave: state.wave });

  // 무작위 지급 — 클리어 보너스 뒤, victory 판정 **앞**이다(w20에도 지급한다).
  // ★ 추첨은 **조건 없이** 돌린다. "자리가 있을 때만 뽑는다"처럼 draw 횟수를 상태에
  // 의존시키면 난수열이 플레이 내용에 따라 갈라져 재현성이 사라진다. 뽑고 나서 버린다.
  if (CONFIG.grant.enabled && state.wave % CONFIG.grant.everyWaves === 0) {
    const type = pickGrantType(grantRng());
    // ★ grantRng를 **두 번** 뽑는다 — 종류 하나, 스폰 위치 하나(v1.12). 위치를 적 스폰
    // 난수(rng)에서 뽑으면 파일 시퀀스가 통째로 달라져 기존 헤드리스 측정이 조용히 다른
    // 것을 재게 된다(N8). 별도 세 번째 난수원을 만들지 않은 것은, 지급의 "무엇을"과
    // "어디에"가 같은 한 사건이라 같은 실에서 나오는 편이 재현에 유리하기 때문이다.
    if (grantPiece(state, type, events, grantRng)) {
      // grantPiece가 pieceSpawned를 이미 발행했다(구매와 같은 이벤트를 쓴다 — 플레이어에게는
      // "기물이 어디에 생겼는가"가 같은 종류의 사건이다).
    } else {
      // 보드 만석. 조용히 버리면 §12.3의 무음 실패 경로가 하나 더 늘고, 이월은 새 상태와
      // 불투명한 지급 시점을 만든다. 판매가로 환급하는 것이 새 규칙을 0개 추가하는 길이다.
      // ⚠️ 판매와 같은 취급이므로 stats.totalGoldEarned에는 넣지 않는다 — 그 통계는 "벌어들인
      // 골드"이고 환급은 받지 못한 것을 되돌려 받는 것이다.
      const refund = sellPrice(type);
      state.gold += refund;
      events.push({ kind: 'grantDiscarded', pieceType: type, refund });
    }
  }
  // 마지막 웨이브는 난이도가 정한다 — 이지 20 · 노멀 30 · 하드 40 (v1.20).
  if (state.wave >= waveTotal(state.difficulty)) {
    state.phase = 'victory';
    return;
  }
  state.wave++;
  state.phase = 'prepare';
  state.prepareTimer = CONFIG.wave.prepareSeconds;
  events.push({
    kind: 'prepareStarted',
    wave: state.wave,
    isBossWave: state.wave % CONFIG.wave.bossEvery === 0,
  });
}

/** HUD "남은 적": 아직 스폰 안 된 수 + 보드 위 생존 수 */
export function remainingEnemies(state: GameState): number {
  const total = enemyCount(state.wave, state.difficulty);
  return state.phase === 'wave'
    ? total - state.spawnedCount + state.enemies.length
    : total;
}
