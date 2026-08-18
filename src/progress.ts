import { CONFIG } from './config';
import { readStored, writeStored } from './storage';

/**
 * 플레이어 기록 — **판을 넘어 남는 성취** (v1.19).
 *
 * 지금 담는 것은 하나다: 마지막 웨이브를 클리어한 적이 있는가(= 승리 경험). 스킨 해금 조건이
 * 여기에 기댄다(`render/skins.ts`).
 *
 * ★ **왜 `core/`가 아닌가** — `src/core/`는 DOM도 브라우저 API도 모르는 순수 시뮬레이션이고
 * (§10.4의 단방향 규칙), 헤드리스 밸런스 측정이 그 순수성 위에 서 있다. localStorage를 코어에
 * 들이면 한 판의 결과가 **다음 판의 시작 상태를 바꾸는** 통로가 생겨, 같은 난수 씨앗이 같은
 * 결과를 낸다는 보장이 깨진다. 기록은 코어 **바깥에서** 코어를 지켜보고 적는다(main.ts).
 *
 * ⚠️ **이 기록은 게임 규칙에 영향을 주지 않는다.** 해금되는 것은 그림뿐이고, 능력치·확률·
 * 비용 어느 것도 바뀌지 않는다 — 밸런스 문서(§9)의 모든 실측이 계속 유효하다는 뜻이다.
 */

const STORAGE_KEY = 'chess-defense.progress.v1';

interface StoredProgress { clearedFinalWave?: unknown }

type Listener = () => void;
const listeners = new Set<Listener>();

function load(): boolean {
  const raw = readStored(STORAGE_KEY);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  // `=== true`로 좁힌다 — 'false' 같은 문자열이나 0/1이 들어와도 참으로 읽히지 않게.
  return (raw as StoredProgress).clearedFinalWave === true;
}

let clearedFinalWave = load();

/** 마지막 웨이브(= `CONFIG.wave.total`)를 클리어한 적이 있는가. */
export function hasClearedFinalWave(): boolean {
  return clearedFinalWave;
}

/**
 * 승리를 기록한다.
 *
 * ★ **이미 기록돼 있으면 즉시 반환한다.** 호출부(main.ts)는 승리 페이즈가 유지되는 동안
 * 매 프레임 이 함수를 부른다 — 페이즈 전환을 따로 추적하지 않아도 되도록 여기서 멱등하게
 * 만드는 쪽이 호출부에 상태를 하나 더 두는 것보다 안전하다. 이 가드가 없으면 결과 화면이
 * 떠 있는 동안 초당 60회 localStorage에 쓴다.
 */
export function recordFinalWaveClear(): void {
  if (clearedFinalWave) return;
  clearedFinalWave = true;
  writeStored(STORAGE_KEY, { clearedFinalWave: true });
  for (const listener of [...listeners]) listener();
}

/** 기록 변경 구독. 해지 함수를 돌려준다. */
export function onProgressChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** 해금 조건을 사람이 읽는 문구로. 웨이브 수는 CONFIG에서 유도한다 —
 *  `wave.total`을 바꾸면 이 문구도 따라온다(§10.1의 단일 출처 규칙). */
export const FINAL_WAVE_CLEAR_LABEL = `${CONFIG.wave.total}웨이브 클리어`;

/** 테스트 전용 seam — skins.ts의 resetSkinsForTest와 같은 성격. 프로덕션은 절대 부르지 않는다. */
export function resetProgressForTest(): void {
  const had = clearedFinalWave;
  clearedFinalWave = false;
  writeStored(STORAGE_KEY, { clearedFinalWave: false });
  if (had) for (const listener of [...listeners]) listener();
}
