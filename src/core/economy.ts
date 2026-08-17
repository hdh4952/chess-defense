import { CONFIG, TRAITS, tierMultiplier } from '../config';
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

export function canBuy(state: GameState, type: PieceType): boolean {
  return TRAITS[type].purchasable
    && !state.paused
    && (state.phase === 'prepare' || state.phase === 'wave')
    && state.gold >= CONFIG.pieces[type].cost
    // 보드에 빈 칸이 없으면 구매 불가 (사용자 결정). 예전 "트레이 만석" 게이트를 그대로
    // 물려받은 자리이고 실패 표현도 같다 — 상점 버튼이 비활성화된다.
    && emptySquares(state).length > 0;
}

/**
 * 구매 — 골드를 내고 **보드의 빈 칸 중 하나에 무작위로** 스폰한다 (v1.12, 사용자 결정).
 *
 * rng에 기본값을 두지 않은 것은 의도적이다: 호출부가 어느 난수원을 쓰는지 매번 명시하게 해서,
 * 적 스폰 난수를 실수로 끌어다 쓰는 일을 눈에 보이게 만든다.
 */
export function buyPiece(
  state: GameState, type: PieceType, events: GameEvent[], rng: () => number,
): Piece | null {
  if (!canBuy(state, type)) return null;
  const square = randomEmptySquare(state, rng);
  if (square === null) return null;      // canBuy가 이미 걸렀다 — 타입을 좁히려고 남긴다
  state.gold -= CONFIG.pieces[type].cost;
  const piece: Piece = {
    id: `p-${pieceSeq++}`, type, square, cooldown: 0, queenBuffCount: 0, tier: 1,
  };
  state.pieces.push(piece);
  // 새 기물이 퀸 라인 위에 떨어졌을 수도, 그 자신이 퀸일 수도 있다. 예전에는 트레이에
  // 들어갔다가 배치될 때 재계산됐지만, 이제 스폰이 곧 배치다.
  recalcQueenBuffs(state);
  events.push({ kind: 'pieceSpawned', square: { ...square }, pieceType: type, bought: true });
  return piece;
}

/**
 * 판매가 = 원가 × 강화 단계 × 판매 비율. tier를 곱하지 않으면 합성이 보이지 않는 골드 소각이
 * 된다(룩 2기 1,000G를 합쳐서 팔면 250G만 회수) — 게다가 sellPrice는 type만 받으므로 그 손실이
 * 어떤 테스트에도 걸리지 않는다. tier를 곱하면 "합성 후 판매액 = 합성 전 각각의 판매액 합"이
 * 성립해 sellRatio 0.5 경제가 그대로 유지된다.
 */
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
