// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dropAction, DragController, pickDropTarget, type DropZones } from '../src/ui/drag';
import { createInitialState } from '../src/core/state';
import { createLayout } from '../src/ui/layout';
import type { GameEvent, GameState, Piece, PieceType } from '../src/types';
import { boardPiece, waveState } from './helpers';

const zones: DropZones = {
  board: { left: 100, top: 0, width: 640, height: 640 },
  slots: [
    { left: 0, top: 0, width: 40, height: 40 },
    { left: 44, top: 0, width: 40, height: 40 },
  ],
  sell: { left: 800, top: 0, width: 100, height: 100 },
};

describe('pickDropTarget', () => {
  it('보드 좌표 → 칸 (좌상단 = a8)', () => {
    expect(pickDropTarget(101, 1, zones)).toEqual({ kind: 'square', file: 0, rank: 8 });
    expect(pickDropTarget(100 + 639, 639, zones)).toEqual({ kind: 'square', file: 7, rank: 1 });
    expect(pickDropTarget(100 + 250, 500, zones)).toEqual({ kind: 'square', file: 3, rank: 2 });
  });
  it('슬롯/판매/바깥 판정', () => {
    expect(pickDropTarget(50, 20, zones)).toEqual({ kind: 'slot', index: 1 });
    expect(pickDropTarget(850, 50, zones)).toEqual({ kind: 'sell' });
    expect(pickDropTarget(999, 999, zones)).toBeNull();
  });
});

describe('dropAction (스펙 7.5 동작표)', () => {
  function withSlotPiece(type: PieceType = 'pawn'): { s: GameState; p: Piece } {
    const s = waveState();
    const p: Piece = { id: 'x', type, square: null, slotIndex: 0, cooldown: 0, queenBuffCount: 0 };
    s.pieces.push(p);
    return { s, p };
  }

  it('슬롯 → 보드 빈칸 = 배치', () => {
    const { s, p } = withSlotPiece();
    expect(dropAction(s, 'x', 'slot', { kind: 'square', file: 2, rank: 3 }, [])).toBe(true);
    expect(p.square).toEqual({ file: 2, rank: 3 });
  });
  it('슬롯 → 슬롯 = 재정렬, 슬롯 → 판매 = 판매', () => {
    const { s, p } = withSlotPiece();
    expect(dropAction(s, 'x', 'slot', { kind: 'slot', index: 3 }, [])).toBe(true);
    expect(p.slotIndex).toBe(3);
    const gold = s.gold;
    expect(dropAction(s, 'x', 'slot', { kind: 'sell' }, [])).toBe(true);
    expect(s.gold).toBe(gold + 50);
  });
  it('보드 → 보드/슬롯/판매', () => {
    const s = waveState();
    const p = boardPiece('rook', 0, 1);
    s.pieces.push(p);
    expect(dropAction(s, p.id, 'board', { kind: 'square', file: 5, rank: 5 }, [])).toBe(true);
    expect(dropAction(s, p.id, 'board', { kind: 'slot', index: 2 }, [])).toBe(true);
    expect(p.slotIndex).toBe(2);
    p.square = { file: 0, rank: 1 }; p.slotIndex = null;
    const gold = s.gold;
    expect(dropAction(s, p.id, 'board', { kind: 'sell' }, [])).toBe(true);
    expect(s.gold).toBe(gold + 250);
  });
  it('무효 드롭(8랭크/점유/null)은 false — 원위치 복귀 의미', () => {
    const { s } = withSlotPiece();
    expect(dropAction(s, 'x', 'slot', { kind: 'square', file: 0, rank: 8 }, [])).toBe(false);
    expect(dropAction(s, 'x', 'slot', null, [])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DragController — DOM 레벨 스위트 (컨트롤러 결정: 브리프 Step 5의 수동 검증을
// 자동화된 PointerEvent 시퀀스로 대체한다. happy-dom은 PointerEvent를 완전히
// 지원하므로 (MouseEvent를 상속) 실제 브라우저 이벤트와 동일한 타입을 사용한다).
//
// happy-dom의 getBoundingClientRect()는 기본적으로 전부 0을 반환하므로, 각
// 테스트에서 캔버스/슬롯 칸/판매 슬롯 요소에 고정된 사각형을 오버라이드한다.
// (DragController에는 테스트용 seam을 추가하지 않는다 — 인스턴스 오버라이드만 사용)
// ---------------------------------------------------------------------------

const SQ = 80;              // 보드 오버라이드 사각형의 칸당 픽셀 (CONFIG.board.squarePx와 동일)
// 슬롯 그리드(4x4, x/y: 0~176) · 보드(x: 300~940) · 판매 슬롯(x: 1000~1100)이
// 서로 절대 겹치지 않도록 넉넉히 띄운다 — pickDropTarget은 판매→슬롯→보드 순으로
// 판정하므로, 좌표가 우연히 다른 존과 겹치면 의도한 존이 아닌 곳으로 판정될 수 있다.
const BOARD_LEFT = 300;
const SLOT_SIZE = 40;
const SLOT_GAP = 4;
const SELL_RECT = { left: 1000, top: 0, width: 100, height: 100 };

function overrideRect(el: Element, rect: { left: number; top: number; width: number; height: number }): void {
  el.getBoundingClientRect = () => ({
    ...rect,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    x: rect.left,
    y: rect.top,
    toJSON() { return this; },
  });
}

/** file(0~7)/rank(1~8) 칸의 중심 화면 좌표 (보드 사각형: left=BOARD_LEFT(300), top=0, 640x640) */
function squareCenter(file: number, rank: number): { x: number; y: number } {
  const row = 8 - rank;
  return { x: BOARD_LEFT + file * SQ + SQ / 2, y: row * SQ + SQ / 2 };
}

/** 슬롯 인덱스(4x4)의 중심 화면 좌표 */
function slotCenter(index: number): { x: number; y: number } {
  const col = index % 4, row = Math.floor(index / 4);
  const left = col * (SLOT_SIZE + SLOT_GAP), top = row * (SLOT_SIZE + SLOT_GAP);
  return { x: left + SLOT_SIZE / 2, y: top + SLOT_SIZE / 2 };
}

const SELL_CENTER = { x: SELL_RECT.left + SELL_RECT.width / 2, y: SELL_RECT.top + SELL_RECT.height / 2 };

interface Rig { state: GameState; layout: ReturnType<typeof createLayout>; events: GameEvent[]; drag: DragController }

// 검토 Finding 7: DragController는 document/window에 리스너를 붙인 채 destroy() 없이는 살아남는다.
// 매 테스트가 만든 컨트롤러를 추적해 afterEach에서 반드시 정리한다 (같은 파일 안에서 document는
// 테스트 간에 재사용되므로, 정리하지 않으면 이전 테스트의 리스너가 이후 테스트의 이벤트에도 반응한다).
let currentRig: Rig | null = null;

/** 매 테스트마다 깨끗한 DOM + 새 DragController를 준비한다. */
function setup(phase: GameState['phase'] = 'wave'): Rig {
  document.body.innerHTML = '';
  const app = document.createElement('div');
  document.body.appendChild(app);
  const layout = createLayout(app);

  overrideRect(layout.canvas, { left: BOARD_LEFT, top: 0, width: 640, height: 640 });
  const cells = [...layout.slotGrid.children];
  cells.forEach((cell, i) => {
    const col = i % 4, row = Math.floor(i / 4);
    overrideRect(cell, {
      left: col * (SLOT_SIZE + SLOT_GAP), top: row * (SLOT_SIZE + SLOT_GAP),
      width: SLOT_SIZE, height: SLOT_SIZE,
    });
  });
  overrideRect(layout.sellSlot, SELL_RECT);

  const state = createInitialState();
  state.phase = phase;
  const events: GameEvent[] = [];
  const drag = new DragController(state, layout, events);
  currentRig = { state, layout, events, drag };
  return currentRig;
}

afterEach(() => {
  currentRig?.drag.destroy();
  currentRig = null;
  vi.useRealTimers();
});

/** DragController가 document.body에 붙인 고스트/쿨다운 라벨 (constructor에서 app 다음으로 추가됨) */
function ghostEl(): HTMLDivElement { return document.body.children[1] as HTMLDivElement; }
function cooldownEl(): HTMLDivElement { return document.body.children[2] as HTMLDivElement; }

function pointer(type: string, x: number, y: number, button = 0): PointerEvent {
  return new PointerEvent(type, { clientX: x, clientY: y, button, bubbles: true });
}

function drag_(from: { x: number; y: number }, to: { x: number; y: number }): void {
  document.dispatchEvent(pointer('pointerdown', from.x, from.y));
  document.dispatchEvent(pointer('pointermove', to.x, to.y));
  document.dispatchEvent(pointer('pointerup', to.x, to.y));
}

function click(at: { x: number; y: number }): void {
  document.dispatchEvent(pointer('pointerdown', at.x, at.y));
  document.dispatchEvent(pointer('pointerup', at.x, at.y));
}

function slotPiece(id: string, type: PieceType, slotIndex: number): Piece {
  return { id, type, square: null, slotIndex, cooldown: 0, queenBuffCount: 0 };
}

describe('DragController — 드래그 제스처 (스펙 7.5 동작표 7행, 자동화된 Step 5 대체 1/2)', () => {
  it('1. 슬롯 → 보드 빈칸 = 배치', () => {
    const { state, drag } = setup('prepare');
    const p = slotPiece('d1', 'pawn', 0);
    state.pieces.push(p);

    drag_(slotCenter(0), squareCenter(2, 3));

    expect(p.square).toEqual({ file: 2, rank: 3 });
    expect(p.slotIndex).toBeNull();
    expect(drag.interaction.dragging).toBeNull();
    expect(ghostEl().style.display).toBe('none');       // 드롭 후 고스트 제거
  });

  it('2. 슬롯 → 슬롯 = 재정렬 (맞교환 포함)', () => {
    const { state } = setup('prepare');
    const p0 = slotPiece('d2a', 'pawn', 0);
    const p1 = slotPiece('d2b', 'bishop', 3);
    state.pieces.push(p0, p1);

    drag_(slotCenter(0), slotCenter(3));

    expect(p0.slotIndex).toBe(3);
    expect(p1.slotIndex).toBe(0);                        // 점유자와 맞교환
  });

  it('3. 슬롯 → 판매 = 판매 (50% 환급)', () => {
    const { state } = setup('prepare');
    const p = slotPiece('d3', 'rook', 0);
    state.pieces.push(p);
    const goldBefore = state.gold;

    drag_(slotCenter(0), SELL_CENTER);

    expect(state.pieces.find(x => x.id === p.id)).toBeUndefined();
    expect(state.gold).toBe(goldBefore + 250);            // rook 500 * 0.5
  });

  it('4. 보드 → 보드 빈칸 = 이동 (cooldown 유지, 웨이브 중에도 자유 이동)', () => {
    const { state, drag } = setup('wave');
    const p = boardPiece('rook', 0, 1);
    p.cooldown = 1.2;
    state.pieces.push(p);

    drag_(squareCenter(0, 1), squareCenter(5, 5));

    expect(p.square).toEqual({ file: 5, rank: 5 });
    expect(p.cooldown).toBe(1.2);
    expect(drag.interaction.dragging).toBeNull();
  });

  it('5. 보드 → 슬롯 = 회수', () => {
    const { state } = setup('wave');
    const p = boardPiece('rook', 0, 1);
    state.pieces.push(p);

    drag_(squareCenter(0, 1), slotCenter(2));

    expect(p.square).toBeNull();
    expect(p.slotIndex).toBe(2);
  });

  it("컨트롤러 룰링: 보드 → 이미 점유된 트레이 칸 = 가장 낮은 빈 슬롯으로 재배치 (occupant는 그대로)", () => {
    const { state } = setup('wave');
    const p = boardPiece('rook', 0, 1);
    const occupant = slotPiece('occ', 'pawn', 2);
    state.pieces.push(p, occupant);

    drag_(squareCenter(0, 1), slotCenter(2));             // 슬롯2는 occupant가 점유 중

    expect(p.square).toBeNull();
    expect(p.slotIndex).toBe(0);                          // 가장 낮은 빈 슬롯(0)으로 재배치
    expect(occupant.slotIndex).toBe(2);                   // occupant는 밀려나지 않음
  });

  it('6. 보드 → 판매 = 판매. 판매 슬롯 hover 시 환급 프리뷰 먼저 표시', () => {
    const { state, layout, drag } = setup('wave');
    const p = boardPiece('pawn', 3, 3);
    state.pieces.push(p);
    const goldBefore = state.gold;

    document.dispatchEvent(pointer('pointerdown', squareCenter(3, 3).x, squareCenter(3, 3).y));
    document.dispatchEvent(pointer('pointermove', SELL_CENTER.x, SELL_CENTER.y));

    expect(layout.sellSlot.classList.contains('armed')).toBe(true);
    expect(layout.sellSlot.querySelector('#sell-preview')!.textContent).toBe('+50G');

    document.dispatchEvent(pointer('pointerup', SELL_CENTER.x, SELL_CENTER.y));

    expect(state.pieces.find(x => x.id === p.id)).toBeUndefined();
    expect(state.gold).toBe(goldBefore + 50);
    expect(layout.sellSlot.classList.contains('armed')).toBe(false);
    expect(layout.sellSlot.querySelector('#sell-preview')!.textContent).toBe('');
    expect(drag.interaction.dragging).toBeNull();
  });

  it('7. 무효 드롭(8랭크/점유 칸/모든 존 바깥)은 상태를 전혀 바꾸지 않고 고스트/프리뷰를 정리한다', () => {
    const { state, layout, drag, events } = setup('prepare');
    const p = slotPiece('d7', 'pawn', 0);
    state.pieces.push(p);
    const goldBefore = state.gold;

    drag_(slotCenter(0), squareCenter(0, 8));            // 8랭크 = 스폰 구역, 배치 불가
    expect(p.square).toBeNull();
    expect(p.slotIndex).toBe(0);
    expect(ghostEl().style.display).toBe('none');
    expect(layout.sellSlot.querySelector('#sell-preview')!.textContent).toBe('');

    const occupant = boardPiece('bishop', 4, 4);
    state.pieces.push(occupant);
    drag_(slotCenter(0), squareCenter(4, 4));            // 이미 점유된 칸
    expect(p.square).toBeNull();
    expect(p.slotIndex).toBe(0);
    expect(occupant.square).toEqual({ file: 4, rank: 4 });

    drag_(slotCenter(0), { x: 5000, y: 5000 });          // 모든 존 바깥
    expect(p.square).toBeNull();
    expect(p.slotIndex).toBe(0);

    expect(state.gold).toBe(goldBefore);
    expect(state.pieces).toHaveLength(2);
    expect(drag.interaction.dragging).toBeNull();
    expect(ghostEl().style.display).toBe('none');
    expect(events).toHaveLength(0);                      // 거부된 동작은 이벤트도 발생시키지 않는다 (Finding 9)
  });
});

describe('DragController — 클릭-투-무브 (스펙 7.5 동작표 7행, 자동화된 Step 5 대체 2/2)', () => {
  it('1. 슬롯 → 보드 빈칸 = 배치 (드래그와 동일한 목적지·결과)', () => {
    const { state, drag } = setup('prepare');
    const p = slotPiece('c1', 'pawn', 0);
    state.pieces.push(p);

    click(slotCenter(0));
    expect(drag.interaction.selectedPieceId).toBe(p.id);
    click(squareCenter(2, 3));                            // 드래그 테스트 1번과 동일한 목적지

    expect(p.square).toEqual({ file: 2, rank: 3 });        // 드래그와 동일한 결과
    expect(p.slotIndex).toBeNull();
    expect(drag.interaction.selectedPieceId).toBeNull();
  });

  it('2. 슬롯 → 슬롯 = 재정렬 (맞교환 포함)', () => {
    const { state, drag } = setup('prepare');
    const p0 = slotPiece('c2a', 'pawn', 0);
    const p1 = slotPiece('c2b', 'bishop', 3);
    state.pieces.push(p0, p1);

    click(slotCenter(0));
    click(slotCenter(3));

    expect(p0.slotIndex).toBe(3);
    expect(p1.slotIndex).toBe(0);
    expect(drag.interaction.selectedPieceId).toBeNull();
  });

  it('3. 슬롯 → 판매 = 판매', () => {
    const { state } = setup('prepare');
    const p = slotPiece('c3', 'rook', 0);
    state.pieces.push(p);
    const goldBefore = state.gold;

    click(slotCenter(0));
    click(SELL_CENTER);

    expect(state.pieces.find(x => x.id === p.id)).toBeUndefined();
    expect(state.gold).toBe(goldBefore + 250);
  });

  it('4. 보드 → 보드 빈칸 = 이동, cooldown은 그대로 유지 (Finding 9 — 이전엔 cooldown:0이라 무의미했음)', () => {
    const { state, drag } = setup('wave');
    const p = boardPiece('pawn', 1, 1);
    p.cooldown = 0.8;
    state.pieces.push(p);

    click(squareCenter(1, 1));
    expect(drag.interaction.selectedPieceId).toBe(p.id);
    click(squareCenter(4, 4));

    expect(p.square).toEqual({ file: 4, rank: 4 });
    expect(p.cooldown).toBe(0.8);
    expect(drag.interaction.selectedPieceId).toBeNull();
  });

  it('5. 보드 → 슬롯 = 회수', () => {
    const { state } = setup('wave');
    const p = boardPiece('rook', 0, 1);
    state.pieces.push(p);

    click(squareCenter(0, 1));
    click(slotCenter(2));

    expect(p.square).toBeNull();
    expect(p.slotIndex).toBe(2);
  });

  it('6. 보드 → 판매 = 판매', () => {
    const { state } = setup('wave');
    const p = boardPiece('bishop', 2, 2);
    state.pieces.push(p);
    const goldBefore = state.gold;

    click(squareCenter(2, 2));
    click(SELL_CENTER);

    expect(state.pieces.find(x => x.id === p.id)).toBeUndefined();
    expect(state.gold).toBe(goldBefore + 150);            // bishop 300 * 0.5
  });

  it('7. 무효 대상(8랭크/점유 칸) 클릭은 상태를 바꾸지 않고 선택을 해제한다', () => {
    const { state, drag, events } = setup('prepare');
    const p = slotPiece('c7', 'pawn', 0);
    state.pieces.push(p);

    click(slotCenter(0));
    click(squareCenter(0, 8));                            // 8랭크 = 배치 불가

    expect(p.square).toBeNull();
    expect(p.slotIndex).toBe(0);
    expect(drag.interaction.selectedPieceId).toBeNull();

    const occupant = boardPiece('bishop', 4, 4);          // 점유 칸 케이스도 함께 확인 (Finding 9)
    state.pieces.push(occupant);
    click(slotCenter(0));
    click(squareCenter(4, 4));

    expect(p.square).toBeNull();
    expect(p.slotIndex).toBe(0);
    expect(occupant.square).toEqual({ file: 4, rank: 4 });
    expect(drag.interaction.selectedPieceId).toBeNull();
    expect(events).toHaveLength(0);
  });

  it('같은 기물을 두 번 클릭하면 선택이 해제된다', () => {
    const { state, drag } = setup('wave');
    const p = boardPiece('pawn', 6, 6);
    state.pieces.push(p);

    click(squareCenter(6, 6));
    expect(drag.interaction.selectedPieceId).toBe(p.id);
    click(squareCenter(6, 6));
    expect(drag.interaction.selectedPieceId).toBeNull();
    expect(p.square).toEqual({ file: 6, rank: 6 });        // 상태는 바뀌지 않음
  });

  it('미세한 떨림(< 6px)이 섞여도 클릭으로 인식된다 (CLICK_DIST 임계값)', () => {
    const { state, drag } = setup('wave');
    const p = boardPiece('queen', 5, 5);
    state.pieces.push(p);
    const at = squareCenter(5, 5);

    document.dispatchEvent(pointer('pointerdown', at.x, at.y));
    document.dispatchEvent(pointer('pointermove', at.x + 3, at.y + 2));  // hypot(3,2)≈3.6px < 6px
    document.dispatchEvent(pointer('pointerup', at.x + 3, at.y + 2));

    // 드래그로 오인됐다면 selectedPieceId는 그대로 null이었을 것이다 (드래그 분기는 선택 상태를 건드리지 않음).
    expect(drag.interaction.selectedPieceId).toBe(p.id);
    expect(p.square).toEqual({ file: 5, rank: 5 });         // 위치도 그대로 (제자리 재선택)
  });
});

describe('DragController — 나이트 쿨다운 / 일시정지 (스펙 5.3, 7.7)', () => {
  it('쿨다운 중인 나이트: 드래그 시작 자체를 거부하고 남은 쿨다운을 표시한다', () => {
    const { state, drag } = setup('wave');
    const p = boardPiece('knight', 2, 2);
    p.cooldown = 2.4;
    state.pieces.push(p);

    document.dispatchEvent(pointer('pointerdown', squareCenter(2, 2).x, squareCenter(2, 2).y));

    expect(drag.interaction.dragging).toBeNull();          // 드래그 시작 자체가 거부됨
    expect(p.square).toEqual({ file: 2, rank: 2 });
    expect(p.cooldown).toBe(2.4);
    expect(cooldownEl().style.display).toBe('block');
    expect(cooldownEl().textContent).toBe('이동 쿨다운 2.4s');

    document.dispatchEvent(pointer('pointerup', squareCenter(2, 2).x, squareCenter(2, 2).y));
    expect(p.square).toEqual({ file: 2, rank: 2 });         // 직선 칸으로는 여전히 이동 안 됨
  });

  it('일시정지 중에는 드래그 시작 자체가 막힌다 — ghost도 뜨지 않는다 (Finding 2: onDown 가드에 실질적 검증)', () => {
    const { state, drag } = setup('wave');
    const p = boardPiece('pawn', 1, 1);
    state.pieces.push(p);
    state.paused = true;

    document.dispatchEvent(pointer('pointerdown', squareCenter(1, 1).x, squareCenter(1, 1).y));
    expect(drag.interaction.dragging).toBeNull();           // onDown 가드가 없다면 여기서 dragging이 채워진다
    expect(ghostEl().style.display).toBe('none');            // onDown 가드가 없다면 여기서 고스트가 보인다

    document.dispatchEvent(pointer('pointerup', squareCenter(1, 1).x, squareCenter(1, 1).y));
    expect(p.square).toEqual({ file: 1, rank: 1 });
    expect(drag.interaction.selectedPieceId).toBeNull();     // 클릭-투-무브 선택도 되지 않는다
  });

  it('드래그 도중 일시정지되면 onUp이 드래그 분기에 진입조차 하지 않는다 (Finding 2: onUp 가드 전용 경로)', () => {
    const { state, drag } = setup('wave');
    const p = boardPiece('pawn', 1, 1);
    state.pieces.push(p);

    document.dispatchEvent(pointer('pointerdown', squareCenter(1, 1).x, squareCenter(1, 1).y));
    expect(drag.interaction.dragging).not.toBeNull();        // 아직 일시정지 전이므로 정상적으로 드래그 시작
    document.dispatchEvent(pointer('pointermove', squareCenter(3, 3).x, squareCenter(3, 3).y));

    // moveOnBoard 자체도 interactable()에서 paused를 걸러내므로, 상태 불변 단언만으로는
    // onUp의 가드가 실제로 동작했는지(core의 이중 방어 때문에 우연히 통과한 건 아닌지) 구분할 수
    // 없다. 그래서 드래그 분기 안에서만(그리고 가드를 통과했을 때만) 건드리는 selectedPieceId를
    // 감시 값(sentinel)으로 세팅해 둔다 — 가드가 없다면 드래그 분기가 이 값을 null로 덮어쓴다.
    drag.interaction.selectedPieceId = 'sentinel';
    state.paused = true;                                      // 드래그 도중 일시정지 (onUp 가드만 검증하는 경로)
    document.dispatchEvent(pointer('pointerup', squareCenter(3, 3).x, squareCenter(3, 3).y));

    expect(p.square).toEqual({ file: 1, rank: 1 });           // 드롭이 커밋되지 않는다 (core의 방어와 별개로)
    expect(ghostEl().style.display).toBe('none');             // 고스트는 정리된다 (일반 규칙)
    expect(drag.interaction.dragging).toBeNull();
    expect(drag.interaction.selectedPieceId).toBe('sentinel'); // 드래그 분기 자체에 진입하지 않았다는 증거
  });
});

describe('DragController — 클릭 선택 안정성 (검토 Finding 1)', () => {
  it('클릭 선택 중 판매 슬롯에 hover하면 환급 프리뷰가 확정 클릭 전에 표시된다', () => {
    const { state, layout } = setup('wave');
    const p = boardPiece('pawn', 2, 2);
    state.pieces.push(p);
    const goldBefore = state.gold;

    click(squareCenter(2, 2));                                // 클릭으로 선택 (드래그 아님)
    document.dispatchEvent(pointer('pointermove', SELL_CENTER.x, SELL_CENTER.y));

    expect(layout.sellSlot.classList.contains('armed')).toBe(true);
    expect(layout.sellSlot.querySelector('#sell-preview')!.textContent).toBe('+50G');
    expect(state.pieces.find(x => x.id === p.id)).toBeDefined();  // 아직 판매되지 않았다 (프리뷰일 뿐)

    click(SELL_CENTER);                                        // 확정 클릭
    expect(state.pieces.find(x => x.id === p.id)).toBeUndefined();
    expect(state.gold).toBe(goldBefore + 50);
  });

  it('드래그 완료 후 남아있던 클릭 선택으로 다른 기물이 팔리지 않는다 (재현 시나리오)', () => {
    const { state } = setup('wave');
    const pawnA = slotPiece('stale-a', 'pawn', 0);
    const pieceB = boardPiece('rook', 0, 1);
    state.pieces.push(pawnA, pieceB);
    const goldBefore = state.gold;

    click(slotCenter(0));                                      // 1. 트레이의 pawnA를 클릭해 선택
    drag_(squareCenter(0, 1), squareCenter(5, 5));              // 2. 관계없는 pieceB를 드래그로 이동

    expect(pieceB.square).toEqual({ file: 5, rank: 5 });        // 드래그 자체는 정상 동작

    click(SELL_CENTER);                                         // 3. 판매 슬롯 클릭 (pawnA를 겨냥한 적 없음)

    expect(state.pieces.find(x => x.id === pawnA.id)).toBeDefined();  // pawnA는 팔리지 않는다
    expect(pawnA.slotIndex).toBe(0);
    expect(state.gold).toBe(goldBefore);                        // 골드도 그대로
  });
});

describe('DragController — pointercancel / Esc / 우클릭 / hover 정리 (검토 Finding 3, 4, 8)', () => {
  it('pointercancel은 드롭을 시도하지 않고 진행 중인 드래그만 정리한다', () => {
    const { state, drag } = setup('wave');
    const p = boardPiece('pawn', 1, 1);
    state.pieces.push(p);

    document.dispatchEvent(pointer('pointerdown', squareCenter(1, 1).x, squareCenter(1, 1).y));
    document.dispatchEvent(pointer('pointermove', squareCenter(4, 4).x, squareCenter(4, 4).y));
    expect(drag.interaction.dragging).not.toBeNull();

    document.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));

    expect(drag.interaction.dragging).toBeNull();
    expect(ghostEl().style.display).toBe('none');
    expect(p.square).toEqual({ file: 1, rank: 1 });             // 드롭이 발생하지 않았다
  });

  it('Esc는 진행 중인 드래그도 취소한다', () => {
    const { state, drag } = setup('wave');
    const p = boardPiece('pawn', 1, 1);
    state.pieces.push(p);

    document.dispatchEvent(pointer('pointerdown', squareCenter(1, 1).x, squareCenter(1, 1).y));
    document.dispatchEvent(pointer('pointermove', squareCenter(4, 4).x, squareCenter(4, 4).y));
    expect(drag.interaction.dragging).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(drag.interaction.dragging).toBeNull();
    expect(ghostEl().style.display).toBe('none');

    document.dispatchEvent(pointer('pointerup', squareCenter(4, 4).x, squareCenter(4, 4).y));
    expect(p.square).toEqual({ file: 1, rank: 1 });             // 취소 후 pointerup은 아무 일도 하지 않는다
  });

  it('onUp: 좌클릭이 아닌 버튼 해제는 드롭을 커밋하지 않는다', () => {
    const { state, drag } = setup('wave');
    const p = boardPiece('pawn', 1, 1);
    state.pieces.push(p);

    document.dispatchEvent(pointer('pointerdown', squareCenter(1, 1).x, squareCenter(1, 1).y, 0));
    expect(drag.interaction.dragging).not.toBeNull();
    document.dispatchEvent(pointer('pointermove', squareCenter(4, 4).x, squareCenter(4, 4).y, 0));
    document.dispatchEvent(pointer('pointerup', squareCenter(4, 4).x, squareCenter(4, 4).y, 2));  // 우클릭 해제

    expect(p.square).toEqual({ file: 1, rank: 1 });             // 커밋되지 않는다
    expect(drag.interaction.dragging).not.toBeNull();           // 드래그는 좌클릭 해제를 계속 기다린다

    document.dispatchEvent(pointer('pointerup', squareCenter(4, 4).x, squareCenter(4, 4).y, 0));  // 실제 좌클릭 해제
    expect(p.square).toEqual({ file: 4, rank: 4 });
    expect(drag.interaction.dragging).toBeNull();
  });

  it('pointerleave는 hoverSquare를 초기화한다', () => {
    const { drag } = setup('wave');
    document.dispatchEvent(pointer('pointermove', squareCenter(3, 3).x, squareCenter(3, 3).y));
    expect(drag.interaction.hoverSquare).toEqual({ file: 3, rank: 3 });

    document.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    expect(drag.interaction.hoverSquare).toBeNull();
  });
});

describe('DragController — 쿨다운 라벨 타이머 (검토 Finding 5)', () => {
  it('반복 거부 시 이전 타이머가 새 라벨을 조기에 숨기지 않는다', () => {
    vi.useFakeTimers();
    const { state } = setup('wave');
    const p = boardPiece('knight', 2, 2);
    p.cooldown = 3.0;
    state.pieces.push(p);
    const at = squareCenter(2, 2);

    document.dispatchEvent(pointer('pointerdown', at.x, at.y));       // t=0: 첫 거부, 타이머A(만료 t=800)
    document.dispatchEvent(pointer('pointerup', at.x, at.y));
    expect(cooldownEl().style.display).toBe('block');

    vi.advanceTimersByTime(600);                                      // t=600
    document.dispatchEvent(pointer('pointerdown', at.x, at.y));       // 재시도 → 타이머A 취소, 타이머B(만료 t=1400)
    document.dispatchEvent(pointer('pointerup', at.x, at.y));
    expect(cooldownEl().style.display).toBe('block');

    vi.advanceTimersByTime(600);                                      // t=1200: 타이머A였다면 이미 만료(800)됐을 시점
    expect(cooldownEl().style.display).toBe('block');                 // 타이머A가 취소됐으므로 라벨은 계속 보인다

    vi.advanceTimersByTime(250);                                      // t=1450: 타이머B(1400) 만료
    expect(cooldownEl().style.display).toBe('none');
  });
});

describe('DragController — zones() 캐시 (검토 Finding 6, 스펙 9.4)', () => {
  it('resize 전까지는 캐시된 사각형을 재사용하고, resize 후에는 새 레이아웃으로 갱신한다', () => {
    const { layout, drag } = setup('wave');
    const oldCenter = squareCenter(3, 3);

    document.dispatchEvent(pointer('pointermove', oldCenter.x, oldCenter.y));
    expect(drag.interaction.hoverSquare).toEqual({ file: 3, rank: 3 });   // 최초 계산 & 캐시

    overrideRect(layout.canvas, { left: 9000, top: 9000, width: 640, height: 640 }); // 레이아웃이 바뀐 것처럼 오버라이드
    document.dispatchEvent(pointer('pointermove', oldCenter.x, oldCenter.y));
    expect(drag.interaction.hoverSquare).toEqual({ file: 3, rank: 3 });   // 캐시가 살아있어 여전히 이전 좌표계로 판정

    window.dispatchEvent(new Event('resize'));
    document.dispatchEvent(pointer('pointermove', oldCenter.x, oldCenter.y));
    expect(drag.interaction.hoverSquare).toBeNull();                     // 무효화 후 재계산 → 더 이상 보드 안이 아님
  });

  it('scroll 이벤트도 캐시를 무효화한다', () => {
    const { layout, drag } = setup('wave');
    const oldCenter = squareCenter(3, 3);

    document.dispatchEvent(pointer('pointermove', oldCenter.x, oldCenter.y));
    expect(drag.interaction.hoverSquare).toEqual({ file: 3, rank: 3 });

    overrideRect(layout.canvas, { left: 9000, top: 9000, width: 640, height: 640 });
    window.dispatchEvent(new Event('scroll'));
    document.dispatchEvent(pointer('pointermove', oldCenter.x, oldCenter.y));
    expect(drag.interaction.hoverSquare).toBeNull();
  });

  it('드래그 시작(pointerdown) 시점에는 캐시 유무와 무관하게 최신 레이아웃을 사용한다', () => {
    const { state, layout, drag } = setup('wave');
    const p = boardPiece('pawn', 3, 3);
    state.pieces.push(p);
    const oldCenter = squareCenter(3, 3);

    document.dispatchEvent(pointer('pointermove', oldCenter.x, oldCenter.y));  // 캐시 생성 (구 레이아웃 기준)

    overrideRect(layout.canvas, { left: 9000, top: 9000, width: 640, height: 640 }); // resize 이벤트 없이 레이아웃만 변경
    document.dispatchEvent(pointer('pointerdown', oldCenter.x, oldCenter.y));  // 드래그 시작 = 최신 레이아웃으로 재계산

    expect(drag.interaction.dragging).toBeNull();     // 새 레이아웃 기준으로는 이 좌표에 보드/기물이 없다
  });
});

describe('DragController — destroy() (검토 Finding 7)', () => {
  it('destroy()는 리스너와 ghost/쿨다운 라벨 DOM을 정리하고, 이후 이벤트를 무시한다', () => {
    const { state, drag } = setup('wave');
    const p = boardPiece('pawn', 2, 2);
    state.pieces.push(p);
    const ghost = ghostEl();
    const cooldown = cooldownEl();

    drag.destroy();

    expect(document.body.contains(ghost)).toBe(false);
    expect(document.body.contains(cooldown)).toBe(false);

    drag_(squareCenter(2, 2), squareCenter(4, 4));      // destroy 이후에는 더 이상 반응하지 않는다
    expect(p.square).toEqual({ file: 2, rank: 2 });
    expect(drag.interaction.dragging).toBeNull();
  });
});
