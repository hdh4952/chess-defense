import { CONFIG, drawCost, pickGachaType, tierMultiplier } from '../config';
import type { GameEvent, GameState, Piece, PieceType, Square } from '../types';
import { recalcQueenBuffs } from './buff';
import { squareKey } from './grid';

let pieceSeq = 0;
export function resetPieceSeq(): void { pieceSeq = 0; }

/**
 * 기물을 새로 놓을 수 있는 빈 칸 전부 (v1.12 — 기물 보관함을 대체한다).
 *
 * 예전에는 구매·지급이 트레이 16칸을 놓고 자리를 다퉜다. 보관함이 사라지면서 그 역할을
 * **보드의 빈 칸**이 그대로 물려받았다 — 1~7랭크의 8×7 = 56칸이고, 8랭크는 적 스폰 구역이라
 * 여기서도 빠진다(pieces.ts의 inLandableBounds와 같은 규칙).
 *
 * ⚠️ 랭크 상한을 리터럴로 적지 말 것. 배치 금지 규칙이 두 곳으로 갈라지면 "상점은 살 수
 * 있다고 하는데 놓을 자리가 없는" 상태가 조용히 생긴다.
 */
export function emptySquares(state: GameState): Square[] {
  const taken = new Set(state.pieces.map(p => squareKey(p.square)));
  const out: Square[] = [];
  for (let file = 0; file < CONFIG.board.files; file++) {
    for (let rank = 1; rank <= CONFIG.board.ranks - 1; rank++) {
      const sq = { file, rank };
      if (!taken.has(squareKey(sq))) out.push(sq);
    }
  }
  return out;
}

/**
 * 빈 칸 하나를 균등 추첨. 자리가 없으면 null.
 *
 * ⚠️ **적 스폰 난수를 쓰지 말 것.** 스폰 파일 추첨은 호출 "순서"에만 의존하므로, 여기서
 * draw를 하나 뽑으면 파일 시퀀스가 통째로 달라져 기존 헤드리스 측정이 조용히 다른 것을 재게
 * 된다(signals.test.ts N8이 이 사실을 강제한다). 구매는 UI 조작이라 애초에 stepGame 밖에서
 * 일어나고, 지급은 grantRng를 쓴다.
 *
 * 인덱스에 Math.min을 씌운 이유는 rng가 정확히 1.0을 돌려주는 구현(테스트용 상수 난수 등)에서
 * 범위를 벗어나기 때문이다 — pickGrantType이 같은 이유로 같은 방어를 하고 있다.
 */
export function randomEmptySquare(state: GameState, rng: () => number): Square | null {
  const free = emptySquares(state);
  if (free.length === 0) return null;
  return free[Math.min(free.length - 1, Math.floor(rng() * free.length))];
}

/**
 * 뽑기를 돌릴 수 있는가 (v1.16). 예전 canBuy의 자리를 그대로 물려받는다.
 *
 * ★ 기물 종류를 인자로 받지 않는 것이 이 변경의 전부다 — 무엇이 나올지 고를 수 없으므로
 * "이 기물을 살 수 있는가"라는 질문 자체가 없어졌다.
 */
export function canDraw(state: GameState): boolean {
  return !state.paused
    && (state.phase === 'prepare' || state.phase === 'wave')
    && state.gold >= drawCost(state.draws)
    // 보드에 빈 칸이 없으면 뽑을 수 없다 (v1.12 사용자 결정을 그대로 물려받는다).
    && emptySquares(state).length > 0;
}

/**
 * 기물 뽑기 — 골드를 내고 **무엇이 나올지 모르는 기물 하나**를 빈 칸에 스폰한다
 * (v1.16, 사용자 결정: "기물 구매는 랜덤 뽑기만 가능하게").
 *
 * ★ rng를 **두 번** 뽑는다: 종류 하나, 위치 하나. 순서가 규칙이다 — 종류를 먼저 뽑아야
 * 같은 난수열에서 같은 기물이 나오고, 뒤집으면 위치 표의 길이(빈 칸 수)가 종류에 영향을 준다.
 *
 * rng에 기본값을 두지 않은 것은 buyPiece 때와 같은 이유다: 호출부가 어느 난수원을 쓰는지
 * 매번 명시하게 해서 적 스폰 난수를 실수로 끌어다 쓰는 일을 눈에 보이게 만든다.
 *
 * ⚠️ 실패는 null이고 **골드를 건드리지 않는다.** canDraw가 이미 걸렀지만, 그 사실에 기대지
 * 않는다 — 골드를 먼저 깎고 스폰에 실패하면 조용히 증발한다.
 */
export function drawPiece(
  state: GameState, events: GameEvent[], rng: () => number,
): Piece | null {
  if (!canDraw(state)) return null;
  const type = pickGachaType(rng());
  const square = randomEmptySquare(state, rng);
  if (square === null) return null;
  state.gold -= drawCost(state.draws);
  // ★ 가격을 **깎은 뒤에** 올린다. 순서가 뒤집히면 첫 뽑기가 320G가 되어 시작 골드 300G로
  //   아무것도 못 한다 — 초반 게이트를 건드리지 않는 것이 누진을 고른 이유 전부다.
  state.draws++;
  const piece: Piece = {
    id: `p-${pieceSeq++}`, type, square, cooldown: 0, queenBuffCount: 0, tier: 1,
  };
  state.pieces.push(piece);
  // 새 기물이 퀸 라인 위에 떨어졌을 수도, 그 자신이 퀸일 수도 있다.
  recalcQueenBuffs(state);
  events.push({ kind: 'pieceSpawned', square: { ...square }, pieceType: type, bought: true });
  return piece;
}

/**
 * 기물 **지급** — 골드를 받지 않고 빈 칸에 T1을 무작위 스폰한다. 구매와 공유하는 것은
 * pieceSeq와 randomEmptySquare뿐이고, canBuy의 게이트(페이즈·골드·구매 가능 여부)는 전혀
 * 타지 않는다. pieceSeq가 이 모듈의 private이라 반드시 여기 있어야 한다.
 *
 * 보드가 꽉 차면 null. 그 처리는 호출부의 몫이다 — 조용히 버리면 무음 실패가 하나 더 는다.
 */
export function grantPiece(
  state: GameState, type: PieceType, events: GameEvent[], rng: () => number,
): Piece | null {
  const square = randomEmptySquare(state, rng);
  if (square === null) return null;
  const piece: Piece = {
    id: `p-${pieceSeq++}`, type, square, cooldown: 0, queenBuffCount: 0, tier: 1,
  };
  state.pieces.push(piece);
  recalcQueenBuffs(state);
  events.push({ kind: 'pieceSpawned', square: { ...square }, pieceType: type, bought: false });
  return piece;
}

export function sellPrice(type: PieceType, tier = 1): number {
  return CONFIG.pieces[type].cost * tierMultiplier(tier) * CONFIG.economy.sellRatio;
}

/** 기물 판매. 확인창 없음 (스펙 7.3) — v1.12부터 모든 기물이 보드 위에 있다. */
export function sellPiece(state: GameState, pieceId: string): boolean {
  if (state.paused || state.phase === 'victory' || state.phase === 'defeat') return false;
  const i = state.pieces.findIndex(p => p.id === pieceId);
  if (i < 0) return false;
  state.gold += sellPrice(state.pieces[i].type, state.pieces[i].tier);
  state.pieces.splice(i, 1);
  recalcQueenBuffs(state);   // 퀸/버프 대상 판매 대응 (스펙 10.5)
  return true;
}
