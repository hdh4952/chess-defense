// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { CONFIG, TRAITS, slowPercent, tierMultiplier } from '../src/config';
import { recalcQueenBuffs } from '../src/core/buff';
import { pieceDamage, updateCombat } from '../src/core/combat';
import { sellPrice } from '../src/core/economy';
import { FUSION_RECIPES, fusionResult } from '../src/core/fusion';
import { moveOnBoard, placeFromSlot, resolveLanding } from '../src/core/pieces';
import { bishopTargets, slowSquares, slowTargets } from '../src/core/patterns';
import { effectiveSpeed, updateSlowAura } from '../src/core/slow';
import { buildHighlights, HIGHLIGHT_COLORS } from '../src/render/highlights';
import { updateTooltip } from '../src/ui/tooltip';
import type { GameEvent, Piece, PieceType, Square } from '../src/types';
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

    // 재료 합 — **비용**은 셋 다 정확히 지킨다. 골드 중립성과 판매가 불변식이 여기 걸려 있다.
    for (const [a, b, r] of FUSION_RECIPES) {
      expect(CONFIG.pieces[r].cost, r).toBe(CONFIG.pieces[a].cost + CONFIG.pieces[b].cost);
    }
    // 공격력은 **아마존만** 단언한다. 나이트의 공격력이 3 → 0이 되면서(v1.10) 재료 합을 지킨
    // 것은 아마존뿐이고(퀸 0 + 나이트 0 = 0), 아치비숍 4·챈슬러 8은 나이트가 3딜이던 시절의
    // 합을 그대로 들고 있다. 여기서 세 기물 모두에 재료 합을 단언하면 아직 결론이 나지 않은
    // 밸런스 지점에 테스트가 못을 박는 셈이 되므로, 성립하는 축만 단언하고 어긋난 사실은
    // 주석으로 남긴다 — 지우면 다음 사람이 이 불일치를 처음부터 다시 발견해야 한다.
    expect(CONFIG.pieces.amazon.damage)
      .toBe(CONFIG.pieces.queen.damage + CONFIG.pieces.knight.damage);
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

  it('★ 융합물은 나이트의 **감속**을 물려받는다 — 판정은 결과 기물 기준이다', () => {
    // 이 자리에 있던 "융합 직후 폭발" 테스트를 감속 판본으로 다시 쓴 것이다. 능력이 사건에서
    // 상태로 바뀌었을 뿐(v1.10) 지켜야 할 것은 그대로다: 능력은 **커밋이 타입을 바꾼 뒤**의
    // 종류로 판정돼야 한다. 커밋 전 타입을 읽으면 비숍을 나이트 위로 끌어 만든 아치비숍이
    // 감속을 잃고(비숍은 slow가 없다), 같은 조합이 드래그 방향에 따라 다른 기물이 된다.
    for (const [moverType, occType] of [['bishop', 'knight'], ['knight', 'bishop']] as const) {
      const s = waveState();
      const mover = boardPiece(moverType, 3, 4);
      const occ = boardPiece(occType, 4, 6);
      s.pieces.push(mover, occ);
      const e = enemyAt(1, 6, 5);          // g5 — 결과 기물이 서는 칸(e6)에서 L자로 떨어져 있다
      s.enemies.push(e);
      const hp0 = e.hp;

      // 융합 **전** 상태는 방향마다 다르다 — 나이트가 이미 e6에 서 있던 쪽만 걸려 있다.
      updateSlowAura(s, []);
      expect(e.slowed, `${moverType} → ${occType} (융합 전)`).toBe(occType === 'knight');

      expect(moveOnBoard(s, mover.id, 4, 6, [], true)).toBe(true);
      expect(occ.type).toBe('archbishop');
      // 융합 순간에는 아무 일도 일어나지 않는다. 폭발이 사라진 흔적이 여기다 — 예전에는 이
      // 시점에 3×3 피해가 나갔고, 그래서 tryKnightBlast의 호출 위치가 규칙의 일부였다.
      expect(e.hp).toBe(hp0);

      // 한쪽은 걸려 있던 감속이 **유지**되고, 다른 쪽은 없던 감속이 **생긴다**. 결과를 비숍
      // 으로 읽으면 앞쪽이 풀리고 뒤쪽은 영영 걸리지 않는다 — 양방향을 도는 이유가 그것이다.
      updateSlowAura(s, []);
      expect(e.slowed, `${moverType} → ${occType}`).toBe(true);
      expect(effectiveSpeed(e)).toBeCloseTo(e.speed * CONFIG.slowAura.multiplier);
    }
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
  it('★ 감속은 물려받고 L자 행마는 물려받지 않는다 — 두 범위가 아예 다르다', () => {
    // slow와 moveL을 굳이 별도 필드로 둔 이유가 실전에서 처음 드러나는 지점이다. 행마까지
    // 상속하면 융합물이 옆 칸으로 한 칸 미는 조작조차 못 해 룩보다 기동성이 *낮아진다*.
    // 그 결과 한 기물 안에서 "갈 수 있는 칸"과 "늦추는 칸"이 완전히 갈라진다 — 둘을 한
    // 함수로 합치려는 유혹이 생길 때마다 이 단언이 먼저 깨져야 한다.
    const from: Square = { file: 3, rank: 4 };
    for (const [, , result] of FUSION_RECIPES) {
      expect(TRAITS[result].slow, result).toBe(true);
      expect(TRAITS[result].moveL, result).toBe(false);

      const s = waveState();
      const p = boardPiece(result, from.file, from.rank);
      s.pieces.push(p);
      // 옆 칸(e4)은 L자가 아니다. 나이트라면 거부되는 이동인데 융합물은 그냥 간다.
      expect(resolveLanding(s, p, { file: 4, rank: 4 }, false).kind, result).toBe('place');
      // 그런데 감속이 닿는 칸은 여전히 나이트와 똑같은 L자 8칸이라, 방금 갈 수 있었던 그
      // 칸이 오히려 오라 밖이다.
      const slow = slowTargets(result, from);
      expect(slow, result).toHaveLength(slowSquares(from).length);
      expect(slow.some(q => q.file === 4 && q.rank === 4), result).toBe(false);
    }
    // 대조군 — 같은 이동을 나이트에게 시키면 행마에서 걸린다.
    const s = waveState();
    s.pieces.push(boardPiece('knight', from.file, from.rank));
    expect(resolveLanding(s, s.pieces[0], { file: 4, rank: 4 }, false))
      .toMatchObject({ kind: 'reject', reason: 'knightPattern' });
  });

  it('융합물의 감속은 8랭크에도 닿는다 — 이동으로는 못 가는 칸이다', () => {
    // 두 범위가 갈리는 극단이자, slowSquares가 knightMoves와 별도 함수여야 하는 이유.
    // 스폰 구역으로 **이동**은 어느 기물도 못 하지만, 적이 판에 들어오는 바로 그 칸을
    // 오라가 덮지 못하면 입구 크기의 구멍이 생긴다.
    const from: Square = { file: 4, rank: 6 };
    const s = waveState();
    const p = boardPiece('archbishop', from.file, from.rank);
    s.pieces.push(p);
    expect(resolveLanding(s, p, { file: from.file, rank: CONFIG.board.ranks }, false))
      .toMatchObject({ kind: 'reject', reason: 'outOfBounds' });
    expect(slowTargets('archbishop', from).some(q => q.rank === CONFIG.board.ranks)).toBe(true);
  });

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
  it('★ 아치비숍은 대각선 사거리와 L자 감속 범위를 **다른 색으로 둘 다** 보여준다', () => {
    // 예전 조기반환 사슬에서는 한쪽이 통째로 사라졌다. 나이트 브랜치가 초록 L자칸만 그리고
    // return했고, 그 아래 사거리 블록에는 도달하지 못했다.
    // 색까지 보는 것은 v1.10에서 두 축의 **뜻**이 갈라졌기 때문이다: 감속 칸은 "여기 있으면
    // 맞는다"가 아니라 "여기 있으면 느려진다"라, 사거리와 같은 주황으로 칠하면 피해를 주지
    // 않는 능력을 딜로 광고하게 된다.
    const s = waveState();
    const from: Square = { file: 3, rank: 4 };
    const p = boardPiece('archbishop', from.file, from.rank);
    s.pieces.push(p);
    const hl = buildHighlights(s, {
      dragging: null, selectedPieceId: p.id, hoverSquare: { ...from },
    });
    const colorsAt = (f: number, r: number): string[] => hl.highlights
      .filter(h => h.square.file === f && h.square.rank === r).map(h => h.color);

    for (const sq of bishopTargets(from)) {
      expect(colorsAt(sq.file, sq.rank), `대각선 ${sq.file},${sq.rank}`)
        .toContain(HIGHLIGHT_COLORS.range);
    }
    for (const sq of slowSquares(from)) {
      expect(colorsAt(sq.file, sq.rank), `L자 ${sq.file},${sq.rank}`)
        .toContain(HIGHLIGHT_COLORS.slow);
    }
    // f5는 L자이면서 대각선이 아니다 — 감속 범위가 사거리에 얹혀 있는 게 아니라 정말로 따로
    // 그려진다는 직접 증거다(예전에는 3×3이 사거리에 합집합으로 섞여 한 색으로 나갔다).
    expect(colorsAt(5, 5)).toContain(HIGHLIGHT_COLORS.slow);
    expect(colorsAt(5, 5)).not.toContain(HIGHLIGHT_COLORS.range);
  });

  it('아마존은 버프 라인과 감속 범위를 둘 다 보여준다 — 색이 겹치면 둘 다 못 읽는다', () => {
    // 아마존은 buffFactor > 0이면서 감속도 하는 유일한 기물이라, 한 번의 선택으로 두 색이
    // 같은 화면에 동시에 그려진다. 두 색을 갈라 둔 규칙이 실제로 쓰이는 유일한 지점이다.
    const s = waveState();
    const from: Square = { file: 3, rank: 4 };
    const p = boardPiece('amazon', from.file, from.rank);
    s.pieces.push(p);
    const hl = buildHighlights(s, {
      dragging: null, selectedPieceId: p.id, hoverSquare: { ...from },
    });
    const colors = new Set(hl.highlights.map(h => h.color));
    expect(HIGHLIGHT_COLORS.slow).not.toBe(HIGHLIGHT_COLORS.queenLine);
    expect(colors.has(HIGHLIGHT_COLORS.queenLine)).toBe(true);
    expect(colors.has(HIGHLIGHT_COLORS.slow)).toBe(true);
    expect(hl.lines.length).toBeGreaterThan(0);           // 8방향 라인도 그린다
    // b3은 L자 칸이면서 8방향 라인 어디에도 없다 — 감속 범위가 버프 라인에 묻히지 않는다.
    expect(hl.highlights.some(
      h => h.square.file === 1 && h.square.rank === 3 && h.color === HIGHLIGHT_COLORS.slow,
    )).toBe(true);
    // 사거리 칸은 하나도 없다. 아마존의 공격력은 재료 합 그대로 0이라(퀸 0 + 나이트 0)
    // 주황이 한 칸이라도 나오면 그것은 없는 공격을 약속하는 그림이다.
    expect(colors.has(HIGHLIGHT_COLORS.range)).toBe(false);
  });

  it('순수 나이트는 여전히 자기 칸에서 능력 범위를 그리지 않는다 (회귀 방지)', () => {
    // 근거가 바뀌었다. 예전에는 "폭발이 착지 지점에 묶여 있어서"였지만, 이제는 renderer가
    // 감속 칸을 **상시로** 그리기 때문이다 — 여기서 또 칠하면 같은 칸에 알파가 두 겹 얹혀
    // "저기는 더 느리다"로 읽히는데, 감속은 정확히 ×0.7 한 번뿐이라 그 그림 자체가 거짓말이다.
    const s = waveState();
    const n = boardPiece('knight', 3, 4);
    s.pieces.push(n);
    const idle = buildHighlights(s, {
      dragging: null, selectedPieceId: n.id, hoverSquare: null,
    });
    expect(idle.highlights.every(h => h.color !== HIGHLIGHT_COLORS.slow)).toBe(true);
    expect(idle.highlights.every(h => h.color !== HIGHLIGHT_COLORS.range)).toBe(true);

    // 반대로 L자 착지 후보를 hover하면 **그 칸 기준** 오라를 미리 보여준다. 위 단언이
    // "감속을 못 그린다"가 아니라 "지금 서 있는 칸에는 안 그린다"라는 뜻임을 이 대조가 고정한다.
    const dest: Square = { file: 4, rank: 6 };
    const hover = buildHighlights(s, {
      dragging: null, selectedPieceId: n.id, hoverSquare: dest,
    });
    for (const sq of slowSquares(dest)) {
      expect(hover.highlights.some(
        h => h.square.file === sq.file && h.square.rank === sq.rank
          && h.color === HIGHLIGHT_COLORS.slow,
      ), `${sq.file},${sq.rank}`).toBe(true);
    }
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

  it('★ 아마존은 버프와 감속을 **둘 다** 보여준다', () => {
    // 예전 배타 삼항에서는 버퍼 분기로 들어가는 순간 나머지 행이 통째로 사라졌다. 아마존은
    // 공격력이 0이라(퀸 0 + 나이트 0) 이 두 줄 말고는 보여줄 것이 아예 없고, 그래서 한쪽이
    // 삼켜지면 툴팁이 "이 기물이 무엇을 하는가"를 하나도 말하지 못한다.
    const html = tip('amazon');
    expect(html).toContain('버프 효과');
    expect(html).toContain(`−${slowPercent()}%`);
    // 공격력 0인 순수 지원 기물이므로 "기본 공격력 0"은 적지 않는다 — 알려주는 정보가 없다.
    expect(html).not.toContain('기본 공격력');
    // 이 줄이 없으면 플레이어는 나이트를 겹쳐 놓거나 합성해 더 느리게 만들려 한다. 둘 다
    // 효과가 없고 합성은 덮는 칸이 줄어 오히려 손해다 — 규칙을 말해 주는 편이 낫다.
    expect(html).toContain('중첩');
  });

  it('아마존의 버프 표기는 계수를 반영한다 — 퀸의 절반', () => {
    expect(tip('queen')).toContain('버프 효과: +100%');
    expect(tip('amazon')).toContain('버프 효과: +50%');
  });

  it('챈슬러는 공격 주기와 감속을 둘 다 보여준다', () => {
    const html = tip('chancellor');
    expect(html).toContain(`공격 주기 ${CONFIG.pieces.chancellor.interval}s`);
    expect(html).toContain(`−${slowPercent()}%`);
    // v1.10에서 '이동 쿨다운'이라는 개념 자체가 사라졌다(hasMoveCooldown 삭제). interval은
    // 이제 모든 기물에서 공격 주기 하나만 뜻하므로, 이 문구가 되살아나면 그 통합이 깨진 것이다.
    expect(html).not.toContain('이동 쿨다운');
  });

  it('아치비숍은 비숍의 골드 줄과 나이트의 감속 줄을 함께 유지한다', () => {
    // 겸업 기물은 툴팁에서도 겸업으로 보여야 한다 — 재료 둘의 정체성 중 하나라도 빠지면
    // 플레이어가 융합으로 무엇을 얻고 무엇을 잃었는지 화면에서 확인할 방법이 없다.
    const html = tip('archbishop');
    expect(html).toContain(`공격당 +${CONFIG.pieces.archbishop.goldPerAttack}G`);
    expect(html).toContain(`−${slowPercent()}%`);
  });
});

describe('★ 공격 쿨다운이 이동을 막지 않는다 (S4 회귀)', () => {
  // 같은 `interval` 필드가 기물에 따라 다른 뜻을 갖는 데서 온 버그였다. 나이트에게는 이동
  // 쿨다운이지만 겸업 기물에게는 공격 주기인데, 게이트가 둘을 구분하지 않아 아치비숍·챈슬러가
  // 자동 공격을 할 때마다 3초씩 이동이 잠겼다 — 사거리에 적이 있는 동안 사실상 못 움직였다.
  //
  // v1.10에서 게이트가 통째로 사라졌는데도 이 스위트를 남기는 이유는, 되살아날 유혹이 있는
  // 규칙이기 때문이다. 감속은 "언제 움직였는가"와 무관한 상태라 이동을 제한할 근거가 아예
  // 없다는 것을, 아래 셋이 서로 다른 각도(이동 허용 · 감속 즉시 적용 · interval의 뜻)에서 짚는다.
  //
  // 목록을 리터럴로 적지 않는 이유: 감속 기물이 늘면 그 기물만 조용히 감시 밖으로 빠진다.
  const SLOWERS = (Object.keys(TRAITS) as PieceType[]).filter(t => TRAITS[t].slow);

  it('주기 공격 직후에도 감속 기물을 옮길 수 있다', () => {
    for (const type of SLOWERS) {
      const s = waveState();
      const p = boardPiece(type, 3, 4);
      s.pieces.push(p);
      s.enemies.push(enemyAt(1, 3, 4), enemyAt(1, 5, 6));
      updateCombat(s, 1 / 60, []);
      // 나이트류(L자)는 L자 칸으로, 나머지는 아무 칸으로.
      const dest = TRAITS[type].moveL ? { file: 4, rank: 6 } : { file: 6, rank: 2 };
      expect(resolveLanding(s, p, dest, false).kind, `${type} (쿨다운 ${p.cooldown})`).not.toBe('reject');
    }
  });

  it('쿨다운이 가득 찬 채 옮겨도 새 칸에서 곧바로 감속이 걸린다', () => {
    // 예전에는 "쿨다운 중 이동하면 폭발이 조용히 삼켜진다"가 여기 있었다. 감속에는 삼켜질
    // 순간이 없다 — 능력이 쿨다운이 아니라 **지금 서 있는 칸**에만 의존하기 때문이다. 방금
    // 쏴서 쿨다운이 가득 찬 기물도 옮긴 즉시 새 8칸을 늦춘다는 것이 그 독립성의 관측 가능한 형태다.
    const s = waveState();
    const p = boardPiece('chancellor', 3, 4);
    p.cooldown = CONFIG.pieces.chancellor.interval;   // 방금 쏜 직후
    s.pieces.push(p);
    const e = enemyAt(1, 4, 3);      // e3 — d4의 오라 밖이고 g2의 오라 안이다
    s.enemies.push(e);
    const hp0 = e.hp;
    const ev: GameEvent[] = [];

    updateSlowAura(s, ev);
    expect(e.slowed).toBe(false);

    expect(moveOnBoard(s, p.id, 6, 2, ev, false)).toBe(true);   // 이동은 된다
    expect(p.cooldown).toBeCloseTo(CONFIG.pieces.chancellor.interval);   // 쿨다운은 그대로
    expect(e.hp).toBe(hp0);          // 이동 자체는 아무 피해도 주지 않는다 (폭발 없음)

    updateSlowAura(s, ev);
    expect(e.slowed).toBe(true);
    expect(effectiveSpeed(e)).toBeCloseTo(e.speed * CONFIG.slowAura.multiplier);
    // 알림은 **전이에서만** 나간다. 이미 걸린 적을 몇 틱을 더 재판정해도 새 사건은 없으므로,
    // 한 번 더 돌려 개수가 그대로인 것까지 본다 — 매 틱 발행하면 이펙트도 소리도 60fps ×
    // 적 수로 쏟아져 쓸 수 없게 된다.
    updateSlowAura(s, ev);
    expect(ev.filter(x => x.kind === 'enemySlowed')).toHaveLength(1);
  });

  it('interval의 뜻이 하나로 합쳐졌다 — 주기 공격이 있는 기물만 0이 아니다', () => {
    // 여기 있던 hasMoveCooldown() 단언을 대체한다. 그 함수는 "폭발 기물의 interval은 공격
    // 주기가 아니라 이동 쿨다운"이라는 구분이었는데, 폭발이 사라지면서 구분할 대상 자체가
    // 없어져 함수째 삭제됐다(v1.10). 남은 불변식은 더 단순하다: interval은 이제 공격 주기
    // 하나만 뜻하므로, 주기 공격이 없는 기물(나이트·퀸·아마존)에 0이 아닌 값이 들어가는
    // 순간 그것은 어디에서도 읽히지 않는 거짓말이 된다 — 나이트의 3딜이 그랬던 것처럼.
    for (const type of Object.keys(TRAITS) as PieceType[]) {
      expect(CONFIG.pieces[type].interval > 0, type).toBe(TRAITS[type].pattern !== 'none');
    }
  });
});
