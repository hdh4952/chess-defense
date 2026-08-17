import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { fileCenterX, rankToTopY } from '../src/core/grid';
import { createInitialState } from '../src/core/state';
import { render } from '../src/render/renderer';
import { ALLY_SPRITE_PX, setSpriteForTest, type Drawable } from '../src/render/sprites';
import type { Enemy, Piece, PieceType } from '../src/types';
import { makeStubCtx } from './canvasStub';

// sprites.ts는 실제 브라우저(Image 디코딩 + 캔버스 2D 컨텍스트)에 의존해 스프라이트를 굽는다.
// happy-dom/node는 SVG를 실제로 디코드하지 않으므로 img.onload가 결코 발생하지 않는다 — 그래서
// 이 스위트는 sprites.ts가 노출하는 테스트 전용 seam(setSpriteForTest)으로 "이미 구워진 것"을
// 흉내 낼 스탠드인 drawable을 직접 주입해, renderer.ts의 이미지 경로(drawImage 호출)만 검증한다.
// 헤드리스 환경에서 실제 SVG 래스터화 자체를 검증할 수는 없다 — 그 부분은 SVG-report.md에
// 별도로 명시한다.

const SQ = CONFIG.board.squarePx;
const PIECE_TYPES: PieceType[] = ['pawn', 'knight', 'bishop', 'rook', 'queen'];

// 타입별로 서로 다른 스탠드인 오브젝트를 만든다. drawPiece가 실제로 p.type으로 스프라이트를
// 조회하지 않고 특정 타입 하나만 하드코딩해 그린다면, rook/bishop처럼 pawn이 아닌 타입을 찾는
// 아래 단언들이 실패한다 (요청받은 "타입 인지" 검증).
const allyStub: Record<PieceType, Drawable> = Object.fromEntries(
  PIECE_TYPES.map(t => [t, { marker: `ally-${t}` } as unknown as Drawable]),
) as Record<PieceType, Drawable>;
const normalEnemyStub = { marker: 'enemy-normal' } as unknown as Drawable;
const bossEnemyStub = { marker: 'enemy-boss' } as unknown as Drawable;

function makeEnemy(overrides: Partial<Enemy>): Enemy {
  return {
    id: 'e', file: 0, y: 0, hp: 10, maxHp: 10, isBoss: false, speed: 26.6, jitterX: 0,
    traits: [], shieldPool: 0, slowed: false,
    ...overrides,
  };
}
function makePiece(overrides: Partial<Piece>): Piece {
  return {
    id: 'p', type: 'rook', square: { file: 0, rank: 1 }, cooldown: 0, queenBuffCount: 0, tier: 1,
    ...overrides,
  };
}

describe('ALLY_SPRITE_PX (재검토 Item 4)', () => {
  it('보드 칸(CONFIG.board.squarePx)을 넘지 않는다 — 넘으면 이웃 칸을 침범해 그려진다', () => {
    // 아래 render() 테스트들은 drawImage 호출의 기대 좌표·크기를 전부 ALLY_SPRITE_PX 자신에서
    // 유도한다(자기 참조) — ALLY_SPRITE_PX를 200으로 바꿔도(80px 칸을 넘어 이웃 칸까지 침범)
    // 그 테스트들은 여전히 통과한다. 이 테스트만이 상수를 보드 칸 크기라는 외부 기준에 묶어,
    // 그런 회귀를 실제로 잡는다.
    expect(ALLY_SPRITE_PX).toBeGreaterThan(0);
    expect(ALLY_SPRITE_PX).toBeLessThanOrEqual(CONFIG.board.squarePx);
  });
});

describe('render() — 이미지 경로 (스프라이트 준비 완료, sprites.ts 테스트 seam으로 주입)', () => {
  beforeEach(() => {
    for (const t of PIECE_TYPES) setSpriteForTest('ally', t, allyStub[t]);
    setSpriteForTest('enemy', false, normalEnemyStub);
    setSpriteForTest('enemy', true, bossEnemyStub);
  });
  afterEach(() => {
    for (const t of PIECE_TYPES) setSpriteForTest('ally', t, null);
    setSpriteForTest('enemy', false, null);
    setSpriteForTest('enemy', true, null);
  });

  it('아군 기물은 자신의 타입에 맞는 스프라이트로 drawImage되며, 칸 중심에 ALLY_SPRITE_PX 크기로 그려진다', () => {
    const { ctx, records } = makeStubCtx();
    const state = createInitialState();
    state.pieces.push(makePiece({ id: 'r1', type: 'rook', square: { file: 2, rank: 3 } }));
    state.pieces.push(makePiece({ id: 'b1', type: 'bishop', square: { file: 5, rank: 6 } }));

    render(ctx as unknown as CanvasRenderingContext2D, state);

    const draws = records.filter(r => r.method === 'drawImage');
    expect(draws).toHaveLength(2);

    const rookX = fileCenterX(2), rookY = rankToTopY(3) + SQ / 2;
    const bishopX = fileCenterX(5), bishopY = rankToTopY(6) + SQ / 2;

    const rookDraw = draws.find(r => r.args[0] === allyStub.rook);
    expect(rookDraw).toBeDefined();
    expect(rookDraw!.args).toEqual([
      allyStub.rook, rookX - ALLY_SPRITE_PX / 2, rookY - ALLY_SPRITE_PX / 2, ALLY_SPRITE_PX, ALLY_SPRITE_PX,
    ]);

    const bishopDraw = draws.find(r => r.args[0] === allyStub.bishop);
    expect(bishopDraw).toBeDefined();
    expect(bishopDraw!.args).toEqual([
      allyStub.bishop, bishopX - ALLY_SPRITE_PX / 2, bishopY - ALLY_SPRITE_PX / 2, ALLY_SPRITE_PX, ALLY_SPRITE_PX,
    ]);
  });

  it('아군 경로는 체력바를 그리지 않는다 (체력바는 적 전용, 스펙 4.1)', () => {
    const { ctx, records } = makeStubCtx();
    const state = createInitialState();
    state.pieces.push(makePiece({ id: 'q1', type: 'queen', square: { file: 0, rank: 1 } }));

    render(ctx as unknown as CanvasRenderingContext2D, state);

    const hpBars = records.filter(r => r.method === 'fillRect' && r.args[2] === 40 && r.args[3] === 4);
    expect(hpBars).toHaveLength(0);
  });

  it('일반 적은 폰 스프라이트로, 보스는 킹 스프라이트로 drawImage되며 크기는 CONFIG.enemy.spritePx다', () => {
    const { ctx, records } = makeStubCtx();
    const state = createInitialState();
    const size = CONFIG.enemy.spritePx;
    const normal = makeEnemy({ id: 'n1', file: 3, y: 200, isBoss: false });
    const boss = makeEnemy({ id: 'b1', file: 6, y: 400, isBoss: true, hp: 300, maxHp: 300 });
    state.enemies.push(normal, boss);

    render(ctx as unknown as CanvasRenderingContext2D, state);

    const draws = records.filter(r => r.method === 'drawImage');
    expect(draws).toHaveLength(2);

    const normalX = fileCenterX(3) + normal.jitterX;
    const normalDraw = draws.find(r => r.args[0] === normalEnemyStub);
    expect(normalDraw).toBeDefined();
    expect(normalDraw!.args).toEqual([normalEnemyStub, normalX - size / 2, normal.y - size / 2, size, size]);

    const bossX = fileCenterX(6) + boss.jitterX;
    const bossDraw = draws.find(r => r.args[0] === bossEnemyStub);
    expect(bossDraw).toBeDefined();
    expect(bossDraw!.args).toEqual([bossEnemyStub, bossX - size / 2, boss.y - size / 2, size, size]);
  });

  it('이미지 경로에서도 적 체력바(배경+체력, fillRect 2회)는 그대로 그려진다 (스펙 4.1/7.8 — 스프라이트 유무와 무관)', () => {
    const { ctx, records } = makeStubCtx();
    const state = createInitialState();
    const e = makeEnemy({ id: 'e1', file: 4, y: 300, hp: 5, maxHp: 10 });
    state.enemies.push(e);

    render(ctx as unknown as CanvasRenderingContext2D, state);

    const size = CONFIG.enemy.spritePx;
    const top = e.y - size / 2 - 8;
    // hp(5) !== maxHp(10)라 체력 막대 너비는 20이지 배경(40)과 같지 않다 — 너비 대신 y좌표
    // (top, 이 적의 체력바 고유 위치)로 걸러 두 fillRect(배경+체력)만 잡는다. 높이(4)만으로
    // 거르면 8랭크 스폰 구역 경계선(재검토 수정, 두께도 4px)까지 함께 잡혀버린다.
    const hpBars = records.filter(r => r.method === 'fillRect' && r.args[1] === top);
    expect(hpBars).toHaveLength(2);
    const x = fileCenterX(4) + e.jitterX;
    expect(hpBars[0].args).toEqual([x - 20, top, 40, 4]);                          // 배경
    expect(hpBars[1].args).toEqual([x - 20, top, 40 * (e.hp / e.maxHp), 4]);        // 체력
  });

  it('일부 타입만 준비된 상태에서는 준비된 타입만 이미지로, 나머지는 여전히 글리프로 그려진다', () => {
    setSpriteForTest('ally', 'pawn', null);        // 폰만 다시 "로딩 전" 상태로 되돌린다
    const { ctx, records } = makeStubCtx();
    const state = createInitialState();
    state.pieces.push(makePiece({ id: 'p1', type: 'pawn', square: { file: 1, rank: 1 } }));
    state.pieces.push(makePiece({ id: 'r1', type: 'rook', square: { file: 2, rank: 1 } }));

    render(ctx as unknown as CanvasRenderingContext2D, state);

    const draws = records.filter(r => r.method === 'drawImage');
    expect(draws).toHaveLength(1);                   // 룩만 이미지 경로
    expect(draws[0].args[0]).toBe(allyStub.rook);
    const pawnGlyph = records.filter(r => r.method === 'fillText' && r.args[0] === '♟');
    expect(pawnGlyph.length).toBeGreaterThanOrEqual(1); // 폰은 글리프 폴백 그대로
  });
});
