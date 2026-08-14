// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { bishopTargets, knightMoves } from '../src/core/patterns';
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

  it('나이트 패널은 폭발 9칸과 L자 이동칸을 따로 표시한다', () => {
    const app = mount();
    const targets = markedSquares(app, 'knight', 'is-target');
    expect(targets.size).toBe(9);                       // 자기 칸 포함 주변 3×3
    expect(targets.has(`${RANGE_CENTER.file},${RANGE_CENTER.rank}`)).toBe(true);

    const expectedMoves = new Set(knightMoves(RANGE_CENTER).map(s => `${s.file},${s.rank}`));
    expect(markedSquares(app, 'knight', 'is-move')).toEqual(expectedMoves);
  });

  it('나이트 패널은 칠해진 두 색이 각각 무엇인지 범례로 밝힌다', () => {
    const app = mount();
    const legend = app.querySelector<HTMLElement>(
      '.title-panel[data-piece-type="knight"] .range-legend',
    )!;
    expect(legend.textContent).toContain('폭발');
    expect(legend.textContent).toContain('L자 이동');
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
