// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
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

/** file(0~7)/rank(1~8) 칸의 중심 화면 좌표 (보드 사각형: left=100, top=0, 640x640) */
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
  return { state, layout, events, drag };
}

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
    const { state, layout, drag } = setup('prepare');
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

  it('4. 보드 → 보드 빈칸 = 이동', () => {
    const { state, drag } = setup('wave');
    const p = boardPiece('pawn', 1, 1);
    state.pieces.push(p);

    click(squareCenter(1, 1));
    expect(drag.interaction.selectedPieceId).toBe(p.id);
    click(squareCenter(4, 4));

    expect(p.square).toEqual({ file: 4, rank: 4 });
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
    const { state, drag } = setup('prepare');
    const p = slotPiece('c7', 'pawn', 0);
    state.pieces.push(p);

    click(slotCenter(0));
    click(squareCenter(0, 8));                            // 8랭크 = 배치 불가

    expect(p.square).toBeNull();
    expect(p.slotIndex).toBe(0);
    expect(drag.interaction.selectedPieceId).toBeNull();
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

  it('일시정지 중에는 드래그도 클릭-투-무브도 아무것도 바꾸지 않는다', () => {
    const { state, drag } = setup('wave');
    const p = boardPiece('pawn', 1, 1);
    state.pieces.push(p);
    state.paused = true;

    drag_(squareCenter(1, 1), squareCenter(3, 3));
    expect(p.square).toEqual({ file: 1, rank: 1 });
    expect(drag.interaction.dragging).toBeNull();

    click(squareCenter(1, 1));
    expect(drag.interaction.selectedPieceId).toBeNull();
    expect(p.square).toEqual({ file: 1, rank: 1 });
  });
});
