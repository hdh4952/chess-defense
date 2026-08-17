import { describe, expect, it } from 'vitest';
import { CONFIG, tierMultiplier } from '../src/config';
import { pieceDamage, pieceGold, updateCombat } from '../src/core/combat';
import { recalcQueenBuffs } from '../src/core/buff';
import { sellPiece, sellPrice } from '../src/core/economy';
import { moveOnBoard, placeFromSlot, resolveLanding, canLandAt } from '../src/core/pieces';
import { updateSlowAura } from '../src/core/slow';
import { buildHighlights, HIGHLIGHT_COLORS } from '../src/render/highlights';
import { TIER_COLORS, tierRingColor } from '../src/render/tiers';
import { render, createFrameView } from '../src/render/renderer';
import type { GameEvent, Interaction, Piece, PieceType } from '../src/types';
import { makeStubCtx } from './canvasStub';
import { boardPiece, enemyAt, waveState } from './helpers';

/**
 * 동일 기물 합성. 이 스위트가 고정하는 규칙은 세 층이다:
 *   1) 판정 — resolveLanding 하나가 배치/합성/맞교환/거부를 가른다 (미리보기와 실제 규칙의 단일 출처)
 *   2) 능력치 — 전부 tier에 정비례한다 ("능력치 합"이 문자 그대로 성립하는지)
 *   3) 제스처 — 합성은 드래그 앤 드롭 전용이고 클릭-투-무브는 예전 그대로 맞교환이다
 * 수치는 전부 CONFIG에서 유도한다 (이 저장소의 관행 — 밸런스 재조정에 테스트가 깨지지 않게).
 */

function slotPiece(type: PieceType, slotIndex = 0, tier = 1): Piece {
  return { id: `sp-${type}-${slotIndex}-${tier}`, type, square: null, slotIndex, cooldown: 0, queenBuffCount: 0, tier };
}

function noInteraction(overrides: Partial<Interaction> = {}): Interaction {
  return { dragging: null, selectedPieceId: null, hoverSquare: null, ...overrides };
}

describe('resolveLanding — 판정표 (합성 규칙 결정표 §3.1)', () => {
  it('보드 → 같은 종류 점유 칸: 드래그면 합성, 클릭-투-무브면 맞교환', () => {
    const s = waveState();
    const mover = boardPiece('rook', 0, 1);
    const occupant = boardPiece('rook', 5, 5);
    s.pieces.push(mover, occupant);
    const sq = { file: 5, rank: 5 };

    expect(resolveLanding(s, mover, sq, true)).toMatchObject({ kind: 'merge', resultTier: 2 });
    // allowMerge=false는 합성 도입 이전과 정확히 같은 결과여야 한다 — 이게 클릭-투-무브 경로다.
    expect(resolveLanding(s, mover, sq, false)).toMatchObject({ kind: 'swap' });
  });

  it('다른 종류 점유 칸은 드래그여도 맞교환이지, 합성이 아니다', () => {
    const s = waveState();
    const mover = boardPiece('rook', 0, 1);
    s.pieces.push(mover, boardPiece('bishop', 5, 5));
    expect(resolveLanding(s, mover, { file: 5, rank: 5 }, true)).toMatchObject({ kind: 'swap' });
  });

  it('트레이 → 같은 종류·같은 티어 점유 칸: 드래그면 합성, 아니면 거부', () => {
    const s = waveState();
    const tray = slotPiece('rook');
    s.pieces.push(tray, boardPiece('rook', 4, 4));
    expect(resolveLanding(s, tray, { file: 4, rank: 4 }, true)).toMatchObject({ kind: 'merge', resultTier: 2 });
    expect(resolveLanding(s, tray, { file: 4, rank: 4 }, false)).toMatchObject({ kind: 'reject' });
  });

  it('티어가 다르면 같은 종류여도 합성이 아니다 — 강화된 기물이 조용히 잡아먹히지 않는다', () => {
    const s = waveState();
    const t2 = boardPiece('rook', 0, 1, 2);
    const t1 = boardPiece('rook', 5, 5, 1);
    s.pieces.push(t2, t1);
    // 보드발은 맞교환으로 흘려보낸다 (다른 종류 위에 놓았을 때와 같은 결과)
    expect(resolveLanding(s, t2, { file: 5, rank: 5 }, true)).toMatchObject({ kind: 'swap' });
    // 트레이발은 밀려날 자리가 없으므로 거부다
    const tray = slotPiece('rook', 0, 3);
    s.pieces.push(tray);
    expect(resolveLanding(s, tray, { file: 5, rank: 5 }, true))
      .toMatchObject({ kind: 'reject', reason: 'tierMismatch' });
  });

  it('트레이 → 다른 종류 점유 칸은 여전히 거부다 (밀려날 상대가 없다)', () => {
    const s = waveState();
    const tray = slotPiece('pawn');
    s.pieces.push(tray, boardPiece('bishop', 4, 4));
    expect(resolveLanding(s, tray, { file: 4, rank: 4 }, true))
      .toMatchObject({ kind: 'reject', reason: 'typeMismatch' });
  });

  it('8랭크(스폰 구역)는 합성 경로로도 뚫리지 않는다 — 게이트 순서가 규칙이다', () => {
    const s = waveState();
    const mover = boardPiece('rook', 0, 7);
    s.pieces.push(mover, boardPiece('rook', 5, 8));   // 8랭크에 기물이 있는 비정상 상태를 가정해도
    expect(resolveLanding(s, mover, { file: 5, rank: 8 }, true))
      .toMatchObject({ kind: 'reject', reason: 'outOfBounds' });
  });

  it('나이트는 합성이어도 L자 행마를 지켜야 한다', () => {
    const s = waveState();
    const n = boardPiece('knight', 3, 4);
    s.pieces.push(n, boardPiece('knight', 3, 5));     // 같은 티어지만 바로 위 = L자가 아님
    expect(resolveLanding(s, n, { file: 3, rank: 5 }, true))
      .toMatchObject({ kind: 'reject', reason: 'knightPattern' });
  });

  it('티어 합이 상한을 넘으면 출발지와 무관하게 거부다 — 초과분을 깎지도, 조용히 맞교환하지도 않는다', () => {
    // 설계 초안은 보드발 초과를 "맞교환 폴백"으로 뒀지만 거부로 바꿨다. 같은 종류 위로 드래그하는
    // 조작의 의도는 언제나 합성인데, 합성이 불가능할 때 대신 자리를 바꿔 주면 공들여 짜 둔 배치가
    // 예고 없이 흐트러진다 — 미리보기(마젠타 + 결과 티어)도 뜨지 않은 상태라 플레이어에게는
    // 아무 예고가 없다. 거부하면 drag.ts가 uiInvalid를 울리고 기물이 원위치로 돌아간다.
    // 같은 종류끼리 자리를 바꾸고 싶으면 클릭-투-무브를 쓴다(그 경로는 언제나 맞교환이다).
    const max = CONFIG.merge.maxTier.rook;
    const s = waveState();
    const mover = boardPiece('rook', 0, 1, max);
    const occupant = boardPiece('rook', 5, 5, max);   // 둘 다 상한 단계
    s.pieces.push(mover, occupant);
    expect(resolveLanding(s, mover, { file: 5, rank: 5 }, true))
      .toMatchObject({ kind: 'reject', reason: 'tierOverflow' });

    const events: GameEvent[] = [];
    expect(moveOnBoard(s, mover.id, 5, 5, events, true)).toBe(false);
    expect(mover.tier).toBe(max);
    expect(occupant.tier).toBe(max);
    expect(mover.square).toEqual({ file: 0, rank: 1 });     // 원위치 그대로
    expect(events).toHaveLength(0);

    // 반면 클릭-투-무브(allowMerge=false)는 예전 그대로 맞교환한다.
    expect(moveOnBoard(s, mover.id, 5, 5, events)).toBe(true);
    expect(mover.square).toEqual({ file: 5, rank: 5 });
    expect(occupant.square).toEqual({ file: 0, rank: 1 });
  });

  it('canLandAt은 resolveLanding(allowMerge=false)의 파생 — 합성 도입 전과 의미가 같다', () => {
    const s = waveState();
    const tray = slotPiece('rook');
    s.pieces.push(tray, boardPiece('rook', 4, 4));
    expect(canLandAt(s, tray, { file: 4, rank: 4 })).toBe(false);   // 트레이 → 점유 칸은 여전히 불가
    expect(canLandAt(s, tray, { file: 4, rank: 5 })).toBe(true);
  });
});

describe('합성 커밋 — 생존자·쿨다운·이벤트', () => {
  it('점유자가 살아남고 드래그한 쪽이 사라진다. 티어는 한 단계 오른다', () => {
    const s = waveState();
    const mover = boardPiece('rook', 0, 1, 2);
    const occupant = boardPiece('rook', 5, 5, 2);
    s.pieces.push(mover, occupant);
    const events: GameEvent[] = [];

    expect(moveOnBoard(s, mover.id, 5, 5, events, true)).toBe(true);
    expect(occupant.tier).toBe(3);
    expect(s.pieces).toHaveLength(1);
    expect(s.pieces[0]).toBe(occupant);
    expect(occupant.square).toEqual({ file: 5, rank: 5 });   // 생존자는 제자리
    expect(events).toContainEqual({
      kind: 'merged', square: { file: 5, rank: 5 }, pieceType: 'rook', tier: 3,
    });
  });

  it('쿨다운은 생존자 것이 그대로 남는다 — 구매→합성이 쿨다운 초기화 버튼이 되면 안 된다', () => {
    const s = waveState();
    const fresh = slotPiece('rook');                   // 갓 산 기물: 쿨다운 0
    const tired = boardPiece('rook', 4, 4);
    tired.cooldown = 2.9;
    s.pieces.push(fresh, tired);

    expect(placeFromSlot(s, fresh.id, 4, 4, [], true)).toBe(true);
    expect(tired.cooldown).toBeCloseTo(2.9);
  });

  it('트레이발 합성은 슬롯을 비워 다시 구매할 수 있게 한다', () => {
    const s = waveState();
    const tray = slotPiece('bishop', 0);
    s.pieces.push(tray, boardPiece('bishop', 4, 4));
    expect(placeFromSlot(s, tray.id, 4, 4, [], true)).toBe(true);
    expect(s.pieces.some(p => p.slotIndex === 0)).toBe(false);
  });

  it('같은 칸에 두 기물이 남지 않는다 — 흡수된 쪽은 배열에서 제거된다', () => {
    const s = waveState();
    const mover = boardPiece('pawn', 0, 1);
    s.pieces.push(mover, boardPiece('pawn', 1, 2));
    moveOnBoard(s, mover.id, 1, 2, [], true);
    expect(s.pieces.filter(p => p.square?.file === 1 && p.square?.rank === 2)).toHaveLength(1);
  });

  it('합성 직후에는 아무 능력도 발동하지 않는다 — 감속은 다음 틱이 생존자의 칸으로 건다', () => {
    // v1.10 전까지 이 자리에는 "나이트 합성은 생존자 기준으로 정확히 1회 폭발한다"가 있었다.
    // 폭발이 감속 오라로 바뀌면서 능력이 붙을 **순간**이 사라졌으므로(서 있기만 하면 걸리는
    // 지속 상태다) 불변식이 뒤집힌다: 합성은 merged 하나만 남기고 끝나야 한다. 티어에 비례하던
    // 데미지 단언은 지킬 대상이 없어졌다 — 감속은 티어와 무관하고 나이트 공격력은 0이다.
    const s = waveState();
    const mover = boardPiece('knight', 3, 4);
    const occupant = boardPiece('knight', 4, 6);       // d4 → e6 = L자
    s.pieces.push(mover, occupant);
    const onSurvivor = enemyAt(1, 4, 6);               // 예전 폭발이 중심으로 삼던 칸
    const onL = enemyAt(1, 3, 4);                      // 합성 결과 기물의 L자 칸(= 출발 칸)
    s.enemies.push(onSurvivor, onL);
    const hp0 = onSurvivor.hp;
    const events: GameEvent[] = [];

    expect(moveOnBoard(s, mover.id, 4, 6, events, true)).toBe(true);
    expect(occupant.tier).toBe(2);
    // 합성이 남기는 이벤트는 merged 하나뿐이다 — 조작 직후에 능력이 되살아나면 여기서 걸린다.
    expect(events.map(x => x.kind)).toEqual(['merged']);
    expect(onSurvivor.hp).toBe(hp0);                   // 피해를 주는 능력 자체가 없다
    expect(s.enemies.map(x => x.slowed)).toEqual([false, false]);   // 감속도 아직이다

    // 능력은 조작이 아니라 틱에 속한다(step.ts). 그리고 틱이 보는 것은 합성 결과 기물의
    // 지금 칸뿐이라, 흡수된 쪽이 있던 자리가 아니라 생존자의 L자 8칸이 덮인다.
    const tickEvents: GameEvent[] = [];
    updateSlowAura(s, tickEvents);
    expect(onL.slowed).toBe(true);
    expect(onSurvivor.slowed).toBe(false);             // 자기가 선 칸은 L자가 아니다
  });
});

describe('능력치는 전부 tier에 정비례한다 ("능력치 합")', () => {
  it('공격력: 각 티어는 바로 아래 티어 둘의 합 (단계마다 정확히 2배)', () => {
    const base = CONFIG.pieces.rook.damage;
    const t1 = boardPiece('rook', 0, 1);
    const t2 = boardPiece('rook', 0, 2, 2);
    expect(pieceDamage(t2)).toBe(pieceDamage(t1) * 2);
    expect(pieceDamage(t2)).toBe(base * 2);

    // 사슬 전체가 "합"이어야 한다 — T3는 T2 둘, T4는 T3 둘 …
    for (let tier = 2; tier <= CONFIG.merge.maxTier.rook; tier++) {
      const upper = boardPiece('rook', 0, 1, tier);
      const lower = boardPiece('rook', 0, 1, tier - 1);
      expect(pieceDamage(upper)).toBe(pieceDamage(lower) * 2);
    }
    expect(tierMultiplier(CONFIG.merge.maxTier.rook)).toBe(32);   // T6 = 기본 기물 32기분

    // 퀸 라인 위에서도 "합"이 유지되어야 한다: T1 두 기가 각각 base×2 = 합계 base×4,
    // T2 한 기도 base×2×2 = base×4. 곱셈 순서가 어긋나면 여기서 갈라진다.
    t1.queenBuffCount = 1;
    t2.queenBuffCount = 1;
    expect(pieceDamage(t2)).toBe(pieceDamage(t1) * 2);
  });

  it('비숍 골드: 발사체 수가 줄어드는 만큼 발당 액수가 정확히 커진다', () => {
    const g = CONFIG.pieces.bishop.goldPerAttack;
    expect(pieceGold(boardPiece('bishop', 0, 1, 1))).toBe(g);
    expect(pieceGold(boardPiece('bishop', 0, 1, 4))).toBe(g * 8);   // T4 = T1 8기분

    // 실제 지급 경로도 같은 값을 쓴다 (툴팁만 맞고 지급은 틀리는 상황을 막는다)
    const s = waveState();
    s.pieces.push(boardPiece('bishop', 3, 4, 3));
    s.enemies.push(enemyAt(1, 6, 7));
    const gold0 = s.gold;
    updateCombat(s, 1 / 60, []);
    expect(s.gold).toBe(gold0 + g * 4);   // T3 = T1 4기분
  });

  it('퀸 버프: T2 퀸 하나 = T1 퀸 둘. 합성해도 손해가 아니다', () => {
    const twoQueens = waveState();
    const target1 = boardPiece('rook', 3, 3);
    twoQueens.pieces.push(target1, boardPiece('queen', 3, 1), boardPiece('queen', 3, 2));
    recalcQueenBuffs(twoQueens);

    const oneQueen = waveState();
    const target2 = boardPiece('rook', 3, 3);
    oneQueen.pieces.push(target2, boardPiece('queen', 3, 1, 2));   // T2 퀸 = T1 퀸 둘
    recalcQueenBuffs(oneQueen);

    expect(target2.queenBuffCount).toBe(target1.queenBuffCount);
    expect(pieceDamage(target2)).toBe(pieceDamage(target1));
  });

  it('판매가: 합성 후 판매액 = 합성 전 각각의 판매액 합 (보이지 않는 골드 소각 없음)', () => {
    const cost = CONFIG.pieces.rook.cost;
    // 각 티어의 판매가는 바로 아래 티어 둘의 판매가 합이어야 한다 — 합성이 골드 소각이 되지 않게
    for (let tier = 2; tier <= CONFIG.merge.maxTier.rook; tier++) {
      expect(sellPrice('rook', tier)).toBe(sellPrice('rook', tier - 1) * 2);
    }
    expect(sellPrice('rook', 2)).toBe(cost * 2 * CONFIG.economy.sellRatio);

    const s = waveState();
    const merged = boardPiece('rook', 4, 4, 3);
    s.pieces.push(merged);
    const gold0 = s.gold;
    expect(sellPiece(s, merged.id)).toBe(true);
    expect(s.gold).toBe(gold0 + cost * 4 * CONFIG.economy.sellRatio);   // T3 = T1 4기분
  });

  it('모든 기물이 테두리 색 6단계 끝까지 강화된다 — 상한과 팔레트가 어긋나지 않는다', () => {
    // 상한을 올렸는데 색이 모자라면 tierRingColor가 null을 돌려 링이 사라진다(T1 취급).
    for (const type of Object.keys(CONFIG.merge.maxTier) as PieceType[]) {
      expect(CONFIG.merge.maxTier[type]).toBe(TIER_COLORS.length);
      expect(tierRingColor(CONFIG.merge.maxTier[type])).not.toBeNull();
    }
  });

  it('퀸 버프는 티어 배수만큼 커진다 — 상한 6이 전체 화력의 지수라는 사실을 수치로 고정한다', () => {
    // 퀸만은 자기 화력이 아니라 보드 전체의 화력에 곱해지므로, 상한을 열어 둔 대가가 얼마인지
    // 테스트가 직접 들고 있어야 한다. 밸런스가 무너지면 여기 숫자가 먼저 근거가 된다.
    const s = waveState();
    const target = boardPiece('rook', 3, 3, CONFIG.merge.maxTier.rook);
    // 같은 칸을 덮는 최대 티어 퀸 두 기 (파일·랭크로 각각 target을 지난다)
    s.pieces.push(target, boardPiece('queen', 3, 1, 6), boardPiece('queen', 0, 3, 6));
    recalcQueenBuffs(s);

    expect(target.queenBuffCount).toBe(tierMultiplier(6) * 2);          // 32 × 2 = 64
    expect(pieceDamage(target)).toBe(CONFIG.pieces.rook.damage * tierMultiplier(6) * 65);
    expect(pieceDamage(target)).toBe(10_400);
  });
});

describe('합성 미리보기 — 드래그 중에만, 실제 판정과 같은 출처에서', () => {
  it('드래그로 같은 종류 위에 올리면 결과 티어가 미리보기로 나온다', () => {
    const s = waveState();
    const mover = boardPiece('rook', 0, 1, 2);
    s.pieces.push(mover, boardPiece('rook', 5, 5, 2));
    const hl = buildHighlights(s, noInteraction({
      dragging: { pieceId: mover.id, from: 'board' }, hoverSquare: { file: 5, rank: 5 },
    }));

    expect(hl.mergePreview).toEqual({ square: { file: 5, rank: 5 }, tier: 3 });
    expect(hl.highlights).toContainEqual({ square: { file: 5, rank: 5 }, color: HIGHLIGHT_COLORS.merge });
  });

  it('클릭 선택(드래그 아님)으로는 미리보기가 뜨지 않는다 — 실제로 합성되지 않으므로', () => {
    const s = waveState();
    const mover = boardPiece('rook', 0, 1);
    s.pieces.push(mover, boardPiece('rook', 5, 5));
    const hl = buildHighlights(s, noInteraction({
      selectedPieceId: mover.id, hoverSquare: { file: 5, rank: 5 },
    }));
    expect(hl.mergePreview).toBeNull();
  });

  it('상한 초과 칸에는 미리보기가 뜨지 않는다 — 합성되지 않을 결과를 약속하지 않는다', () => {
    const max = CONFIG.merge.maxTier.rook;
    const s = waveState();
    const mover = boardPiece('rook', 0, 1, max);
    s.pieces.push(mover, boardPiece('rook', 5, 5, max));
    const hl = buildHighlights(s, noInteraction({
      dragging: { pieceId: mover.id, from: 'board' }, hoverSquare: { file: 5, rank: 5 },
    }));
    expect(hl.mergePreview).toBeNull();
  });
});

describe('렌더 — 티어 링과 미리보기가 실제로 그려진다', () => {
  it('T1은 링을 그리지 않고, T2 이상만 그린다 (보드 전체가 상시 테두리로 덮이지 않게)', () => {
    const t1 = waveState();
    t1.pieces.push(boardPiece('rook', 3, 3));
    const a = makeStubCtx();
    render(a.ctx as unknown as CanvasRenderingContext2D, t1, createFrameView());
    const arcsT1 = a.records.filter(r => r.method === 'arc').length;

    const t3 = waveState();
    t3.pieces.push(boardPiece('rook', 3, 3, 3));
    const b = makeStubCtx();
    render(b.ctx as unknown as CanvasRenderingContext2D, t3, createFrameView());
    const arcsT3 = b.records.filter(r => r.method === 'arc');

    expect(arcsT3.length).toBe(arcsT1 + 1);                 // 링 하나만 늘어난다
    expect(b.records.some(r => r.strokeStyle === tierRingColor(3))).toBe(true);
  });

  it('합성 미리보기는 점선 링과 결과 티어 라벨을 그린다', () => {
    const s = waveState();
    s.pieces.push(boardPiece('rook', 3, 3, 2));
    const view = createFrameView();
    view.mergePreview = { square: { file: 3, rank: 3 }, tier: 4 };

    const { ctx, records } = makeStubCtx();
    render(ctx as unknown as CanvasRenderingContext2D, s, view);

    expect(records.some(r => r.method === 'setLineDash')).toBe(true);
    const labels = records.filter(r => r.method === 'fillText').map(r => r.args[0]);
    expect(labels).toContain('T4');
    // 퀸 버프 배지('×N')와 구분되는 접두사여야 한다 — renderer.test.ts가 '×' 계열을 전수 단언한다
    expect(labels.every(l => !String(l).startsWith('×'))).toBe(true);
  });
});
