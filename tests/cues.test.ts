import { describe, expect, it } from 'vitest';
import { AUDIO_TUNING, CueResolver } from '../src/audio/cues';
import type { GameEvent, PieceType, Square } from '../src/types';

// cues.ts는 DOM-free 정책 계층이라는 것이 이 스위트의 요지다 — 그래서 이 파일에는
// `@vitest-environment happy-dom` 주석이 없다(기본 node 환경 그대로): document/window 없이도
// 전부 통과해야 "src/render/·src/ui/를 import하지 않고 Web Audio도 건드리지 않는다"는 아키텍처
// 요구가 실제로 지켜지고 있음을 보증한다.

const SQ: Square = { file: 0, rank: 0 };

function attackEvent(pieceType: PieceType, targets: Square[] = [SQ]): GameEvent {
  return { kind: 'attack', pieceType, from: SQ, targets };
}

describe('CueResolver — 프레임 내 코일레싱 (스펙 "1번 방어")', () => {
  it('한 프레임에 폰 attack 이벤트가 8개 있어도 pawn 큐는 정확히 1개만 나온다', () => {
    const resolver = new CueResolver();
    const events = Array.from({ length: 8 }, () => attackEvent('pawn'));
    expect(resolver.resolve(events, 1000, false)).toEqual(['pawn']);
  });

  it('서로 다른 타입이 섞여 있으면 타입마다 하나씩 나온다', () => {
    const resolver = new CueResolver();
    const events = [attackEvent('pawn'), attackEvent('pawn'), attackEvent('bishop'), attackEvent('rook')];
    const cues = resolver.resolve(events, 0, false);
    expect(new Set(cues)).toEqual(new Set(['pawn', 'bishop', 'rook']));
    expect(cues).toHaveLength(3);
  });
});

describe('CueResolver — 큐별 최소 간격 스로틀 (스펙 "2번 방어")', () => {
  it('스로틀 윈도우 안에 들어온 두 번째 pawn 큐는 버려지고, 윈도우가 지나면 다시 허용된다', () => {
    const resolver = new CueResolver();
    const throttleMs = AUDIO_TUNING.cues.pawn.throttleMs;

    expect(resolver.resolve([attackEvent('pawn')], 0, false)).toEqual(['pawn']);
    // 윈도우 안(경계 미만) — 버려진다
    expect(resolver.resolve([attackEvent('pawn')], throttleMs - 1, false)).toEqual([]);
    // 윈도우가 정확히 지난 시점 — 다시 허용된다
    expect(resolver.resolve([attackEvent('pawn')], throttleMs, false)).toEqual(['pawn']);
  });

  it('폰의 스로틀은 같은 프레임에 함께 온 룩 큐를 막지 않는다 (전역이 아니라 큐별)', () => {
    const resolver = new CueResolver();
    resolver.resolve([attackEvent('pawn')], 0, false);   // pawn 스로틀 시작
    // 아직 pawn 스로틀 윈도우 안이지만, 같은 프레임의 rook은 별개로 판정돼야 한다.
    const cues = resolver.resolve([attackEvent('pawn'), attackEvent('rook')], 1, false);
    expect(cues).toEqual(['rook']);
  });

  it('각 큐 종류는 서로 다른 스로틀 윈도우 시각을 독립적으로 갖는다 (bishop/rook/knight)', () => {
    const resolver = new CueResolver();
    expect(resolver.resolve([attackEvent('bishop')], 0, false)).toEqual(['bishop']);
    expect(resolver.resolve([attackEvent('rook')], 0, false)).toEqual(['rook']);
    expect(resolver.resolve([{ kind: 'knightBlast', square: SQ }], 0, false)).toEqual(['knight']);
  });
});

describe('CueResolver — knightBlast 매핑', () => {
  it('knightBlast 이벤트는 knight 큐로 매핑된다', () => {
    const resolver = new CueResolver();
    expect(resolver.resolve([{ kind: 'knightBlast', square: SQ }], 0, false)).toEqual(['knight']);
  });
});

describe('CueResolver — 공격이 아닌 이벤트는 무시된다', () => {
  it('enemyDied/enemyLeaked/bossSpawned/waveCleared/prepareStarted는 아무 큐도 만들지 않는다', () => {
    const resolver = new CueResolver();
    const events: GameEvent[] = [
      { kind: 'enemyDied', enemyId: 'e1', square: SQ, isBoss: false, reward: 10 },
      { kind: 'enemyLeaked', enemyId: 'e2', file: 0, isBoss: false },
      { kind: 'bossSpawned', file: 0 },
      { kind: 'waveCleared', wave: 1 },
      { kind: 'prepareStarted', wave: 2, isBossWave: false },
    ];
    expect(resolver.resolve(events, 0, false)).toEqual([]);
  });
});

describe('CueResolver — 일시정지', () => {
  it('paused=true면 이벤트가 있어도 아무 큐도 나오지 않는다', () => {
    const resolver = new CueResolver();
    expect(resolver.resolve([attackEvent('pawn')], 0, true)).toEqual([]);
  });

  it('일시정지 중의 호출은 스로틀 상태를 소모하지 않는다 — 재개 직후 즉시 재생 허용', () => {
    const resolver = new CueResolver();
    expect(resolver.resolve([attackEvent('pawn')], 0, true)).toEqual([]);   // paused: 무음, 상태도 그대로
    expect(resolver.resolve([attackEvent('pawn')], 0, false)).toEqual(['pawn']); // 같은 시각에도 허용
  });
});
