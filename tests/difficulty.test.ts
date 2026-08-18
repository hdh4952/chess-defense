// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CONFIG, DEFAULT_DIFFICULTY, DIFFICULTIES, enemyCount, enemyHp, waveTotal,
} from '../src/config';
import {
  DIFFICULTY_NAME, difficultyDetail, resetDifficultyForTest, selectedDifficulty, setDifficulty,
} from '../src/difficulty';
import { createEnemy, splitEnemies } from '../src/core/enemy';
import { createInitialState } from '../src/core/state';
import { checkWaveEnd, remainingEnemies, startWave, updateSpawning } from '../src/core/wave';
import { createLayout } from '../src/ui/layout';
import { updateHud } from '../src/ui/hud';
import { createTitleScreen } from '../src/ui/titleScreen';
import type { Difficulty, GameEvent, GameState } from '../src/types';
import { installStorage, uninstallStorage, type StorageStub } from './storageStub';

const rngFile = (file: number) => () => file / 8;   // floor(rng*8) === file

/**
 * 웨이브 w를 **전멸로 끝낸 직후**의 상태. 스폰·전투를 돌리지 않고 카운터만 채워
 * checkWaveEnd에 넘긴다 — 여기서 보려는 것은 전투가 아니라 **승리 판정의 경계**다.
 */
function clearedWave(wave: number, difficulty: Difficulty): GameState {
  const s = createInitialState(difficulty);
  s.wave = wave;
  startWave(s);
  s.spawnedCount = enemyCount(wave, difficulty);
  s.killedThisWave = s.spawnedCount;
  checkWaveEnd(s, [], () => 0);
  return s;
}

// 난이도 선택은 모듈 전역이라 한 테스트가 고른 값이 다음 테스트로 새어 나간다
// (skins.ts의 resetSkinsForTest와 같은 사정).
afterEach(() => { resetDifficultyForTest(); });

describe('난이도 표(CONFIG.difficulty)의 불변식', () => {
  it('★ 이지는 배수가 전부 1이다 — 난이도 도입이 기존 밸런스를 건드리지 않았다는 뜻', () => {
    // 이 단언이 깨지면 저장소의 모든 헤드리스 실측과 밸런스 문서(§9)의 수치가 함께 무효가 된다.
    expect(CONFIG.difficulty.easy)
      .toEqual({ waveTotal: 20, countMultiplier: 1, hpMultiplier: 1 });
    expect(DEFAULT_DIFFICULTY).toBe('easy');
  });

  it('노멀 30웨이브 ×1.5 · 하드 40웨이브 ×2 (사용자 결정)', () => {
    expect(CONFIG.difficulty.normal)
      .toEqual({ waveTotal: 30, countMultiplier: 1.5, hpMultiplier: 1.5 });
    expect(CONFIG.difficulty.hard)
      .toEqual({ waveTotal: 40, countMultiplier: 2, hpMultiplier: 2 });
  });

  it('DIFFICULTIES는 CONFIG의 키에서 유도되고 기본값이 첫 항목이다', () => {
    // UI가 이 순서를 그대로 그린다 — 기본값이 맨 앞이어야 "고르지 않으면 이것"이 눈에 보인다.
    expect(DIFFICULTIES).toEqual(Object.keys(CONFIG.difficulty));
    expect(DIFFICULTIES[0]).toBe(DEFAULT_DIFFICULTY);
  });

  it('배수는 모두 1 이상이다 — 난이도는 쉬워지는 방향으로 열려 있지 않다', () => {
    for (const d of DIFFICULTIES) {
      expect(CONFIG.difficulty[d].countMultiplier, d).toBeGreaterThanOrEqual(1);
      expect(CONFIG.difficulty[d].hpMultiplier, d).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('enemyHp — 난이도 배수 (v1.20)', () => {
  it('인자를 생략하면 이지다 — 기존 호출부가 전부 옛날 값을 그대로 본다', () => {
    for (let w = 1; w <= waveTotal(); w++) expect(enemyHp(w), `w${w}`).toBe(enemyHp(w, 'easy'));
    expect(enemyHp(1)).toBe(10);
    expect(enemyHp(20)).toBe(59);
  });

  it('노멀은 이지의 1.5배, 하드는 2배 (반올림)', () => {
    for (let w = 1; w <= waveTotal(); w++) {
      expect(enemyHp(w, 'normal'), `w${w}`).toBe(Math.round(enemyHp(w) * 1.5));
      expect(enemyHp(w, 'hard'), `w${w}`).toBe(enemyHp(w) * 2);
    }
    expect(enemyHp(1, 'normal')).toBe(15);
    expect(enemyHp(20, 'normal')).toBe(89);      // 59 × 1.5 = 88.5 → 89
    expect(enemyHp(20, 'hard')).toBe(118);
  });

  it('정수만 돌려준다 — 처치 보상 골드가 소수가 되면 안 된다', () => {
    for (const d of DIFFICULTIES) {
      for (let w = 1; w <= waveTotal(); w++) {
        expect(Number.isInteger(enemyHp(w, d)), `${d} w${w}`).toBe(true);
      }
    }
  });

  it('보스 체력도 함께 오른다 — 배수가 enemyHp 안에 있으므로 자동이다', () => {
    const m = CONFIG.enemy.bossHpMultiplier;
    expect(createEnemy(20, 0, true, 'b', [], 'easy').hp).toBe(59 * m);
    expect(createEnemy(20, 0, true, 'b', [], 'normal').hp).toBe(89 * m);
    expect(createEnemy(20, 0, true, 'b', [], 'hard').hp).toBe(118 * m);
  });

  it('createEnemy는 난이도를 체력에만 반영한다 — 속도는 그대로다', () => {
    const easy = createEnemy(12, 3, false, 'a', [], 'easy');
    const hard = createEnemy(12, 3, false, 'b', [], 'hard');
    expect(hard.hp).toBe(easy.hp * 2);
    expect(hard.maxHp).toBe(easy.maxHp * 2);     // 처치 보상도 함께 오른다 (의도된 성질)
    expect(hard.speed).toBe(easy.speed);
  });

  it('분열체 체력은 난이도가 아니라 부모의 maxHp 비율에서 나온다', () => {
    // 부모가 이미 난이도를 탄 체력이므로 자식에 또 곱하면 두 번 곱해진다.
    const parent = createEnemy(14, 3, false, 'p', ['splitter'], 'hard');
    const born = splitEnemies(parent, 14, 'hard');
    const ratio = CONFIG.traitDefs.splitter.splitHpRatio ?? 0;
    for (const child of born) expect(child.hp).toBe(Math.round(parent.maxHp * ratio));
  });
});

describe('enemyCount — 난이도 배수 (v1.20)', () => {
  it('인자를 생략하면 이지다', () => {
    for (let w = 1; w <= waveTotal(); w++) {
      expect(enemyCount(w), `w${w}`).toBe(enemyCount(w, 'easy'));
    }
    expect(enemyCount(1)).toBe(10);
    expect(enemyCount(19)).toBe(46);
  });

  it('일반 웨이브는 노멀 1.5배 · 하드 2배', () => {
    expect(enemyCount(1, 'normal')).toBe(15);
    expect(enemyCount(1, 'hard')).toBe(20);
    expect(enemyCount(19, 'normal')).toBe(69);
    expect(enemyCount(19, 'hard')).toBe(92);
  });

  it('★ 보스 웨이브는 난이도와 무관하게 1마리다', () => {
    // 반올림하면 1.5도 2도 2가 되어 노멀과 하드가 같아지고, 보스 누수는 −5라 두 마리를
    // 놓치면 시작 체력 10이 통째로 날아간다(config.ts의 enemyCount 주석 참고).
    for (const d of DIFFICULTIES) {
      for (const w of [5, 10, 15, 20]) expect(enemyCount(w, d), `${d} w${w}`).toBe(1);
    }
  });

  it('정수만 돌려준다 — 마릿수가 소수면 스폰 루프의 상한이 무너진다', () => {
    for (const d of DIFFICULTIES) {
      for (let w = 1; w <= waveTotal(); w++) {
        expect(Number.isInteger(enemyCount(w, d)), `${d} w${w}`).toBe(true);
      }
    }
  });
});

describe('웨이브 수 — 이지 20 · 노멀 30 · 하드 40 (v1.20)', () => {
  it('난이도마다 판의 길이가 다르다', () => {
    expect(waveTotal('easy')).toBe(20);
    expect(waveTotal('normal')).toBe(30);
    expect(waveTotal('hard')).toBe(40);
    expect(waveTotal()).toBe(waveTotal(DEFAULT_DIFFICULTY));
  });

  it('★ 마지막 웨이브는 셋 다 보스 웨이브다 — 판이 흐지부지 끝나지 않게', () => {
    for (const d of DIFFICULTIES) expect(waveTotal(d) % CONFIG.wave.bossEvery, d).toBe(0);
  });

  it('★ 승리 판정이 그 판의 마지막 웨이브를 본다', () => {
    for (const d of DIFFICULTIES) {
      const last = waveTotal(d);
      // 마지막 직전 웨이브를 끝내면 아직 이기지 않는다.
      const before = clearedWave(last - 1, d);
      expect(before.phase, d).toBe('prepare');
      expect(before.wave, d).toBe(last);
      // 마지막 웨이브를 끝내면 승리다.
      expect(clearedWave(last, d).phase, d).toBe('victory');
    }
  });

  it('★ 이지의 20웨이브에서는 노멀·하드가 아직 끝나지 않는다', () => {
    // 예전 상수(20)를 어딘가에 남겨 뒀다면 여기서 잡힌다 — 노멀 판이 w20에 승리로 끝난다.
    expect(clearedWave(20, 'normal').phase).toBe('prepare');
    expect(clearedWave(20, 'hard').phase).toBe('prepare');
  });

  it('HUD 표기가 그 판의 총 웨이브를 쓴다', () => {
    const layout = createLayout(document.createElement('div'));
    const s = createInitialState('hard');
    s.wave = 3;
    updateHud(layout, s);
    expect(layout.hud.wave.textContent).toBe('3/40');
  });
});

describe('판에 굳는 난이도 (GameState.difficulty)', () => {
  it('인자 없이 만들면 이지 — 모든 헤드리스 하네스가 옛 판을 그대로 잰다', () => {
    expect(createInitialState().difficulty).toBe(DEFAULT_DIFFICULTY);
  });

  it('고른 난이도가 상태에 실린다', () => {
    for (const d of DIFFICULTIES) expect(createInitialState(d).difficulty, d).toBe(d);
  });

  it('스폰은 그 판의 난이도만큼 나온다 — 마릿수도 체력도', () => {
    const s = createInitialState('hard');
    s.pieces.length = 0;
    startWave(s);
    updateSpawning(s, 300, [], rngFile(0));
    expect(s.spawnedCount).toBe(enemyCount(1, 'hard'));
    expect(s.enemies[0].hp).toBe(enemyHp(1, 'hard'));
  });

  it('HUD "남은 적"도 그 판의 난이도를 본다', () => {
    const s = createInitialState('normal');
    expect(remainingEnemies(s)).toBe(enemyCount(1, 'normal'));
  });

  it('★ 클리어 보너스의 처치율 분모도 난이도를 탄 마릿수다', () => {
    // 분모만 이지로 두면 하드에서 전멸시켜도 처치율이 0.5로 계산돼 보너스가 반토막 난다.
    const win = (difficulty: Difficulty): number => {
      const s = createInitialState(difficulty);
      startWave(s);
      s.spawnedCount = enemyCount(1, difficulty);
      s.killedThisWave = s.spawnedCount;          // 전멸
      const ev: GameEvent[] = [];
      const before = s.gold;
      checkWaveEnd(s, ev, () => 0);
      return s.gold - before;
    };
    // 전량 처치면 난이도와 무관하게 같은 보너스다(보너스 자체는 난이도 배수를 타지 않는다).
    expect(win('hard')).toBe(win('easy'));
    expect(win('normal')).toBe(win('easy'));
  });
});

describe('난이도 선택 (src/difficulty.ts)', () => {
  const KEY = 'chess-defense.difficulty.v1';
  let store: StorageStub;

  // ⚠️ 이 테스트 환경에는 localStorage가 아예 없다 — 스텁을 심지 않으면 영속화 단언이
  // "저장이 안 됐다"가 아니라 "저장할 곳이 없다"로 조용히 통과한다(tests/storageStub.ts).
  beforeEach(() => { store = installStorage(); resetDifficultyForTest(); });
  afterEach(() => { uninstallStorage(); });

  it('고른 적이 없으면 기본값', () => {
    expect(selectedDifficulty()).toBe(DEFAULT_DIFFICULTY);
  });

  it('고르면 바뀌고, 같은 값을 다시 고르면 false', () => {
    expect(setDifficulty('hard')).toBe(true);
    expect(selectedDifficulty()).toBe('hard');
    expect(setDifficulty('hard')).toBe(false);
  });

  it('모르는 값은 무시한다 — 드롭다운 밖에서 들어오는 값도 있다', () => {
    expect(setDifficulty('lunatic' as Difficulty)).toBe(false);
    expect(selectedDifficulty()).toBe(DEFAULT_DIFFICULTY);
  });

  it('★ 저장되고 다음에 열 때 복원된다 — 결과 화면의 "다시 시작"이 reload이기 때문', () => {
    setDifficulty('normal');
    expect(store.data[KEY]).toBe(JSON.stringify('normal'));
    // 새로고침 재현: 모듈 캐시를 비우고(reset) 그 직전의 저장값을 그대로 되돌려 둔다.
    resetDifficultyForTest();
    store.data[KEY] = JSON.stringify('normal');
    expect(selectedDifficulty()).toBe('normal');
  });

  it('저장값이 깨져 있으면 조용히 기본값으로 시작한다', () => {
    for (const broken of ['"lunatic"', '3', '{"difficulty":"hard"}', 'not json']) {
      resetDifficultyForTest();
      store.data[KEY] = broken;
      expect(selectedDifficulty(), broken).toBe(DEFAULT_DIFFICULTY);
    }
  });
});

describe('난이도 문구', () => {
  it('이름은 셋 다 있다', () => {
    for (const d of DIFFICULTIES) expect(DIFFICULTY_NAME[d], d).toBeTruthy();
  });

  it('★ 배수 문구는 CONFIG에서 유도된다 — 배수를 바꾸면 설명이 따라온다', () => {
    expect(difficultyDetail('normal')).toContain('×1.5');
    expect(difficultyDetail('hard')).toContain('×2');
    // 배수가 전부 1인 난이도에는 "×1"을 적지 않는다 — 정보가 아니라 잡음이다.
    expect(difficultyDetail('easy')).not.toContain('×');
  });
});

describe('시작 화면의 난이도 드롭다운 (v1.20)', () => {
  beforeEach(() => { installStorage(); resetDifficultyForTest(); });
  afterEach(() => { uninstallStorage(); });

  function mount(onBattle: (d: Difficulty) => void = () => {}): HTMLElement {
    const app = document.createElement('div');
    document.body.appendChild(app);
    createTitleScreen(app, onBattle);
    return app;
  }

  it('BATTLE 버튼 **왼쪽**에 있다 (사용자 결정)', () => {
    const app = mount();
    const row = app.querySelector<HTMLElement>('#title-start')!;
    const kids = [...row.children];
    const pick = kids.findIndex(el => el.querySelector('#difficulty') || el.id === 'difficulty');
    const battle = kids.findIndex(el => el.id === 'battle');
    expect(pick).toBeGreaterThanOrEqual(0);
    expect(battle).toBeGreaterThan(pick);
  });

  it('난이도 전부가 옵션으로 있고 순서가 CONFIG와 같다', () => {
    const app = mount();
    const options = [...app.querySelectorAll<HTMLOptionElement>('#difficulty option')];
    expect(options.map(o => o.value)).toEqual(DIFFICULTIES);
    // 문구도 유도된 것을 그대로 쓴다 — 이름과 배수 설명이 화면에서 갈라지지 않게.
    for (const o of options) {
      const d = o.value as Difficulty;
      expect(o.textContent).toContain(DIFFICULTY_NAME[d]);
      expect(o.textContent).toContain(difficultyDetail(d));
    }
  });

  it('처음 열면 기본값이 골라져 있다', () => {
    const app = mount();
    expect(app.querySelector<HTMLSelectElement>('#difficulty')!.value).toBe(DEFAULT_DIFFICULTY);
  });

  it('고르는 즉시 저장한다 — BATTLE을 누르지 않아도', () => {
    const app = mount();
    const el = app.querySelector<HTMLSelectElement>('#difficulty')!;
    el.value = 'hard';
    el.dispatchEvent(new Event('change'));
    expect(selectedDifficulty()).toBe('hard');
  });

  it('★ BATTLE은 고른 난이도를 함께 넘긴다', () => {
    const got: Difficulty[] = [];
    const app = mount(d => got.push(d));
    const el = app.querySelector<HTMLSelectElement>('#difficulty')!;
    el.value = 'normal';
    el.dispatchEvent(new Event('change'));
    app.querySelector<HTMLButtonElement>('#battle')!.click();
    expect(got).toEqual(['normal']);
  });

  it('이미 골라 둔 값이 있으면 그것이 선택된 채로 열린다', () => {
    setDifficulty('hard');
    const app = mount();
    expect(app.querySelector<HTMLSelectElement>('#difficulty')!.value).toBe('hard');
  });
});
