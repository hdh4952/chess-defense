import { describe, expect, it } from 'vitest';
import { CONFIG, TRAITS, tierMultiplier } from '../src/config';
import { recalcQueenBuffs } from '../src/core/buff';
import { buyPiece, emptySquares, grantPiece } from '../src/core/economy';
import { sameSquare } from '../src/core/grid';
import { queenLines } from '../src/core/patterns';
import { createInitialState } from '../src/core/state';
import type { GameEvent, GameState, Piece, Square } from '../src/types';
import { boardPiece } from './helpers';

/** 퀸 1기(T1)가 주는 버프량. 리터럴 1을 박으면 buffFactor나 tierMultiplier가 바뀌어도
 *  이 스위트는 초록으로 남아 "버프가 없어진 것"을 못 본다. */
const QUEEN_BUFF = TRAITS.queen.buffFactor * tierMultiplier(1);

/**
 * 지정한 칸 하나만 남기고 1~7랭크를 전부 채운다 — 스폰 칸을 난수가 아니라 **판의 상태**로
 * 고정하는 장치다.
 *
 * rng를 `() => 0`으로 두고 emptySquares의 순회 순서(파일 우선)에 기대는 방법도 있지만, 그러면
 * 순회 순서를 바꾸는 순간 버프와 아무 상관 없는 이유로 이 스위트가 깨진다. 빈 칸이 하나뿐이면
 * 어떤 rng를 넣어도 답이 하나라서, "스폰 칸이 퀸 라인 위였다"는 전제가 난수와 무관해진다.
 */
function fillExcept(s: GameState, free: Square): void {
  for (const sq of emptySquares(s)) {
    if (sameSquare(sq, free)) continue;
    s.pieces.push(boardPiece('pawn', sq.file, sq.rank));
  }
}

/** 이 칸을 덮는 퀸들의 버프 합 — 자기 자신은 빼고 센다 (스펙 5.6의 정의 그대로). */
function expectedBuff(pieces: readonly Piece[], p: Piece): number {
  return pieces.reduce((sum, q) => {
    if (q === p) return sum;
    const factor = TRAITS[q.type].buffFactor;
    if (factor === 0) return sum;
    return queenLines(q.square).some(sq => sameSquare(sq, p.square))
      ? sum + tierMultiplier(q.tier) * factor
      : sum;
  }, 0);
}

describe('recalcQueenBuffs (스펙 5.6)', () => {
  it('퀸의 8방향 직선 위 기물이 버프를 받는다', () => {
    const s = createInitialState();
    const rook = boardPiece('rook', 3, 5);      // 퀸 d1과 같은 파일
    const bishop = boardPiece('bishop', 4, 2);  // 퀸 d1의 대각선
    const knight = boardPiece('knight', 0, 3);  // 라인 밖
    s.pieces.push(boardPiece('queen', 3, 1), rook, bishop, knight);
    recalcQueenBuffs(s);
    expect(rook.queenBuffCount).toBe(QUEEN_BUFF);
    expect(bishop.queenBuffCount).toBe(QUEEN_BUFF);
    expect(knight.queenBuffCount).toBe(0);
  });
  it('퀸 2개가 겹치면 +2 (×3 배율)', () => {
    const s = createInitialState();
    const rook = boardPiece('rook', 3, 4);
    s.pieces.push(
      boardPiece('queen', 3, 1),  // 같은 파일
      boardPiece('queen', 0, 4),  // 같은 랭크
      rook,
    );
    recalcQueenBuffs(s);
    expect(rook.queenBuffCount).toBe(2 * QUEEN_BUFF);
  });
  it('다른 기물이 사이에 있어도 차단되지 않는다 (스펙 5.6)', () => {
    const s = createInitialState();
    const far = boardPiece('rook', 3, 7);
    s.pieces.push(
      boardPiece('queen', 3, 1),
      boardPiece('pawn', 3, 4),   // 경로 중간
      far,
    );
    recalcQueenBuffs(s);
    expect(far.queenBuffCount).toBe(QUEEN_BUFF);
  });

  // ⚠️ v1.12에서 삭제: "슬롯 기물은 항상 0". 기물 보관함이 사라져 Piece.square가 널이 아니게
  // 되면서 **버프에서 제외되는 기물이라는 상태 자체가 표현 불가능**해졌다 — recalcQueenBuffs도
  // 트레이를 걸러내던 filter를 잃고 state.pieces 전체를 돈다. 그 filter가 살아 있는지 보던
  // 자리를 아래 두 테스트가 물려받는다: "리셋"은 이전 값이 남지 않는지를, "합과 일치"는
  // 예외 없이 전원이 계산 대상인지를 본다.

  it('재계산은 이전 값을 먼저 리셋한다 — 라인 밖 기물에 쓰레기값이 남지 않는다', () => {
    const s = createInitialState();
    const off = boardPiece('knight', 0, 3);   // 퀸 d1 기준 라인 밖
    off.queenBuffCount = 3;                   // 이전 재계산의 잔재
    const on = boardPiece('rook', 3, 4);
    s.pieces.push(boardPiece('queen', 3, 1), on, off);
    recalcQueenBuffs(s);
    expect(off.queenBuffCount).toBe(0);
    expect(on.queenBuffCount).toBe(QUEEN_BUFF);
  });
  it('퀸이 판에서 빠지면 버프도 사라진다', () => {
    // 트레이 회수가 없어져 퀸이 판을 떠나는 길은 판매·합성뿐이고, 둘 다 배열에서 뺀 뒤
    // recalcQueenBuffs를 부른다. 여기서 보는 것은 그 트리거(economy/merge 스위트의 몫)가
    // 아니라 **재계산 자체가 사라진 퀸을 정확히 잊는가**다.
    const s = createInitialState();
    const rook = boardPiece('rook', 3, 4);
    const queen = boardPiece('queen', 3, 1);
    s.pieces.push(queen, rook);
    recalcQueenBuffs(s);
    expect(rook.queenBuffCount).toBe(QUEEN_BUFF);
    s.pieces.splice(s.pieces.indexOf(queen), 1);
    recalcQueenBuffs(s);
    expect(rook.queenBuffCount).toBe(0);
  });
  it('모든 기물의 버프 = 자기 칸을 덮는 퀸들의 합 (예외 대상이 하나도 없다)', () => {
    // filter가 사라진 지금, "빠뜨린 기물"은 조용히 0으로 남을 뿐 아무 데서도 티가 나지 않는다.
    // 그래서 한 기물이 아니라 판 위의 **전원**을 독립 계산식과 대조한다. 아마존(buffFactor 0.5)을
    // 섞은 이유는 퀸만 특별 취급하는 회귀를 잡기 위해서다 — 버프의 주체는 타입이 아니라 factor다.
    const s = createInitialState();
    const q1 = boardPiece('queen', 3, 1);
    const q2 = boardPiece('queen', 0, 4, 2);      // T2 — 티어 가중이 붙는다
    const amazon = boardPiece('amazon', 6, 6);    // 반쪽 버프도 계산 대상
    s.pieces.push(
      q1, q2, amazon,
      boardPiece('rook', 3, 4),      // q1·q2 둘 다의 라인
      boardPiece('pawn', 7, 5),      // q1 대각선
      boardPiece('bishop', 5, 7),    // 아마존과 같은 대각선
      boardPiece('knight', 1, 7),    // 세 버퍼 어느 라인에도 없다
    );
    recalcQueenBuffs(s);
    for (const p of s.pieces) {
      expect([p.id, p.queenBuffCount]).toEqual([p.id, expectedBuff(s.pieces, p)]);
    }
    // 위 대조식이 통째로 0을 돌려주는 퇴화(= 아무도 버프를 못 받는 상태)를 배제한다.
    expect(s.pieces.some(p => p.queenBuffCount > 0)).toBe(true);
    // 퀸도 다른 퀸의 버프를 받는다 — 제외되는 것은 "퀸"이 아니라 "자기 자신"뿐이다.
    expect(q1.queenBuffCount).toBe(tierMultiplier(q2.tier) * QUEEN_BUFF);
  });
});

/**
 * v1.12 — 구매·지급이 곧 배치다. 예전에는 트레이에 들어갔다가 드래그로 놓일 때 버프가 붙었고,
 * 그 사이의 기물은 정의상 버프 대상이 아니었다. 이제 스폰 위치를 플레이어가 고르지 않으므로
 * **"떨어진 그 순간의 값"이 곧 그 기물의 첫 화력**이다 — buyPiece/grantPiece가 recalcQueenBuffs를
 * 빠뜨리면 다음 재계산(이동·판매·합성)이 일어날 때까지 조용히 버프 없이 싸운다.
 */
describe('스폰 즉시 버프 반영 (v1.12)', () => {
  it('퀸 라인 위에 스폰된 구매 기물은 즉시 버프를 받는다', () => {
    const s = createInitialState();
    const free = { file: 0, rank: 1 };
    s.pieces.push(boardPiece('queen', free.file, 5));   // 빈 칸과 같은 파일
    fillExcept(s, free);
    s.gold = CONFIG.pieces.rook.cost;
    const events: GameEvent[] = [];
    const rook = buyPiece(s, 'rook', events, () => 0.42)!;   // 빈 칸이 하나뿐이라 난수와 무관
    expect(rook.square).toEqual(free);
    expect(rook.queenBuffCount).toBe(QUEEN_BUFF);
    // 이벤트가 가리키는 칸이 실제 기물 위치와 어긋나면 화면이 엉뚱한 칸을 강조한다 —
    // 스폰 위치를 플레이어가 고르지 않는 지금은 그것이 유일한 안내다.
    const spawned = events.find(e => e.kind === 'pieceSpawned');
    expect(spawned).toEqual({ kind: 'pieceSpawned', square: free, pieceType: 'rook', bought: true });
    expect(emptySquares(s)).toHaveLength(0);
  });
  it('스폰된 퀸은 기존 기물에게 즉시 버프를 준다 (반대 방향)', () => {
    const s = createInitialState();
    const free = { file: 0, rank: 2 };
    const rook = boardPiece('rook', free.file, 1);      // 빈 칸과 같은 파일
    s.pieces.push(rook);
    fillExcept(s, free);
    recalcQueenBuffs(s);
    expect(rook.queenBuffCount).toBe(0);
    const events: GameEvent[] = [];
    const queen = grantPiece(s, 'queen', events, () => 0.42)!;
    expect(queen.square).toEqual(free);
    expect(rook.queenBuffCount).toBe(QUEEN_BUFF);
    expect(queen.queenBuffCount).toBe(0);              // 자기 버프는 없다
    expect(events).toContainEqual(
      { kind: 'pieceSpawned', square: free, pieceType: 'queen', bought: false },
    );
  });
  it('퀸 라인 밖에 스폰되면 0 — 스폰이 무조건 버프를 주는 것이 아니다', () => {
    const s = createInitialState();
    const free = { file: 0, rank: 1 };
    s.pieces.push(boardPiece('queen', 7, 7));          // a1과 파일·랭크·대각선 모두 다르다
    fillExcept(s, free);
    const granted = grantPiece(s, 'rook', [], () => 0.42)!;
    expect(granted.square).toEqual(free);
    expect(granted.queenBuffCount).toBe(0);
  });
  it('보드가 꽉 차면 스폰이 없고 기존 버프도 그대로다', () => {
    // 빈 칸이 없으면 구매·지급이 막힌다(사용자 결정). 실패 경로가 recalcQueenBuffs를 헛돌려
    // 기존 값을 흔들지 않는지까지 본다 — 재계산은 멱등이어야 한다.
    const s = createInitialState();
    const rook = boardPiece('rook', 3, 4);
    s.pieces.push(boardPiece('queen', 3, 1), rook);
    fillExcept(s, { file: 3, rank: 4 });               // 이미 룩이 선 칸 → 남는 빈 칸 0
    recalcQueenBuffs(s);
    expect(emptySquares(s)).toHaveLength(0);
    const before = rook.queenBuffCount;
    expect(before).toBe(QUEEN_BUFF);
    s.gold = CONFIG.pieces.rook.cost;
    const events: GameEvent[] = [];
    expect(buyPiece(s, 'rook', events, () => 0)).toBeNull();
    expect(grantPiece(s, 'queen', events, () => 0)).toBeNull();
    expect(events).toHaveLength(0);
    expect(rook.queenBuffCount).toBe(before);
    expect(s.gold).toBe(CONFIG.pieces.rook.cost);      // 구매가 막혔으니 골드도 그대로
  });
});
