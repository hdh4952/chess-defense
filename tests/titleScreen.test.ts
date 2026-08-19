// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONFIG, TRAITS } from '../src/config';
import { bishopTargets, slowSquares } from '../src/core/patterns';
import type { PieceType } from '../src/types';
import { recordWaveCleared, resetProgressForTest } from '../src/progress';
import {
  allySpriteUrl, DEFAULT_SKIN_ID, resetSkinsForTest, selectedSkinId, SKINS, skinsFor, unlockLabel,
} from '../src/render/skins';
import { CREDIT_HTML, createLayout, PIECE_NAME } from '../src/ui/layout';
import { createTitleScreen, RANGE_CENTER, RANGE_RADIUS } from '../src/ui/titleScreen';

const TYPES: PieceType[] = ['pawn', 'knight', 'bishop', 'rook', 'queen'];
/** 탭에 실제로 실리는 전 기물(융합물 포함). TAB_ORDER와 같은 출처에서 뽑아 두면 기물이
 *  늘어도 전수 검사가 저절로 따라온다 — 여기에 목록을 다시 적으면 그 순간 갈라진다. */
const ALL_TYPES: PieceType[] = Object.keys(TRAITS) as PieceType[];

// 스킨 선택은 모듈 전역이라 한 테스트가 바꾼 값이 다음 테스트로 새어 나간다 (skins.ts의
// resetSkinsForTest는 그래서 있다). 시작 화면 스위트 전체가 스킨에 영향을 받으므로
// (아이콘 src 단언 등) 파일 단위로 되돌린다.
afterEach(() => { resetSkinsForTest(); resetProgressForTest(); });

/**
 * 잠긴 스킨의 조건을 전부 만족시킨다. **필요한 웨이브 수를 스킨 표에서 유도한다** — 여기에
 * 20을 적어 두면 조건을 바꿨을 때 이 스위트만 옛 수로 통과하거나 실패한다(§10.2).
 */
function unlockAllSkins(): void {
  const need = Object.values(SKINS).flat()
    .reduce((m, s) => (s.unlock.kind === 'clearWaves' ? Math.max(m, s.unlock.waves) : m), 0);
  recordWaveCleared(need);
}

function mount(onBattle: () => void = () => {}): HTMLElement {
  const app = document.createElement('div');
  document.body.appendChild(app);
  createTitleScreen(app, onBattle);
  return app;
}

/** 미니보드에 실제로 칠해진 칸들을 "file,rank" 집합으로 걷어온다 */
function markedSquares(app: HTMLElement, type: PieceType, cls: string): Set<string> {
  const cells = app.querySelectorAll<HTMLElement>(
    `.title-panel[data-piece-type="${type}"] .range-cell.${cls}`,
  );
  return new Set([...cells].map(c => `${c.dataset.file},${c.dataset.rank}`));
}

describe('createTitleScreen', () => {
  it('게임을 부팅하지 않는다 — 보드 캔버스 없이 battle 버튼만 있다', () => {
    const app = mount();
    expect(app.querySelector('#board')).toBeNull();
    expect(app.querySelector<HTMLButtonElement>('#battle')).not.toBeNull();
  });

  it('battle 클릭 시 onBattle을 정확히 한 번 호출한다', () => {
    let calls = 0;
    const app = mount(() => { calls++; });
    app.querySelector<HTMLButtonElement>('#battle')!.click();
    expect(calls).toBe(1);
  });

  it('처음에는 폰 패널만 보인다', () => {
    const app = mount();
    for (const type of TYPES) {
      const panel = app.querySelector<HTMLElement>(`.title-panel[data-piece-type="${type}"]`)!;
      expect(panel.hidden).toBe(type !== 'pawn');
    }
  });

  it('탭을 클릭하면 그 기물의 패널만 보인다', () => {
    const app = mount();
    app.querySelector<HTMLButtonElement>('.title-tab[data-piece-type="rook"]')!.click();
    for (const type of TYPES) {
      const panel = app.querySelector<HTMLElement>(`.title-panel[data-piece-type="${type}"]`)!;
      expect(panel.hidden).toBe(type !== 'rook');
    }
  });

  it('선택된 탭만 aria-selected=true를 갖는다', () => {
    const app = mount();
    app.querySelector<HTMLButtonElement>('.title-tab[data-piece-type="queen"]')!.click();
    for (const type of TYPES) {
      const tab = app.querySelector<HTMLElement>(`.title-tab[data-piece-type="${type}"]`)!;
      expect(tab.getAttribute('aria-selected')).toBe(type === 'queen' ? 'true' : 'false');
    }
  });

  it('각 패널의 가격·판매가를 CONFIG에서 그대로 가져온다', () => {
    const app = mount();
    for (const type of TYPES) {
      const panel = app.querySelector<HTMLElement>(`.title-panel[data-piece-type="${type}"]`)!;
      const cost = CONFIG.pieces[type].cost;
      expect(panel.textContent).toContain(`${cost}G`);
      expect(panel.textContent).toContain(`${cost * CONFIG.economy.sellRatio}G`);
    }
  });

  it('골드를 버는 기물만 골드 수입 줄을 갖는다 (현재 비숍) — 액수는 CONFIG에서 유도', () => {
    const app = mount();
    for (const type of TYPES) {
      const panel = app.querySelector<HTMLElement>(`.title-panel[data-piece-type="${type}"]`)!;
      const g = CONFIG.pieces[type].goldPerAttack;
      if (g > 0) {
        expect(panel.textContent).toContain(`공격 1회당 +${g}G`);
      } else {
        expect(panel.textContent).not.toContain('공격 1회당');
      }
    }
    // 위 루프가 "전부 0이라 아무것도 검사하지 않은" 채로 통과하지 않도록, 비숍이 실제로 버는
    // 기물이라는 전제를 명시적으로 고정한다.
    expect(CONFIG.pieces.bishop.goldPerAttack).toBeGreaterThan(0);
  });

  it('비숍 사거리 그림이 bishopTargets의 창 안 결과와 정확히 일치한다', () => {
    const app = mount();
    const expected = new Set(
      bishopTargets(RANGE_CENTER)
        .filter(s => Math.abs(s.file - RANGE_CENTER.file) <= RANGE_RADIUS
          && Math.abs(s.rank - RANGE_CENTER.rank) <= RANGE_RADIUS)
        .map(s => `${s.file},${s.rank}`),
    );
    expect(markedSquares(app, 'bishop', 'is-target')).toEqual(expected);
  });

  it('★ 나이트 패널이 칠하는 칸은 감속 하나뿐이다 — 공격도, 이동 후보도 아니다', () => {
    // v1.11 전에는 이 패널이 감속(얼음)과 L자 이동칸(점선) **둘**을 그렸고, 두 집합이 다르다는
    // 것이 가르칠 내용이었다. 이동 제한이 사라져 그릴 이동 후보가 없어졌으므로 이제 이 패널이
    // 말하는 것은 감속 하나다. ★ 그래도 L자는 남아 있다 — 행마가 아니라 능력 범위로.
    const app = mount();
    // 나이트는 이제 공격하지 않는다 — 주황(is-target)이 한 칸도 없어야 한다.
    expect(markedSquares(app, 'knight', 'is-target').size).toBe(0);

    const slows = markedSquares(app, 'knight', 'is-slow');
    expect(slows).toEqual(new Set(slowSquares(RANGE_CENTER).map(s => `${s.file},${s.rank}`)));
    expect(slows.size).toBe(8);
    expect(slows.has(`${RANGE_CENTER.file},${RANGE_CENTER.rank}`)).toBe(false);   // 자기 칸 제외
  });

  it('★ 어떤 패널도 이동 후보를 그리거나 이동 규칙을 말하지 않는다 (전 기물)', () => {
    // v1.11에서 나이트의 L자 이동 제약이 사라지면서, 기물마다 다른 "갈 수 있는 칸"이라는
    // 개념 자체가 없어졌다(is-move 클래스와 범례의 "점선 = L자 이동"이 함께 삭제됐다).
    // 나이트만 보면 나중에 다른 기물에 이동 제한이 되살아나도 이 화면은 조용하므로 전수로 훑는다.
    const app = mount();
    for (const type of ALL_TYPES) {
      const panel = app.querySelector<HTMLElement>(`.title-panel[data-piece-type="${type}"]`);
      expect(panel, type).not.toBeNull();   // 셀렉터가 헛돌아 "0칸"으로 통과하는 것을 막는다
      expect(markedSquares(app, type, 'is-move').size, type).toBe(0);
      expect(panel!.querySelector('.range-legend')!.textContent, type).not.toContain('이동');
    }
    // 위 루프가 markedSquares 오타로 언제나 빈 집합을 보는 상태에서 통과하지 않도록, 같은
    // 헬퍼가 실제로 칠해진 칸을 찾아낸다는 것을 대조군으로 함께 고정한다.
    expect(markedSquares(app, 'knight', 'is-slow').size).toBeGreaterThan(0);
  });

  it('★ 융합물 패널은 공격 칸과 감속 칸을 둘 다 표시한다', () => {
    // 겸업이 이 기물들의 가치 명제인데, 한쪽만 그리면 그 명제가 그림에서 사라진다.
    const app = mount();
    expect(markedSquares(app, 'archbishop', 'is-target').size).toBeGreaterThan(0);
    expect(markedSquares(app, 'archbishop', 'is-slow'))
      .toEqual(new Set(slowSquares(RANGE_CENTER).map(s => `${s.file},${s.rank}`)));
  });

  it('나이트 패널 범례는 칠해진 얼음색이 감속임을 밝힌다', () => {
    // 범례가 설명해야 할 색이 둘("감속" + "L자 이동")에서 하나로 줄었다 — 이동 문구가 빠졌는지는
    // 위의 전수 검사가 지킨다. 여기서는 남은 하나가 여전히 제 뜻을 말하는지만 본다.
    const app = mount();
    const legend = app.querySelector<HTMLElement>(
      '.title-panel[data-piece-type="knight"] .range-legend',
    )!;
    expect(legend.textContent).toContain('감속');
    // ★ 8랭크 포함은 이 기물의 핵심 성질인데 그림만으로는 5×5 창 밖이라 안 보인다 — 글로 말한다.
    expect(legend.textContent).toContain('8랭크');
    expect(legend.textContent).not.toContain('폭발');
  });

  it('퀸 패널 범례는 칠해진 칸이 공격이 아니라 버프 범위임을 밝힌다', () => {
    const app = mount();
    const legend = app.querySelector<HTMLElement>(
      '.title-panel[data-piece-type="queen"] .range-legend',
    )!;
    expect(legend.textContent).toContain('버프');
    expect(legend.textContent).not.toContain('공격');
  });

  it('퀸 패널은 공격이 아니라 8방향 버프 라인을 표시한다', () => {
    const app = mount();
    // queenLines는 8방향 관통이므로 창(5×5) 안에서는 중앙 + 4방향×2칸 + 4대각×2칸 = 17칸
    expect(markedSquares(app, 'queen', 'is-target').size).toBe(17);
  });
});

/**
 * 스킨 선택 (v1.19). 로비에서 기물 탭을 고르고 panel-head의 썸네일을 누르면 그 기물의 그림이
 * 바뀐다 — 이 화면 안의 세 곳(탭·패널·사거리 미니보드)이 **함께** 바뀌는 것이 요점이다.
 * 한 곳만 바뀌면 플레이어는 자기가 무엇을 골랐는지 확신할 수 없다.
 */
describe('스킨 선택 (panel-head)', () => {
  /** 스킨이 둘 이상인 기물 — 목록을 여기 다시 적으면 스킨이 늘 때 갈라진다. */
  const skinnable = ALL_TYPES.find(t => skinsFor(t).length > 1)!;

  // 이 스위트가 보는 것은 **고르는 동작**이다 — 해금은 아래 전용 describe가 본다.
  // 마운트 **전에** 해금해야 한다: 잠김 여부는 패널을 그리는 시점에 마크업으로 굳는다.
  beforeEach(() => { unlockAllSkins(); });

  function swatches(app: HTMLElement, type: PieceType): HTMLButtonElement[] {
    return [...app.querySelectorAll<HTMLButtonElement>(
      `.title-panel[data-piece-type="${type}"] .skin-swatch`,
    )];
  }

  it('스킨이 둘 이상인 기물의 패널에만 선택 버튼이 붙는다', () => {
    // 고를 것이 없는 기물에 버튼 한 칸을 띄우면 "잠긴 스킨"으로 읽힌다.
    const app = mount();
    expect(skinsFor(skinnable).length).toBeGreaterThan(1);   // 전제 고정 (공허 방지)
    expect(swatches(app, skinnable)).toHaveLength(skinsFor(skinnable).length);
    for (const type of ALL_TYPES) {
      if (skinsFor(type).length > 1) continue;
      expect(swatches(app, type), type).toHaveLength(0);
    }
  });

  it('선택 버튼은 panel-head 안에 있다 — 설명 본문이 아니라 기물 머리에서 고른다', () => {
    const app = mount();
    for (const btn of swatches(app, skinnable)) {
      expect(btn.closest('.panel-head')).not.toBeNull();
    }
  });

  it('처음에는 기본 스킨만 눌린 상태다', () => {
    const app = mount();
    for (const btn of swatches(app, skinnable)) {
      expect(btn.getAttribute('aria-pressed'), btn.dataset.skinId)
        .toBe(String(btn.dataset.skinId === DEFAULT_SKIN_ID));
    }
  });

  it('썸네일을 누르면 그 스킨이 선택되고 aria-pressed가 하나만 true가 된다', () => {
    const app = mount();
    const alt = skinsFor(skinnable)[1];
    swatches(app, skinnable).find(b => b.dataset.skinId === alt.id)!.click();

    expect(selectedSkinId(skinnable)).toBe(alt.id);
    const pressed = swatches(app, skinnable).filter(b => b.getAttribute('aria-pressed') === 'true');
    expect(pressed).toHaveLength(1);
    expect(pressed[0].dataset.skinId).toBe(alt.id);
  });

  it('★ 누르는 즉시 탭·패널·사거리 그림의 아이콘이 전부 새 스킨으로 바뀐다', () => {
    const app = mount();
    const alt = skinsFor(skinnable)[1];
    const icons = () => [...app.querySelectorAll<HTMLImageElement>(
      `img[data-piece-icon="${skinnable}"]`,
    )];
    // 탭 · 패널 머리 · 사거리 미니보드 가운데 칸 — 셋 다 잡혔는지부터 고정한다(셀렉터가
    // 헛돌면 아래 단언이 "빈 목록을 전부 통과"로 조용히 넘어간다).
    expect(icons().length).toBe(3);

    swatches(app, skinnable).find(b => b.dataset.skinId === alt.id)!.click();

    expect(allySpriteUrl(skinnable)).toBe(alt.url);
    for (const img of icons()) expect(img.getAttribute('src')).toBe(alt.url);
  });

  it('다른 기물의 아이콘은 건드리지 않는다', () => {
    const app = mount();
    const others = ALL_TYPES.filter(t => t !== skinnable);
    const before = new Map(others.map(t => [t, allySpriteUrl(t)]));

    swatches(app, skinnable).find(b => b.dataset.skinId === skinsFor(skinnable)[1].id)!.click();

    for (const type of others) {
      for (const img of app.querySelectorAll<HTMLImageElement>(`img[data-piece-icon="${type}"]`)) {
        expect(img.getAttribute('src'), type).toBe(before.get(type));
      }
    }
  });

  it('기본으로 되돌릴 수 있다', () => {
    const app = mount();
    const btns = swatches(app, skinnable);
    btns.find(b => b.dataset.skinId === skinsFor(skinnable)[1].id)!.click();
    btns.find(b => b.dataset.skinId === DEFAULT_SKIN_ID)!.click();

    expect(selectedSkinId(skinnable)).toBe(DEFAULT_SKIN_ID);
    expect(allySpriteUrl(skinnable)).toBe(skinsFor(skinnable)[0].url);
    for (const img of app.querySelectorAll<HTMLImageElement>(`img[data-piece-icon="${skinnable}"]`)) {
      expect(img.getAttribute('src')).toBe(skinsFor(skinnable)[0].url);
    }
  });

  it('이미 고른 스킨을 다시 눌러도 상태가 흐트러지지 않는다', () => {
    const app = mount();
    const alt = skinsFor(skinnable)[1];
    const btn = swatches(app, skinnable).find(b => b.dataset.skinId === alt.id)!;
    btn.click();
    btn.click();
    expect(selectedSkinId(skinnable)).toBe(alt.id);
    expect(swatches(app, skinnable).filter(b => b.getAttribute('aria-pressed') === 'true'))
      .toHaveLength(1);
  });

  it('선택 버튼이 스크린 리더용 이름을 갖는다 — 그림만으로는 무엇인지 알 수 없다', () => {
    const app = mount();
    for (const skin of skinsFor(skinnable)) {
      const btn = swatches(app, skinnable).find(b => b.dataset.skinId === skin.id)!;
      expect(btn.getAttribute('aria-label'), skin.id).toContain(skin.name);
      expect(btn.querySelector('img')!.getAttribute('draggable')).toBe('false');
    }
  });

  it('선택한 스킨이 게임 화면(뽑기 확률표)으로 이어진다', () => {
    // 로비에서 고른 스킨이 BATTLE 이후에 원래 그림으로 돌아가면 기능이 반쪽이다.
    // createLayout은 만들어지는 시점에 allySpriteUrl을 읽으므로 별도 배선 없이 따라온다.
    const app = mount();
    const alt = skinsFor(skinnable)[1];
    swatches(app, skinnable).find(b => b.dataset.skinId === alt.id)!.click();

    const game = document.createElement('div');
    document.body.appendChild(game);
    createLayout(game);
    const odds = [...game.querySelectorAll<HTMLImageElement>('#odds li img')];
    expect(odds.length).toBeGreaterThan(0);
    const names = [...game.querySelectorAll<HTMLElement>('#odds li span')].map(e => e.textContent);
    const idx = names.indexOf(PIECE_NAME[skinnable]);
    expect(idx, `${skinnable}이 확률표에 없다`).toBeGreaterThanOrEqual(0);
    expect(odds[idx].getAttribute('src')).toBe(alt.url);
  });
});

/**
 * 스킨 해금 조건이 화면에 드러나는 방식 (v1.19).
 *
 * 잠긴 스킨을 **숨기지 않고 잠긴 채로 보여주는** 것이 이 기능의 설계다 — 이 화면이 만들 수
 * 없는 융합 기물까지 탭에 두는 이유와 같다(숨기면 존재 자체를 모른다). 그래서 검사할 것도
 * "안 보인다"가 아니라 "보이되 눌리지 않고, 왜 그런지 읽을 수 있다"이다.
 */
describe('스킨 해금 조건 (panel-head)', () => {
  const skinnable = ALL_TYPES.find(t => skinsFor(t).length > 1)!;
  const lockedSkin = skinsFor(skinnable)[1];

  function swatch(app: HTMLElement, skinId: string): HTMLButtonElement {
    return app.querySelector<HTMLButtonElement>(
      `.title-panel[data-piece-type="${skinnable}"] .skin-swatch[data-skin-id="${skinId}"]`,
    )!;
  }

  it('잠긴 스킨도 목록에 그대로 보인다 — 숨기면 존재 자체를 모른다', () => {
    const app = mount();
    expect(swatch(app, lockedSkin.id)).not.toBeNull();
    expect(swatch(app, lockedSkin.id).querySelector('img')!.getAttribute('src')).toBe(lockedSkin.url);
  });

  it('잠긴 스킨은 잠긴 것으로 표시된다', () => {
    const app = mount();
    const btn = swatch(app, lockedSkin.id);
    expect(btn.classList.contains('is-locked')).toBe(true);
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(swatch(app, DEFAULT_SKIN_ID).getAttribute('aria-disabled'), '열린 스킨은 잠기지 않는다')
      .toBe('false');
  });

  it('★ 해금 조건을 눈으로도, 스크린 리더로도 읽을 수 있다', () => {
    // 자물쇠 그림만 두면 "왜 못 쓰는지"가 아무 데도 없다. 조건은 목표이므로 반드시 읽혀야 한다.
    const app = mount();
    const label = unlockLabel(lockedSkin)!;
    const btn = swatch(app, lockedSkin.id);
    expect(btn.getAttribute('aria-label')).toContain(label);
    const head = app.querySelector<HTMLElement>(
      `.title-panel[data-piece-type="${skinnable}"] .panel-head`,
    )!;
    expect(head.textContent, '화면에도 조건이 적혀 있어야 한다').toContain(label);
  });

  it('잠긴 스킨은 눌러도 바뀌지 않는다', () => {
    const app = mount();
    swatch(app, lockedSkin.id).click();
    expect(selectedSkinId(skinnable)).toBe(DEFAULT_SKIN_ID);
    expect(allySpriteUrl(skinnable)).toBe(skinsFor(skinnable)[0].url);
    expect(swatch(app, lockedSkin.id).getAttribute('aria-pressed')).toBe('false');
  });

  it('해금한 뒤 열면 자물쇠도 조건 문구도 사라지고 고를 수 있다', () => {
    unlockAllSkins();
    const app = mount();
    const btn = swatch(app, lockedSkin.id);
    expect(btn.classList.contains('is-locked')).toBe(false);
    expect(btn.getAttribute('aria-disabled')).toBe('false');
    expect(app.querySelector(`.title-panel[data-piece-type="${skinnable}"] .skin-hint`)).toBeNull();

    btn.click();
    expect(selectedSkinId(skinnable)).toBe(lockedSkin.id);
  });
});

/**
 * ★ v1.30에서 `tests/ui.test.ts`에서 이리로 옮겨 왔다. 게임 화면 하단의 크레딧 줄이
 * 사라지면서(사용자 결정) **시작 화면이 저작자 표시의 유일한 자리**가 됐기 때문이다.
 * 라이선스 위반은 테스트가 저절로 실패하지 않는 종류의 결함이라, 보증이 딸려 있던 스위트가
 * 지워질 때 함께 사라지면 안 된다.
 */
describe('저작자 표시줄 (NOTICE.md — CC BY-SA 이행)', () => {
  it('결과 화면이 아니라 상시 레이아웃에 크레딧이 있고, 저작자·출처·라이선스 링크를 포함한다', () => {
    const app = mount();
    const credit = app.querySelector('#credit');
    expect(credit).not.toBeNull();                 // #main 밖 일회성 오버레이가 아니라 항상 존재하는 요소
    expect(credit!.textContent).toContain('Cburnett');
    expect(credit!.textContent).toContain('CC BY-SA 3.0');
    // ★ 크레딧이 **자기 주장의 범위를 좁혀** 말하는지 (v1.19 — 스킨 도입). 스킨을 켜면 화면의
    // 그 기물은 위키미디어 저작물이 아니다. "기물 이미지: Cburnett …"이라고 두면 그들이 만들지
    // 않은 그림을 그들의 것으로 표시하게 된다 — BY 조항은 저작자를 빠뜨리지 않는 것만이 아니라
    // **엉뚱한 사람을 적지 않는 것**이기도 하다. 이 단언이 없으면 그 회귀는 조용히 배포된다.
    expect(credit!.textContent).toContain('기본 기물 이미지');

    const links = [...credit!.querySelectorAll('a')] as HTMLAnchorElement[];
    expect(links.length).toBeGreaterThanOrEqual(3);
    const licenseLink = links.find(a => a.getAttribute('href') === 'https://creativecommons.org/licenses/by-sa/3.0/');
    expect(licenseLink).toBeDefined();              // 라이선스 원문 링크
    const sourceLink = links.find(a => (a.getAttribute('href') ?? '').includes('commons.wikimedia.org'));
    expect(sourceLink).toBeDefined();                // 출처(Wikimedia Commons) 링크
    // 재검토 Item 2: NOTICE.md는 dist/에 포함되지 않으므로, 배포된 사이트에서 변경 내역까지
    // 확인하려면 저장소의 NOTICE.md로 가는 링크가 크레딧 안에 있어야 한다.
    const noticeLink = links.find(a => (a.getAttribute('href') ?? '').includes('NOTICE.md'));
    expect(noticeLink).toBeDefined();
  });

  it('★ 저작자 셋과 라이선스 버전 둘을 모두 표시한다 (v1.10 — 융합 기물 아트워크 교체)', () => {
    // 아트워크 출처가 갈라지면 BY 이행도 갈라진다. 융합 기물이 직접 만든 합성물에서 위키미디어의
    // 실제 페어리 기물로 바뀌면서 저작자가 셋(Cburnett / NikNaks93 / Mszulc29)이 됐고, 그중
    // 아마존만 **CC BY-SA 4.0**이다. 크레딧에 3.0만 적으면 그 파일의 BY 이행이 틀린 것이 된다.
    //
    // 이 단언이 없으면 다음에 아트워크를 바꿀 때 크레딧이 조용히 뒤처진다 — 라이선스 위반은
    // 테스트가 실패하지 않는 종류의 결함이라 사람이 알아채기 전까지 배포된 채로 남는다.
    const app = mount();
    const credit = app.querySelector('#credit')!;

    for (const author of ['Cburnett', 'NikNaks93', 'Mszulc29']) {
      expect(credit.textContent, author).toContain(author);
    }
    const hrefs = Array.from(credit.querySelectorAll('a')).map(a => a.getAttribute('href') ?? '');
    for (const v of ['3.0', '4.0']) {
      expect(hrefs, v).toContain(`https://creativecommons.org/licenses/by-sa/${v}/`);
    }
    expect(credit.textContent).toContain('CC BY-SA 4.0');
  });

  /**
   * ⚠️ **게임 화면에는 더 이상 크레딧이 없다** (v1.30). 그런데 게임 화면에도 위키미디어
   * 저작물은 남아 있다 — 뽑기 확률표의 기물 아이콘과 드래그 고스트가 `allySpriteUrl`을
   * 띄운다. 이 단언은 그 사실을 **기록으로 남긴다**: 표시가 시작 화면 하나로 좁아진 지금
   * 구성이 "게임의 크레딧은 타이틀 화면에 둔다"는 관행에 기대고 있다는 것.
   */
  it('★ 게임 화면에는 크레딧이 없지만 위키미디어 아트워크는 남아 있다 (v1.30 — 표시는 시작 화면이 전담)', () => {
    const app = document.createElement('div');
    document.body.appendChild(app);
    createLayout(app);
    expect(app.querySelector('#credit')).toBeNull();
    // 확률표 아이콘이 여전히 Cburnett SVG다.
    const icons = Array.from(app.querySelectorAll('#odds img')) as HTMLImageElement[];
    expect(icons.length).toBeGreaterThan(0);
    expect(icons[0].getAttribute('src')).toBe(allySpriteUrl('pawn'));
  });

  it('문구는 상수 하나에서 온다 — 화면마다 따로 적으면 한쪽만 갱신되는 사고가 난다', () => {
    expect(CREDIT_HTML).toContain('Cburnett');
    expect(CREDIT_HTML).toContain('Mszulc29');
    expect(CREDIT_HTML).toContain('by-sa/4.0');
  });
});
