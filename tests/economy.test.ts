import { beforeEach, describe, expect, it } from 'vitest';
import { CONFIG, TRAITS } from '../src/config';
import { recalcQueenBuffs } from '../src/core/buff';
import {
  buyPiece, canBuy, emptySquares, grantPiece, randomEmptySquare,
  resetPieceSeq, sellPiece, sellPrice,
} from '../src/core/economy';
import { squareKey } from '../src/core/grid';
import { createInitialState } from '../src/core/state';
import type { GameEvent, GameState, PieceType, Square } from '../src/types';
import { boardPiece, countingRng } from './helpers';

/**
 * v1.12에서 기물 보관함(트레이)이 사라졌다 — 구매·지급은 **보드의 빈 칸에 무작위 스폰**이고,
 * 빈 칸이 없으면 아예 일어나지 않는다(사용자 결정). 그래서 예전 이 스위트의 주인공이던
 * SLOT_CAPACITY · freeSlotIndex · Piece.slotIndex는 전부 사라졌고, 그 자리에 emptySquares가
 * 들어왔다. "16칸을 놓고 다투던" 규칙이 "56칸을 놓고 다투는" 규칙으로 옮겨간 것뿐이므로,
 * 만석 게이트·자리 재사용 같은 불변식은 지우지 않고 새 무대로 다시 썼다.
 */

/**
 * 기물이 설 수 있는 칸 수 = 8 × 7 = 56. 8랭크는 적 스폰 구역이라 빠진다.
 * ⚠️ 리터럴 56이 아니라 CONFIG에서 유도한다 — 보드 크기를 바꿨을 때 이 스위트만 "옛 보드"를
 * 계속 검사하면 만석 게이트가 통째로 눈이 먼다.
 */
const LANDABLE = CONFIG.board.files * (CONFIG.board.ranks - 1);

const PURCHASABLE = (Object.keys(TRAITS) as PieceType[]).filter(t => TRAITS[t].purchasable);

type SpawnedEvent = Extract<GameEvent, { kind: 'pieceSpawned' }>;
function spawnEvents(ev: GameEvent[]): SpawnedEvent[] {
  return ev.filter((e): e is SpawnedEvent => e.kind === 'pieceSpawned');
}

/**
 * 특정 칸이 뽑히게 만드는 rng. 스폰 위치를 플레이어가 고르지 않으므로 테스트도 "어디에
 * 떨어질지"를 상태로부터 역산해야 한다 — 후보 목록의 순서에 기대지 않으려고 인덱스를 직접
 * 찾는다(목록이 file-major든 rank-major든 같은 칸을 가리킨다).
 */
function rngFor(state: GameState, sq: Square): () => number {
  const free = emptySquares(state);
  const i = free.findIndex(f => squareKey(f) === squareKey(sq));
  expect(i, `${squareKey(sq)}는 빈 칸이어야 한다`).toBeGreaterThanOrEqual(0);
  return () => (i + 0.5) / free.length;
}

/** 보드를 폰으로 메운다(기본값은 만석). 구매 경로를 거치지 않으므로 골드와 무관하다. */
function fillBoard(state: GameState, n = LANDABLE): void {
  for (const sq of emptySquares(state).slice(0, n)) {
    state.pieces.push(boardPiece('pawn', sq.file, sq.rank));
  }
}

beforeEach(() => resetPieceSeq());

describe('빈 칸 — 트레이 16칸을 대체한 스폰 후보 (v1.12)', () => {
  it('빈 보드의 후보는 8×7 = 56칸이고 중복이 없다', () => {
    const s = createInitialState();
    const free = emptySquares(s);
    expect(free).toHaveLength(LANDABLE);
    expect(LANDABLE).toBe(56);
    expect(new Set(free.map(squareKey)).size).toBe(LANDABLE);
  });

  it('★ 8랭크(적 스폰 구역)는 후보에 없다 — 상점과 배치 규칙이 갈라지면 "샀는데 놓을 데가 없는" 상태가 생긴다', () => {
    const s = createInitialState();
    const ranks = new Set(emptySquares(s).map(sq => sq.rank));
    expect(ranks.has(CONFIG.board.ranks)).toBe(false);
    expect([...ranks].sort((a, b) => a - b))
      .toEqual(Array.from({ length: CONFIG.board.ranks - 1 }, (_, i) => i + 1));
  });

  it('기물이 선 칸은 후보에서 빠진다 — 겹쳐 스폰될 자리가 애초에 목록에 없다', () => {
    const s = createInitialState();
    const taken = { file: 3, rank: 4 };
    s.pieces.push(boardPiece('rook', taken.file, taken.rank));
    const free = emptySquares(s);
    expect(free).toHaveLength(LANDABLE - 1);
    expect(free.map(squareKey)).not.toContain(squareKey(taken));
  });

  it('★ rng 0은 첫 후보, 1에 가까운 값은 마지막 후보 — 후보 전체를 균등하게 훑는다', () => {
    const s = createInitialState();
    const free = emptySquares(s);
    expect(randomEmptySquare(s, () => 0)).toEqual(free[0]);
    expect(randomEmptySquare(s, () => 1 - Number.EPSILON)).toEqual(free[free.length - 1]);
  });

  it('rng가 정확히 1.0을 돌려줘도 범위를 벗어나지 않는다 (상수 난수를 쓰는 테스트 보호)', () => {
    const s = createInitialState();
    const free = emptySquares(s);
    expect(randomEmptySquare(s, () => 1)).toEqual(free[free.length - 1]);
  });

  it('★ rng 전 구간이 56칸에 1:1로 대응한다 — 영영 뽑히지 않는 칸이 없다', () => {
    const s = createInitialState();
    const free = emptySquares(s);
    const hit = free.map((_, i) => randomEmptySquare(s, () => (i + 0.5) / free.length)!);
    expect(hit.map(squareKey)).toEqual(free.map(squareKey));
    expect(new Set(hit.map(squareKey)).size).toBe(LANDABLE);
  });

  it('★ 어떤 rng 값으로도 8랭크에는 떨어지지 않는다', () => {
    const s = createInitialState();
    const N = 200;
    for (let i = 0; i < N; i++) {
      const sq = randomEmptySquare(s, () => i / N)!;
      expect(sq.rank).toBeGreaterThanOrEqual(1);
      expect(sq.rank).toBeLessThanOrEqual(CONFIG.board.ranks - 1);
    }
  });

  it('만석이면 null — 뽑을 후보 자체가 없다', () => {
    const s = createInitialState();
    fillBoard(s);
    expect(emptySquares(s)).toHaveLength(0);
    expect(randomEmptySquare(s, () => 0)).toBeNull();
  });

  it('rng를 정확히 한 번만 소비한다 — 위치 추첨 때문에 난수열이 갈라지지 않는다', () => {
    const s = createInitialState();
    const rng = countingRng(() => 0);
    randomEmptySquare(s, rng);
    expect(rng.count()).toBe(1);
  });
});

describe('구매 (스펙 6/7.2/7.4)', () => {
  it('폰 구매: 골드 300→200, 보드의 빈 칸에 T1으로 선다', () => {
    const s = createInitialState();
    const ev: GameEvent[] = [];
    const target = { file: 5, rank: 3 };
    const p = buyPiece(s, 'pawn', ev, rngFor(s, target))!;
    expect(s.gold).toBe(CONFIG.player.startGold - CONFIG.pieces.pawn.cost);
    expect(p.type).toBe('pawn');
    expect(p.square).toEqual(target);       // v1.12: square는 널이 아니다 — 트레이가 없다
    expect(p.tier).toBe(1);
    expect(p.cooldown).toBe(0);
    expect(s.pieces).toHaveLength(1);
  });

  it('★ pieceSpawned의 square가 실제 기물 위치와 같다 — 56칸 중 어디인지 알려주는 유일한 단서다', () => {
    const s = createInitialState();
    const ev: GameEvent[] = [];
    const p = buyPiece(s, 'pawn', ev, rngFor(s, { file: 2, rank: 6 }))!;
    const spawned = spawnEvents(ev);
    expect(spawned).toHaveLength(1);
    expect(spawned[0].square).toEqual(p.square);
    expect(spawned[0].pieceType).toBe('pawn');
    expect(spawned[0].bought).toBe(true);   // 구매와 지급을 이 플래그 하나로 구분한다
  });

  it('이벤트의 square는 발행 시점의 복사본이다 — 나중에 기물이 움직여도 과거 알림이 바뀌지 않는다', () => {
    const s = createInitialState();
    const ev: GameEvent[] = [];
    const p = buyPiece(s, 'pawn', ev, () => 0)!;
    const spawned = spawnEvents(ev)[0];
    expect(spawned.square).not.toBe(p.square);
    p.square = { file: 7, rank: 7 };
    expect(spawned.square).not.toEqual(p.square);
  });

  it('★ 56기를 연달아 사도 두 기물이 같은 칸에 겹치지 않는다', () => {
    const s = createInitialState();
    s.gold = CONFIG.pieces.pawn.cost * LANDABLE;
    const ev: GameEvent[] = [];
    // 첫 칸만 반복해 고르지 않도록 결정론적으로 흩뜨린다 (Math.random 금지)
    let k = 0;
    const rng = (): number => ((k++ * 37) % 101) / 101;
    for (let i = 0; i < LANDABLE; i++) expect(buyPiece(s, 'pawn', ev, rng)).not.toBeNull();

    expect(s.pieces).toHaveLength(LANDABLE);
    expect(new Set(s.pieces.map(p => squareKey(p.square))).size).toBe(LANDABLE);
    expect(s.pieces.every(p => p.square.rank <= CONFIG.board.ranks - 1)).toBe(true);
    expect(emptySquares(s)).toHaveLength(0);
    expect(s.gold).toBe(0);
    // 이벤트도 기물과 같은 56칸을 가리킨다 — 화면이 실제와 다른 칸을 짚으면 못 찾는다
    expect(new Set(spawnEvents(ev).map(e => squareKey(e.square))))
      .toEqual(new Set(s.pieces.map(p => squareKey(p.square))));
  });

  it('★ 보드가 꽉 차면 구매 불가 — 예전 "트레이 만석" 게이트를 그대로 물려받았다 (스펙 7.2)', () => {
    const s = createInitialState();
    fillBoard(s);
    s.gold = 100000;
    expect(canBuy(s, 'pawn')).toBe(false);

    const ev: GameEvent[] = [];
    expect(buyPiece(s, 'pawn', ev, () => 0)).toBeNull();
    // 원자성: 거부는 골드도 기물도 이벤트도 건드리지 않는다
    expect(s.gold).toBe(100000);
    expect(s.pieces).toHaveLength(LANDABLE);
    expect(ev).toHaveLength(0);
  });

  it('55칸이 차 있으면 마지막 한 칸에 정확히 떨어지고, 그 다음이 만석이다', () => {
    const s = createInitialState();
    fillBoard(s, LANDABLE - 1);
    s.gold = CONFIG.pieces.rook.cost;
    const last = emptySquares(s)[0];
    const ev: GameEvent[] = [];
    const p = buyPiece(s, 'rook', ev, () => 0)!;
    expect(p.square).toEqual(last);
    expect(canBuy(s, 'rook')).toBe(false);
  });

  it('골드 부족 시 구매 불가', () => {
    const s = createInitialState();
    expect(CONFIG.pieces.queen.cost).toBeGreaterThan(CONFIG.player.startGold);
    expect(canBuy(s, 'queen')).toBe(false);
    const ev: GameEvent[] = [];
    expect(buyPiece(s, 'queen', ev, () => 0)).toBeNull();
    expect(s.gold).toBe(CONFIG.player.startGold);
    expect(ev).toHaveLength(0);
  });

  it('일시정지·게임 종료 중 구매 불가 (스펙 7.4)', () => {
    const s = createInitialState();
    s.paused = true;
    expect(canBuy(s, 'pawn')).toBe(false);
    s.paused = false;
    s.phase = 'defeat';
    expect(canBuy(s, 'pawn')).toBe(false);
    s.phase = 'victory';
    expect(canBuy(s, 'pawn')).toBe(false);
  });

  it('canBuy 양수 경로: 충분한 금, 빈 칸, 미일시정지 상태에서 참 (웨이브 중 구매 열림)', () => {
    const s = createInitialState();
    s.gold = CONFIG.pieces.pawn.cost;
    s.paused = false;
    s.phase = 'wave';  // 웨이브 중 구매 활성화 (스펙 7.4)
    expect(canBuy(s, 'pawn')).toBe(true);
  });

  it('융합물은 상점에 없다 — 구매 경로로는 만들 수 없다', () => {
    const s = createInitialState();
    s.gold = 100000;
    const ev: GameEvent[] = [];
    for (const type of (Object.keys(TRAITS) as PieceType[]).filter(t => !TRAITS[t].purchasable)) {
      expect(canBuy(s, type), type).toBe(false);
      expect(buyPiece(s, type, ev, () => 0), type).toBeNull();
    }
    expect(s.pieces).toHaveLength(0);
  });

  it('★ canBuy와 buyPiece의 판정이 갈라지지 않는다 — 버튼이 켜졌는데 못 사는 일은 없다', () => {
    // 게이트가 두 곳에 있으면 언젠가 한쪽만 고쳐진다. 만석·골드 부족·정상 셋을 같은 축으로 본다.
    for (const type of PURCHASABLE) {
      const cases: { name: string; setup: (s: GameState) => void }[] = [
        { name: '정상', setup: s => { s.gold = CONFIG.pieces[type].cost; } },
        { name: '골드 부족', setup: s => { s.gold = CONFIG.pieces[type].cost - 1; } },
        { name: '보드 만석', setup: s => { s.gold = 100000; fillBoard(s); } },
      ];
      for (const c of cases) {
        const s = createInitialState();
        c.setup(s);
        const expected = canBuy(s, type);
        const bought = buyPiece(s, type, [], () => 0) !== null;
        expect(bought, `${type} / ${c.name}`).toBe(expected);
      }
    }
  });

  it('★ 구매는 rng를 정확히 한 번만 소비한다', () => {
    const s = createInitialState();
    const rng = countingRng(() => 0);
    buyPiece(s, 'pawn', [], rng);
    expect(rng.count()).toBe(1);
  });

  it('★ 난수원에 기본값이 없다 — 호출부가 매번 명시해야 적 스폰 난수를 실수로 끌어다 쓰지 않는다', () => {
    // 기본 인자를 붙이면 Function.length가 줄어든다. 스폰 파일 추첨은 호출 "순서"에만
    // 의존하므로, 구매가 그 난수원을 조용히 빌려 쓰면 헤드리스 측정이 다른 것을 재게 된다.
    expect(buyPiece).toHaveLength(4);
    expect(grantPiece).toHaveLength(4);
  });

  it('구매 즉시 퀸 버프가 재계산된다 — 스폰이 곧 배치라 "트레이에 뒀다가 놓는" 중간 단계가 없다', () => {
    const s = createInitialState();
    s.gold = CONFIG.pieces.queen.cost;
    const rook = boardPiece('rook', 0, 5);
    s.pieces.push(rook);
    recalcQueenBuffs(s);
    expect(rook.queenBuffCount).toBe(0);

    const q = buyPiece(s, 'queen', [], rngFor(s, { file: rook.square.file, rank: 1 }))!;
    expect(q.square.file).toBe(rook.square.file);   // 같은 파일 = 퀸 라인 위
    expect(rook.queenBuffCount).toBe(1);
  });

  it('산 퀸이 남의 라인 위에 떨어지면 자기 자신도 즉시 버프를 받는다', () => {
    const s = createInitialState();
    s.gold = CONFIG.pieces.queen.cost;
    const other = boardPiece('queen', 4, 6);
    s.pieces.push(other);
    recalcQueenBuffs(s);

    const q = buyPiece(s, 'queen', [], rngFor(s, { file: other.square.file, rank: 2 }))!;
    expect(q.queenBuffCount).toBe(1);
    expect(other.queenBuffCount).toBe(1);   // 퀸끼리도 서로 버프한다 (자기 자신만 제외)
  });
});

describe('지급 — grantPiece (구매와 같은 스폰, 다른 게이트)', () => {
  it('골드를 내지 않고 빈 칸에 T1을 스폰한다 — bought:false만 구매와 다르다', () => {
    const s = createInitialState();
    const ev: GameEvent[] = [];
    const target = { file: 6, rank: 2 };
    const p = grantPiece(s, 'rook', ev, rngFor(s, target))!;
    expect(s.gold).toBe(CONFIG.player.startGold);   // 지급은 무상이다
    expect(p.type).toBe('rook');
    expect(p.tier).toBe(1);
    expect(p.square).toEqual(target);
    const spawned = spawnEvents(ev);
    expect(spawned).toHaveLength(1);
    expect(spawned[0].square).toEqual(p.square);
    expect(spawned[0].bought).toBe(false);
  });

  it('★ canBuy 게이트를 전혀 타지 않는다 — 일시정지·패배·골드 0에서도 지급된다', () => {
    // 지급은 웨이브 클리어가 부르는 경로다. 구매 게이트를 함께 태우면 "이겼는데 상이 안 오는"
    // 무음 실패가 생긴다.
    const s = createInitialState();
    s.gold = 0;
    s.paused = true;
    s.phase = 'defeat';
    expect(canBuy(s, 'rook')).toBe(false);
    expect(grantPiece(s, 'rook', [], () => 0)).not.toBeNull();
  });

  it('★ 보드가 꽉 차면 null이고 아무것도 바꾸지 않는다 — 환급은 호출부(wave.ts)의 몫이다', () => {
    const s = createInitialState();
    fillBoard(s);
    const gold = s.gold;
    const ev: GameEvent[] = [];
    expect(grantPiece(s, 'rook', ev, () => 0)).toBeNull();
    expect(s.gold).toBe(gold);
    expect(s.pieces).toHaveLength(LANDABLE);
    expect(ev).toHaveLength(0);
  });

  it('★ 지급도 빈 칸에만 떨어진다 — 55칸이 차 있으면 남은 한 칸이다', () => {
    const s = createInitialState();
    fillBoard(s, LANDABLE - 1);
    const last = emptySquares(s)[0];
    const p = grantPiece(s, 'knight', [], () => 1)!;   // rng 상한에서도 겹치지 않는다
    expect(p.square).toEqual(last);
    expect(new Set(s.pieces.map(x => squareKey(x.square))).size).toBe(LANDABLE);
  });

  it('구매와 id 시퀀스를 공유한다 — 두 경로가 같은 id를 발급하면 쿨다운이 뒤섞인다', () => {
    const s = createInitialState();
    const a = buyPiece(s, 'pawn', [], () => 0)!;
    const b = grantPiece(s, 'pawn', [], () => 0)!;
    expect(a.id).not.toBe(b.id);
  });

  it('★ 지급도 rng를 정확히 한 번만 소비한다 — 웨이브 클리어의 난수열이 갈라지지 않는다', () => {
    const s = createInitialState();
    const rng = countingRng(() => 0);
    grantPiece(s, 'pawn', [], rng);
    expect(rng.count()).toBe(1);
  });

  it('지급받은 퀸도 그 자리에서 즉시 라인 버프를 건다', () => {
    const s = createInitialState();
    const rook = boardPiece('rook', 2, 5);
    s.pieces.push(rook);
    recalcQueenBuffs(s);
    grantPiece(s, 'queen', [], rngFor(s, { file: rook.square.file, rank: 1 }));
    expect(rook.queenBuffCount).toBe(1);
  });
});

describe('판매 (스펙 6/7.3)', () => {
  it('환급 50%: 룩 500 → 250', () => {
    expect(sellPrice('rook')).toBe(CONFIG.pieces.rook.cost * CONFIG.economy.sellRatio);
    expect(sellPrice('rook')).toBe(250);

    const s = createInitialState();
    s.gold = CONFIG.pieces.rook.cost;
    const r = buyPiece(s, 'rook', [], () => 0)!;
    expect(s.gold).toBe(0);
    expect(sellPiece(s, r.id)).toBe(true);
    expect(s.gold).toBe(sellPrice('rook'));
    expect(s.pieces).toHaveLength(0);
  });

  it('퀸을 팔면 라인 버프가 즉시 소멸한다 (스펙 10.5)', () => {
    // v1.12부터 모든 기물이 보드 위에 있으므로 "보드 위 기물도 판매 가능"이라는 옛 구분은
    // 사라졌다 — 판매 경로가 하나뿐이라는 것이 그 사실의 기록이다.
    const s = createInitialState();
    const q = boardPiece('queen', 3, 1);
    const r = boardPiece('rook', 3, 5);
    s.pieces.push(q, r);
    recalcQueenBuffs(s);
    expect(r.queenBuffCount).toBe(1);

    expect(sellPiece(s, q.id)).toBe(true);
    expect(r.queenBuffCount).toBe(0);
  });

  it('★ 판 자리는 즉시 다시 스폰 후보가 된다 — 예전 "빈 슬롯 재사용"의 새 형태', () => {
    const s = createInitialState();
    fillBoard(s);
    const victim = s.pieces[10];
    const freed = { ...victim.square };
    expect(sellPiece(s, victim.id)).toBe(true);

    expect(emptySquares(s).map(squareKey)).toEqual([squareKey(freed)]);
    s.gold = CONFIG.pieces.bishop.cost;
    expect(canBuy(s, 'bishop')).toBe(true);
    const p = buyPiece(s, 'bishop', [], () => 0)!;
    expect(p.square).toEqual(freed);
  });

  it('일시정지 중 판매 불가 (스펙 7.7)', () => {
    const s = createInitialState();
    const p = buyPiece(s, 'pawn', [], () => 0)!;
    s.paused = true;
    expect(sellPiece(s, p.id)).toBe(false);
    expect(s.pieces).toHaveLength(1);
  });

  it('게임 종료 (victory/defeat) 중 판매 불가', () => {
    const s = createInitialState();
    const p = buyPiece(s, 'pawn', [], () => 0)!;
    s.phase = 'victory';
    expect(sellPiece(s, p.id)).toBe(false);
    s.phase = 'defeat';
    expect(sellPiece(s, p.id)).toBe(false);
    expect(s.pieces).toHaveLength(1);
  });

  it('없는 id는 false — 골드가 늘지 않는다', () => {
    const s = createInitialState();
    const gold = s.gold;
    expect(sellPiece(s, 'nope')).toBe(false);
    expect(s.gold).toBe(gold);
  });
});
