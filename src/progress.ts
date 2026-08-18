import { readStored, writeStored } from './storage';

/**
 * 플레이어 기록 — **판을 넘어 남는 성취** (v1.19 · v1.20에서 형태가 바뀌었다).
 *
 * 지금 담는 것은 하나다: **지금까지 클리어한 가장 높은 웨이브**. 스킨 해금 조건이 여기에
 * 기댄다(`render/skins.ts`).
 *
 * ★ **v1.20에서 boolean("마지막 웨이브를 깼는가")이 숫자로 바뀌었다.** 난이도마다 마지막
 * 웨이브가 다르므로(20 / 30 / 40) boolean은 "무엇을 깼는가"를 더 이상 말하지 못한다 —
 * 하드에서 25웨이브까지 간 사람과 5웨이브에서 죽은 사람이 똑같이 `false`였다. 숫자로 두면
 * **난이도를 몰라도 성취를 비교할 수 있고**, 사용자 결정("20웨이브 이상 클리어 시 해금,
 * 모드 상관없이")이 그대로 한 줄 비교가 된다.
 *
 * ★ **왜 `core/`가 아닌가** — `src/core/`는 DOM도 브라우저 API도 모르는 순수 시뮬레이션이고
 * (§10.4의 단방향 규칙), 헤드리스 밸런스 측정이 그 순수성 위에 서 있다. localStorage를 코어에
 * 들이면 한 판의 결과가 **다음 판의 시작 상태를 바꾸는** 통로가 생겨, 같은 난수 씨앗이 같은
 * 결과를 낸다는 보장이 깨진다. 기록은 코어 **바깥에서** 코어를 지켜보고 적는다(main.ts가
 * `waveCleared` 이벤트를 보고 적는다 — 코어는 자기가 기록된다는 사실을 모른다).
 *
 * ⚠️ **이 기록은 게임 규칙에 영향을 주지 않는다.** 해금되는 것은 그림뿐이고, 능력치·확률·
 * 비용 어느 것도 바뀌지 않는다 — 밸런스 문서(§9)의 모든 실측이 계속 유효하다는 뜻이다.
 */

const STORAGE_KEY = 'chess-defense.progress.v1';

interface StoredProgress { bestWaveCleared?: unknown; clearedFinalWave?: unknown }

/**
 * v1.19 저장값(`{ clearedFinalWave: true }`)이 실제로 뜻하던 웨이브 수.
 *
 * ★ **리터럴 20이 맞다** — `waveTotal('easy')`로 유도하면 안 된다. 그 시절에는 난이도가 없어
 * 마지막 웨이브가 20 하나뿐이었다는 **역사적 사실**이고, 이지의 길이를 나중에 25로 바꾸더라도
 * 옛 저장값이 뜻하는 바는 여전히 20이다. 유도하면 그 순간 옛 기록이 소급해서 부풀거나 줄어든다.
 */
const LEGACY_CLEARED_WAVE = 20;

type Listener = () => void;
const listeners = new Set<Listener>();

function load(): number {
  const raw = readStored(STORAGE_KEY);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 0;
  const stored = raw as StoredProgress;
  const best = stored.bestWaveCleared;
  // 숫자만 받는다. 문자열 "20"이나 true를 느슨하게 통과시키면 저장값이 조금만 어긋나도
  // 해금이 공짜로 열린다 — 해금은 **얻어야 하는 것**이다.
  if (typeof best === 'number' && Number.isFinite(best) && best > 0) return Math.floor(best);
  // 구 형식(v1.19). `=== true`로 좁힌다 — 'false' 같은 문자열이나 0/1이 참으로 읽히지 않게.
  return stored.clearedFinalWave === true ? LEGACY_CLEARED_WAVE : 0;
}

let bestWave = load();

/** 지금까지 클리어한 가장 높은 웨이브. 한 번도 못 넘겼으면 0. */
export function bestWaveCleared(): number {
  return bestWave;
}

/** `waves` 웨이브 이상을 클리어한 적이 있는가 — **난이도는 묻지 않는다**(사용자 결정). */
export function hasClearedWaves(waves: number): boolean {
  return bestWave >= waves;
}

/**
 * 웨이브 하나를 클리어했다고 기록한다. 호출부는 main.ts이고, 코어의 `waveCleared` 이벤트
 * 하나당 한 번 부른다.
 *
 * ★ **최고 기록만 올라간다(단조).** 그래서 두 성질이 공짜로 따라온다: ① 낮은 난이도로 다시
 * 놀아도 기록이 깎이지 않고, ② 이미 넘어선 웨이브에서는 저장을 아예 하지 않는다(예전 판본이
 * 승리 화면 동안 매 프레임 불려도 안전하도록 멱등하게 만들었던 것과 같은 보호다 — 이제는
 * 웨이브당 한 번뿐이지만 그 보호를 잃을 이유가 없다).
 */
export function recordWaveCleared(wave: number): void {
  if (!Number.isFinite(wave) || wave <= bestWave) return;
  bestWave = Math.floor(wave);
  writeStored(STORAGE_KEY, { bestWaveCleared: bestWave });
  for (const listener of [...listeners]) listener();
}

/** 기록 변경 구독. 해지 함수를 돌려준다. */
export function onProgressChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * 해금 조건을 사람이 읽는 문구로 — "20웨이브 이상 클리어".
 *
 * ★ 수를 인자로 받는다. 조건의 단일 출처는 스킨 표(`render/skins.ts`)이고 이 함수는 그 수를
 * 문장으로 바꿀 뿐이다 — 문구 쪽에 20을 다시 적으면 조건을 25로 바꿨을 때 **화면만 옛 숫자를
 * 말한다.**
 *
 * "이상"이 문구에 들어가는 것이 중요하다: 하드로 40웨이브를 깬 사람에게 "20웨이브 클리어"는
 * 이미 지나온 조건인데, 그 표기만 보면 20을 **정확히** 깨야 하는 것처럼 읽힌다.
 */
export function waveClearLabel(waves: number): string {
  return `${waves}웨이브 이상 클리어`;
}

/** 테스트 전용 seam — skins.ts의 resetSkinsForTest와 같은 성격. 프로덕션은 절대 부르지 않는다. */
export function resetProgressForTest(): void {
  const had = bestWave;
  bestWave = 0;
  writeStored(STORAGE_KEY, { bestWaveCleared: 0 });
  if (had > 0) for (const listener of [...listeners]) listener();
}
