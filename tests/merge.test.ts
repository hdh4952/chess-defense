import { describe, expect, it } from 'vitest';
import { CONFIG, slowMultiplier, slowPercent, tierMultiplier } from '../src/config';
import { pieceDamage, pieceGold, updateCombat } from '../src/core/combat';
import { recalcQueenBuffs } from '../src/core/buff';
import { canDraw, drawPiece, emptySquares, sellPiece, sellPrice } from '../src/core/economy';
import { moveOnBoard, pieceAt, resolveLanding, canLandAt } from '../src/core/pieces';
import { NO_SLOW, slowCoverage, slowFactorAt, updateSlowAura } from '../src/core/slow';
import { buildHighlights, HIGHLIGHT_COLORS } from '../src/render/highlights';
import { TIER_COLORS, tierRingColor } from '../src/render/tiers';
import { render, createFrameView } from '../src/render/renderer';
import type { GameEvent, Interaction, PieceType } from '../src/types';
import { makeStubCtx } from './canvasStub';
import { boardPiece, enemyAt, waveState, gachaRng } from './helpers';

/**
 * 동일 기물 합성. 이 스위트가 고정하는 규칙은 세 층이다:
 *   1) 판정 — resolveLanding 하나가 배치/합성/맞교환/거부를 가른다 (미리보기와 실제 규칙의 단일 출처)
 *   2) 능력치 — tier에 정비례한다 ("능력치 합"이 문자 그대로 성립하는지). ★ v1.13에서 예외가
 *      하나 생겼다 — 감속만은 "합"이 아니라 단계마다 +5%p인 **선형**이다
 *   3) 제스처 — 합성은 드래그 앤 드롭 전용이고 클릭-투-무브는 예전 그대로 맞교환이다
 * 수치는 전부 CONFIG에서 유도한다 (이 저장소의 관행 — 밸런스 재조정에 테스트가 깨지지 않게).
 * 예외는 감속표 하나뿐이다: 사용자가 정한 30/35/40…을 아래에서 **한 번은 리터럴로** 못박는다.
 * 전부 유도하면 계수를 잘못 바꿔도 테스트가 그 값을 따라 움직여 아무것도 지키지 못한다.
 *
 * ⚠️ v1.13에서 **나이트 합성의 의미가 뒤집혔다.** v1.12까지 감속은 티어와 무관해서, 나이트를
 * 합치면 덮는 칸만 절반이 되고 얻는 것이 없었다 — 이 게임에서 **합성이 손해인 유일한 기물**이었다.
 * 이제 단계마다 감속이 +5%p 세지므로 합성은 "칸 ↔ 세기"의 교환이 된다. 그 뒤집힘을 들고 있는
 * 것이 아래 '나이트 합성은 …'으로 시작하는 두 테스트다. 함께 봐야 할 것이 하나 더 있다 —
 * **중첩은 여전히 없다**: 세기 축이 생겼다고 두 오라가 더해지지는 않고, 겹친 칸은 가장 높은
 * 티어 하나가 이긴다. 둘을 따로 두면 "세진다"만 읽고 합산을 기대하기 쉬워 나란히 단언한다.
 *
 * ⚠️ v1.12에서 **축이 하나 사라졌다**: 기물 보관함(트레이)이 없어져 착지 경로가 보드 → 보드
 * 하나뿐이다. 예전에는 같은 칸·같은 제스처인데도 출발지에 따라 결과가 갈렸고(트레이발은
 * 거부, 보드발은 맞교환) 이 파일의 절반이 그 대조였다. 합성 규칙 자체는 한 줄도 바뀌지
 * 않았으므로, 트레이발 단언은 지우지 않고 전부 보드발로 옮겨 살렸다 — 티어가 다를 때
 * 거부가 아니라 맞교환이 되는 것 하나만 결과가 달라진다.
 */

function noInteraction(overrides: Partial<Interaction> = {}): Interaction {
  return { dragging: null, selectedPieceId: null, hoverSquare: null, ...overrides };
}

describe('resolveLanding — 판정표 (합성 규칙 결정표 §3.1)', () => {
  it('같은 종류·같은 티어 점유 칸: 드래그면 합성, 클릭-투-무브면 맞교환', () => {
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

  /*
   * ⚠️ 여기 있던 트레이발 판정 둘이 v1.12에서 삭제됐다 (기물 보관함이 사라져 **경로 자체가
   * 없다**). 둘 다 "트레이발은 밀려날 자리가 없으므로 거부"를 고정하던 테스트다:
   *   - '트레이 → 같은 종류·같은 티어 점유 칸: 드래그면 합성, 아니면 거부'
   *     → 보드발 판본이 바로 위 첫 테스트다. 합성 쪽 단언은 그대로고, allowMerge=false만
   *       거부가 아니라 맞교환이 된다.
   *   - '트레이 → 다른 종류 점유 칸은 여전히 거부다 (밀려날 상대가 없다)'
   *     → 보드발 판본이 그 아래 두 번째 테스트다(맞교환).
   * 사유 상수 'typeMismatch' · 'tierMismatch'도 RejectReason에서 함께 삭제됐으므로, 되살리려면
   * 타입부터 되살려야 한다 — 즉 이 삭제는 컴파일러가 지키고 있다.
   */

  it('티어가 다르면 같은 종류여도 합성이 아니다 — 강화된 기물이 조용히 잡아먹히지 않는다', () => {
    const s = waveState();
    const t2 = boardPiece('rook', 0, 1, 2);
    const t1 = boardPiece('rook', 5, 5, 1);
    s.pieces.push(t2, t1);
    // v1.12 이전에는 이 줄 아래에 트레이발 대조군('tierMismatch' 거부)이 함께 서 있었다.
    // 이제 출발지가 하나뿐이라 결과도 하나 — 맞교환이다.
    expect(resolveLanding(s, t2, { file: 5, rank: 5 }, true)).toMatchObject({ kind: 'swap' });

    // 판정만 보고 넘어가면 커밋 쪽에 흡수 경로가 남아 있어도 초록이다. 실제로 끌어서,
    // 어느 쪽 티어도 변하지 않고 아무도 배열에서 사라지지 않는 것까지 확인한다.
    const events: GameEvent[] = [];
    expect(moveOnBoard(s, t2.id, 5, 5, events, true)).toBe(true);
    expect([t2.tier, t1.tier]).toEqual([2, 1]);
    expect(s.pieces).toHaveLength(2);
    expect(events).toHaveLength(0);                          // merged도 나지 않는다
    expect(t2.square).toEqual({ file: 5, rank: 5 });
    expect(t1.square).toEqual({ file: 0, rank: 1 });         // 자리만 맞바뀐다
  });

  it('8랭크(스폰 구역)는 합성 경로로도 뚫리지 않는다 — 게이트 순서가 규칙이다', () => {
    const s = waveState();
    const mover = boardPiece('rook', 0, 7);
    s.pieces.push(mover, boardPiece('rook', 5, 8));   // 8랭크에 기물이 있는 비정상 상태를 가정해도
    expect(resolveLanding(s, mover, { file: 5, rank: 8 }, true))
      .toMatchObject({ kind: 'reject', reason: 'outOfBounds' });
  });

  it('나이트도 L자가 아닌 칸에서 끌어와 합성된다 — 판정이 뒤집혔다', () => {
    // v1.11 전까지 이 자리에는 "나이트는 합성이어도 L자 행마를 지켜야 한다"가 있었다(거부 사유
    // 'knightPattern'). 나이트의 이동 제약이 통째로 사라지면서(사용자 결정) 불변식이 뒤집힌다:
    // 예전에 거부되던 **바로 그 배치**가 이제 성사돼야 한다. 삭제만 하고 넘어가면 누가 게이트를
    // 되살려도 아무 테스트가 울지 않으므로, 같은 좌표를 그대로 물려받아 반대 방향으로 단언한다.
    const s = waveState();
    const mover = boardPiece('knight', 3, 4);
    const occupant = boardPiece('knight', 3, 5);      // 같은 티어, 바로 위 = L자가 아닌 인접 칸
    s.pieces.push(mover, occupant);
    const sq = { file: 3, rank: 5 };

    expect(resolveLanding(s, mover, sq, true)).toMatchObject({ kind: 'merge', resultTier: 2 });
    // 판정표뿐 아니라 커밋 경로까지 열려 있어야 한다 — 한쪽에만 가드가 남으면 미리보기는
    // 마젠타로 합성을 약속해 놓고 손을 떼는 순간 조용히 실패한다.
    expect(moveOnBoard(s, mover.id, sq.file, sq.rank, [], true)).toBe(true);
    expect(occupant.tier).toBe(2);
    expect(s.pieces).toHaveLength(1);
  });

  it('나이트 합성 판정은 출발 칸과 무관하다 — 어느 방향에서 끌어도 같은 결과다', () => {
    // v1.12 이전 이 테스트는 "보드발이 트레이발과 같은 결과를 낸다"였다. 사라진 L자 게이트가
    // **보드발 전용**이었으므로 두 출발지를 나란히 세워 두는 것이 회귀 신호였는데, 트레이가
    // 없어져 그 축 자체가 사라졌다. 축을 잃은 만큼 다른 축으로 갚는다 — 같은 목표 칸을 여러
    // 방향에서 끌어와, 나이트에게만 붙는 조건이 부활하면 어느 방향에서든 걸리게 한다.
    const s = waveState();
    const target = boardPiece('knight', 4, 4);
    const movers = [
      boardPiece('knight', 4, 5),   // 바로 위 — 인접, L자 아님
      boardPiece('knight', 3, 3),   // 대각 인접 — L자 아님
      boardPiece('knight', 4, 1),   // 같은 파일 먼 칸 — L자 아님
      boardPiece('knight', 6, 5),   // L자 (예전 게이트를 통과하던 유일한 부류)
    ];
    s.pieces.push(target, ...movers);
    // resolveLanding은 순수 판정이라 상태를 건드리지 않는다 — 넷을 같은 보드에서 그대로 훑는다.
    for (const m of movers) {
      expect(resolveLanding(s, m, { file: 4, rank: 4 }, true))
        .toMatchObject({ kind: 'merge', resultTier: 2 });
    }
    // 남은 제약은 8랭크 금지 하나뿐이고 그것은 모든 기물에 공통이다 — 나이트에게만 더 걸리는
    // 사유가 부활하면 여기가 아니라 위 루프가 먼저 깨진다.
    expect(canLandAt(s, movers[0], { file: 4, rank: CONFIG.board.ranks })).toBe(false);
  });

  it('티어 합이 상한을 넘으면 거부다 — 초과분을 깎지도, 조용히 맞교환하지도 않는다', () => {
    // 설계 초안은 초과를 "맞교환 폴백"으로 뒀지만 거부로 바꿨다. 같은 종류 위로 드래그하는
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

  it('canLandAt은 resolveLanding(allowMerge=false)의 파생 — 점유 칸도 맞교환이라 착지 가능이다', () => {
    // v1.12 이전 이 단언은 트레이 기물로 세워졌고 점유 칸이 false였다(밀려날 자리가 없었다).
    // 모든 기물이 보드 위에 있는 지금은 점유 칸이 언제나 맞교환 대상이므로 true다 — 판정이
    // 뒤집혔을 뿐 "canLandAt = 합성을 빼고 본 resolveLanding"이라는 관계는 그대로다.
    const s = waveState();
    const mover = boardPiece('rook', 4, 5);
    s.pieces.push(mover, boardPiece('rook', 4, 4));
    const squares = [
      { file: 4, rank: 4 },                        // 같은 종류 점유 → 맞교환
      { file: 4, rank: 6 },                        // 빈 칸
      { file: 4, rank: CONFIG.board.ranks },       // 8랭크 = 스폰 구역
    ];
    expect(squares.map(sq => canLandAt(s, mover, sq))).toEqual([true, true, false]);
    // 파생이라는 사실 자체를 고정한다 — 두 함수가 갈라지면 미리보기와 실제 결과가 어긋난다.
    for (const sq of squares) {
      expect(canLandAt(s, mover, sq)).toBe(resolveLanding(s, mover, sq, false).kind !== 'reject');
    }
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

  it('갓 산 기물을 겹쳐도 쿨다운이 초기화되지 않는다 — 구매→합성이 리셋 버튼이 되면 안 된다', () => {
    // v1.12 이전에는 "갓 산 기물"이 트레이에 있어서 placeFromSlot으로 이 규칙을 확인했다.
    // 구매가 곧 보드 스폰이 되면서 갓 산 기물은 그냥 **쿨다운 0인 보드 기물**이고, 검증
    // 경로도 보드 → 보드 하나로 합쳐졌다. 막으려는 어뷰징은 그대로다(스펙 5.1의 안티파밍).
    // 승계 규칙이 max라 드래그 방향과 무관하다는 사실은 fusion.test.ts가 전담한다.
    const s = waveState();
    const fresh = boardPiece('rook', 4, 5);            // 갓 산 기물: 쿨다운 0
    const tired = boardPiece('rook', 4, 4);
    tired.cooldown = 2.9;
    s.pieces.push(fresh, tired);

    expect(moveOnBoard(s, fresh.id, 4, 4, [], true)).toBe(true);
    expect(tired.cooldown).toBeCloseTo(2.9);
  });

  it('합성은 보드 칸을 하나 돌려준다 — 꽉 찬 보드에서 다시 구매할 수 있게 된다', () => {
    // v1.12 이전 이 자리에는 "트레이발 합성은 슬롯을 비워 다시 구매할 수 있게 한다"가 있었다.
    // 압박의 무대가 트레이 16칸에서 **보드 56칸**으로 옮겨갔을 뿐 불변식은 문자 그대로 같다:
    // 두 기물이 하나가 되므로 자리가 하나 남고, 그 자리가 곧 다음 구매를 여는 열쇠다.
    // (판매를 빼면 자리를 되찾는 방법은 이것뿐이다.)
    const s = waveState();
    for (const sq of emptySquares(s)) s.pieces.push(boardPiece('pawn', sq.file, sq.rank));
    expect(s.pieces).toHaveLength(CONFIG.board.files * (CONFIG.board.ranks - 1));  // 8랭크는 제외
    expect(emptySquares(s)).toHaveLength(0);
    expect(canDraw(s)).toBe(false);               // 자리가 없으면 뽑기 자체가 막힌다

    const mover = pieceAt(s, 0, 1)!;
    const survivor = pieceAt(s, 0, 2)!;
    expect(moveOnBoard(s, mover.id, 0, 2, [], true)).toBe(true);
    expect(survivor.tier).toBe(2);
    expect(emptySquares(s)).toEqual([{ file: 0, rank: 1 }]);   // 흡수된 쪽의 칸이 정확히 돌아온다
    expect(canDraw(s)).toBe(true);

    // 그리고 새 기물은 **그 빈 칸**에 떨어진다. 스폰 위치를 플레이어가 고르지 않으므로
    // pieceSpawned의 square가 실제 기물 위치와 같다는 것이 유일한 안내다 — 둘이 갈라지면
    // 화면은 엉뚱한 칸을 가리키고 플레이어는 56칸에서 새 기물을 직접 찾아야 한다.
    const events: GameEvent[] = [];
    const bought = drawPiece(s, events, gachaRng('pawn'))!;
    expect(bought.square).toEqual({ file: 0, rank: 1 });
    expect(events).toContainEqual({
      kind: 'pieceSpawned', square: bought.square, pieceType: 'pawn', bought: true,
    });
    expect(emptySquares(s)).toHaveLength(0);      // 겹쳐 놓지 않고 그 한 칸을 정확히 메웠다
  });

  it('같은 칸에 두 기물이 남지 않는다 — 흡수된 쪽은 배열에서 제거된다', () => {
    const s = waveState();
    const mover = boardPiece('pawn', 0, 1);
    s.pieces.push(mover, boardPiece('pawn', 1, 2));
    moveOnBoard(s, mover.id, 1, 2, [], true);
    expect(s.pieces.filter(p => p.square.file === 1 && p.square.rank === 2)).toHaveLength(1);
  });

  it('합성 직후에는 아무 능력도 발동하지 않는다 — 감속은 다음 틱이 생존자의 칸으로 건다', () => {
    // v1.10 전까지 이 자리에는 "나이트 합성은 생존자 기준으로 정확히 1회 폭발한다"가 있었다.
    // 폭발이 감속 오라로 바뀌면서 능력이 붙을 **순간**이 사라졌으므로(서 있기만 하면 걸리는
    // 지속 상태다) 불변식이 뒤집힌다: 합성은 merged 하나만 남기고 끝나야 한다.
    // 여기 있던 "티어에 비례하는 데미지" 단언은 나이트 공격력이 0이 되면서 지킬 대상을 잃었는데,
    // v1.13에서 **티어 축이 감속 세기로 돌아왔다** — 그래서 아래 틱 뒤 단언이 티어를 다시 본다.
    // 합성 결과가 T2면 다음 틱이 거는 것도 T2 감속(−35%)이어야 한다. 흡수된 쪽의 T1이 남아
    // 걸리면 합성한 보람이 조용히 사라지므로, 값이 아니라 **어느 기물의 티어인지**를 못박는다.
    const s = waveState();
    const mover = boardPiece('knight', 3, 4);
    // d4 → e6. v1.11부터 이 좌표가 L자인 것은 **이동 조건이 아니라** 아래 감속 단언의 조건이다
    // (어느 칸으로 끌어도 합성 자체는 된다) — 출발 칸이 생존자의 감속 8칸에 들어와야 한다.
    const occupant = boardPiece('knight', 4, 6);
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
    expect(s.enemies.map(x => x.slowTier)).toEqual([NO_SLOW, NO_SLOW]);   // 감속도 아직이다

    // 능력은 조작이 아니라 틱에 속한다(step.ts). 그리고 틱이 보는 것은 합성 결과 기물의
    // 지금 칸뿐이라, 흡수된 쪽이 있던 자리가 아니라 생존자의 L자 8칸이 덮인다.
    const tickEvents: GameEvent[] = [];
    updateSlowAura(s, tickEvents);
    expect(onL.slowTier).toBe(occupant.tier);          // 재료의 T1이 아니라 합성 결과의 T2다
    expect(onSurvivor.slowTier).toBe(NO_SLOW);         // 자기가 선 칸은 L자가 아니다
    // 화면이 −30%가 아니라 −35%를 말하려면 이벤트가 그 티어를 실어 날라야 한다 —
    // 렌더는 적의 상태를 뒤져 보지 않고 이 이벤트 하나로 라벨을 만든다(render/effects.ts).
    expect(tickEvents).toContainEqual({
      kind: 'enemySlowed', enemyId: onL.id, file: onL.file, y: onL.y, tier: 2,
    });
  });
});

describe('능력치는 tier에 정비례한다 ("능력치 합") — 단 감속만은 선형이다', () => {
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

  it('나이트 합성: 덮는 칸은 절반이 되지만 감속이 30% → 35%로 세진다 (v1.13에서 뒤집힌 거래)', () => {
    // v1.12까지 나이트는 이 게임에서 **합성이 손해인 유일한 기물**이었다. 감속률이 티어와
    // 무관해서, 두 기를 합치면 덮는 칸만 16 → 8로 줄고 얻는 것이 하나도 없었기 때문이다.
    // 잃는 쪽은 지금도 그대로다 — 그래서 두 축을 한 테스트에서 함께 잰다. 바뀐 것은 그 대가로
    // 받는 것이 생겼다는 쪽이고, 칸 단언을 빼면 "세진다"만 남아 거래의 절반이 안 보인다.
    const s = waveState();
    const mover = boardPiece('knight', 2, 3);
    const occupant = boardPiece('knight', 5, 3);      // 두 L자 8칸이 한 칸도 겹치지 않는 배치
    s.pieces.push(mover, occupant);
    const sq = { file: 6, rank: 5 };                  // occupant의 L자 칸 — 합성 후에도 계속 덮인다

    expect(slowCoverage(s).size).toBe(16);            // T1 둘 = 8칸 + 8칸
    expect(slowFactorAt(s, sq)).toBe(slowMultiplier(1));

    expect(moveOnBoard(s, mover.id, 5, 3, [], true)).toBe(true);
    expect(occupant.tier).toBe(2);
    expect(slowCoverage(s).size).toBe(8);                    // 잃는 것: 칸의 절반
    expect(slowFactorAt(s, sq)).toBe(slowMultiplier(2));     // 얻는 것: 한 단계 센 감속

    // 증가폭 자체는 CONFIG에서 유도한다. 이 스위트에서 감속만 갖는 성질이 여기 있다 —
    // 다른 능력치처럼 "합"(배)이었다면 T2는 35%가 아니라 60%였을 것이다.
    expect(slowPercent(2) - slowPercent(1)).toBe(CONFIG.slowAura.perTierPercent);
    expect(slowPercent(2)).not.toBe(slowPercent(1) * 2);

    // 그리고 사용자가 정한 표는 여기서 한 번 **리터럴로** 못박는다. 전부 유도하면 계수를 잘못
    // 바꿔도 위 단언들이 새 값을 따라가 초록이다. 길이를 maxTier에서 뽑는 이유는 합성 사슬이
    // 표보다 길어지는 순간 상한 티어의 감속률이 아무도 정하지 않은 값이 되기 때문이다.
    const tiers = Array.from({ length: CONFIG.merge.maxTier.knight }, (_, i) => i + 1);
    expect(tiers.map(t => slowPercent(t))).toEqual([30, 35, 40, 45, 50, 55]);
  });

  it('나이트 합성은 옆의 T1에 끌려 내려가지 않는다 — 티어는 타되 중첩은 여전히 없다', () => {
    // 두 규칙을 한 테스트에 나란히 세운다. 따로 읽으면 "세진다"에서 합산을, "중첩 없음"에서
    // 티어 무관을 각각 기대하게 되는데 실제 규칙은 그 사이에 있다 — 겹친 칸은 **가장 높은
    // 티어 하나**가 이긴다. 합성 쪽에서 이 규칙이 걸리는 지점이 분명하다: 합성해 만든 T2
    // 옆에 T1이 서 있다는 이유만으로 그 칸이 30%로 되돌아가면, 방금 두 기를 태워 산 세기가
    // 배치를 조금 바꿨다는 이유로 조용히 사라진다.
    const s = waveState();
    const mover = boardPiece('knight', 2, 3);
    const merged = boardPiece('knight', 5, 3);
    s.pieces.push(mover, merged);
    expect(moveOnBoard(s, mover.id, 5, 3, [], true)).toBe(true);
    expect(merged.tier).toBe(2);
    // 나중에 배치한다 = slowCoverage 순회에서 **뒤에 온다**. "마지막에 쓴 쪽이 이긴다"는
    // 흔한 실수가 여기서만 드러나므로 순서가 이 테스트의 일부다.
    const weak = boardPiece('knight', 4, 4);
    s.pieces.push(weak);

    const both = { file: 6, rank: 5 };        // T2와 T1이 함께 덮는 칸
    const onlyWeak = { file: 5, rank: 6 };    // T1만 덮는 칸
    expect(slowFactorAt(s, both)).toBe(slowMultiplier(merged.tier));
    expect(slowFactorAt(s, both)).not.toBe(slowMultiplier(weak.tier));               // 끌어내리지 않고
    expect(slowFactorAt(s, both)).not.toBe(slowMultiplier(1) * slowMultiplier(2));   // 곱해지지도 않는다
    expect(slowFactorAt(s, onlyWeak)).toBe(slowMultiplier(1));   // 약한 쪽이 사라지는 것도 아니다

    // 적이 드는 값도 하나뿐이다. 배수가 아니라 **티어**라 두 값을 섞는 코드가 의미조차 없다.
    const e = enemyAt(1, both.file, both.rank);
    s.enemies.push(e);
    updateSlowAura(s, []);
    expect(e.slowTier).toBe(merged.tier);
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
    // v1.12부터 dragging에 from이 없다 — 드래그의 출발지는 언제나 보드다.
    const hl = buildHighlights(s, noInteraction({
      dragging: { pieceId: mover.id }, hoverSquare: { file: 5, rank: 5 },
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
      dragging: { pieceId: mover.id }, hoverSquare: { file: 5, rank: 5 },
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
