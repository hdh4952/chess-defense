import { describe, expect, it, vi } from 'vitest';
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

    it('knightBlast: 폭발(explosion) 1개 + 잔불 파티클(ember) 14개', () => {
      const fx = new Effects();
      fx.onEvent({ kind: 'knightBlast', square: { file: 2, rank: 5 } });

      const { ctx, records } = makeStubCtx();
      fx.draw(ctx as unknown as CanvasRenderingContext2D);

      expect(records.filter(r => r.method === 'createRadialGradient')).toHaveLength(1); // explosion 1개
      expect(records.filter(r => r.method === 'fillRect')).toHaveLength(14);            // ember 14개
    });

    it('enemyDied: 처치 연출(puff) 1개', () => {
      const fx = new Effects();
      fx.onEvent({ kind: 'enemyDied', enemyId: 'e1', square: { file: 3, rank: 2 }, isBoss: false, reward: 10 });

      const { ctx, records } = makeStubCtx();
      fx.draw(ctx as unknown as CanvasRenderingContext2D);

      expect(records.filter(r => r.method === 'arc')).toHaveLength(1);
      expect(records.filter(r => r.method === 'fill')).toHaveLength(1);
      expect(records.filter(r => r.method === 'fillRect')).toHaveLength(0); // ember와 구분됨
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

    it('퀸은 attack 이벤트를 받아도 이펙트를 만들지 않는다 (스펙 8.2 — 퀸은 공격 이펙트 없음)', () => {
      const fx = new Effects();
      const from: Square = { file: 4, rank: 4 };
      // 실제 게임은 퀸의 attack 이벤트를 절대 발행하지 않지만(damage 0), 방어적으로 검증한다.
      const ev: GameEvent = { kind: 'attack', pieceType: 'queen', from, targets: [{ file: 4, rank: 5 }] };
      fx.onEvent(ev);

      const { ctx, records } = makeStubCtx();
      fx.draw(ctx as unknown as CanvasRenderingContext2D);

      expect(records).toHaveLength(0);
    });
  });

  describe('수명 관리 — 장기 웨이브에서 무한정 누적되지 않는다', () => {
    it('충분한 시간이 지나면 모든 이펙트가 소멸해 draw()가 아무것도 그리지 않는다 (save 호출 0회)', () => {
      const fx = new Effects();
      const from: Square = { file: 4, rank: 4 };
      fx.onEvent({ kind: 'attack', pieceType: 'pawn', from, targets: pawnTargets(from) });
      fx.onEvent({ kind: 'attack', pieceType: 'rook', from, targets: rookTargets(from) });
      fx.onEvent({ kind: 'attack', pieceType: 'bishop', from, targets: bishopTargets(from) });
      fx.onEvent({ kind: 'knightBlast', square: { file: 1, rank: 1 } });
      fx.onEvent({ kind: 'enemyDied', enemyId: 'e', square: { file: 6, rank: 6 }, isBoss: false, reward: 1 });

      // 가장 긴 ttl(ember 0.5s)보다 확실히 길게, 실제 프레임처럼 잘게 나눠 진행시킨다.
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
      fx.onEvent({ kind: 'knightBlast', square: { file: 5, rank: 5 } });
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
