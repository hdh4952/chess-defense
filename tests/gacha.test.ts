import { describe, expect, it } from 'vitest';
import { CONFIG, pickGachaType, pickGrantType } from '../src/config';
import { canDraw, drawPiece, emptySquares } from '../src/core/economy';
import { squareKey } from '../src/core/grid';
import { createInitialState } from '../src/core/state';
import type { GameEvent, PieceType } from '../src/types';
import { cleanState, countingRng, gachaRng } from './helpers';

/**
 * 기물 뽑기와 시작 배치 (v1.16).
 *
 * 사용자 결정 둘: **① 폰 3개를 가지고 시작한다 ② 기물 구매는 뽑기만 가능하다**(1회 300G,
 * 폰 40 / 나이트 25 / 비숍 25 / 룩 9 / 퀸 1).
 *
 * ⚠️ 이 파일이 `createInitialState()`를 **그대로** 쓰는 유일한 스위트다. 다른 모든 테스트는
 * helpers의 `cleanState()`로 시작 폰을 치운다 — 측정 하네스가 통제하지 않은 폰 3기를 들고
 * 다니면 "이 빌드가 얼마나 잘하는가"의 답이 빌드의 답이 아니게 된다. 그래서 시작 배치를
 * 실제로 검증하는 자리가 여기뿐이다.
 */

const ALL = Object.keys(CONFIG.pieces) as PieceType[];

describe('시작 배치 — 폰 3개', () => {
  it('★ 보드에 폰이 정확히 startPawns개 놓인 상태로 시작한다', () => {
    // 가챠만으로 기물을 얻게 되면서 빈손으로는 w1을 넘길 수 없다. 이 단언이 없으면 누군가
    // startPawns를 0으로 두거나 배치 코드를 지워도 "구매를 못 해서 진다"로만 보인다.
    const s = createInitialState();
    expect(CONFIG.player.startPawns).toBeGreaterThan(0);
    expect(s.pieces).toHaveLength(CONFIG.player.startPawns);
    expect(s.pieces.every(p => p.type === 'pawn')).toBe(true);
    expect(s.pieces.every(p => p.tier === 1)).toBe(true);
    expect(s.pieces.every(p => p.cooldown === 0)).toBe(true);
  });

  it('★ 배치가 결정론적이다 — 두 번 불러도 같은 칸이다', () => {
    // createInitialState는 이 저장소의 모든 헤드리스 측정이 부르는 순수 함수다. 여기에 난수가
    // 들어오면 모든 기준선이 판마다 흔들린다 — 판마다 다른 것은 가챠가 만들면 충분하다.
    const a = createInitialState().pieces.map(p => squareKey(p.square));
    const b = createInitialState().pieces.map(p => squareKey(p.square));
    expect(a).toEqual(b);
  });

  it('배치 가능한 칸에만, 서로 겹치지 않게 놓인다', () => {
    const s = createInitialState();
    for (const p of s.pieces) {
      expect(p.square.rank).toBeGreaterThanOrEqual(1);
      expect(p.square.rank).toBeLessThanOrEqual(CONFIG.board.ranks - 1);   // 8랭크는 적 스폰 구역
      expect(p.square.file).toBeGreaterThanOrEqual(0);
      expect(p.square.file).toBeLessThan(CONFIG.board.files);
    }
    const keys = s.pieces.map(p => squareKey(p.square));
    expect(new Set(keys).size).toBe(keys.length);
    // 빈 칸 계산이 시작 폰을 실제로 제외하는지 — 겹쳐 스폰되는 사고의 첫 방어선이다.
    expect(emptySquares(s)).toHaveLength(
      CONFIG.board.files * (CONFIG.board.ranks - 1) - CONFIG.player.startPawns,
    );
  });

  it('★ 파일이 서로 다르다 — 몰아 두면 같은 파일을 두 번 덮고 나머지가 빈다', () => {
    // 폰은 자기 파일이 아니라 **전방 대각선 두 칸**을 때린다. 그래서 인접해 두면 커버가
    // 겹치고, 8파일 중 덮이는 파일 수가 줄어든다.
    const files = createInitialState().pieces.map(p => p.square.file);
    expect(new Set(files).size).toBe(files.length);
  });

  it('시작 골드로 뽑기를 정확히 한 번 돌릴 수 있다', () => {
    // 밸런스 값이지만 "시작하자마자 아무것도 못 한다"와 "몇 번이나 돌린다"를 가르는 경계라
    // 기록해 둔다. 조정하면 이 줄이 먼저 깨져 의도한 변경임을 확인하게 된다.
    const s = createInitialState();
    expect(Math.floor(s.gold / CONFIG.gacha.cost)).toBe(1);
    expect(canDraw(s)).toBe(true);
  });
});

describe('뽑기 확률 — 사용자가 정한 표', () => {
  it('★ 표를 바깥에서 못박는다 — 유도하면 계수 오변경을 못 잡는다', () => {
    expect(CONFIG.gacha.cost).toBe(300);
    expect(CONFIG.gacha.weights).toMatchObject({
      pawn: 0.40, knight: 0.25, bishop: 0.25, rook: 0.09, queen: 0.01,
    });
  });

  it('가중치 합이 정확히 1이다', () => {
    // pickByWeight는 합으로 정규화하므로 합이 1이 아니어도 "동작"한다 — 오타(0.09 → 0.9)가
    // 조용히 통과하고 확률만 통째로 달라진다.
    const total = (Object.values(CONFIG.gacha.weights) as number[]).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('★ 실측 분포가 표에 수렴하고, 1%짜리도 실제로 나온다', () => {
    const N = 200000;
    const counts = new Map<PieceType, number>();
    for (let i = 0; i < N; i++) {
      const t = pickGachaType((i + 0.5) / N);
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    for (const [type, w] of Object.entries(CONFIG.gacha.weights) as [PieceType, number][]) {
      expect(Math.abs((counts.get(type) ?? 0) / N - w), type).toBeLessThan(0.003);
    }
    // 표에 있으나 도달 불가인 기물이 없어야 한다 — 퀸 1%가 그 경계다.
    expect(counts.get('queen') ?? 0).toBeGreaterThan(0);
  });

  it('경계값 — roll 0 · 1 근처 · 정확히 1이 모두 유효한 기물을 돌려준다', () => {
    for (const roll of [0, 0.999999, 1, 1 - Number.EPSILON]) {
      const t = pickGachaType(roll);
      expect(CONFIG.gacha.weights[t], `roll ${roll}`).toBeGreaterThan(0);
    }
  });

  it('rng를 스스로 부르지 않는다 — roll을 주입받는다', () => {
    // 난수를 안에서 뽑으면 테스트가 전 구간을 결정론적으로 훑을 수 없다.
    expect(pickGachaType(0.5)).toBe(pickGachaType(0.5));
  });

  it('★ 뽑기와 지급은 **다른 표**를 쓴다 — 같은 함수를 공유하되 표는 갈라져 있다', () => {
    // 로직(누적합·경계 처리)은 공유해야 한다: 두 곳에 같은 계산을 적으면 부동소수 잔차 같은
    // 경계 결함이 한쪽에서만 고쳐지고, 그 결함은 수만 번에 한 번 나와 아무도 재현하지 못한다.
    // 반면 표는 갈라져야 한다 — 무상 지급과 유상 뽑기는 다른 결정이다.
    expect(CONFIG.gacha.weights).not.toEqual(CONFIG.grant.weights);
    // 그 차이가 실제로 결과에 나타나는지 — 퀸은 지급에서 0이고 뽑기에서는 나온다.
    expect(CONFIG.grant.weights.queen).toBe(0);
    expect(CONFIG.gacha.weights.queen).toBeGreaterThan(0);
    let grantQueens = 0;
    for (let i = 0; i < 10000; i++) if (pickGrantType((i + 0.5) / 10000) === 'queen') grantQueens++;
    expect(grantQueens).toBe(0);
  });
});

describe('drawPiece — 뽑기 실행', () => {
  it('★ 종류를 고를 수 없다 — 같은 난수열이면 같은 기물이 나온다', () => {
    // 이 변경의 전부다. 예전에는 호출부가 종류를 인자로 줬고, 그래서 "최적 빌드"가 정해져
    // 있었다(밸런스 감사 §7: 최적은 룩+퀸이고 다른 구성은 전부 열세).
    const a = cleanState(); a.gold = 100000;
    const b = cleanState(); b.gold = 100000;
    const seq = (): (() => number) => { let i = 0; const r = [0.5, 0.3]; return () => r[i++ % 2]; };
    expect(drawPiece(a, [], seq())!.type).toBe(drawPiece(b, [], seq())!.type);
  });

  it('★ 실패는 골드를 건드리지 않는다 — 깎고 나서 실패하면 조용히 증발한다', () => {
    const s = cleanState();
    s.gold = CONFIG.gacha.cost - 1;
    const ev: GameEvent[] = [];
    expect(drawPiece(s, ev, gachaRng('pawn'))).toBeNull();
    expect(s.gold).toBe(CONFIG.gacha.cost - 1);
    expect(s.pieces).toEqual([]);
    expect(ev).toEqual([]);
  });

  it('★ rng를 정확히 두 번 소비한다 — 종류 그리고 위치', () => {
    // 순서가 규칙이다: 종류를 먼저 뽑아야 같은 난수열에서 같은 기물이 나온다. 뒤집으면
    // 위치 표의 길이(빈 칸 수)가 종류에 영향을 준다 — 보드가 채워질수록 확률이 흐른다.
    const s = cleanState();
    s.gold = CONFIG.gacha.cost;
    const rng = countingRng(() => 0.5);
    expect(drawPiece(s, [], rng)).not.toBeNull();
    expect(rng.count()).toBe(2);
  });

  it('★ 보드가 채워져도 종류 확률이 흐르지 않는다 (순서 규칙의 실측)', () => {
    // 위 테스트가 "두 번 뽑는다"만 재는 것과 달리, 이건 순서가 뒤집혔을 때 실제로 무엇이
    // 달라지는지를 잡는다. 같은 종류 롤을 주면 빈 칸이 56개든 1개든 같은 기물이 나와야 한다.
    const draw = (fill: number): PieceType => {
      const s = cleanState();
      s.gold = 100000;
      for (const sq of emptySquares(s).slice(0, fill)) {
        s.pieces.push({
          id: `f-${squareKey(sq)}`, type: 'pawn', square: sq,
          cooldown: 0, queenBuffCount: 0, tier: 1,
        });
      }
      let i = 0;
      const r = [0.95, 0.5];      // 종류 롤 0.95 = 룩 구간
      return drawPiece(s, [], () => r[i++ % 2])!.type;
    };
    expect(draw(0)).toBe(draw(40));
    expect(draw(0)).toBe(draw(55));
  });

  it('뽑은 기물은 항상 T1이고 쿨다운 0이다', () => {
    for (const want of ALL.filter(t => CONFIG.gacha.weights[t] > 0)) {
      const s = cleanState();
      s.gold = CONFIG.gacha.cost;
      const p = drawPiece(s, [], gachaRng(want))!;
      expect(p.type, want).toBe(want);
      expect(p.tier, want).toBe(1);
      expect(p.cooldown, want).toBe(0);
    }
  });

  it('★ 정가와 무관하게 값이 하나다 — 퀸도 300G에 나온다', () => {
    // 기대 비용으로 보면 퀸은 30,000G(= 300 / 0.01)이고 한 판 총 골드가 약 24,900G라
    // **사실상 한 판에 한 번 볼 수 있는 기물**이다. 그 사실이 이 한 줄에서 나온다.
    const s = cleanState();
    s.gold = CONFIG.gacha.cost;
    const q = drawPiece(s, [], gachaRng('queen'))!;
    expect(q.type).toBe('queen');
    expect(s.gold).toBe(0);
    expect(CONFIG.pieces.queen.cost).toBeGreaterThan(CONFIG.gacha.cost);
  });

  it('판매가는 여전히 **정가** 기준이다 — 뽑기 비용이 아니다', () => {
    // 판매가가 gacha.cost를 쓰면 티어 배수가 유도되지 않는다(합성 후 판매액 = 합성 전 합).
    // 그 불변식이 정가에만 걸려 있으므로 pieces[].cost는 여전히 살아 있어야 한다.
    for (const t of ALL) expect(CONFIG.pieces[t].cost, t).toBeGreaterThan(0);
  });
});
