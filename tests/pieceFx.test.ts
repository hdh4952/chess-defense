import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { fileCenterX, rankToTopY } from '../src/core/grid';
import { bishopTargets, pawnTargets, rookTargets } from '../src/core/patterns';
import { PieceFx } from '../src/render/pieceFx';
import type { Square } from '../src/types';

/**
 * 기물 공격 모션 (v1.22).
 *
 * ★ **이 연출이 없으면 폰의 공격은 화면에서 "누가 했는지"가 없다.** v1.21까지 폰이 때리면
 * 대각선 두 칸에 충격파가 뜨고 피해 숫자가 떴지만 폰 자신은 미동도 하지 않아, 피해가 어디선가
 * 저절로 나는 것처럼 보였다. 아래 단언들이 지키는 것은 "움직인다"가 아니라 **"규칙이 말하는
 * 방향으로 움직인다"**다 — 방향을 상수로 굳히면 가장자리 폰이 허공을 찌른다.
 */

const SQ = CONFIG.board.squarePx;
const center = (sq: Square) => ({ x: fileCenterX(sq.file), y: rankToTopY(sq.rank) + SQ / 2 });

/** 한 프레임 진행시킨 뒤(뻗는 구간) 자세를 읽는다. */
function strikeOnce(fx: PieceFx, square: Square) {
  fx.update(0.02);
  return fx.poseAt(square);
}

describe('PieceFx — 폰의 찌르기', () => {
  it('보드 한가운데 폰은 **정면으로** 찌른다 — 앞 대각선 둘의 중심이 정확히 정면이다', () => {
    const fx = new PieceFx();
    const from: Square = { file: 3, rank: 3 };
    const targets = pawnTargets(from);
    expect(targets).toHaveLength(2);                    // 전제: 대각선 둘 다 유효
    fx.onEvent({ kind: 'attack', pieceType: 'pawn', from, targets });

    const pose = strikeOnce(fx, from)!;
    expect(pose).not.toBeNull();
    expect(pose.dx).toBeCloseTo(0, 9);                  // 좌우 성분이 상쇄된다
    expect(pose.dy).toBeCloseTo(-1, 9);                 // 보드 y는 아래로 증가하므로 −1이 8랭크 쪽
    expect(pose.offset).toBeGreaterThan(0);             // 적 쪽으로 나아간다
    expect(pose.pitch).toBeGreaterThan(0);              // 진행 방향으로 숙인다
  });

  it('가장자리 파일 폰은 **하나뿐인 대각선 쪽으로 비스듬히** 찌른다 (방향이 상수가 아니다)', () => {
    const fx = new PieceFx();
    const from: Square = { file: 0, rank: 3 };
    const targets = pawnTargets(from);
    expect(targets).toHaveLength(1);                    // a파일이라 왼쪽 대각선이 없다
    fx.onEvent({ kind: 'attack', pieceType: 'pawn', from, targets });

    const pose = strikeOnce(fx, from)!;
    // 기대 방향을 이벤트가 아니라 **칸 좌표에서 직접** 만든다 — 구현과 같은 식을 다시 쓰지 않는다.
    const c = center(from), t = center(targets[0]);
    const len = Math.hypot(t.x - c.x, t.y - c.y);
    expect(pose.dx).toBeCloseTo((t.x - c.x) / len, 9);
    expect(pose.dy).toBeCloseTo((t.y - c.y) / len, 9);
    expect(pose.dx).toBeGreaterThan(0);                 // b파일 쪽(오른쪽)
  });

  it('때리지 않은 칸에는 자세가 없다', () => {
    const fx = new PieceFx();
    const from: Square = { file: 3, rank: 3 };
    fx.onEvent({ kind: 'attack', pieceType: 'pawn', from, targets: pawnTargets(from) });
    fx.update(0.02);
    expect(fx.poseAt({ file: 4, rank: 3 })).toBeNull();
  });
});

/**
 * ★ **근접과 원거리가 반대로 움직인다.** 폰은 적 쪽으로 나가고, 룩·비숍은 쏜 반동으로
 * 물러난다 — 모션만 보고도 "때리러 갔다"와 "쐈다"가 갈린다. 부호가 같아지면 그 구분이 사라진다.
 */
describe('PieceFx — 룩·비숍의 반동', () => {
  for (const [type, targetsOf] of [
    ['rook', rookTargets], ['bishop', bishopTargets],
  ] as const) {
    it(`${type}은 쏜 뒤 **뒤로** 물러난다 (폰과 부호가 반대다)`, () => {
      const fx = new PieceFx();
      const from: Square = { file: 3, rank: 3 };
      fx.onEvent({ kind: 'attack', pieceType: type, from, targets: targetsOf(from) });

      const pose = strikeOnce(fx, from)!;
      expect(pose).not.toBeNull();
      expect(pose.offset).toBeLessThan(0);
      expect(pose.pitch).toBeLessThan(0);
    });
  }

  it('반동은 찌르기보다 작다 — 원거리 기물이 크게 흔들리면 무엇이 근접인지 읽히지 않는다', () => {
    const peak = (type: 'pawn' | 'rook'): number => {
      const fx = new PieceFx();
      const from: Square = { file: 3, rank: 3 };
      const targets = type === 'pawn' ? pawnTargets(from) : rookTargets(from);
      fx.onEvent({ kind: 'attack', pieceType: type, from, targets });
      let max = 0;
      for (let i = 0; i < 3; i++) { fx.update(0.015); max = Math.max(max, Math.abs(fx.poseAt(from)!.offset)); }
      return max;
    };
    expect(peak('rook')).toBeLessThan(peak('pawn'));
  });
});

describe('PieceFx — 수명과 일시정지', () => {
  const from: Square = { file: 3, rank: 3 };
  const fire = (fx: PieceFx): void => {
    fx.onEvent({ kind: 'attack', pieceType: 'pawn', from, targets: pawnTargets(from) });
  };

  it('뻗었다가 돌아오고, 끝나면 자세가 사라진다 — 남으면 폰이 기울어진 채 굳는다', () => {
    const fx = new PieceFx();
    fire(fx);
    fx.update(0.045);                                   // 뻗는 구간 끝 = 최대
    const peak = fx.poseAt(from)!.offset;
    expect(peak).toBeGreaterThan(0);

    fx.update(0.1);                                     // 돌아오는 중
    const mid = fx.poseAt(from)!.offset;
    expect(mid).toBeLessThan(peak);
    expect(mid).toBeGreaterThan(0);

    fx.update(0.2);                                     // 누적 0.345 > 총 길이 0.22
    expect(fx.poseAt(from)).toBeNull();
  });

  /**
   * ★ **폰의 공격 주기(0.5초)는 2배속에서 0.25초다.** 모션이 그보다 길면 끝나기 전에 다음
   * 공격이 덮어써서 폰이 영영 기울어진 채로 떨게 된다 — 총 길이는 그 벽에 맞춰 잡은 값이다.
   */
  it('모션 총 길이가 2배속 폰의 공격 간격보다 짧다', () => {
    const fx = new PieceFx();
    fire(fx);
    fx.update(CONFIG.pieces.pawn.interval / 2);         // 2배속 한 주기만큼
    expect(fx.poseAt(from)).toBeNull();
  });

  it('일시정지(dt=0)에는 자세가 그대로 얼어붙는다 — 세계는 멈췄는데 기물만 찌르면 안 된다', () => {
    const fx = new PieceFx();
    fire(fx);
    fx.update(0.03);
    const frozen = fx.poseAt(from)!.offset;
    for (let i = 0; i < 10; i++) fx.update(0);
    expect(fx.poseAt(from)!.offset).toBe(frozen);
  });

  it('공격 이벤트가 아니면 아무 자세도 만들지 않는다', () => {
    const fx = new PieceFx();
    fx.onEvent({ kind: 'merged', square: from, pieceType: 'pawn', tier: 2 });
    fx.onEvent({ kind: 'enemyDied', enemyId: 'e', square: from, isBoss: false, reward: 1 });
    fx.update(0.02);
    expect(fx.poseAt(from)).toBeNull();
  });
});
