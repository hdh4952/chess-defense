// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dropAction, DragController, pickDropTarget, type DropZones } from '../src/ui/drag';
import { sellPrice } from '../src/core/economy';
import { createLayout } from '../src/ui/layout';
import type { UiAudio } from '../src/audio';
import type { UiCueKind } from '../src/audio/cues';
import type { GameEvent, GameState } from '../src/types';
import { boardPiece, waveState, cleanState } from './helpers';
import { buildHighlights } from '../src/render/highlights';
import { CONFIG } from '../src/config';

/** UiAudio 스텁 — DragController가 어떤 UI 큐를 어떤 순서로 재생 요청했는지만 기록한다.
 *  (실제 재생/스로틀은 cues.ts/audio/index.ts 쪽 유닛 테스트가 이미 검증한다 — 여기서는
 *  "DragController가 올바른 지점에서 올바른 큐 이름으로 부르는가"만 본다.) */
function makeAudioSpy(): UiAudio & { played: UiCueKind[] } {
  return {
    played: [],
    playUi(cue: UiCueKind): void {
      this.played.push(cue);
    },
  };
}

// v1.12: 존이 둘로 줄었다. 기물 보관함이 사라지면서 DropZones.slots가 통째로 없어졌고,
// 드래그의 목적지는 보드 칸 아니면 판매 슬롯뿐이다.
const zones: DropZones = {
  board: { left: 100, top: 0, width: 640, height: 640 },
  sell: { left: 800, top: 0, width: 100, height: 100 },
};

describe('pickDropTarget', () => {
  it('보드 좌표 → 칸 (좌상단 = a8)', () => {
    expect(pickDropTarget(101, 1, zones)).toEqual({ kind: 'square', file: 0, rank: 8 });
    expect(pickDropTarget(100 + 639, 639, zones)).toEqual({ kind: 'square', file: 7, rank: 1 });
    expect(pickDropTarget(100 + 250, 500, zones)).toEqual({ kind: 'square', file: 3, rank: 2 });
  });
  it('판매/바깥 판정 — 옛 슬롯 그리드 자리는 이제 아무 존도 아니다', () => {
    expect(pickDropTarget(850, 50, zones)).toEqual({ kind: 'sell' });
    expect(pickDropTarget(999, 999, zones)).toBeNull();
    // ⚠️ 여기 있던 `{ kind: 'slot', index }` 단언이 v1.12에서 사라졌다 — 판정할 존 자체가 없다.
    // 지우고 끝내지 않고 **같은 좌표가 이제 null이 되는 것**을 고정한다: 보드 왼쪽의 이 빈
    // 공간이 다시 무언가를 삼키기 시작하면(존이 되살아나면) 여기서 먼저 빨개진다.
    expect(pickDropTarget(50, 20, zones)).toBeNull();
  });
});

describe('dropAction (스펙 7.5 동작표)', () => {
  // ⚠️ 이 스위트에 있던 슬롯 출발 케이스 넷(슬롯 → 보드 배치 · 슬롯 → 슬롯 재정렬 ·
  // 슬롯 → 판매 · 슬롯 → 점유 칸 거부)이 v1.12에서 삭제됐다. dropAction의 `from` 인자와 함께
  // 출발지 분기 자체가 없어졌기 때문이다 — 모든 기물이 보드 위에 있으므로 드래그는 언제나
  // 보드에서 출발한다. 그 케이스들이 지키던 규칙 중 살아남은 것(8랭크 금지·판매)은 아래
  // 보드 출발 케이스가 그대로 이어받는다.

  it('보드 → 보드 빈칸 = 이동, 보드 → 판매 = 판매', () => {
    const s = waveState();
    const p = boardPiece('rook', 0, 1);
    s.pieces.push(p);

    expect(dropAction(s, p.id, { kind: 'square', file: 5, rank: 5 }, [])).toBe(true);
    expect(p.square).toEqual({ file: 5, rank: 5 });

    const gold = s.gold;
    expect(dropAction(s, p.id, { kind: 'sell' }, [])).toBe(true);
    expect(s.gold).toBe(gold + sellPrice('rook'));
    expect(s.pieces).toHaveLength(0);   // 보드에서 기물을 치우는 유일한 수단이 판매다
  });

  it('보드 → 점유된 보드 칸 = 맞교환 (게임 규칙 변경, 사용자 승인)', () => {
    const s = waveState();
    const p = boardPiece('rook', 0, 1);
    const occupant = boardPiece('bishop', 5, 5);
    s.pieces.push(p, occupant);
    expect(dropAction(s, p.id, { kind: 'square', file: 5, rank: 5 }, [])).toBe(true);
    expect(p.square).toEqual({ file: 5, rank: 5 });
    expect(occupant.square).toEqual({ file: 0, rank: 1 });
  });

  it('무효 드롭(8랭크/null)은 false — 원위치 복귀 의미', () => {
    const s = waveState();
    const p = boardPiece('pawn', 2, 2);
    s.pieces.push(p);
    expect(dropAction(s, p.id, { kind: 'square', file: 0, rank: CONFIG.board.ranks }, [])).toBe(false);
    expect(dropAction(s, p.id, null, [])).toBe(false);
    expect(p.square).toEqual({ file: 2, rank: 2 });
  });
});

// ---------------------------------------------------------------------------
// DragController — DOM 레벨 스위트 (컨트롤러 결정: 브리프 Step 5의 수동 검증을
// 자동화된 PointerEvent 시퀀스로 대체한다. happy-dom은 PointerEvent를 완전히
// 지원하므로 (MouseEvent를 상속) 실제 브라우저 이벤트와 동일한 타입을 사용한다).
//
// happy-dom의 getBoundingClientRect()는 기본적으로 전부 0을 반환하므로, 각
// 테스트에서 캔버스/판매 슬롯 요소에 고정된 사각형을 오버라이드한다.
// (DragController에는 테스트용 seam을 추가하지 않는다 — 인스턴스 오버라이드만 사용)
// ---------------------------------------------------------------------------

const SQ = 80;              // 보드 오버라이드 사각형의 칸당 픽셀 (CONFIG.board.squarePx와 동일)
// 보드(x: 300~940)와 판매 슬롯(x: 1000~1100)이 서로 절대 겹치지 않도록 넉넉히 띄운다 —
// pickDropTarget은 판매 → 보드 순으로 판정하므로, 좌표가 우연히 다른 존과 겹치면 의도한
// 존이 아닌 곳으로 판정될 수 있다.
const BOARD_LEFT = 300;
const SELL_RECT = { left: 1000, top: 0, width: 100, height: 100 };
// 예전 슬롯 그리드(보드 왼쪽 0~176)가 있던 자리. v1.12에서 존이 사라졌으므로 그냥 빈 화면이고,
// 여기로 떨어뜨린 기물은 "모든 존 바깥"과 똑같이 원위치로 돌아와야 한다.
const OLD_TRAY_AREA = { x: 20, y: 20 };

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

const SELL_CENTER = { x: SELL_RECT.left + SELL_RECT.width / 2, y: SELL_RECT.top + SELL_RECT.height / 2 };

interface Rig {
  state: GameState; layout: ReturnType<typeof createLayout>; events: GameEvent[]; drag: DragController;
  audio: UiAudio & { played: UiCueKind[] };
}

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
  overrideRect(layout.sellSlot, SELL_RECT);

  const state = cleanState();
  state.phase = phase;
  const events: GameEvent[] = [];
  const audio = makeAudioSpy();
  const drag = new DragController(state, layout, events, audio);
  currentRig = { state, layout, events, drag, audio };
  return currentRig;
}

afterEach(() => {
  currentRig?.drag.destroy();
  currentRig = null;
  vi.useRealTimers();
});

/** DragController가 document.body에 붙인 고스트 (constructor에서 app 다음으로 추가됨).
 *  ⚠️ 인덱스로 집으므로 body 직속 자식의 개수·순서에 의존한다. v1.12에서 슬롯 그리드가
 *  사라졌지만 그것은 app **안쪽**(createLayout이 app.innerHTML에 그린다)이었으므로 body의
 *  자식은 여전히 [app, ghost] 둘이고 인덱스는 밀리지 않았다. body에 새 노드를 붙이는 변경이
 *  생기면 여기부터 고쳐야 한다. */
function ghostEl(): HTMLDivElement { return document.body.children[1] as HTMLDivElement; }

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

describe('DragController — 합성은 드래그 전용 (제스처 분리, 사용자 결정)', () => {
  // ⚠️ "트레이에서 드래그해 보드의 같은 종류 위에 놓아도 합성된다"가 v1.12에서 삭제됐다.
  // 트레이발 드래그라는 경로가 없어졌을 뿐 합성 규칙 자체는 그대로이고, 아래 보드 → 보드
  // 케이스가 같은 불변식(드래그면 합성)을 덮는다.

  it('드래그로 같은 종류 위에 놓으면 합성된다', () => {
    const { state, events } = setup('wave');
    const mover = boardPiece('rook', 0, 1);
    const occupant = boardPiece('rook', 5, 5);
    state.pieces.push(mover, occupant);

    drag_(squareCenter(0, 1), squareCenter(5, 5));

    expect(state.pieces).toHaveLength(1);
    expect(occupant.tier).toBe(2);
    expect(events.some(e => e.kind === 'merged')).toBe(true);
  });

  it('클릭-투-무브로 같은 종류 위에 놓으면 합성이 아니라 맞교환이다 — 되돌릴 수 없는 조작이 클릭 하나로 새어나가지 않는다', () => {
    const { state, events } = setup('wave');
    const mover = boardPiece('rook', 0, 1);
    const occupant = boardPiece('rook', 5, 5);
    state.pieces.push(mover, occupant);

    click(squareCenter(0, 1));      // 선택
    click(squareCenter(5, 5));      // 같은 종류 기물 클릭 = 이동 커밋

    expect(state.pieces).toHaveLength(2);
    expect(mover.tier).toBe(1);
    expect(occupant.tier).toBe(1);
    expect(mover.square).toEqual({ file: 5, rank: 5 });
    expect(occupant.square).toEqual({ file: 0, rank: 1 });
    expect(events.some(e => e.kind === 'merged')).toBe(false);
  });

  it('드래그 중 같은 종류 위에 올리면 결과 티어 미리보기가 뜬다 (놓기 전 유일한 사전 표시)', () => {
    const { state, drag } = setup('wave');
    const mover = boardPiece('bishop', 0, 1, 2);
    state.pieces.push(mover, boardPiece('bishop', 5, 5, 2));   // 같은 티어끼리만 합쳐진다

    const to = squareCenter(5, 5);
    document.dispatchEvent(pointer('pointerdown', squareCenter(0, 1).x, squareCenter(0, 1).y));
    document.dispatchEvent(pointer('pointermove', to.x, to.y));

    const hl = buildHighlights(state, drag.interaction);
    expect(hl.mergePreview).toEqual({ square: { file: 5, rank: 5 }, tier: 3 });

    document.dispatchEvent(pointer('pointerup', to.x, to.y));
  });
});

// ⚠️ 아래 두 스위트(드래그 제스처 / 클릭-투-무브)에서 슬롯이 얽힌 행 넷이 v1.12에서 함께
// 사라졌다: 슬롯 → 보드 배치 · 슬롯 → 슬롯 재정렬 · 슬롯 → 판매 · 보드 → 슬롯 회수(그리고
// "이미 점유된 트레이 칸은 가장 낮은 빈 슬롯으로" 컨트롤러 룰링까지). 기물 보관함이 없어져
// 동작표에서 그 행들이 통째로 빠졌기 때문이다 — 남은 행은 보드 → 보드와 보드 → 판매 둘뿐이고,
// 두 스위트는 그 둘을 드래그/클릭 양쪽 제스처로 각각 덮는다.

describe('DragController — 드래그 제스처 (스펙 7.5 동작표, 자동화된 Step 5 대체 1/2)', () => {
  it('1. 보드 → 보드 빈칸 = 이동 (cooldown 유지, 웨이브 중에도 자유 이동)', () => {
    const { state, drag } = setup('wave');
    const p = boardPiece('rook', 0, 1);
    p.cooldown = 1.2;
    state.pieces.push(p);

    drag_(squareCenter(0, 1), squareCenter(5, 5));

    expect(p.square).toEqual({ file: 5, rank: 5 });
    expect(p.cooldown).toBe(1.2);
    expect(drag.interaction.dragging).toBeNull();
    // ⚠️ v1.15에서 잠깐 back-out 스냅이 붙어 드롭 후에도 160ms 보였으나, 사용자 요청으로
    // v1.17에서 되돌렸다 — 다시 **드롭 즉시** 감춘다.
    expect(ghostEl().style.display).toBe('none');
  });

  /*
   * ⚠️ 여기 있던 스냅 전용 테스트 둘("스냅 애니메이션이 끝나면 고스트가 감춰진다" ·
   * "거부된 드롭에는 스냅이 붙지 않는다")을 v1.17에서 제거했다 — 사용자 요청으로 back-out
   * 스냅 자체가 사라졌다. 지키던 불변식("드롭 후 고스트가 남지 않는다")은 위 동작표 1행이
   * 그대로 잰다.
   */

  it('2. 보드 → 판매 = 판매. 판매 슬롯 hover 시 환급 프리뷰 먼저 표시', () => {
    const { state, layout, drag } = setup('wave');
    const p = boardPiece('pawn', 3, 3);
    state.pieces.push(p);
    const goldBefore = state.gold;

    document.dispatchEvent(pointer('pointerdown', squareCenter(3, 3).x, squareCenter(3, 3).y));
    document.dispatchEvent(pointer('pointermove', SELL_CENTER.x, SELL_CENTER.y));

    expect(layout.sellSlot.classList.contains('armed')).toBe(true);
    expect(layout.sellSlot.querySelector('#sell-preview')!.textContent).toBe(`+${sellPrice('pawn')}G`);

    document.dispatchEvent(pointer('pointerup', SELL_CENTER.x, SELL_CENTER.y));

    expect(state.pieces.find(x => x.id === p.id)).toBeUndefined();
    expect(state.gold).toBe(goldBefore + sellPrice('pawn'));
    expect(layout.sellSlot.classList.contains('armed')).toBe(false);
    expect(layout.sellSlot.querySelector('#sell-preview')!.textContent).toBe('');
    expect(drag.interaction.dragging).toBeNull();
  });

  it('3. 무효 드롭(8랭크/옛 트레이 자리/모든 존 바깥)은 상태를 전혀 바꾸지 않고 고스트/프리뷰를 정리한다', () => {
    const { state, layout, drag, events } = setup('wave');
    const p = boardPiece('pawn', 0, 1);
    state.pieces.push(p);
    const goldBefore = state.gold;
    const home = { file: 0, rank: 1 };

    drag_(squareCenter(0, 1), squareCenter(0, CONFIG.board.ranks));   // 최상단 랭크 = 스폰 구역
    expect(p.square).toEqual(home);
    expect(ghostEl().style.display).toBe('none');
    expect(layout.sellSlot.querySelector('#sell-preview')!.textContent).toBe('');

    // 판매 슬롯이 사라진 자리가 아니라 **트레이가** 사라진 자리다 — 예전에는 여기 놓으면
    // 회수(보드 → 슬롯)였다. 존이 없어졌으므로 이제는 그냥 원위치 복귀여야 한다.
    drag_(squareCenter(0, 1), OLD_TRAY_AREA);
    expect(p.square).toEqual(home);

    drag_(squareCenter(0, 1), { x: 5000, y: 5000 });                  // 모든 존 바깥
    expect(p.square).toEqual(home);

    expect(state.gold).toBe(goldBefore);
    expect(state.pieces).toHaveLength(1);
    expect(drag.interaction.dragging).toBeNull();
    expect(ghostEl().style.display).toBe('none');
    expect(events).toHaveLength(0);                      // 거부된 동작은 이벤트도 발생시키지 않는다 (Finding 9)
  });

  it('4. 보드 → 점유된 보드 칸 드래그 드롭 = 두 기물이 서로 자리를 맞바꾼다 (게임 규칙 변경, 사용자 승인)', () => {
    const { state, drag } = setup('wave');
    const mover = boardPiece('rook', 0, 1);
    const occupant = boardPiece('bishop', 5, 5);
    state.pieces.push(mover, occupant);

    drag_(squareCenter(0, 1), squareCenter(5, 5));

    expect(mover.square).toEqual({ file: 5, rank: 5 });
    expect(occupant.square).toEqual({ file: 0, rank: 1 });
    expect(drag.interaction.dragging).toBeNull();
  });
});

describe('DragController — 클릭-투-무브 (스펙 7.5 동작표, 자동화된 Step 5 대체 2/2)', () => {
  it('1. 보드 → 보드 빈칸 = 이동, cooldown은 그대로 유지 (Finding 9 — 이전엔 cooldown:0이라 무의미했음)', () => {
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

  it('2. 보드 → 판매 = 판매', () => {
    const { state } = setup('wave');
    const p = boardPiece('bishop', 2, 2);
    state.pieces.push(p);
    const goldBefore = state.gold;

    click(squareCenter(2, 2));
    click(SELL_CENTER);

    expect(state.pieces.find(x => x.id === p.id)).toBeUndefined();
    // 판매가는 CONFIG에서 유도한다 — 여기서 고정하려는 건 "보드 기물을 판매 영역에 떨구면
    // 판매된다"는 동작이지 비숍의 가격이 아니다 (비숍 비용은 경제 기물 전환과 함께 바뀌었다).
    expect(state.gold).toBe(goldBefore + sellPrice('bishop'));
  });

  it('3. 무효 대상(8랭크/옛 트레이 자리) 클릭은 상태를 바꾸지 않고 선택을 해제한다', () => {
    const { state, drag, events } = setup('wave');
    const p = boardPiece('pawn', 1, 1);
    state.pieces.push(p);

    click(squareCenter(1, 1));
    click(squareCenter(0, CONFIG.board.ranks));           // 8랭크 = 배치 불가

    expect(p.square).toEqual({ file: 1, rank: 1 });
    expect(drag.interaction.selectedPieceId).toBeNull();

    click(squareCenter(1, 1));
    click(OLD_TRAY_AREA);                                 // 존이 사라진 자리 = target null

    expect(p.square).toEqual({ file: 1, rank: 1 });
    expect(drag.interaction.selectedPieceId).toBeNull();
    expect(events).toHaveLength(0);
  });

  it('4. 보드 → 점유된 보드 칸 클릭-투-무브 = 두 기물이 서로 자리를 맞바꾼다 (게임 규칙 변경, 사용자 승인)', () => {
    const { state, drag } = setup('wave');
    const mover = boardPiece('rook', 1, 1);
    const occupant = boardPiece('bishop', 4, 4);
    state.pieces.push(mover, occupant);

    click(squareCenter(1, 1));
    expect(drag.interaction.selectedPieceId).toBe(mover.id);
    click(squareCenter(4, 4));

    expect(mover.square).toEqual({ file: 4, rank: 4 });
    expect(occupant.square).toEqual({ file: 1, rank: 1 });
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

describe('DragController — 이동 제약 없음 / 일시정지 (v1.10 쿨다운 → v1.11 L자, 스펙 7.7)', () => {
  it('★ 쿨다운이 남아 있어도 나이트를 집을 수 있다 — 이동 게이트가 사라졌다', () => {
    // 사용자가 "이동 쿨타임 있는게 불쾌하다"고 지적했던 바로 그 동작이다. 폭발이 감속으로
    // 바뀌면서 게이트의 근거 자체가 없어졌다 — 감속은 "언제 움직였는가"와 무관하기 때문이다.
    // cooldown을 인위적으로 넣어 두는 이유는, 게이트가 값이 아니라 **존재하지 않는 규칙**
    // 때문에 통과한다는 것을 증명하기 위해서다.
    const { state, drag } = setup('wave');
    const p = boardPiece('knight', 2, 2);
    p.cooldown = 2.4;
    state.pieces.push(p);

    document.dispatchEvent(pointer('pointerdown', squareCenter(2, 2).x, squareCenter(2, 2).y));

    // ★ toEqual이라 여분의 키도 잡는다 — v1.12에서 `from`이 사라진 뒤 Interaction.dragging은
    // pieceId 하나뿐이다. 출발지를 다시 들고 오려는 변경은 여기서 먼저 걸린다.
    expect(drag.interaction.dragging).toEqual({ pieceId: p.id });
    expect(ghostEl().style.display).toBe('block');
    expect(p.cooldown).toBe(2.4);                          // 집는 것만으로 쿨다운이 바뀌지는 않는다
  });

  it('★ 쿨다운 중인 나이트도 드롭까지 실제로 커밋된다', () => {
    // 위 테스트가 "집힌다"만 재는 것과 달리, 이건 드롭까지 가서 규칙(resolveLanding)에도
    // 쿨다운 거부가 남아 있지 않은지 확인한다. 두 곳 중 하나만 고치면 집히기는 하는데
    // 놓으면 원위치로 돌아오는 상태가 된다.
    // 목적지 (2,2)→(3,4)는 옛 L자 규칙에서도 허용되던 칸이다 — 이 테스트가 재려는 건 쿨다운
    // 하나뿐이므로 행마까지 얽힌 칸을 쓰면 실패 원인이 둘로 갈린다. 행마 제약이 사라졌다는
    // 사실은 바로 아래 테스트가 따로 고정한다.
    const { state } = setup('wave');
    const p = boardPiece('knight', 2, 2);
    p.cooldown = 2.4;
    state.pieces.push(p);

    drag_(squareCenter(2, 2), squareCenter(3, 4));
    expect(p.square).toEqual({ file: 3, rank: 4 });
  });

  it('★ 쿨다운 중인 나이트도 클릭-투-무브로 선택된다', () => {
    // 예전에는 거부된 눌림이 클릭-투-무브로 새어나가지 않게 downAt을 비웠다(검토 Item 1).
    // 거부 경로가 사라졌으므로 그 방어도 함께 사라졌고, 이제는 평범하게 선택돼야 한다.
    const { state, drag } = setup('wave');
    const p = boardPiece('knight', 2, 2);
    p.cooldown = 2.4;
    state.pieces.push(p);

    click(squareCenter(2, 2));
    expect(drag.interaction.selectedPieceId).toBe(p.id);
  });

  it('★ L자가 아닌 칸에도 나이트가 놓인다 — v1.11에서 행마 규칙마저 사라졌다', () => {
    // v1.10에서는 이 자리에 "사라진 것은 쿨다운이지 행마 규칙이 아니다"라며 **거부**를 고정한
    // 테스트가 있었다. 그 규칙이 없어졌으므로 지우는 대신 단언을 뒤집는다 — 삭제하면 누군가
    // resolveLanding에 L자 게이트를 되살려도 아무도 실패하지 않기 때문이다. 이 테스트가
    // 초록인 한 "나이트도 다른 기물과 똑같다"는 사용자 결정이 코드에 살아 있다.
    const { state, audio } = setup('wave');
    const p = boardPiece('knight', 2, 2);
    state.pieces.push(p);

    drag_(squareCenter(2, 2), squareCenter(2, 5));         // 직선 — 옛 규칙이라면 거부됐을 칸
    expect(p.square).toEqual({ file: 2, rank: 5 });
    expect(audio.played).toEqual(['uiPlace']);             // 거부음이 아니라 배치음이 난다
  });

  it('★ 나이트도 8랭크(스폰 구역)에는 못 놓는다 — 전 기물에 공통으로 남은 유일한 제약', () => {
    // 위 테스트의 짝. "제약이 전부 사라졌다"가 아니라 "나이트 전용 제약만 사라졌고 공통 제약은
    // 그대로"임을 고정해야, 게이트를 걷어내다 inLandableBounds까지 함께 무너뜨린 경우를 잡는다.
    // 거부 경로(uiInvalid)가 살아 있다는 증거이기도 하다 — 나이트는 이제 거부될 일이 이것뿐이다.
    const { state, audio } = setup('wave');
    const p = boardPiece('knight', 2, 2);
    state.pieces.push(p);

    drag_(squareCenter(2, 2), squareCenter(2, CONFIG.board.ranks));   // 최상단 랭크 = 적 스폰 구역
    expect(p.square).toEqual({ file: 2, rank: 2 });                   // 원위치 복귀
    expect(audio.played).toEqual(['uiInvalid']);
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
    expect(layout.sellSlot.querySelector('#sell-preview')!.textContent).toBe(`+${sellPrice('pawn')}G`);
    expect(state.pieces.find(x => x.id === p.id)).toBeDefined();  // 아직 판매되지 않았다 (프리뷰일 뿐)

    click(SELL_CENTER);                                        // 확정 클릭
    expect(state.pieces.find(x => x.id === p.id)).toBeUndefined();
    expect(state.gold).toBe(goldBefore + sellPrice('pawn'));
  });

  it('드래그 완료 후 남아있던 클릭 선택으로 다른 기물이 팔리지 않는다 (재현 시나리오)', () => {
    const { state } = setup('wave');
    const pawnA = boardPiece('pawn', 7, 7);      // 드래그와 무관한 구석 기물 (예전엔 트레이에 있었다)
    const pieceB = boardPiece('rook', 0, 1);
    state.pieces.push(pawnA, pieceB);
    const goldBefore = state.gold;

    click(squareCenter(7, 7));                                 // 1. pawnA를 클릭해 선택
    drag_(squareCenter(0, 1), squareCenter(5, 5));              // 2. 관계없는 pieceB를 드래그로 이동

    expect(pieceB.square).toEqual({ file: 5, rank: 5 });        // 드래그 자체는 정상 동작

    click(SELL_CENTER);                                         // 3. 판매 슬롯 클릭 (pawnA를 겨냥한 적 없음)

    expect(state.pieces.find(x => x.id === pawnA.id)).toBeDefined();  // pawnA는 팔리지 않는다
    expect(pawnA.square).toEqual({ file: 7, rank: 7 });          // 자리도 그대로
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

// ⚠️ 여기 있던 "쿨다운 라벨 타이머" 스위트가 v1.10에서 삭제됐다. 커서 옆에 남은 쿨다운을
// 띄우던 기구(showCooldown + 중첩 타이머 방지, 검토 Finding 5) 자체가 사라졌기 때문이다.
// ★ 그 기구는 원래 다른 거부 사유를 알리는 데 재활용할 후보였는데, 그 후보였던 사유 둘
// (typeMismatch/tierMismatch)마저 v1.12에서 사라졌다 — 트레이발 착지에만 있던 분기였다.
// 지금 남은 거부 사유는 outOfBounds와 tierOverflow뿐이고, 후자는 여전히 무음으로 거부된다.

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

// 지난 SVG 전환 시도에서 고스트 <img>에 style.css가 크기를 지정하는 클래스가 빠져, 이미지가
// 자기 고유 크기(45×45 viewBox가 브라우저 기본 배율로 확대된 크기)로 그려지며 드래그 내내
// 뷰포트를 뒤덮은 회귀가 있었다. 클래스가 실제로 붙어 있는지, draggable="false"도 함께 있는지
// 매 드래그 시작마다 확인한다.
describe('DragController — 드래그 고스트 이미지 안전장치 (지난 시도 회귀 방지)', () => {
  it('드래그 중 고스트는 draggable="false"와 style.css의 크기 클래스(.drag-ghost-icon)를 가진 <img>를 담는다', () => {
    const { state } = setup('wave');
    const p = boardPiece('pawn', 2, 2);
    state.pieces.push(p);

    document.dispatchEvent(pointer('pointerdown', squareCenter(2, 2).x, squareCenter(2, 2).y));

    const ghost = ghostEl();
    expect(ghost.className).toBe('drag-ghost');           // 부모 컨테이너: overflow:hidden 2차 방어선 대상
    const img = ghost.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.className).toBe('drag-ghost-icon');       // style.css 크기 규칙이 실제로 이 클래스를 타겟한다
    expect(img!.getAttribute('draggable')).toBe('false');

    document.dispatchEvent(pointer('pointerup', squareCenter(2, 2).x, squareCenter(2, 2).y));
  });
});

describe('DragController — destroy() (검토 Finding 7)', () => {
  it('destroy()는 리스너와 ghost DOM을 정리하고, 이후 이벤트를 무시한다', () => {
    const { state, drag } = setup('wave');
    const p = boardPiece('pawn', 2, 2);
    state.pieces.push(p);
    const ghost = ghostEl();

    drag.destroy();

    expect(document.body.contains(ghost)).toBe(false);

    drag_(squareCenter(2, 2), squareCenter(4, 4));      // destroy 이후에는 더 이상 반응하지 않는다
    expect(p.square).toEqual({ file: 2, rank: 2 });
    expect(drag.interaction.dragging).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// UI 제스처 사운드 (스펙 §10.1 v1.3, uiPickup 제거는 v1.4) — src/core/에는 대응 GameEvent가
// 없으므로, DragController가 audio(UiAudio)를 올바른 지점에서 올바른 큐로 호출하는지 DOM
// 레벨에서 직접 확인한다. v1.4: 집기/선택 시작(uiPickup)은 사용자가 실제로 들어보고 무음이
// 낫다고 판단해 완전히 제거됐다 — 아래 스위트는 "소리가 안 난다"를 적극적으로 고정한다.
//
// ⚠️ v1.12에서 "트레이 내 재정렬은 의도적 무음"이라는 예외 하나가 사라졌다(재정렬 자체가
// 없다). 그래서 playDropCue의 분기가 성공 = uiPlace / 판매 = uiSell / 거부 = uiInvalid
// 셋으로 줄었고, 아래 스위트도 그 셋만 덮는다.
// ---------------------------------------------------------------------------
describe('DragController — UI 제스처 사운드 (스펙 §10.1 v1.3/v1.4)', () => {
  it('드래그가 실제로 시작돼도 아무 소리도 나지 않는다 (v1.4 — uiPickup 제거)', () => {
    const { state, audio } = setup('wave');
    const p = boardPiece('pawn', 1, 1);
    state.pieces.push(p);

    document.dispatchEvent(pointer('pointerdown', squareCenter(1, 1).x, squareCenter(1, 1).y));

    expect(audio.played).toEqual([]);
  });

  it('쿨다운이 남은 나이트를 집어도 아무 소리도 나지 않는다', () => {
    // 예전에는 이 눌림이 **거부**됐고 그래도 무음이라는 것을 고정했다. 이제는 정상적으로
    // 집히는데 여전히 무음이어야 한다 — v1.4에서 uiPickup 큐 자체를 없앴기 때문이다.
    const { state, audio, drag } = setup('wave');
    const p = boardPiece('knight', 2, 2);
    p.cooldown = 2.4;
    state.pieces.push(p);

    document.dispatchEvent(pointer('pointerdown', squareCenter(2, 2).x, squareCenter(2, 2).y));

    expect(drag.interaction.dragging).not.toBeNull();     // 실제로 집혔는데도
    expect(audio.played).toEqual([]);                     // 무음이다
  });

  it('빈 칸 클릭(선택 없음)은 아무 소리도 내지 않는다', () => {
    const { audio } = setup('wave');
    click(squareCenter(3, 3));   // 빈 칸 — hit 없음
    expect(audio.played).toEqual([]);
  });

  it('클릭으로 기물을 선택하거나, 같은 기물을 다시 클릭해 해제해도 아무 소리도 나지 않는다 (v1.4 — uiPickup 제거)', () => {
    const { state, drag, audio } = setup('wave');
    const p = boardPiece('pawn', 6, 6);
    state.pieces.push(p);

    click(squareCenter(6, 6));                // 선택 시작 — 무음
    expect(drag.interaction.selectedPieceId).toBe(p.id);
    expect(audio.played).toEqual([]);

    click(squareCenter(6, 6));                // 같은 기물 재클릭 = 해제 — 여전히 무음
    expect(drag.interaction.selectedPieceId).toBeNull();
    expect(audio.played).toEqual([]);
  });

  it('보드 → 보드 빈칸 드래그 이동 성공은 uiPlace를 울린다 (집기 소리 없이 이 한 건만)', () => {
    const { state, audio } = setup('wave');
    const p = boardPiece('pawn', 2, 3);
    state.pieces.push(p);

    drag_(squareCenter(2, 3), squareCenter(5, 6));

    expect(audio.played).toEqual(['uiPlace']);
  });

  it('보드 → 보드 이동 성공(클릭-투-무브)도 uiPlace를 울린다', () => {
    const { state, audio } = setup('wave');
    const p = boardPiece('rook', 1, 1);
    state.pieces.push(p);

    click(squareCenter(1, 1));
    click(squareCenter(4, 4));

    expect(audio.played).toEqual(['uiPlace']);
  });

  it('맞교환도 성공이므로 uiPlace를 울린다 — 점유 칸이라고 거부음이 나지 않는다', () => {
    // 트레이가 있던 시절 점유 칸은 출발지에 따라 거부(uiInvalid)일 수 있었다. 이제 합성이
    // 아닌 점유 칸은 언제나 맞교환이므로 거부음이 날 자리가 아니다.
    const { state, audio } = setup('wave');
    state.pieces.push(boardPiece('rook', 1, 1), boardPiece('bishop', 4, 4));

    drag_(squareCenter(1, 1), squareCenter(4, 4));

    expect(audio.played).toEqual(['uiPlace']);
  });

  it('판매 성공(드래그·클릭 모두)은 uiSell을 울린다', () => {
    const { state, audio } = setup('wave');
    const dragged = boardPiece('rook', 0, 1);
    const clicked = boardPiece('rook', 7, 7);
    state.pieces.push(dragged, clicked);

    drag_(squareCenter(0, 1), SELL_CENTER);
    expect(audio.played).toEqual(['uiSell']);

    click(squareCenter(7, 7));
    click(SELL_CENTER);
    expect(audio.played).toEqual(['uiSell', 'uiSell']);
  });

  it('거부된 드롭(8랭크 등)은 uiInvalid를 울린다 — 게임이 조용히 원위치로 되돌리는 것의 유일한 청각 피드백', () => {
    const { state, audio } = setup('wave');
    const p = boardPiece('pawn', 0, 1);
    state.pieces.push(p);

    drag_(squareCenter(0, 1), squareCenter(0, CONFIG.board.ranks));   // 8랭크 = 스폰 구역, 배치 불가

    expect(audio.played).toEqual(['uiInvalid']);
  });

  it('거부된 클릭-투-무브도 uiInvalid를 울린다', () => {
    const { state, audio } = setup('wave');
    const p = boardPiece('pawn', 1, 1);
    state.pieces.push(p);

    click(squareCenter(1, 1));
    click(squareCenter(1, CONFIG.board.ranks));   // 8랭크 = 배치 불가

    expect(audio.played).toEqual(['uiInvalid']);
  });

  it('모든 존 바깥으로의 드롭(target=null)도 uiInvalid를 울린다', () => {
    const { state, audio } = setup('wave');
    const p = boardPiece('pawn', 1, 1);
    state.pieces.push(p);

    drag_(squareCenter(1, 1), { x: 5000, y: 5000 });

    expect(audio.played).toEqual(['uiInvalid']);
  });

  it('옛 트레이 자리로의 드롭도 이제는 거부음이다 — 존이 사라졌으므로 회수음(uiPlace)이 아니다', () => {
    const { state, audio } = setup('wave');
    const p = boardPiece('pawn', 1, 1);
    state.pieces.push(p);

    drag_(squareCenter(1, 1), OLD_TRAY_AREA);

    expect(audio.played).toEqual(['uiInvalid']);
    expect(p.square).toEqual({ file: 1, rank: 1 });
  });

  it('일시정지 중에는 드래그가 시작되지 않으므로 아무 소리도 나지 않는다', () => {
    const { state, audio } = setup('wave');
    const p = boardPiece('pawn', 1, 1);
    state.pieces.push(p);
    state.paused = true;

    document.dispatchEvent(pointer('pointerdown', squareCenter(1, 1).x, squareCenter(1, 1).y));

    expect(audio.played).toEqual([]);
  });
});
