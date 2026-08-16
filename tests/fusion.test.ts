// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { CONFIG, TRAITS, tierMultiplier } from '../src/config';
import { recalcQueenBuffs } from '../src/core/buff';
import { pieceDamage } from '../src/core/combat';
import { sellPrice } from '../src/core/economy';
import { FUSION_RECIPES, fusionResult } from '../src/core/fusion';
import { moveOnBoard, placeFromSlot, resolveLanding } from '../src/core/pieces';
import { bishopTargets, knightBlastTargets } from '../src/core/patterns';
import { buildHighlights, HIGHLIGHT_COLORS } from '../src/render/highlights';
import { updateTooltip } from '../src/ui/tooltip';
import type { GameEvent, Piece, PieceType } from '../src/types';
import { boardPiece, enemyAt, waveState } from './helpers';

/**
 * 이종 융합 — 서로 다른 종류를 겹쳐 제3의 기물을 만든다.
 *
 * 동종 합성이 화력을 **압축**한다면(같은 것 둘 → 티어 +1), 이종 융합은 역할을 **겸업**시킨다.
 * 그래서 결과 티어가 오르지 않는다 — 등급 상승이 아니라 정체성 변경이다.
 */

function trayPiece(type: PieceType, tier = 1, slot = 0): Piece {
  return {
    id: `t-${type}-${tier}`, type, square: null, slotIndex: slot,
    cooldown: 0, queenBuffCount: 0, tier,
  };
}

describe('fusionResult — 레시피', () => {
  it('교환법칙이 성립한다 — 어느 쪽을 집든 같은 결과', () => {
    // 플레이어는 나이트를 비숍 위로도, 비숍을 나이트 위로도 끌 수 있다. 방향에 따라 결과가
    // 갈리면 그 자체가 규칙 구멍이고 미리보기와 실제가 어긋나는 경로가 된다.
    for (const [a, b, result] of FUSION_RECIPES) {
      expect(fusionResult(a, b)).toBe(result);
      expect(fusionResult(b, a)).toBe(result);
    }
  });

  it('레시피가 없는 조합은 null', () => {
    expect(fusionResult('pawn', 'rook')).toBeNull();
    expect(fusionResult('bishop', 'queen')).toBeNull();
    expect(fusionResult('archbishop', 'rook')).toBeNull();
  });

  it('동종 조합은 레시피에 없다 — 동종 분기가 먼저 이기므로 규칙이 갈라지면 안 된다', () => {
    for (const [a, b] of FUSION_RECIPES) expect(a).not.toBe(b);
    for (const t of Object.keys(TRAITS) as PieceType[]) expect(fusionResult(t, t)).toBeNull();
  });

  it('모든 레시피 결과는 구매할 수 없다 — 융합으로만 얻는다', () => {
    for (const [, , result] of FUSION_RECIPES) expect(TRAITS[result].purchasable).toBe(false);
  });
});

describe('융합 판정 — resolveLanding', () => {
  it('나이트 + 비숍 → 아치비숍, 양방향 모두', () => {
    for (const [moverType, occType] of [['knight', 'bishop'], ['bishop', 'knight']] as const) {
      const s = waveState();
      // 나이트가 움직이는 쪽이면 L자 행마를 지켜야 한다(d4 → e6).
      const mover = boardPiece(moverType, 3, 4);
      s.pieces.push(mover, boardPiece(occType, 4, 6));
      expect(resolveLanding(s, mover, { file: 4, rank: 6 }, true))
        .toMatchObject({ kind: 'merge', resultType: 'archbishop', resultTier: 1 });
    }
  });

  it('★ 이종 융합은 티어를 올리지 않는다 — 등급 상승이 아니라 정체성 변경이다', () => {
    // 티어까지 올리면 500G 재료로 1,000G짜리가 나와 골드 중립성이 무너진다.
    const s = waveState();
    const mover = boardPiece('rook', 3, 4, 3);
    s.pieces.push(mover, boardPiece('knight', 4, 6, 3));
    expect(resolveLanding(s, mover, { file: 4, rank: 6 }, true))
      .toMatchObject({ kind: 'merge', resultType: 'chancellor', resultTier: 3 });
  });

  it('티어가 다르면 융합이 아니다 — 보드발은 맞교환, 트레이발은 거부', () => {
    const s = waveState();
    const mover = boardPiece('rook', 3, 4, 2);
    s.pieces.push(mover, boardPiece('knight', 4, 6, 1));
    expect(resolveLanding(s, mover, { file: 4, rank: 6 }, true)).toMatchObject({ kind: 'swap' });

    const tray = trayPiece('rook', 2);
    s.pieces.push(tray);
    expect(resolveLanding(s, tray, { file: 4, rank: 6 }, true))
      .toMatchObject({ kind: 'reject', reason: 'tierMismatch' });
  });

  it('클릭-투-무브로는 융합되지 않는다 — 합성과 같은 규칙', () => {
    const s = waveState();
    const mover = boardPiece('rook', 3, 4);
    s.pieces.push(mover, boardPiece('knight', 4, 6));
    expect(resolveLanding(s, mover, { file: 4, rank: 6 }, false)).toMatchObject({ kind: 'swap' });
  });

  it('나이트가 움직이는 쪽이면 L자 게이트를 지켜야 한다 (의도된 비대칭)', () => {
    // 나이트를 비숍 위로 끌면 L자 거리에서만 융합되고, 비숍을 나이트 위로 끌면 거리 제약이
    // 없다. 같은 레시피가 방향에 따라 다른 조건을 갖지만, 이는 "나이트의 행마"가 이동하는
    // 쪽에만 걸리는 기존 성질의 귀결이지 융합이 만든 예외가 아니다.
    const s = waveState();
    const knight = boardPiece('knight', 3, 4);
    s.pieces.push(knight, boardPiece('bishop', 3, 5));   // 바로 위 = L자 아님
    expect(resolveLanding(s, knight, { file: 3, rank: 5 }, true))
      .toMatchObject({ kind: 'reject', reason: 'knightPattern' });
  });

  it('8랭크는 융합 경로로도 뚫리지 않는다', () => {
    const s = waveState();
    const mover = boardPiece('rook', 3, 7);
    s.pieces.push(mover, boardPiece('knight', 3, 8));
    expect(resolveLanding(s, mover, { file: 3, rank: 8 }, true))
      .toMatchObject({ kind: 'reject', reason: 'outOfBounds' });
  });
});

describe('융합 커밋', () => {
  it('점유자가 새 기물이 되고, 능력치가 재료 합과 같다', () => {
    const s = waveState();
    const mover = boardPiece('rook', 3, 4);
    const occ = boardPiece('knight', 4, 6);
    s.pieces.push(mover, occ);
    const ev: GameEvent[] = [];

    expect(moveOnBoard(s, mover.id, 4, 6, ev, true)).toBe(true);
    expect(s.pieces).toHaveLength(1);
    expect(occ.type).toBe('chancellor');
    expect(occ.tier).toBe(1);
    expect(ev).toContainEqual({
      kind: 'merged', square: { file: 4, rank: 6 }, pieceType: 'chancellor', tier: 1,
    });

    // 재료 합 — 비용도 능력치도. 이것이 골드 중립성의 근거다.
    expect(CONFIG.pieces.chancellor.cost)
      .toBe(CONFIG.pieces.rook.cost + CONFIG.pieces.knight.cost);
    expect(CONFIG.pieces.chancellor.damage)
      .toBe(CONFIG.pieces.rook.damage + CONFIG.pieces.knight.damage);
  });

  it('★ 쿨다운은 둘 중 큰 값 — 드래그 방향에 따라 달라지지 않는다', () => {
    // 예전에는 생존자 것을 그대로 뒀는데, 어느 쪽이 생존자가 될지는 플레이어가 어느 쪽을
    // 집느냐로 정해졌다. 그래서 "쿨다운 남은 기물을 갓 산 기물 위로 끌면 리셋"이 성립했다.
    for (const dragTired of [true, false]) {
      const s = waveState();
      const tired = boardPiece('rook', 3, 4);
      const fresh = boardPiece('rook', 4, 4);
      tired.cooldown = 2.9;
      s.pieces.push(tired, fresh);
      const [mover, target] = dragTired ? [tired, fresh] : [fresh, tired];
      expect(moveOnBoard(s, mover.id, target.square!.file, target.square!.rank, [], true)).toBe(true);
      expect(target.cooldown).toBeCloseTo(2.9);
    }
  });

  it('융합 직후 폭발은 **결과 기물** 기준이다', () => {
    // 커밋이 타입을 바꾼 뒤에 폭발을 판정해야 한다. 커밋 전 타입을 읽으면 비숍 위로 끌어
    // 만든 아치비숍이 폭발을 잃고(비숍은 blast가 없다), 반대 방향은 나이트 데미지로 터진다.
    const s = waveState();
    const mover = boardPiece('bishop', 3, 4);
    const occ = boardPiece('knight', 4, 6);
    s.pieces.push(mover, occ);
    const e = enemyAt(1, 4, 6);
    s.enemies.push(e);
    const hp0 = e.hp;
    const ev: GameEvent[] = [];

    expect(moveOnBoard(s, mover.id, 4, 6, ev, true)).toBe(true);
    expect(occ.type).toBe('archbishop');
    expect(ev.filter(x => x.kind === 'knightBlast')).toHaveLength(1);
    expect(hp0 - e.hp).toBe(CONFIG.pieces.archbishop.damage);
  });

  it('아마존이 생기면 버프가 즉시 재계산된다', () => {
    // 아마존은 buffFactor > 0이라 **새 버퍼가 태어나는** 유일한 경로다. 재계산을 빠뜨리면
    // 라인 위 아군이 다음 배치까지 옛 배율로 싸운다.
    const s = waveState();
    const target = boardPiece('rook', 3, 1);
    const mover = boardPiece('queen', 3, 4);
    const occ = boardPiece('knight', 4, 6);
    s.pieces.push(target, mover, occ);
    recalcQueenBuffs(s);
    const before = target.queenBuffCount;

    expect(moveOnBoard(s, mover.id, 4, 6, [], true)).toBe(true);
    expect(occ.type).toBe('amazon');
    // 퀸(계수 1)이 사라지고 아마존(계수 0.5)이 생겼다 — 값이 실제로 다시 계산됐는지를 본다.
    expect(target.queenBuffCount).not.toBe(before);
    expect(pieceDamage(target)).toBe(CONFIG.pieces.rook.damage * (1 + target.queenBuffCount));
  });

  it('트레이에서 끌어와도 융합된다', () => {
    const s = waveState();
    const tray = trayPiece('knight');
    s.pieces.push(tray, boardPiece('bishop', 4, 4));
    expect(placeFromSlot(s, tray.id, 4, 4, [], true)).toBe(true);
    expect(s.pieces).toHaveLength(1);
    expect(s.pieces[0].type).toBe('archbishop');
  });
});

describe('융합물의 그 이후', () => {
  it('융합물끼리는 동종 합성된다 (티어 +1)', () => {
    const s = waveState();
    const a = boardPiece('archbishop', 3, 4, 2);
    const b = boardPiece('archbishop', 4, 4, 2);
    s.pieces.push(a, b);
    expect(moveOnBoard(s, a.id, 4, 4, [], true)).toBe(true);
    expect(b.tier).toBe(3);
    expect(b.type).toBe('archbishop');
  });

  it('융합물 + 다른 종류는 레시피가 없으므로 맞교환이다', () => {
    const s = waveState();
    const a = boardPiece('archbishop', 3, 4);
    s.pieces.push(a, boardPiece('rook', 4, 4));
    expect(resolveLanding(s, a, { file: 4, rank: 4 }, true)).toMatchObject({ kind: 'swap' });
  });

  it('판매가·공격력이 티어 배수를 그대로 탄다 — 융합물도 예외가 아니다', () => {
    for (const [, , result] of FUSION_RECIPES) {
      for (let k = 1; k <= CONFIG.merge.maxTier[result]; k++) {
        expect(sellPrice(result, k))
          .toBe(CONFIG.pieces[result].cost * tierMultiplier(k) * CONFIG.economy.sellRatio);
        expect(pieceDamage(boardPiece(result, 0, 1, k)))
          .toBe(CONFIG.pieces[result].damage * tierMultiplier(k));
      }
    }
  });
});

describe('겸업 기물의 미리보기와 설명 (S4c)', () => {
  it('★ 아치비숍은 대각선 사거리와 3×3 폭발을 **둘 다** 보여준다', () => {
    // 예전 조기반환 사슬에서는 한쪽이 통째로 사라졌다. 나이트 브랜치가 초록 L자칸만 그리고
    // return했고, 그 아래 사거리 블록에는 도달하지 못했다.
    const s = waveState();
    const p = boardPiece('archbishop', 3, 4);
    s.pieces.push(p);
    const hl = buildHighlights(s, {
      dragging: null, selectedPieceId: p.id, hoverSquare: { file: 3, rank: 4 },
    });
    const squares = hl.highlights.map(h => h.square);
    const has = (f: number, r: number): boolean => squares.some(q => q.file === f && q.rank === r);

    for (const sq of bishopTargets({ file: 3, rank: 4 })) expect(has(sq.file, sq.rank)).toBe(true);
    for (const sq of knightBlastTargets({ file: 3, rank: 4 })) expect(has(sq.file, sq.rank)).toBe(true);
    // 대각선에 없는 3×3 칸(바로 위)이 실제로 포함됐는지 — 폭발 범위가 살아 있다는 직접 증거
    expect(has(3, 5)).toBe(true);
  });

  it('아마존은 버프 라인과 폭발 범위를 둘 다 보여준다', () => {
    const s = waveState();
    const p = boardPiece('amazon', 3, 4);
    s.pieces.push(p);
    const hl = buildHighlights(s, {
      dragging: null, selectedPieceId: p.id, hoverSquare: { file: 3, rank: 4 },
    });
    const squares = hl.highlights.map(h => h.square);
    const colors = new Set(hl.highlights.map(h => h.color));
    expect(colors.has(HIGHLIGHT_COLORS.queenLine)).toBe(true);
    expect(colors.has(HIGHLIGHT_COLORS.range)).toBe(true);
    expect(hl.lines.length).toBeGreaterThan(0);           // 8방향 라인도 그린다
    expect(squares.some(q => q.file === 2 && q.rank === 3)).toBe(true);   // 3×3 안쪽
  });

  it('순수 나이트는 여전히 자기 칸에서 폭발 범위를 그리지 않는다 (회귀 방지)', () => {
    // 나이트의 폭발은 "착지 지점"에 묶여 있다. 가산 구조가 anchor 기준으로 폭발을 그리면
    // 보드 위 나이트가 자기 현재 칸에서 터지는 것처럼 보인다.
    const s = waveState();
    const n = boardPiece('knight', 3, 4);
    s.pieces.push(n);
    const hl = buildHighlights(s, {
      dragging: null, selectedPieceId: n.id, hoverSquare: null,
    });
    expect(hl.highlights.every(h => h.color !== HIGHLIGHT_COLORS.range)).toBe(true);
  });
});

describe('융합 기물 툴팁 (S4c)', () => {
  function tip(type: PieceType, tier = 1): string {
    const el = document.createElement('div');
    const s = waveState();
    const p = boardPiece(type, 2, 2, tier);
    s.pieces.push(p);
    updateTooltip(el, s, {
      dragging: null, selectedPieceId: null, hoverSquare: { file: 2, rank: 2 },
    }, { x: 0, y: 0 });
    return el.innerHTML;
  }

  it('★ 아마존은 공격력과 버프를 **둘 다** 보여준다', () => {
    // 예전 배타 삼항에서는 버퍼 분기로 들어가 공격력·주기·쿨다운 행이 통째로 사라졌다.
    const html = tip('amazon');
    expect(html).toContain('기본 공격력');
    expect(html).toContain('버프 효과');
    expect(html).toContain('폭발');
  });

  it('아마존의 버프 표기는 계수를 반영한다 — 퀸의 절반', () => {
    expect(tip('queen')).toContain('버프 효과: +100%');
    expect(tip('amazon')).toContain('버프 효과: +50%');
  });

  it('챈슬러는 공격 주기와 이동 폭발을 둘 다 보여준다', () => {
    const html = tip('chancellor');
    expect(html).toContain(`공격 주기 ${CONFIG.pieces.chancellor.interval}s`);
    expect(html).toContain('이동·배치할 때 주변 9칸 폭발');
    expect(html).not.toContain('이동 쿨다운');   // interval은 공격 주기가 쓰고 있다
  });

  it('아치비숍은 비숍의 골드 수입 줄을 유지한다', () => {
    expect(tip('archbishop')).toContain(`공격당 +${CONFIG.pieces.archbishop.goldPerAttack}G`);
  });
});
