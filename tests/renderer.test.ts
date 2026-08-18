import { describe, expect, it } from 'vitest';
import { boardPiece, cleanState } from './helpers';
import { CONFIG } from '../src/config';
import { BOARD_H, BOARD_W, fileCenterX, rankToTopY } from '../src/core/grid';
import {
  createFrameView, decalSignature, drawBoardBase, drawDecals, EMPTY_VIEW, SPAWN_BORDER_PX,
  TILE_BEVEL, TILE_GAP, TILE_PX,
} from '../src/render/renderer';
import { makeStubCtx } from './canvasStub';

const SQ = CONFIG.board.squarePx;

/**
 * v1.21 — 이 스위트의 대상이 좁아졌다. 기물·적은 더 이상 캔버스에 그려지지 않는다(3D 메시,
 * render3d/). 여기 남은 것은 **판에 깔리는 것**뿐이고, 그 둘은 다시 "한 번 굽고 끝"(판)과
 * "바뀔 때만 다시 굽는다"(데칼)로 갈린다.
 *
 * 기물·적·체력바·버프 배지의 렌더 검증은 tests/overlay.test.ts와 tests/render3d.test.ts로 옮겼다.
 */

describe('drawBoardBase() — 판 텍스처 (한 번만 굽는다)', () => {
  it('예외 없이 렌더되고, 보드 64칸을 모두 그린다 (8×8)', () => {
    const { ctx, records } = makeStubCtx();
    expect(() => drawBoardBase(ctx as unknown as CanvasRenderingContext2D)).not.toThrow();
    // ★ v1.23부터 타일은 칸(SQ)보다 작다 — 칸 경계에 홈(grout)을 파고 그 안쪽만 칠한다.
    //   기대값을 리터럴이 아니라 상수에서 유도해, 홈 두께를 조정해도 이 단언이 따라온다.
    expect(TILE_PX).toBe(SQ - TILE_GAP * 2);
    const squareFills = records.filter(
      r => r.method === 'fillRect' && r.args[2] === TILE_PX && r.args[3] === TILE_PX,
    );
    expect(squareFills).toHaveLength(64);
  });

  /**
   * ★ 판의 스타일은 **텍스처가 만든다.** 판은 위를 향한 평면이라 법선이 어디서나 같고,
   * 그래서 툰 램프가 판 위에서는 아무 일도 하지 않는다 — 재질만 갈아서는 판이 하나도
   * 안 바뀐다. 베벨이 빠지면 "보드도 툰으로"가 조용히 무효가 되므로 여기서 못박는다.
   */
  it('칸마다 홈과 안쪽 베벨(밝은 위·왼쪽 / 어두운 아래·오른쪽)이 들어간다', () => {
    const { ctx, records } = makeStubCtx();
    drawBoardBase(ctx as unknown as CanvasRenderingContext2D);

    // 홈은 판 전체를 한 번에 깔고 그 위에 타일을 얹는다 (칸마다 네 변을 긋지 않는다).
    expect(records[0]).toMatchObject({ method: 'fillRect', args: [0, 0, BOARD_W, BOARD_H] });
    expect(records[0].fillStyle).toBe('#6B4A32');

    // 칸당 베벨 띠는 넷 — 가로 둘(위·아래) + 세로 둘(왼쪽·오른쪽).
    const horiz = records.filter(r => r.method === 'fillRect' && r.args[2] === TILE_PX && r.args[3] === TILE_BEVEL);
    const vert = records.filter(r => r.method === 'fillRect' && r.args[2] === TILE_BEVEL && r.args[3] === TILE_PX);
    expect(horiz).toHaveLength(64 * 2);
    expect(vert).toHaveLength(64 * 2);
    // 밝은 칸 a1의 위쪽 띠가 타일 본체보다 밝고, 아래쪽 띠는 더 어둡다.
    const a1Top = horiz.find(r => r.args[0] === TILE_GAP && r.args[1] === rankToTopY(1) + TILE_GAP)!;
    const a1Bottom = horiz.find(
      r => r.args[0] === TILE_GAP && r.args[1] === rankToTopY(1) + TILE_GAP + TILE_PX - TILE_BEVEL,
    )!;
    expect(a1Top.fillStyle).not.toBe(a1Bottom.fillStyle);
  });

  it('8랭크(최상단, y=0)의 스폰 구역에 명도 오버레이 + 7랭크 경계의 불투명 경계선이 이중으로 덮인다', () => {
    // 재검토 수정: 예전에는 옅은 붉은 틴트(rgba(200,60,50,0.10)) 하나뿐이었는데, 나무색 보드
    // 위에서는 색상(hue)만 다르고 명도(luminance)는 거의 그대로라 인접 랭크와 육안으로
    // 구분되지 않는 결함이 있었다(SVG-report.md 참조). 지금은 명도 오버레이 + 불투명 경계선
    // 두 개의 fillRect로 이중 표식한다 — 이 테스트는 그 두 개가 모두 있는지, 정확한 색상인지,
    // 경계선이 7랭크를 침범하지 않고 8랭크 칸 안쪽에서 정확히 그 경계에 맞닿는지까지 고정한다.
    const { ctx, records } = makeStubCtx();
    drawBoardBase(ctx as unknown as CanvasRenderingContext2D);
    expect(rankToTopY(8)).toBe(0); // 8랭크가 최상단 행

    // 보드 폭(BOARD_W) 전체를 가로지르는 fillRect 중 **판 전체를 덮는 것(홈 바탕)을 뺀**
    // 나머지는 이 두 표식뿐이다. ★ v1.21에서 보스 비네트가 오버레이로 옮겨 갔고, v1.23에서
    // 타일 홈 바탕(BOARD_W × BOARD_H)이 하나 늘었다 — 높이로 갈라낸다.
    const spawnMarks = records.filter(
      r => r.method === 'fillRect' && r.args[2] === BOARD_W && r.args[3] !== BOARD_H,
    );
    expect(spawnMarks).toHaveLength(2);

    const overlay = spawnMarks.find(r => r.args[1] === 0);
    expect(overlay).toBeDefined();
    expect(overlay!.args).toEqual([0, 0, BOARD_W, SQ]);
    expect(overlay!.fillStyle).toBe('rgba(0, 0, 0, 0.14)');

    const border = spawnMarks.find(r => r.args[1] !== 0);
    expect(border).toBeDefined();
    expect(border!.fillStyle).toBe('#C83C32');
    const [bx, by, bw, bh] = border!.args as number[];
    expect(bx).toBe(0);
    expect(bw).toBe(BOARD_W);
    // 재검토 Important 1: by>0 && by+bh===SQ만으로는 두께 0(by=SQ, bh=0)짜리 "보이지 않는" 경계선도
    // 통과한다 — 이 결함을 고치는 커밋의 테스트가 정확히 그 결함을 놓치면 안 된다. SPAWN_BORDER_PX를
    // 리터럴로 못박아(자기 참조가 아니라 실제 의도한 값 4를 고정) 두께가 실제로 양수임을 보장한다.
    expect(SPAWN_BORDER_PX).toBe(4);
    expect(bh).toBe(SPAWN_BORDER_PX);
    expect(by).toBeGreaterThan(0);           // 8랭크 칸(y=0) 내부, 맨 위가 아니라 아래쪽 가장자리
    expect(by + bh).toBe(SQ);                // 경계선 하단이 정확히 7랭크와 맞닿는 지점 — 7랭크를 침범하지 않음
  });

  it('판 텍스처는 상태를 읽지 않는다 — 인자가 ctx 하나뿐이라는 것이 "한 번 굽고 끝"의 근거다', () => {
    expect(drawBoardBase).toHaveLength(1);
  });
});

describe('drawDecals() — 상태에 따라 바뀌는 바닥 표식', () => {
  it('맨 앞에서 캔버스를 지운다 — 데칼은 투명 계층이라 남은 잉크가 다음 프레임에 겹친다', () => {
    const { ctx, records } = makeStubCtx();
    drawDecals(ctx as unknown as CanvasRenderingContext2D, cleanState(), createFrameView());
    expect(records[0]?.method).toBe('clearRect');
  });

  it('하이라이트 fillRect는 file*squarePx와 rankToTopY(rank)로 그려진다', () => {
    const { ctx, records } = makeStubCtx();
    // file=5, rank=3은 일부러 피한다: file+rank === CONFIG.board.ranks(8)인 칸은
    // file*SQ === rankToTopY(rank)가 우연히 성립해(둘 다 같은 값), fillRect(x, y, …)의 x/y가
    // 뒤바뀌어도(transpose 버그) 이 단언을 그대로 통과시킨다 — 즉 그런 회귀를 절대 못 잡는
    // 좌표였다 (회귀 4). file+rank !== 8인 칸을 골라 x/y가 서로 다른 값이 되게 한다.
    const square = { file: 5, rank: 2 };
    expect(square.file * SQ).not.toBe(rankToTopY(square.rank));   // 전제 확인: x/y가 실제로 다르다
    const color = 'rgba(11, 22, 33, 0.5)';
    const view = createFrameView();
    view.highlights.push({ square, color });

    drawDecals(ctx as unknown as CanvasRenderingContext2D, cleanState(), view);

    const hit = records.find(r => r.method === 'fillRect' && r.fillStyle === color);
    expect(hit).toBeDefined();
    expect(hit!.args).toEqual([square.file * SQ, rankToTopY(square.rank), SQ, SQ]);
  });

  it('라인 moveTo/lineTo는 fileCenterX(file)와 rankToTopY(rank)+squarePx/2로 그려진다', () => {
    const { ctx, records } = makeStubCtx();
    const from = { file: 1, rank: 2 };
    const to = { file: 6, rank: 7 };
    const color = '#abcdef';
    const view = createFrameView();
    view.lines.push({ from, to, color });

    drawDecals(ctx as unknown as CanvasRenderingContext2D, cleanState(), view);

    const moveTo = records.find(r => r.method === 'moveTo' && r.strokeStyle === color);
    const lineTo = records.find(r => r.method === 'lineTo' && r.strokeStyle === color);
    expect(moveTo).toBeDefined();
    expect(lineTo).toBeDefined();
    expect(moveTo!.args).toEqual([fileCenterX(from.file), rankToTopY(from.rank) + SQ / 2]);
    expect(lineTo!.args).toEqual([fileCenterX(to.file), rankToTopY(to.rank) + SQ / 2]);
  });

  it('freeze 이후에도 기본 인자 경로(view 생략)는 정상 동작한다', () => {
    const { ctx } = makeStubCtx();
    expect(() => drawDecals(ctx as unknown as CanvasRenderingContext2D, cleanState())).not.toThrow();
  });
});

/**
 * ★ v1.21 신설. 데칼 텍스처를 **매 프레임 GPU에 올리지 않기 위한** 서명이고, 그 절약이
 * 성립하려면 두 가지가 동시에 참이어야 한다: (1) 그림이 같으면 서명도 같고, (2) 그림이
 * 달라지면 서명도 반드시 달라진다. (2)를 놓치면 화면이 옛 하이라이트에 얼어붙는다 —
 * 조용히 틀리는 종류의 결함이라 테스트가 없으면 발견되지 않는다.
 */
describe('decalSignature() — 다시 구울지 판단하는 서명', () => {
  it('적이 움직여도 서명은 그대로다 — 이 계층이 적을 그리지 않는다는 사실이 절약의 근거다', () => {
    const s = cleanState();
    s.pieces.push(boardPiece('rook', 3, 3));
    const view = createFrameView();
    const before = decalSignature(s, view);

    s.enemies.push({
      id: 'e', file: 2, y: 120, hp: 10, maxHp: 10, isBoss: false, speed: 26.6,
      jitterX: 0, traits: [], slowTier: 0, auraBonus: 0,
    });
    expect(decalSignature(s, view)).toBe(before);

    s.enemies[0].y = 480;
    expect(decalSignature(s, view)).toBe(before);
  });

  it('하이라이트·라인·합성 미리보기가 바뀌면 서명이 반드시 바뀐다', () => {
    const s = cleanState();
    const base = decalSignature(s, createFrameView());

    const hl = createFrameView();
    hl.highlights.push({ square: { file: 1, rank: 1 }, color: '#fff' });
    expect(decalSignature(s, hl)).not.toBe(base);

    const ln = createFrameView();
    ln.lines.push({ from: { file: 0, rank: 1 }, to: { file: 0, rank: 8 }, color: '#fff' });
    expect(decalSignature(s, ln)).not.toBe(base);

    const mp = createFrameView();
    mp.mergePreview = { square: { file: 2, rank: 2 }, tier: 3 };
    expect(decalSignature(s, mp)).not.toBe(base);
    // 같은 칸이라도 결과 티어가 다르면 다른 그림이다.
    const mp4 = createFrameView();
    mp4.mergePreview = { square: { file: 2, rank: 2 }, tier: 4 };
    expect(decalSignature(s, mp4)).not.toBe(decalSignature(s, mp));
  });

  it('감속 오라가 생기거나 티어가 오르면 서명이 바뀐다 (칸 색의 알파가 티어에 달려 있다)', () => {
    const s = cleanState();
    const empty = decalSignature(s, EMPTY_VIEW);
    s.pieces.push(boardPiece('knight', 3, 3));
    const t1 = decalSignature(s, EMPTY_VIEW);
    expect(t1).not.toBe(empty);

    s.pieces[0].tier = 4;
    expect(decalSignature(s, EMPTY_VIEW)).not.toBe(t1);
  });
});

describe('createFrameView / EMPTY_VIEW 참조 격리 (Task 17 리뷰 수정)', () => {
  it('createFrameView()가 반환하는 highlights/lines/shake는 매번 새 인스턴스이며 EMPTY_VIEW와 참조를 공유하지 않는다', () => {
    const a = createFrameView();
    const b = createFrameView();
    expect(a.highlights).not.toBe(EMPTY_VIEW.highlights);
    expect(a.lines).not.toBe(EMPTY_VIEW.lines);
    expect(a.shake).not.toBe(EMPTY_VIEW.shake);
    // 두 번 호출한 결과끼리도 서로 다른 인스턴스여야 한다 (프레임마다 새로 만든다는 계약).
    expect(a.highlights).not.toBe(b.highlights);
    expect(a.lines).not.toBe(b.lines);
    expect(a.shake).not.toBe(b.shake);
  });

  it('createFrameView()의 lines에 push해도 EMPTY_VIEW.lines는 비어 있는 채로 남는다 (Task 18/19 회귀 방지)', () => {
    const view = createFrameView();
    view.lines.push({ from: { file: 0, rank: 1 }, to: { file: 0, rank: 2 }, color: '#fff' });
    expect(view.lines).toHaveLength(1);
    expect(EMPTY_VIEW.lines).toHaveLength(0);
  });

  it('EMPTY_VIEW와 그 내부 배열/객체는 freeze되어 있어 실수로 뮤테이션하면 즉시 실패한다', () => {
    expect(Object.isFrozen(EMPTY_VIEW)).toBe(true);
    expect(Object.isFrozen(EMPTY_VIEW.highlights)).toBe(true);
    expect(Object.isFrozen(EMPTY_VIEW.lines)).toBe(true);
    expect(Object.isFrozen(EMPTY_VIEW.shake)).toBe(true);
    // ES 모듈은 기본 strict mode이므로 frozen 배열에 push하면 TypeError.
    expect(() => EMPTY_VIEW.lines.push({ from: { file: 0, rank: 1 }, to: { file: 0, rank: 2 }, color: '#fff' })).toThrow(TypeError);
    expect(() => { EMPTY_VIEW.shake.x = 5; }).toThrow(TypeError);
  });
});
