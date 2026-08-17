// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { bishopTargets, knightMoves, slowSquares } from '../src/core/patterns';
import type { PieceType } from '../src/types';
import { createTitleScreen, RANGE_CENTER, RANGE_RADIUS } from '../src/ui/titleScreen';

const TYPES: PieceType[] = ['pawn', 'knight', 'bishop', 'rook', 'queen'];

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

  it('★ 나이트 패널은 감속 칸(얼음)과 L자 이동칸(점선)을 따로 표시한다', () => {
    // 두 집합이 **다르다는 것**이 이 패널이 가르치는 전부다. 감속은 8랭크를 포함하고 이동은
    // 아니라서, 5×5 창 안에서도 두 표시가 어긋나는 칸이 보인다.
    const app = mount();
    // 나이트는 이제 공격하지 않는다 — 주황(is-target)이 한 칸도 없어야 한다.
    expect(markedSquares(app, 'knight', 'is-target').size).toBe(0);

    const slows = markedSquares(app, 'knight', 'is-slow');
    expect(slows).toEqual(new Set(slowSquares(RANGE_CENTER).map(s => `${s.file},${s.rank}`)));
    expect(slows.size).toBe(8);
    expect(slows.has(`${RANGE_CENTER.file},${RANGE_CENTER.rank}`)).toBe(false);   // 자기 칸 제외

    const expectedMoves = new Set(knightMoves(RANGE_CENTER).map(s => `${s.file},${s.rank}`));
    expect(markedSquares(app, 'knight', 'is-move')).toEqual(expectedMoves);
  });

  it('★ 융합물 패널은 공격 칸과 감속 칸을 둘 다 표시한다', () => {
    // 겸업이 이 기물들의 가치 명제인데, 한쪽만 그리면 그 명제가 그림에서 사라진다.
    const app = mount();
    expect(markedSquares(app, 'archbishop', 'is-target').size).toBeGreaterThan(0);
    expect(markedSquares(app, 'archbishop', 'is-slow'))
      .toEqual(new Set(slowSquares(RANGE_CENTER).map(s => `${s.file},${s.rank}`)));
  });

  it('나이트 패널은 칠해진 두 색이 각각 무엇인지 범례로 밝힌다', () => {
    const app = mount();
    const legend = app.querySelector<HTMLElement>(
      '.title-panel[data-piece-type="knight"] .range-legend',
    )!;
    expect(legend.textContent).toContain('감속');
    expect(legend.textContent).toContain('L자 이동');
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
