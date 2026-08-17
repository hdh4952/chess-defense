import { describe, expect, it, vi } from 'vitest';
import { CONFIG, slowPercent } from '../src/config';
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

      // ★ v1.15에서 세 겹이 됐다: **잔광 → 밝은 테두리 → 갈색 코어**. 잔광은 넓어지며
      // 옅어지고 코어는 얇아진다(두 방향이 반대라야 "터진 뒤 잦아든다"로 읽힌다).
      // 겹 수를 상수로 두고 유도하는 이유는, 겹이 늘 때 이 테스트가 **의도적으로** 깨져
      // 누가 연출을 바꿨다는 사실이 드러나야 하기 때문이다 — 자동으로 따라가면 잔광이
      // 실수로 빠져도 초록으로 남는다.
      const PASSES = 3;
      const moveTos = records.filter(r => r.method === 'moveTo');
      expect(moveTos).toHaveLength(expectedEnds.length * PASSES);
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

      // crack과 같이 v1.15에서 세 겹이 됐다(금빛 잔광 → 어두운 테두리 → 밝은 코어).
      const PASSES = 3;
      const moveTos = records.filter(r => r.method === 'moveTo');
      expect(moveTos).toHaveLength(expectedEnds.length * PASSES);

      const lineTos = records.filter(r => r.method === 'lineTo');
      const endpoints = new Set(lineTos.map(l => `${l.args[0]},${l.args[1]}`));
      const expectedEndpoints = new Set(expectedEnds.map(sq => { const c = center(sq); return `${c.x},${c.y}`; }));
      expect(endpoints).toEqual(expectedEndpoints);
    });

    it('★ 히트스톱 — 룩 계열 타격에만 걸리고, 벽시계로 풀린다 (v1.15)', () => {
      // 사용자 요청은 "룩/나이트만"이었지만 나이트는 v1.10에서 폭발을 잃고 공격 자체가
      // 없어졌다(공격력 0). 요청의 의도는 "무거운 타격"이고, 이 게임에 남은 무거운 타격이
      // crack(관통 균열 + 화면 진동)이라 pattern 'rook'(룩·챈슬러)이 그대로 이어받는다.
      const fx = new Effects();
      expect(fx.tickHitstop(1 / 60)).toBe(false);            // 아무 일 없으면 안 멈춘다

      const from: Square = { file: 4, rank: 4 };
      fx.onEvent({ kind: 'attack', pieceType: 'rook', from, targets: rookTargets(from) });
      expect(fx.tickHitstop(0.01)).toBe(true);               // 걸렸다
      expect(fx.tickHitstop(0.05)).toBe(true);               // 아직 남아 있다(이 호출이 소진시킨다)
      expect(fx.tickHitstop(0.01)).toBe(false);              // 40ms를 넘겨 풀렸다
    });

    it('★ 룩 계열이 아닌 공격은 히트스톱을 걸지 않는다', () => {
      // 폰(shock)·비숍(beam)에도 걸면 후반에 초당 수십 번 멈춰 게임이 끊긴다. 진동(shake)이
      // crack에만 걸리는 것과 같은 근거이고, 같은 조건을 쓰는 것이 두 연출의 일관성이다.
      for (const type of ['pawn', 'bishop'] as const) {
        const fx = new Effects();
        const from: Square = { file: 4, rank: 4 };
        const targets = type === 'pawn' ? pawnTargets(from) : bishopTargets(from);
        fx.onEvent({ kind: 'attack', pieceType: type, from, targets });
        expect(fx.tickHitstop(0.01), type).toBe(false);
      }
    });

    it('★ 연속 타격에도 최소 간격이 지켜진다 — 매 프레임 멈추면 게임이 끊긴다', () => {
      // 룩 여러 기가 엇갈려 발사하는 것이 실전에서 흔하다. 스로틀이 없으면 그 구간 내내
      // 시뮬레이션이 멈춰 "느려졌다"로 읽힌다 — 오디오 스로틀과 같은 이유다.
      const fx = new Effects();
      const from: Square = { file: 4, rank: 4 };
      const fire = (): void => {
        fx.onEvent({ kind: 'attack', pieceType: 'rook', from, targets: rookTargets(from) });
      };
      fire();
      while (fx.tickHitstop(0.01)) { /* 첫 히트스톱을 소진한다 */ }
      fire();                                                // 곧바로 다시 때렸다
      expect(fx.tickHitstop(0.01)).toBe(false);               // 간격이 안 찼으므로 안 걸린다
      for (let i = 0; i < 40; i++) fx.tickHitstop(0.01);      // 0.4초 흐름
      fire();
      expect(fx.tickHitstop(0.01)).toBe(true);                // 이제 다시 걸린다
    });

    it('★ 히트스톱은 update(dt)와 별개로 진행된다 — 일시정지 중에 영원히 갇히지 않는다', () => {
      // update의 dt는 일시정지 중 0으로 눌린다. 히트스톱을 같은 dt로 감쇠시키면, 히트스톱이
      // 걸린 순간 일시정지하면 절대 풀리지 않아 게임이 재개돼도 시뮬레이션이 멈춘 채 남는다.
      const fx = new Effects();
      const from: Square = { file: 4, rank: 4 };
      fx.onEvent({ kind: 'attack', pieceType: 'rook', from, targets: rookTargets(from) });
      fx.update(0);
      expect(fx.tickHitstop(0.05)).toBe(true);
      expect(fx.tickHitstop(0.01)).toBe(false);               // update(0)에도 벽시계로 풀렸다
    });

    // v1.10: 나이트의 폭발이 감속 오라로 바뀌면서 explosion(createRadialGradient 1) + ember
    // (fillRect 14)를 세던 테스트가 대상을 잃었다. 다만 그 테스트가 지키던 불변식 —
    // "나이트가 한 일이 화면에 즉시 드러난다" — 은 그대로 유효하고, 이제 그 역할을 감속 진입
    // 라벨이 물려받는다. 그래서 삭제가 아니라 frostTag 판본으로 다시 쓴다.
    it('enemySlowed(T1): 감속에 걸린 적 위로 "−30%" 라벨 1개 (테두리 + 채움)', () => {
      const fx = new Effects();
      const file = 2, y = 300;
      fx.onEvent({ kind: 'enemySlowed', enemyId: 'e1', file, y, tier: 1 });

      const { ctx, records } = makeStubCtx();
      fx.draw(ctx as unknown as CanvasRenderingContext2D);

      const texts = records.filter(r => r.method === 'strokeText' || r.method === 'fillText');
      expect(texts).toHaveLength(2);                       // 밝은 칸 위에서도 읽히도록 테두리 1 + 채움 1
      // 테두리와 채움이 **같은** 문구여야 한다 — 둘이 갈라지면 "−30%" 위에 "−40%"가 겹쳐 찍힌다.
      expect(texts.every(r => r.args[0] === `−${slowPercent(1)}%`)).toBe(true);
      expect(texts.every(r => r.args[1] === fileCenterX(file))).toBe(true);
      // 좌표가 칸 중심이 아니라 적의 실제 픽셀 y에서 유도되는지 — 적은 칸 사이를 연속으로
      // 움직이므로 rankToTopY로 스냅하면 최대 한 칸만큼 어긋난 자리에 라벨이 뜬다.
      expect(texts.every(r => (r.args[2] as number) < y)).toBe(true);  // 적의 "머리 위"
    });

    it('★ 티어가 다르면 다른 문구가 그려지고(T1 −30% · T3 −40%), 그래도 겹친 감속은 합산되지 않는다', () => {
      // v1.10~v1.12에는 이 자리의 불변식이 "티어 무관"이었다. 라벨이 한 종류뿐이었으므로 문구를
      // 상수로 굳혀도 아무도 눈치채지 못했고, 실제로 그렇게 굳어 있었다(SLOW_LABEL). v1.13에서
      // 티어마다 감속이 달라졌으므로(사용자 결정) 그 상수화 회귀를 잡는 자리는 **여기뿐이다** —
      // 코어는 티어를 실어 보낼 뿐이고, 그 티어가 정말 문구를 바꾸는지는 그려진 글자로만 드러난다.
      //
      // 두 규칙을 한 테스트에 나란히 둔다. 서로 반대 방향처럼 보여 혼동하기 쉬워서다:
      //  ① 티어가 오르면 감속이 **세진다** (T1 −30% → T3 −40%)
      //  ② 그래도 **중첩은 없다** — 겹친 칸에서는 최댓값 하나만 걸리므로, T1 오라에 이미 걸린
      //     적이 T3 오라로 넘어가 이벤트가 다시 나도 화면이 말하는 값은 −40%(T3 단독)이지
      //     −70%(합)가 아니다. 티어를 더하거나 곱한 수치는 어떤 경로로도 나오면 안 된다.
      const drawLabels = (tiers: readonly number[]): string[] => {
        const fx = new Effects();
        for (const tier of tiers) fx.onEvent({ kind: 'enemySlowed', enemyId: 'e1', file: 3, y: 240, tier });
        const { ctx, records } = makeStubCtx();
        fx.draw(ctx as unknown as CanvasRenderingContext2D);
        // 채움만 센다 — 테두리와 짝을 이룬다는 것은 위 테스트가 지킨다.
        return records.filter(r => r.method === 'fillText').map(r => String(r.args[0]));
      };

      // ① 숫자는 리터럴이 아니라 slowPercent(tier)에서 유도된다. 계수를 조정했을 때 화면 문구만
      //    옛 값으로 굳어 거짓말을 하는 것이 이 프로젝트에서 가장 흔한 회귀다.
      expect(drawLabels([1])).toEqual([`−${slowPercent(1)}%`]);
      expect(drawLabels([3])).toEqual([`−${slowPercent(3)}%`]);
      // 위 둘은 기대값도 같은 함수에서 뽑으므로 perTierPercent가 0이 되면 나란히 −30%로 무너지며
      // 함께 통과해버린다. "티어마다 다르다"는 규칙 자체는 유도에 기대지 않고 직접 단언한다.
      expect(drawLabels([1])).not.toEqual(drawLabels([3]));

      // ② 겹침 — 이벤트가 두 번 와도 각 라벨은 자기 티어를 말할 뿐, 합쳐진 수치는 없다.
      const stacked = drawLabels([1, 3]);
      expect(stacked).toEqual([`−${slowPercent(1)}%`, `−${slowPercent(3)}%`]);
      expect(stacked).not.toContain(`−${slowPercent(1) + slowPercent(3)}%`);   // −70%: 합산 회귀
      // 배수(×0.6)가 아니라 감산량으로 적는다: '×'로 시작하는 fillText는 퀸 버프 배지라는
      // 규칙이 renderer.test.ts에 못박혀 있어, 같은 문법을 쓰면 두 연출이 서로를 오검출한다.
      expect(stacked.some(s => s.startsWith('×'))).toBe(false);
    });

    it('T1~T6 라벨이 정확히 −30% · −35% · −40% · −45% · −50% · −55%다 (표를 바깥에서 못박는 자리)', () => {
      // 위 테스트는 기대값을 전부 slowPercent()에서 유도하므로, basePercent나 perTierPercent를
      // 잘못 건드리면 기대값이 함께 움직여 아무것도 지키지 못한다. 사용자가 정한 표를 여기서 한 번
      // 리터럴로 못박아, 계수 변경이 반드시 이 테스트를 깨고 지나가게 만든다.
      // 화면 문구로 못박는 이유: 플레이어가 실제로 읽는 것이 이 문자열이고, 물리(배수) 쪽 표는
      // slow.test.ts가 따로 지킨다.
      const expected = ['−30%', '−35%', '−40%', '−45%', '−50%', '−55%'];
      // 6줄인 이유 — 합성 상한이 6이라 T7 오라는 존재할 수 없다. 상한이 늘면 이 표도 함께 늘려야
      // 하고, 그 사실을 여기서 알려 준다.
      expect(CONFIG.merge.maxTier.knight).toBe(expected.length);

      const fx = new Effects();
      expected.forEach((_, i) =>
        fx.onEvent({ kind: 'enemySlowed', enemyId: `e${i}`, file: i, y: 240, tier: i + 1 }));

      const { ctx, records } = makeStubCtx();
      fx.draw(ctx as unknown as CanvasRenderingContext2D);
      expect(records.filter(r => r.method === 'fillText').map(r => r.args[0])).toEqual(expected);
    });

    it('스폰 구역(8랭크) 최상단에서 감속돼도 라벨이 화면 위로 잘려나가지 않는다', () => {
      // 감속 범위는 배치 가능 칸과 달리 8랭크를 포함하므로, 갓 스폰된 적(y가 0에 가까움)이
      // 곧바로 걸리는 경우가 실제로 생긴다. 라벨은 적보다 위에 뜨는데 그대로 두면 y가 음수가 돼
      // 플레이어에게는 "아무 일도 안 일어난" 것으로 보인다.
      // 티어를 3으로 두는 것은 이 가드가 문구 길이·티어와 무관하다는 뜻이다 — 잘림은 좌표 문제다.
      const fx = new Effects();
      fx.onEvent({ kind: 'enemySlowed', enemyId: 'e1', file: 0, y: 0, tier: 3 });

      const { ctx, records } = makeStubCtx();
      fx.draw(ctx as unknown as CanvasRenderingContext2D);

      const texts = records.filter(r => r.method === 'strokeText' || r.method === 'fillText');
      expect(texts).toHaveLength(2);
      expect(texts.every(r => (r.args[2] as number) > 0)).toBe(true);
    });

    it('감속 라벨은 ttl 0.7초 뒤 사라진다 — 감속은 지속 상태지만 라벨은 진입 순간의 사건이다', () => {
      // 지속 상태 쪽(오라 범위·감속된 적의 고리)은 renderer.ts가 매 프레임 state를 직접 읽어
      // 그린다. 여기 라벨까지 계속 떠 있으면 적이 오라 안에 머무는 내내 감속 수치가 박혀서,
      // 방금 걸린 적과 이미 걸려 있던 적을 구분할 수 없게 된다. v1.13에서는 더 나쁘다 —
      // 더 센 오라로 넘어갈 때만 새 수치가 뜨는데, 옛 라벨이 안 사라지면 −30%와 −40%가 한
      // 적의 머리 위에 동시에 박혀 어느 쪽이 지금 걸린 값인지 알 수 없게 된다.
      const fx = new Effects();
      fx.onEvent({ kind: 'enemySlowed', enemyId: 'e1', file: 2, y: 300, tier: 1 });

      fx.update(0.69);
      const before = makeStubCtx();
      fx.draw(before.ctx as unknown as CanvasRenderingContext2D);
      expect(before.records.filter(r => r.method === 'fillText')).toHaveLength(1);

      fx.update(0.02);                                     // 누적 0.71 > ttl 0.7
      const after = makeStubCtx();
      fx.draw(after.ctx as unknown as CanvasRenderingContext2D);
      expect(after.records).toHaveLength(0);
    });

    it('enemyDied: 처치 연출(puff) 1개 + 파편 (v1.15)', () => {
      const fx = new Effects();
      fx.onEvent({ kind: 'enemyDied', enemyId: 'e1', square: { file: 3, rank: 2 }, isBoss: false, reward: 10 });

      const { ctx, records } = makeStubCtx();
      fx.draw(ctx as unknown as CanvasRenderingContext2D);

      expect(records.filter(r => r.method === 'arc')).toHaveLength(1);
      expect(records.filter(r => r.method === 'fill')).toHaveLength(1);
      // ⚠️ v1.15에서 파편이 붙었다. 예전 이 자리의 단언은 "처치 연출이 파티클로 번지지
      // 않는다"(fillRect 0)였고 그 근거는 "후반에는 초당 수십 마리가 죽는다"였다 — 그 근거는
      // 여전히 유효하므로 파티클을 **넣되 개수를 조인다.** 일반 적 5개는 그 타협점이고,
      // 상한을 못박아 두지 않으면 다음 사람이 8·12로 올려도 아무 신호가 없다.
      expect(records.filter(r => r.method === 'fillRect')).toHaveLength(5);
    });

    it('★ 보스는 파편이 더 많다 — 그리고 일반 적의 개수가 상한이다', () => {
      // 후반 웨이브가 초당 수십 마리를 처치하므로 일반 적의 파편 수가 화면 부하를 정한다.
      // 보스는 한 판에 넷뿐이라 더 크게 터뜨려도 안전하다.
      const count = (isBoss: boolean): number => {
        const fx = new Effects();
        fx.onEvent({ kind: 'enemyDied', enemyId: 'x', square: { file: 3, rank: 2 }, isBoss, reward: 10 });
        const { ctx, records } = makeStubCtx();
        fx.draw(ctx as unknown as CanvasRenderingContext2D);
        return records.filter(r => r.method === 'fillRect').length;
      };
      expect(count(false)).toBeLessThanOrEqual(6);
      expect(count(true)).toBeGreaterThan(count(false));
    });

    it('★ 골드 비행은 도착점을 모르면 만들어지지 않는다', () => {
      // 이 저장소에서 캔버스와 DOM의 경계를 넘는 연출은 이것이 처음이다. 도착점을 모르는 채
      // (0,0)으로 날리면 화면 왼쪽 위로 텍스트가 쏟아지므로, 좌표가 없으면 아예 만들지 않는다.
      const fx = new Effects();
      fx.onEvent({ kind: 'enemyDied', enemyId: 'e1', square: { file: 3, rank: 2 }, isBoss: false, reward: 42 });
      const bare = makeStubCtx();
      fx.draw(bare.ctx as unknown as CanvasRenderingContext2D);
      expect(bare.records.filter(r => r.method === 'fillText')).toHaveLength(0);

      const fx2 = new Effects();
      fx2.setGoldTarget({ x: 100, y: 20 });
      fx2.onEvent({ kind: 'enemyDied', enemyId: 'e1', square: { file: 3, rank: 2 }, isBoss: false, reward: 42 });
      const withT = makeStubCtx();
      fx2.draw(withT.ctx as unknown as CanvasRenderingContext2D);
      const texts = withT.records.filter(r => r.method === 'fillText');
      expect(texts).toHaveLength(1);
      expect(texts[0].args[0]).toBe('+42');       // 보상 액수를 그대로 실어 보낸다
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
      fx.onEvent({ kind: 'enemySlowed', enemyId: 'e1', file: 1, y: 120, tier: 4 });
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
        fx.onEvent({ kind: 'enemySlowed', enemyId: 'e1', file: 4, y: 200, tier: 6 });
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
      fx.onEvent({ kind: 'enemySlowed', enemyId: 'e1', file: 5, y: 260, tier: 2 });
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
