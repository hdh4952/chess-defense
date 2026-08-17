import { describe, expect, it, vi } from 'vitest';
import { slowPercent } from '../src/config';
import { fileCenterX, rankToTopY } from '../src/core/grid';
import { bishopTargets, pawnTargets, rookTargets } from '../src/core/patterns';
import { Effects } from '../src/render/effects';
import type { GameEvent, Square } from '../src/types';
import { makeStubCtx } from './canvasStub';

const center = (sq: Square) => ({ x: fileCenterX(sq.file), y: rankToTopY(sq.rank) + 40 });

// 방향 키(부호쌍)별 원점에서 가장 먼 대상 칸 — effects.ts의 onEvent와 동일한 로직을 테스트에서
// 독립적으로 재구성해, "회귀 시 두 곳이 함께 틀려서 통과해버리는" 상황을 피한다.
function farthestPerDirection(from: Square, targets: Square[]): Square[] {
  const dirs = new Map<string, Square>();
  for (const sq of targets) {
    const df = Math.sign(sq.file - from.file), dr = Math.sign(sq.rank - from.rank);
    if (df === 0 && dr === 0) continue;
    const key = `${df},${dr}`;
    const prev = dirs.get(key);
    const dist = Math.abs(sq.file - from.file) + Math.abs(sq.rank - from.rank);
    if (!prev || dist > Math.abs(prev.file - from.file) + Math.abs(prev.rank - from.rank)) {
      dirs.set(key, sq);
    }
  }
  return [...dirs.values()];
}

describe('Effects (Task 19 — 속성별 공격 이펙트 + 화면 진동, 스펙 8.2)', () => {
  describe('onEvent → draw: 이벤트 종류별 이펙트 생성', () => {
    it('폰 attack: 대상 칸마다 짧은 충격파(shock) 1개씩 (arc 호출 수 == targets 수)', () => {
      const fx = new Effects();
      const from: Square = { file: 4, rank: 4 };
      const targets = pawnTargets(from);
      expect(targets).toHaveLength(2); // 보드 중앙이므로 대각선 2칸 모두 유효
      fx.onEvent({ kind: 'attack', pieceType: 'pawn', from, targets });

      const { ctx, records } = makeStubCtx();
      fx.draw(ctx as unknown as CanvasRenderingContext2D);

      const arcs = records.filter(r => r.method === 'arc');
      expect(arcs).toHaveLength(targets.length);
      const arcCenters = arcs.map(a => ({ x: a.args[0], y: a.args[1] }));
      for (const sq of targets) {
        const c = center(sq);
        expect(arcCenters).toContainEqual({ x: c.x, y: c.y });
      }
    });

    it('룩 attack: 발사된 각 방향(십자)마다 균열(crack) 선 1개 — 발사 원점에서 각 방향의 가장 먼 칸까지', () => {
      const fx = new Effects();
      const from: Square = { file: 4, rank: 4 };
      const targets = rookTargets(from);
      const expectedEnds = farthestPerDirection(from, targets);
      expect(expectedEnds).toHaveLength(4); // 중앙이므로 상하좌우 4방향 모두 존재

      fx.onEvent({ kind: 'attack', pieceType: 'rook', from, targets });
      const { ctx, records } = makeStubCtx();
      fx.draw(ctx as unknown as CanvasRenderingContext2D);

      // crack은 line()을 2번(밝은 테두리 + 갈색 본선) 호출하므로 moveTo 수 == crack 이펙트 수 * 2
      const moveTos = records.filter(r => r.method === 'moveTo');
      expect(moveTos).toHaveLength(expectedEnds.length * 2);
      const fromC = center(from);
      for (const m of moveTos) expect(m.args).toEqual([fromC.x, fromC.y]);

      const lineTos = records.filter(r => r.method === 'lineTo');
      const endpoints = new Set(lineTos.map(l => `${l.args[0]},${l.args[1]}`));
      const expectedEndpoints = new Set(expectedEnds.map(sq => { const c = center(sq); return `${c.x},${c.y}`; }));
      expect(endpoints).toEqual(expectedEndpoints);
    });

    it('룩 d4 발사: 균열 4개의 끝점이 정확히 h4/a4/d8/d1 칸 중심이다 (하드코딩된 기대값 — 알고리즘 재구현에 기대지 않음)', () => {
      // 리뷰 발견 2: farthestPerDirection 헬퍼는 effects.ts의 방향 버킷팅 로직을 거의 그대로
      // 재구현한 것이라, 그 접근 자체에 내재한 결함은 두 곳에서 똑같이 통과해버릴 수 있다.
      // d4(file=3,rank=4)의 4극단은 손으로 세어도 뻔하므로 여기서는 리터럴로 못박는다.
      const fx = new Effects();
      const from: Square = { file: 3, rank: 4 }; // d4
      fx.onEvent({ kind: 'attack', pieceType: 'rook', from, targets: rookTargets(from) });

      const { ctx, records } = makeStubCtx();
      fx.draw(ctx as unknown as CanvasRenderingContext2D);

      const lineTos = records.filter(r => r.method === 'lineTo');
      const endpoints = new Set(lineTos.map(l => `${l.args[0]},${l.args[1]}`));
      const h4 = center({ file: 7, rank: 4 });
      const a4 = center({ file: 0, rank: 4 });
      const d8 = center({ file: 3, rank: 8 });
      const d1 = center({ file: 3, rank: 1 });
      expect(endpoints).toEqual(new Set([
        `${h4.x},${h4.y}`, `${a4.x},${a4.y}`, `${d8.x},${d8.y}`, `${d1.x},${d1.y}`,
      ]));
    });

    it('비숍 d4 발사: 광선 4개의 끝점이 정확히 h8/g1/a7/a1 칸 중심이다 (하드코딩된 기대값)', () => {
      const fx = new Effects();
      const from: Square = { file: 3, rank: 4 }; // d4
      fx.onEvent({ kind: 'attack', pieceType: 'bishop', from, targets: bishopTargets(from) });

      const { ctx, records } = makeStubCtx();
      fx.draw(ctx as unknown as CanvasRenderingContext2D);

      const lineTos = records.filter(r => r.method === 'lineTo');
      const endpoints = new Set(lineTos.map(l => `${l.args[0]},${l.args[1]}`));
      const h8 = center({ file: 7, rank: 8 });
      const g1 = center({ file: 6, rank: 1 });
      const a7 = center({ file: 0, rank: 7 });
      const a1 = center({ file: 0, rank: 1 });
      expect(endpoints).toEqual(new Set([
        `${h8.x},${h8.y}`, `${g1.x},${g1.y}`, `${a7.x},${a7.y}`, `${a1.x},${a1.y}`,
      ]));
    });

    it('비숍 attack: 발사된 각 대각선 방향마다 광선(beam) 선 1개', () => {
      const fx = new Effects();
      const from: Square = { file: 4, rank: 4 };
      const targets = bishopTargets(from);
      const expectedEnds = farthestPerDirection(from, targets);
      expect(expectedEnds).toHaveLength(4); // 중앙이므로 대각선 4방향 모두 존재

      fx.onEvent({ kind: 'attack', pieceType: 'bishop', from, targets });
      const { ctx, records } = makeStubCtx();
      fx.draw(ctx as unknown as CanvasRenderingContext2D);

      const moveTos = records.filter(r => r.method === 'moveTo');
      expect(moveTos).toHaveLength(expectedEnds.length * 2); // beam도 2겹(어두운 테두리 + 밝은 광선)

      const lineTos = records.filter(r => r.method === 'lineTo');
      const endpoints = new Set(lineTos.map(l => `${l.args[0]},${l.args[1]}`));
      const expectedEndpoints = new Set(expectedEnds.map(sq => { const c = center(sq); return `${c.x},${c.y}`; }));
      expect(endpoints).toEqual(expectedEndpoints);
    });

    // v1.10: 나이트의 폭발이 감속 오라로 바뀌면서 explosion(createRadialGradient 1) + ember
    // (fillRect 14)를 세던 테스트가 대상을 잃었다. 다만 그 테스트가 지키던 불변식 —
    // "나이트가 한 일이 화면에 즉시 드러난다" — 은 그대로 유효하고, 이제 그 역할을 감속 진입
    // 라벨이 물려받는다. 그래서 삭제가 아니라 frostTag 판본으로 다시 쓴다.
    it('enemySlowed: 감속에 걸린 적 위로 "−30%" 라벨 1개 (테두리 + 채움)', () => {
      const fx = new Effects();
      const file = 2, y = 300;
      fx.onEvent({ kind: 'enemySlowed', enemyId: 'e1', file, y });

      const { ctx, records } = makeStubCtx();
      fx.draw(ctx as unknown as CanvasRenderingContext2D);

      const texts = records.filter(r => r.method === 'strokeText' || r.method === 'fillText');
      expect(texts).toHaveLength(2);                       // 밝은 칸 위에서도 읽히도록 테두리 1 + 채움 1
      expect(texts.every(r => r.args[1] === fileCenterX(file))).toBe(true);
      // 좌표가 칸 중심이 아니라 적의 실제 픽셀 y에서 유도되는지 — 적은 칸 사이를 연속으로
      // 움직이므로 rankToTopY로 스냅하면 최대 한 칸만큼 어긋난 자리에 라벨이 뜬다.
      expect(texts.every(r => (r.args[2] as number) < y)).toBe(true);  // 적의 "머리 위"
    });

    it('"−30%"의 숫자는 리터럴이 아니라 CONFIG(slowAura.multiplier)에서 유도된다', () => {
      // multiplier를 조정했을 때 화면 문구만 30%로 굳어 거짓말을 하는 것이 이 프로젝트에서
      // 가장 흔한 회귀다. 기대값도 같은 함수에서 뽑아, 리터럴을 못박는 대신 **유도 경로**를
      // 검사한다.
      const fx = new Effects();
      fx.onEvent({ kind: 'enemySlowed', enemyId: 'e1', file: 3, y: 240 });

      const { ctx, records } = makeStubCtx();
      fx.draw(ctx as unknown as CanvasRenderingContext2D);

      const texts = records.filter(r => r.method === 'strokeText' || r.method === 'fillText');
      expect(texts).toHaveLength(2);                       // every()가 빈 배열로 공허하게 참이 되는 것을 막는다
      expect(texts.every(r => r.args[0] === `−${slowPercent()}%`)).toBe(true);
      // 배수(×0.7)가 아니라 감산량으로 적는다: '×'로 시작하는 fillText는 퀸 버프 배지라는
      // 규칙이 renderer.test.ts에 못박혀 있어, 같은 문법을 쓰면 두 연출이 서로를 오검출한다.
      expect(texts.some(r => String(r.args[0]).startsWith('×'))).toBe(false);
    });

    it('스폰 구역(8랭크) 최상단에서 감속돼도 라벨이 화면 위로 잘려나가지 않는다', () => {
      // 감속 범위는 knightMoves()와 달리 8랭크를 포함하므로, 갓 스폰된 적(y가 0에 가까움)이
      // 곧바로 걸리는 경우가 실제로 생긴다. 라벨은 적보다 위에 뜨는데 그대로 두면 y가 음수가 돼
      // 플레이어에게는 "아무 일도 안 일어난" 것으로 보인다.
      const fx = new Effects();
      fx.onEvent({ kind: 'enemySlowed', enemyId: 'e1', file: 0, y: 0 });

      const { ctx, records } = makeStubCtx();
      fx.draw(ctx as unknown as CanvasRenderingContext2D);

      const texts = records.filter(r => r.method === 'strokeText' || r.method === 'fillText');
      expect(texts).toHaveLength(2);
      expect(texts.every(r => (r.args[2] as number) > 0)).toBe(true);
    });

    it('"−30%" 라벨은 ttl 0.7초 뒤 사라진다 — 감속은 지속 상태지만 라벨은 진입 순간의 사건이다', () => {
      // 지속 상태 쪽(오라 범위·감속된 적의 고리)은 renderer.ts가 매 프레임 state를 직접 읽어
      // 그린다. 여기 라벨까지 계속 떠 있으면 적이 오라 안에 머무는 내내 "−30%"가 박혀서,
      // 방금 걸린 적과 이미 걸려 있던 적을 구분할 수 없게 된다.
      const fx = new Effects();
      fx.onEvent({ kind: 'enemySlowed', enemyId: 'e1', file: 2, y: 300 });

      fx.update(0.69);
      const before = makeStubCtx();
      fx.draw(before.ctx as unknown as CanvasRenderingContext2D);
      expect(before.records.filter(r => r.method === 'fillText')).toHaveLength(1);

      fx.update(0.02);                                     // 누적 0.71 > ttl 0.7
      const after = makeStubCtx();
      fx.draw(after.ctx as unknown as CanvasRenderingContext2D);
      expect(after.records).toHaveLength(0);
    });

    it('enemyDied: 처치 연출(puff) 1개', () => {
      const fx = new Effects();
      fx.onEvent({ kind: 'enemyDied', enemyId: 'e1', square: { file: 3, rank: 2 }, isBoss: false, reward: 10 });

      const { ctx, records } = makeStubCtx();
      fx.draw(ctx as unknown as CanvasRenderingContext2D);

      expect(records.filter(r => r.method === 'arc')).toHaveLength(1);
      expect(records.filter(r => r.method === 'fill')).toHaveLength(1);
      // 채워진 원 하나로 끝난다. 예전에는 나이트 폭발의 ember(fillRect 14개)와 구분하려는
      // 단언이었고, ember가 사라진 지금은 "처치 연출이 파티클로 번지지 않는다"는 상한이다 —
      // 웨이브 후반에는 초당 수십 마리가 죽으므로 파티클이 붙는 순간 화면이 무너진다.
      expect(records.filter(r => r.method === 'fillRect')).toHaveLength(0);
    });

    it('goldGained: 해당 칸에서 위로 떠오르는 "+N G" 1개 (테두리 + 채움)', () => {
      const fx = new Effects();
      const square: Square = { file: 3, rank: 4 };
      fx.onEvent({ kind: 'goldGained', square, amount: 10 });

      const { ctx, records } = makeStubCtx();
      fx.draw(ctx as unknown as CanvasRenderingContext2D);

      const texts = records.filter(r => r.method === 'strokeText' || r.method === 'fillText');
      expect(texts).toHaveLength(2);                       // 가독성용 테두리 1 + 채움 1
      expect(texts.every(r => r.args[0] === '+10G')).toBe(true);
      const c = center(square);
      expect(texts.every(r => r.args[1] === c.x)).toBe(true);
      // 갓 생성된 이펙트는 아직 떠오르지 않았다 — 칸 중앙에서 출발한다.
      expect(texts.every(r => r.args[2] === c.y)).toBe(true);

      // 시간이 지나면 같은 x에서 위(y 감소)로 이동한다.
      fx.update(0.5);
      const later = makeStubCtx();
      fx.draw(later.ctx as unknown as CanvasRenderingContext2D);
      const moved = later.records.filter(r => r.method === 'fillText');
      expect(moved).toHaveLength(1);
      expect(moved[0].args[1]).toBe(c.x);
      expect(moved[0].args[2]).toBeLessThan(c.y);
    });

    it('pattern이 \'none\'인 기물(퀸·나이트)은 attack 이벤트를 받아도 이펙트를 만들지 않는다', () => {
      // 실제 게임은 이들의 attack 이벤트를 절대 발행하지 않지만(발사 루프에서 제외), 방어적으로
      // 검증한다. v1.10부터 나이트도 여기 속한다 — 폭발이 사라진 자리에 공격 연출이 슬쩍
      // 들어오지 않는지가 요점이다. 나이트가 화면에 남기는 것은 오직 감속 라벨뿐이다.
      for (const pieceType of ['queen', 'knight'] as const) {
        const fx = new Effects();
        const from: Square = { file: 4, rank: 4 };
        const ev: GameEvent = { kind: 'attack', pieceType, from, targets: [{ file: 4, rank: 5 }] };
        fx.onEvent(ev);

        const { ctx, records } = makeStubCtx();
        fx.draw(ctx as unknown as CanvasRenderingContext2D);

        expect(records).toHaveLength(0);
      }
    });
  });

  describe('수명 관리 — 장기 웨이브에서 무한정 누적되지 않는다', () => {
    it('충분한 시간이 지나면 모든 이펙트가 소멸해 draw()가 아무것도 그리지 않는다 (save 호출 0회)', () => {
      const fx = new Effects();
      const from: Square = { file: 4, rank: 4 };
      fx.onEvent({ kind: 'attack', pieceType: 'pawn', from, targets: pawnTargets(from) });
      fx.onEvent({ kind: 'attack', pieceType: 'rook', from, targets: rookTargets(from) });
      fx.onEvent({ kind: 'attack', pieceType: 'bishop', from, targets: bishopTargets(from) });
      fx.onEvent({ kind: 'enemySlowed', enemyId: 'e1', file: 1, y: 120 });
      fx.onEvent({ kind: 'goldGained', square: { file: 2, rank: 3 }, amount: 10 });
      fx.onEvent({ kind: 'merged', square: { file: 5, rank: 2 }, pieceType: 'knight', tier: 2 });
      fx.onEvent({ kind: 'enemyDied', enemyId: 'e', square: { file: 6, rank: 6 }, isBoss: false, reward: 1 });

      // 가장 긴 ttl(coin 0.9s)보다 확실히 길게, 실제 프레임처럼 잘게 나눠 진행시킨다.
      // 감속 라벨(0.7s)도 여기 포함된다 — 감속은 상태로 남아도 라벨은 반드시 회수돼야 한다.
      for (let i = 0; i < 20; i++) fx.update(0.1);

      const { ctx, records } = makeStubCtx();
      fx.draw(ctx as unknown as CanvasRenderingContext2D);
      expect(records.filter(r => r.method === 'save')).toHaveLength(0);
    });
  });

  describe('화면 진동', () => {
    it('폰 공격은 진동을 일으키지 않는다 (shakeOffset이 정확히 {0,0})', () => {
      const fx = new Effects();
      const from: Square = { file: 4, rank: 4 };
      fx.onEvent({ kind: 'attack', pieceType: 'pawn', from, targets: pawnTargets(from) });
      expect(fx.shakeOffset()).toEqual({ x: 0, y: 0 });
    });

    it('진동을 만드는 이벤트는 이제 룩 crack 하나뿐이다 — 나이트는 더 이상 화면을 흔들지 않는다', () => {
      // v1.10 이전에는 나이트 폭발이 shake 0.25(룩의 0.15보다 크다)를 걸어, 나이트를 놓거나
      // 옮길 때마다 보드 전체가 크게 흔들렸다. 감속은 터지는 사건이 아니라 서 있는 상태이므로
      // 그 진동은 능력과 함께 사라졌다. 폭발을 되살리는 회귀는 여기서 먼저 잡힌다.
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.9); // 결정론적 오프셋
      try {
        const fx = new Effects();
        const from: Square = { file: 4, rank: 4 };
        // 룩만 뺀 전 이벤트를 한꺼번에 먹여도 화면은 미동도 하지 않아야 한다.
        fx.onEvent({ kind: 'attack', pieceType: 'pawn', from, targets: pawnTargets(from) });
        fx.onEvent({ kind: 'attack', pieceType: 'bishop', from, targets: bishopTargets(from) });
        fx.onEvent({ kind: 'attack', pieceType: 'knight', from, targets: [] });
        fx.onEvent({ kind: 'enemySlowed', enemyId: 'e1', file: 4, y: 200 });
        fx.onEvent({ kind: 'goldGained', square: from, amount: 10 });
        fx.onEvent({ kind: 'merged', square: from, pieceType: 'knight', tier: 2 });
        fx.onEvent({ kind: 'enemyDied', enemyId: 'e', square: from, isBoss: false, reward: 1 });
        fx.update(0.01);
        expect(fx.shakeOffset()).toEqual({ x: 0, y: 0 });

        // 대조군 — 같은 Effects 인스턴스에 룩 하나를 더하면 그제서야 흔들린다. 진동 경로 자체가
        // 죽어서 통과하는 것이 아님을 같은 테스트 안에서 보인다.
        fx.onEvent({ kind: 'attack', pieceType: 'rook', from, targets: rookTargets(from) });
        fx.update(0.01);
        expect(fx.shakeOffset()).not.toEqual({ x: 0, y: 0 });
      } finally {
        randomSpy.mockRestore();
      }
    });

    it('룩 공격은 진동을 일으킨다 (shakeOffset이 {0,0}이 아님)', () => {
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.9); // 결정론적 오프셋
      try {
        const fx = new Effects();
        const from: Square = { file: 4, rank: 4 };
        fx.onEvent({ kind: 'attack', pieceType: 'rook', from, targets: rookTargets(from) });
        // shakeOffset()은 이제 update()가 실제로 진행될 때만 갱신되는 순수 getter이므로
        // (리뷰 발견 1 수정), main.ts와 동일하게 dt>0인 update() 한 번을 거친 뒤 읽는다.
        fx.update(0.01);
        const offset = fx.shakeOffset();
        expect(offset).not.toEqual({ x: 0, y: 0 });
      } finally {
        randomSpy.mockRestore();
      }
    });

    it('진동은 시간이 지나면 정확히 0으로 감쇠하고, 이후 shakeOffset()은 {0,0}을 반환한다', () => {
      const fx = new Effects();
      const from: Square = { file: 4, rank: 4 };
      fx.onEvent({ kind: 'attack', pieceType: 'rook', from, targets: rookTargets(from) }); // shake = 0.15
      fx.update(0.05);
      fx.update(0.05);
      fx.update(0.05); // 누적 0.15 — 정확히 소진 시점
      fx.update(0.05); // 여유분 — Math.max(0, ...)로 음수가 남지 않아야 함
      expect(fx.shakeOffset()).toEqual({ x: 0, y: 0 });
    });

    it('일시정지 중(update(0) 반복)에는 진동 오프셋이 고정되고 새 난수를 뽑지 않으며, 재개하면 다시 갱신된다 (리뷰 발견 1)', () => {
      // main.ts는 state.paused일 때 fx.update(0)을 매 rAF 프레임(초당 약 60회)마다 계속 호출한다.
      // 수정 전에는 shakeOffset()이 호출될 때마다 새 난수를 뽑아, 감쇠는 멈췄는데(수명 고정)
      // 화면 진동만 정지 중 영원히 계속되는 상태가 됐다 — 정지가 없느니만 못한 결과.
      const randomSpy = vi.spyOn(Math, 'random');
      try {
        randomSpy.mockReturnValue(0.9);
        const fx = new Effects();
        const from: Square = { file: 4, rank: 4 };
        fx.onEvent({ kind: 'attack', pieceType: 'rook', from, targets: rookTargets(from) }); // shake = 0.15
        fx.update(0.01); // 정지 전 한 프레임 — 오프셋이 처음 계산된다
        const seeded = fx.shakeOffset();
        expect(seeded).not.toEqual({ x: 0, y: 0 });

        const randomCallsBeforePause = randomSpy.mock.calls.length;
        const duringPause: { x: number; y: number }[] = [];
        for (let i = 0; i < 5; i++) {          // 일시정지 중 5개의 rAF 프레임을 흉내
          fx.update(0);
          duringPause.push(fx.shakeOffset());
        }
        expect(randomSpy.mock.calls.length).toBe(randomCallsBeforePause); // 새 난수 호출 없음
        for (const offset of duringPause) expect(offset).toEqual(seeded); // 값이 완전히 고정됨

        randomSpy.mockReturnValue(0.1); // 재개: 다른 난수로 바꿔서 실제로 다시 뽑히는지 확인
        fx.update(0.01);
        const afterResume = fx.shakeOffset();
        expect(afterResume).not.toEqual(seeded);
        expect(randomSpy.mock.calls.length).toBeGreaterThan(randomCallsBeforePause);
      } finally {
        randomSpy.mockRestore();
      }
    });
  });

  describe('캔버스 변환 스택 안전성', () => {
    it('여러 종류의 이펙트가 동시에 살아있어도 draw()는 예외 없이 동작하고 save/restore 호출 수가 일치한다', () => {
      const fx = new Effects();
      const from: Square = { file: 4, rank: 4 };
      fx.onEvent({ kind: 'attack', pieceType: 'pawn', from, targets: pawnTargets(from) });
      fx.onEvent({ kind: 'attack', pieceType: 'rook', from, targets: rookTargets(from) });
      fx.onEvent({ kind: 'attack', pieceType: 'bishop', from, targets: bishopTargets(from) });
      fx.onEvent({ kind: 'enemySlowed', enemyId: 'e1', file: 5, y: 260 });
      fx.onEvent({ kind: 'goldGained', square: { file: 2, rank: 3 }, amount: 7 });
      fx.onEvent({ kind: 'merged', square: { file: 5, rank: 2 }, pieceType: 'knight', tier: 2 });
      fx.onEvent({ kind: 'enemyDied', enemyId: 'e', square: { file: 0, rank: 1 }, isBoss: false, reward: 1 });

      const { ctx, records } = makeStubCtx();
      expect(() => fx.draw(ctx as unknown as CanvasRenderingContext2D)).not.toThrow();

      const saves = records.filter(r => r.method === 'save').length;
      const restores = records.filter(r => r.method === 'restore').length;
      expect(saves).toBeGreaterThan(0);
      expect(saves).toBe(restores);
    });
  });
});
