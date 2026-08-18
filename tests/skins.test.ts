// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TRAITS, waveTotal } from '../src/config';
import { recordWaveCleared, resetProgressForTest } from '../src/progress';
import {
  allySpriteUrl, DEFAULT_SKIN_ID, isSkinUnlocked, onSkinChange, resetSkinsForTest, selectedSkinId,
  setSkin, SKINS, skinsFor, unlockLabel,
} from '../src/render/skins';
import { installStorage, uninstallStorage } from './storageStub';
import type { PieceType } from '../src/types';

const ALL_TYPES: PieceType[] = Object.keys(TRAITS) as PieceType[];

/** 스킨이 둘 이상인 기물(지금은 폰뿐) — 목록을 여기 다시 적으면 스킨이 늘 때 갈라진다. */
function multiSkinType(): PieceType {
  const found = ALL_TYPES.find(t => skinsFor(t).length > 1);
  expect(found, '스킨이 둘 이상인 기물이 하나도 없다 — 이 스위트가 검증할 대상이 사라졌다').toBeDefined();
  return found!;
}

/**
 * 잠긴 스킨의 조건을 전부 만족시킨다. **필요한 웨이브 수를 스킨 표에서 유도한다** — 여기에
 * 20을 적어 두면 조건을 바꿨을 때 이 스위트만 옛 수로 통과하거나 실패한다(§10.2).
 */
function unlockAllSkins(): void {
  const need = Object.values(SKINS).flat()
    .reduce((m, s) => (s.unlock.kind === 'clearWaves' ? Math.max(m, s.unlock.waves) : m), 0);
  recordWaveCleared(need);
}

// 해금 조건이 붙은 뒤로, **선택 동작을 보는 스위트들은 해금 상태를 전제로 한다** — 잠긴 채로
// 두면 "고를 수 없다"는 이유로 전부 실패해 정작 보려던 규칙(선택·격리·영속화)이 가려진다.
// 잠긴 상태 자체는 아래 전용 describe가 본다.
beforeEach(() => { resetSkinsForTest(); unlockAllSkins(); });
afterEach(() => { resetSkinsForTest(); resetProgressForTest(); });

describe('스킨 표(SKINS)의 불변식', () => {
  it('모든 기물이 스킨 목록을 갖고, 첫 항목이 기본 스킨이다', () => {
    // 첫 항목이 기본이라는 약속은 코드가 실제로 기댄다: allySpriteUrl이 알 수 없는 id를
    // 만났을 때 list[0]으로 폴백하고, 선택 UI도 순서를 그대로 그린다.
    for (const type of ALL_TYPES) {
      const skins = skinsFor(type);
      expect(skins.length, type).toBeGreaterThan(0);
      expect(skins[0].id, type).toBe(DEFAULT_SKIN_ID);
    }
  });

  it('한 기물 안에서 스킨 id가 겹치지 않는다', () => {
    // id는 localStorage에 저장되는 키다 — 겹치면 find가 먼저 걸린 쪽을 돌려주어
    // "고른 것과 다른 그림"이 나오고, 그 상태가 저장까지 된다.
    for (const type of ALL_TYPES) {
      const ids = skinsFor(type).map(s => s.id);
      expect(new Set(ids).size, type).toBe(ids.length);
    }
  });

  it('모든 스킨이 이름과 URL을 갖는다', () => {
    for (const type of ALL_TYPES) {
      for (const skin of skinsFor(type)) {
        expect(skin.name.length, `${type}/${skin.id}`).toBeGreaterThan(0);
        expect(skin.url.length, `${type}/${skin.id}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('선택 (setSkin / allySpriteUrl)', () => {
  it('고르기 전에는 기본 스킨의 URL을 돌려준다', () => {
    for (const type of ALL_TYPES) {
      expect(selectedSkinId(type), type).toBe(DEFAULT_SKIN_ID);
      expect(allySpriteUrl(type), type).toBe(SKINS[type][0].url);
    }
  });

  it('스킨을 고르면 그 기물의 URL만 바뀐다', () => {
    const type = multiSkinType();
    const alt = skinsFor(type)[1];
    const others = ALL_TYPES.filter(t => t !== type).map(t => [t, allySpriteUrl(t)] as const);

    expect(setSkin(type, alt.id)).toBe(true);

    expect(allySpriteUrl(type)).toBe(alt.url);
    expect(selectedSkinId(type)).toBe(alt.id);
    // 옆 기물까지 갈아치우는 것이 이 기능의 가장 그럴듯한 결함이다(선택을 기물별이 아니라
    // 전역으로 들고 있는 구현이면 전부 바뀐다).
    for (const [t, url] of others) expect(allySpriteUrl(t), t).toBe(url);
  });

  it('모르는 스킨 id는 무시한다 — 선택도 URL도 그대로다', () => {
    const type = multiSkinType();
    expect(setSkin(type, 'no-such-skin')).toBe(false);
    expect(selectedSkinId(type)).toBe(DEFAULT_SKIN_ID);
    expect(allySpriteUrl(type)).toBe(SKINS[type][0].url);
  });

  it('같은 스킨을 다시 고르면 false — 헛된 재굽기를 만들지 않는다', () => {
    const type = multiSkinType();
    const alt = skinsFor(type)[1];
    expect(setSkin(type, alt.id)).toBe(true);
    expect(setSkin(type, alt.id)).toBe(false);
  });
});

describe('구독 (onSkinChange)', () => {
  it('바뀐 기물만 알린다 — sprites.ts가 이 신호로 그 기물만 다시 굽는다', () => {
    const type = multiSkinType();
    const seen: PieceType[] = [];
    const off = onSkinChange(t => seen.push(t));

    setSkin(type, skinsFor(type)[1].id);
    setSkin(type, 'no-such-skin');            // 무시된 호출은 알리지 않는다
    setSkin(type, skinsFor(type)[1].id);      // 같은 스킨 재선택도 알리지 않는다

    off();
    setSkin(type, DEFAULT_SKIN_ID);           // 해지 후에는 오지 않는다

    expect(seen).toEqual([type]);
  });
});

describe('영속화 (localStorage)', () => {
  const KEY = 'chess-defense.skins.v1';
  let stored: Record<string, string>;

  beforeEach(() => { stored = installStorage().data; resetSkinsForTest(); });
  afterEach(() => { uninstallStorage(); });

  it('고른 스킨이 저장된다', () => {
    // 이 게임에서 유일하게 저장되는 상태다 — 결과 화면의 "다시 시작"이 location.reload()라서
    // 저장하지 않으면 매 판 스킨이 기본으로 되돌아간다(skins.ts의 STORAGE_KEY 주석 참고).
    const type = multiSkinType();
    const alt = skinsFor(type)[1];
    setSkin(type, alt.id);

    expect(stored[KEY], '선택이 저장되지 않았다 — 새로고침하면 스킨이 사라진다').toBeDefined();
    expect(JSON.parse(stored[KEY])).toEqual({ [type]: alt.id });
  });

  it('기본 스킨은 저장값에 남기지 않는다', () => {
    // 기본으로 되돌린 선택까지 적어 두면, 나중에 기본 아트워크를 교체했을 때 옛 저장값이
    // 사라진 스킨 id를 가리키게 된다(그 자체는 로드 시 걸러지지만, 남길 이유가 없다).
    const type = multiSkinType();
    setSkin(type, skinsFor(type)[1].id);
    setSkin(type, DEFAULT_SKIN_ID);
    expect(JSON.parse(stored[KEY])).toEqual({});
  });

  it('저장할 곳이 없어도(비-브라우저·프라이빗 모드) 선택은 그대로 동작한다', () => {
    // 저장은 부가 기능이다 — 쓰기가 막혔다고 스킨 선택 자체가 죽으면 안 된다.
    uninstallStorage();
    const type = multiSkinType();
    const alt = skinsFor(type)[1];
    expect(setSkin(type, alt.id)).toBe(true);
    expect(allySpriteUrl(type)).toBe(alt.url);
    installStorage();                 // afterEach의 uninstall 대칭을 유지한다
  });
});

/**
 * 저장값 읽기는 **모듈 로드 시점에 딱 한 번** 일어난다(skins.ts의 loadSelection). 그래서 이
 * 블록만 모듈을 지우고 다시 import한다 — 저장값을 손으로 심어 두고 "다음 새로고침"을 흉내
 * 내는 유일한 방법이다. 저장값은 사용자가 직접 고칠 수도, 이 코드가 스킨을 지운 뒤의 옛
 * 값일 수도 있는 **신뢰할 수 없는 입력**이라, 여기서 깨지면 시작 화면이 통째로 죽는다.
 */
describe('저장값 읽기 — 신뢰할 수 없는 입력', () => {
  const KEY = 'chess-defense.skins.v1';

  async function reload(raw: string | null) {
    const data = installStorage().data;
    // ★ progress도 저장값에서 다시 읽힌다(모듈이 새로 평가되므로) — 해금 상태를 함께 심지
    // 않으면 복원한 선택이 "잠김"으로 판정돼 기본으로 떨어진다.
    data['chess-defense.progress.v1'] = JSON.stringify({ clearedFinalWave: true });
    if (raw !== null) data[KEY] = raw;
    vi.resetModules();               // skins.ts를 다시 평가시켜 loadSelection을 새 저장값으로 돌린다
    return import('../src/render/skins');
  }

  afterEach(() => { uninstallStorage(); vi.resetModules(); });

  it('저장된 선택을 복원한다', async () => {
    const type = multiSkinType();
    const alt = skinsFor(type)[1];
    const mod = await reload(JSON.stringify({ [type]: alt.id }));
    expect(mod.selectedSkinId(type)).toBe(alt.id);
    expect(mod.allySpriteUrl(type)).toBe(alt.url);
  });

  it.each([
    ['JSON이 아님', 'not json{'],
    ['객체가 아님', '"pawn"'],
    ['배열', '["pawn"]'],
    ['null', 'null'],
    ['값이 문자열이 아님', '{"pawn": 3}'],
    ['모르는 기물', '{"dragon": "heart-princess"}'],
    ['모르는 스킨', '{"pawn": "no-such-skin"}'],
  ])('망가진 저장값(%s)은 조용히 무시하고 기본 스킨으로 시작한다', async (_label, stored) => {
    const mod = await reload(stored);
    for (const type of ALL_TYPES) {
      expect(mod.selectedSkinId(type), type).toBe(mod.DEFAULT_SKIN_ID);
    }
  });

  it('한 항목이 망가져도 나머지 선택은 살린다', async () => {
    // 전체를 버리는 구현이면 폰 스킨 하나가 사라졌다는 이유로 다른 기물 선택까지 날아간다.
    const type = multiSkinType();
    const alt = skinsFor(type)[1];
    const mod = await reload(JSON.stringify({ dragon: 'x', [type]: alt.id }));
    expect(mod.selectedSkinId(type)).toBe(alt.id);
  });
});

/**
 * 해금 조건 (v1.19). 폰 스킨은 **20웨이브를 클리어한 적이 있어야** 쓸 수 있다.
 *
 * 이 스위트만 잠긴 상태에서 돈다(파일 전역 beforeEach가 해금해 두므로 여기서 되돌린다).
 * 핵심은 셋이다: ① 잠긴 것은 고를 수 없다 ② 잠김 판정은 **읽을 때마다** 다시 한다
 * ③ 잠겨 있어도 골라 둔 선택은 버리지 않는다.
 */
describe('해금 조건', () => {
  const locked = () => skinsFor(multiSkinType())[1];

  beforeEach(() => { resetProgressForTest(); });

  it('승리 경험이 없으면 잠겨 있고, 기본 스킨은 언제나 열려 있다', () => {
    const type = multiSkinType();
    expect(isSkinUnlocked(skinsFor(type)[0]), '기본은 잠기면 안 된다 — 그리면 그림이 없다').toBe(true);
    expect(isSkinUnlocked(locked())).toBe(false);
  });

  it('★ 해금 문구의 웨이브 수는 스킨 표에서 나온다 (v1.20)', () => {
    // 조건이 **절대 웨이브 수**가 되면서(사용자 결정: "20웨이브 이상, 모드 상관없이") 문구에
    // 다시 수가 들어왔다. 다만 그 수의 출처는 난이도가 아니라 스킨 자신이다 — 여기에 리터럴
    // 20을 적으면 조건을 25로 바꿨을 때 이 테스트만 옛 수로 실패한다(§10.2).
    const skin = locked();
    const waves = skin.unlock.kind === 'clearWaves' ? skin.unlock.waves : 0;
    expect(waves, '잠긴 스킨인데 웨이브 조건이 아니다').toBeGreaterThan(0);
    expect(unlockLabel(skin)).toContain(String(waves));
    // ★ "이상"이 빠지면 하드로 40웨이브를 깬 사람에게 "20웨이브 클리어"가 아직 못 한 일처럼
    // 읽힌다 — 조건은 난이도를 묻지 않는 하한이다.
    expect(unlockLabel(skin)).toContain('이상');
    expect(unlockLabel(skinsFor(multiSkinType())[0]), '열린 스킨에는 조건 문구가 없다').toBeNull();
  });

  it('★ 조건은 난이도를 묻지 않는다 — 하드 도중 20웨이브만 넘겨도 열린다', () => {
    // 예전 규칙("그 판의 마지막 웨이브")이었다면 하드는 40을 다 깨야 했다.
    resetProgressForTest();
    const skin = locked();
    const waves = skin.unlock.kind === 'clearWaves' ? skin.unlock.waves : 0;
    expect(waves).toBeLessThanOrEqual(waveTotal('hard'));
    recordWaveCleared(waves);            // 하드 판 도중 w20을 넘긴 상태
    expect(isSkinUnlocked(skin)).toBe(true);
  });

  it('잠긴 스킨은 고를 수 없다', () => {
    const type = multiSkinType();
    expect(setSkin(type, locked().id)).toBe(false);
    expect(selectedSkinId(type)).toBe(DEFAULT_SKIN_ID);
    expect(allySpriteUrl(type)).toBe(SKINS[type][0].url);
  });

  it('클리어를 기록하면 곧바로 고를 수 있다', () => {
    const type = multiSkinType();
    unlockAllSkins();
    expect(isSkinUnlocked(locked())).toBe(true);
    expect(setSkin(type, locked().id)).toBe(true);
    expect(allySpriteUrl(type)).toBe(locked().url);
  });

  it('★ 잠김 판정은 읽을 때마다 한다 — 잠기면 그림이 즉시 기본으로 돌아간다', () => {
    // 저장 시점에만 판정하면, 저장값을 손으로 고친 사용자에게는 잠긴 그림이 그대로 그려진다.
    // 게다가 판정 지점이 여럿이면 아이콘·보드·고스트 중 일부만 잠긴 그림을 쓰는 어긋남이 난다.
    const type = multiSkinType();
    unlockAllSkins();
    setSkin(type, locked().id);
    expect(allySpriteUrl(type)).toBe(locked().url);

    resetProgressForTest();                       // 다시 잠긴 상태로
    expect(selectedSkinId(type)).toBe(DEFAULT_SKIN_ID);
    expect(allySpriteUrl(type)).toBe(SKINS[type][0].url);
  });

  it('★ 잠겨 있어도 골라 둔 선택은 버리지 않는다 — 해금하면 되살아난다', () => {
    // "잠겼으니 기본으로 덮어쓴다"고 구현하면 이 테스트가 실패한다. 사용자가 고른 것을
    // 조용히 지우는 쪽이 훨씬 나쁜 동작이다.
    const type = multiSkinType();
    unlockAllSkins();
    setSkin(type, locked().id);
    resetProgressForTest();
    expect(selectedSkinId(type)).toBe(DEFAULT_SKIN_ID);   // 잠긴 동안에는 기본을 그리지만

    unlockAllSkins();
    expect(selectedSkinId(type), '해금 후 옛 선택이 되살아나야 한다').toBe(locked().id);
  });
});
