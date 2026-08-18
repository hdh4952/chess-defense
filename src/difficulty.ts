import { CONFIG, DEFAULT_DIFFICULTY, DIFFICULTIES, waveTotal } from './config';
import { readStored, writeStored } from './storage';
import type { Difficulty } from './types';

/**
 * 난이도 **선택** — 시작 화면에서 고른 값을 들고 있다가 판이 시작될 때 코어에 넘긴다 (v1.20).
 *
 * ★ **규칙(배수)은 여기 없다.** 배수는 `CONFIG.difficulty`에 있고 그것을 읽는 것은 코어뿐이다.
 * 이 모듈이 아는 것은 "플레이어가 무엇을 골랐는가"와 "그것을 어떻게 적어 두는가"뿐이다 —
 * `render/skins.ts`가 그림 URL과 선택만 다루고 능력치를 모르는 것과 같은 분업이다.
 *
 * ★ **왜 `core/`가 아닌가** — localStorage를 쓰기 때문이다. 코어는 DOM도 브라우저 API도 모르는
 * 순수 시뮬레이션이고(§10.4), 저장을 들이면 이전 판의 흔적이 다음 판의 시작 상태를 바꾸는
 * 통로가 생겨 헤드리스 측정의 재현성이 깨진다(`progress.ts`의 ★ 참고). 코어가 보는 것은
 * `GameState.difficulty` 하나이고, 그 값을 여기서 **한 번** 밀어 넣는다(main.ts).
 */

/**
 * ★ 판을 넘어 남는 셋 중 하나다(다른 둘은 스킨 선택과 승리 기록). 결과 화면의 "다시 시작"이
 * `location.reload()`라서(ui/banners.ts) 저장하지 않으면 **한 판 끝날 때마다 이지로 되돌아간다** —
 * 하드로 재도전하려는 사람이 매번 드롭다운을 다시 만져야 한다는 뜻이다.
 *
 * ⚠️ 스킨·승리 기록과 달리 이것은 **게임 규칙에 영향을 주는 첫 저장값**이다(적 마릿수와 체력).
 * 그래도 위험하지 않은 이유는 코어가 이 값을 **읽지 않기** 때문이다: 저장값은 드롭다운의 초기
 * 선택일 뿐이고, 실제 판의 난이도는 BATTLE을 누른 순간 상태에 굳는다. 저장이 실패하거나 값이
 * 깨져 있으면 조용히 기본값(이지)으로 시작한다.
 */
const STORAGE_KEY = 'chess-defense.difficulty.v1';

/**
 * ★ 저장값을 **읽는 시점에** 한 번만 불러온다(모듈 로드 시점이 아니다). 시작 화면은 임포트보다
 * 한참 뒤에 만들어지므로 프로덕션 동작에는 차이가 없고, 테스트는 localStorage 스텁을 심은 뒤에
 * 첫 읽기가 일어나게 만들 수 있다(happy-dom에는 localStorage가 아예 없다 — tests/storageStub.ts).
 */
let selected: Difficulty | null = null;

function load(): Difficulty {
  const raw = readStored(STORAGE_KEY);
  // 저장값은 전적으로 신뢰할 수 없는 입력이다(storage.ts). 모르는 난이도는 조용히 버린다 —
  // 난이도를 이름 바꾸거나 없앤 뒤의 옛 값일 수도 있다.
  return typeof raw === 'string' && (DIFFICULTIES as string[]).includes(raw)
    ? raw as Difficulty
    : DEFAULT_DIFFICULTY;
}

/** 지금 골라져 있는 난이도. 고른 적이 없거나 저장값이 깨졌으면 기본값(이지). */
export function selectedDifficulty(): Difficulty {
  if (selected === null) selected = load();
  return selected;
}

/** 난이도를 고른다. 모르는 값은 무시한다(false) — 드롭다운 밖에서 들어오는 값도 있을 수 있다. */
export function setDifficulty(difficulty: Difficulty): boolean {
  if (!(DIFFICULTIES as string[]).includes(difficulty)) return false;
  if (selectedDifficulty() === difficulty) return false;
  selected = difficulty;
  writeStored(STORAGE_KEY, difficulty);
  return true;
}

/** 화면에 보이는 이름. 규칙이 아니라 표기이므로 여기 있다(layout.ts의 PIECE_NAME과 같은 성격). */
export const DIFFICULTY_NAME: Record<Difficulty, string> = {
  easy: '이지', normal: '노멀', hard: '하드',
};

/**
 * 난이도 한 줄 요약 — "30웨이브 · 적 수 ×1.5 · 체력 ×1.5".
 *
 * ★ 수치를 문구에 리터럴로 적지 않는다. 이 저장소가 시작 화면의 모든 수치를 코드에서 유도하는
 * 이유와 같다: 배수나 웨이브 수를 조정하는 순간 설명만 옛 숫자를 말하기 시작하는데, **그
 * 어긋남은 테스트가 아니라 플레이어가 발견한다.**
 *
 * ★ **웨이브 수를 맨 앞에 둔다** (v1.20). 셋 중 가장 먼저 체감되는 차이이고 — 판 길이가
 * 20분에서 한 시간이 된다 — 배수와 달리 "얼마나 오래 붙잡혀 있는가"를 고르는 것이기 때문이다.
 */
export function difficultyDetail(difficulty: Difficulty): string {
  const { countMultiplier, hpMultiplier } = CONFIG.difficulty[difficulty];
  const waves = `${waveTotal(difficulty)}웨이브`;
  // 배수가 전부 1인 난이도(이지)에는 곱할 것이 없다 — "×1 · ×1"은 정보가 아니라 잡음이다.
  return countMultiplier === 1 && hpMultiplier === 1
    ? `${waves} · 기본 밸런스`
    : `${waves} · 적 수 ×${countMultiplier} · 체력 ×${hpMultiplier}`;
}

/**
 * 테스트 전용 seam — skins.ts의 resetSkinsForTest와 같은 성격. 모듈 전역이라 한 테스트가 고른
 * 값이 다음 테스트로 새어 나간다. 프로덕션 코드 경로는 절대 부르지 않는다.
 */
export function resetDifficultyForTest(): void {
  selected = null;                        // 다음 읽기에서 저장값을 다시 불러오게 한다
  writeStored(STORAGE_KEY, DEFAULT_DIFFICULTY);
}
