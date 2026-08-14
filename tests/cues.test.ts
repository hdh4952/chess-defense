import { describe, expect, it } from 'vitest';
import { AUDIO_TUNING, CueResolver } from '../src/audio/cues';
import type { GameEvent, Phase, PieceType, Square } from '../src/types';

// cues.ts는 DOM-free 정책 계층이라는 것이 이 스위트의 요지다 — 그래서 이 파일에는
// `@vitest-environment happy-dom` 주석이 없다(기본 node 환경 그대로): document/window 없이도
// 전부 통과해야 "src/render/·src/ui/를 import하지 않고 Web Audio도 건드리지 않는다"는 아키텍처
// 요구가 실제로 지켜지고 있음을 보증한다.

const SQ: Square = { file: 0, rank: 0 };
// resolve()는 v1.3에서 phase 인자를 추가로 받는다 — attack/knightBlast 등 phase 전환과 무관한
// 기존 테스트는 이 중립값('wave')을 그대로 넘겨, phase 전환 감지 로직이 끼어들지 않게 한다.
const WAVE: Phase = 'wave';

function attackEvent(pieceType: PieceType, targets: Square[] = [SQ]): GameEvent {
  return { kind: 'attack', pieceType, from: SQ, targets };
}

describe('CueResolver — 프레임 내 코일레싱 (스펙 "1번 방어")', () => {
  it('한 프레임에 폰 attack 이벤트가 8개 있어도 pawn 큐는 정확히 1개만 나온다', () => {
    const resolver = new CueResolver();
    const events = Array.from({ length: 8 }, () => attackEvent('pawn'));
    expect(resolver.resolve(events, 1000, false, WAVE)).toEqual(['pawn']);
  });

  it('서로 다른 타입이 섞여 있으면 타입마다 하나씩 나온다', () => {
    const resolver = new CueResolver();
    const events = [attackEvent('pawn'), attackEvent('pawn'), attackEvent('bishop'), attackEvent('rook')];
    const cues = resolver.resolve(events, 0, false, WAVE);
    expect(new Set(cues)).toEqual(new Set(['pawn', 'bishop', 'rook']));
    expect(cues).toHaveLength(3);
  });

  it('한 프레임에 여러 마리가 죽어도(enemyDied) enemyDied 큐는 1개만 나온다 — enemyDied는 새로운 attack이다', () => {
    const resolver = new CueResolver();
    const events: GameEvent[] = Array.from({ length: 12 }, (_, i) => (
      { kind: 'enemyDied', enemyId: `e${i}`, square: SQ, isBoss: false, reward: 10 }
    ));
    expect(resolver.resolve(events, 0, false, WAVE)).toEqual(['enemyDied']);
  });
});

describe('CueResolver — 큐별 최소 간격 스로틀 (스펙 "2번 방어")', () => {
  it('스로틀 윈도우 안에 들어온 두 번째 pawn 큐는 버려지고, 윈도우가 지나면 다시 허용된다', () => {
    const resolver = new CueResolver();
    const throttleMs = AUDIO_TUNING.cues.pawn.throttleMs;

    expect(resolver.resolve([attackEvent('pawn')], 0, false, WAVE)).toEqual(['pawn']);
    // 윈도우 안(경계 미만) — 버려진다
    expect(resolver.resolve([attackEvent('pawn')], throttleMs - 1, false, WAVE)).toEqual([]);
    // 윈도우가 정확히 지난 시점 — 다시 허용된다
    expect(resolver.resolve([attackEvent('pawn')], throttleMs, false, WAVE)).toEqual(['pawn']);
    // 리뷰 Important 3: 시각을 최초 1회만 기록하고 다시는 갱신하지 않는 구현(예:
    // `if (!lastPlayedAt.has(cue)) set(...)`)도 위 세 단언은 전부 통과한다 — 그런 구현은 세
    // 번째 호출 이후 스로틀이 다시는 걸리지 않아 실제 게임에서 60Hz로 매 프레임 재생된다.
    // 재허용된 이번(throttleMs 시점) 재생이 새 기준 시각으로 다시 스로틀을 거는지까지 확인해야
    // 이 실패 모드를 잡는다.
    expect(resolver.resolve([attackEvent('pawn')], throttleMs + 1, false, WAVE)).toEqual([]);
  });

  it('폰의 스로틀은 같은 프레임에 함께 온 룩 큐를 막지 않는다 (전역이 아니라 큐별)', () => {
    const resolver = new CueResolver();
    resolver.resolve([attackEvent('pawn')], 0, false, WAVE);   // pawn 스로틀 시작
    // 아직 pawn 스로틀 윈도우 안이지만, 같은 프레임의 rook은 별개로 판정돼야 한다.
    const cues = resolver.resolve([attackEvent('pawn'), attackEvent('rook')], 1, false, WAVE);
    expect(cues).toEqual(['rook']);
  });

  it('각 큐 종류는 서로 다른 스로틀 윈도우 시각을 독립적으로 갖는다 (bishop/rook/knight)', () => {
    const resolver = new CueResolver();
    expect(resolver.resolve([attackEvent('bishop')], 0, false, WAVE)).toEqual(['bishop']);
    expect(resolver.resolve([attackEvent('rook')], 0, false, WAVE)).toEqual(['rook']);
    expect(resolver.resolve([{ kind: 'knightBlast', square: SQ }], 0, false, WAVE)).toEqual(['knight']);
  });
});

describe('CueResolver — knightBlast 매핑', () => {
  it('knightBlast 이벤트는 knight 큐로 매핑된다', () => {
    const resolver = new CueResolver();
    expect(resolver.resolve([{ kind: 'knightBlast', square: SQ }], 0, false, WAVE)).toEqual(['knight']);
  });
});

describe('CueResolver — enemyDied (스펙 §10.1 v1.3)', () => {
  it("isBoss: true는 bossDied로, false는 enemyDied로 매핑된다", () => {
    const resolver = new CueResolver();
    expect(resolver.resolve(
      [{ kind: 'enemyDied', enemyId: 'e1', square: SQ, isBoss: true, reward: 100 }], 0, false, WAVE,
    )).toEqual(['bossDied']);
    expect(resolver.resolve(
      [{ kind: 'enemyDied', enemyId: 'e2', square: SQ, isBoss: false, reward: 10 }], 1000, false, WAVE,
    )).toEqual(['enemyDied']);
  });

  it('보스와 일반이 같은 프레임에 섞이면 두 큐가 모두 나온다 (코일레싱은 큐 종류별)', () => {
    const resolver = new CueResolver();
    const events: GameEvent[] = [
      { kind: 'enemyDied', enemyId: 'e1', square: SQ, isBoss: true, reward: 100 },
      { kind: 'enemyDied', enemyId: 'e2', square: SQ, isBoss: false, reward: 10 },
    ];
    const cues = resolver.resolve(events, 0, false, WAVE);
    expect(new Set(cues)).toEqual(new Set(['bossDied', 'enemyDied']));
  });
});

describe('CueResolver — enemyLeaked (스펙 §10.1 v1.3)', () => {
  it('isBoss와 무관하게 항상 같은 enemyLeaked 큐로 매핑된다 (일반/보스 누수를 나누지 않는다)', () => {
    const resolver = new CueResolver();
    expect(resolver.resolve(
      [{ kind: 'enemyLeaked', enemyId: 'e1', file: 0, isBoss: false }], 0, false, WAVE,
    )).toEqual(['enemyLeaked']);
    expect(resolver.resolve(
      [{ kind: 'enemyLeaked', enemyId: 'e2', file: 1, isBoss: true }], 1000, false, WAVE,
    )).toEqual(['enemyLeaked']);
  });
});

describe('CueResolver — bossSpawned / waveCleared (스펙 §10.1 v1.3)', () => {
  it('bossSpawned는 bossSpawn 큐로 매핑된다', () => {
    const resolver = new CueResolver();
    expect(resolver.resolve([{ kind: 'bossSpawned', file: 3 }], 0, false, WAVE)).toEqual(['bossSpawn']);
  });

  it('waveCleared는 waveClear 큐로 매핑된다', () => {
    const resolver = new CueResolver();
    expect(resolver.resolve([{ kind: 'waveCleared', wave: 4 }], 0, false, WAVE)).toEqual(['waveClear']);
  });
});

describe('CueResolver — prepareStarted (스펙 7.9 2단계 보스 경고, §10.1 v1.3)', () => {
  it('isBossWave: true는 bossSpawn을 낸다 (준비 시작 시점의 1차 경고 — 10초 뒤 실제 스폰에서 2차 경고가 온다)', () => {
    const resolver = new CueResolver();
    expect(resolver.resolve(
      [{ kind: 'prepareStarted', wave: 5, isBossWave: true }], 0, false, WAVE,
    )).toEqual(['bossSpawn']);
  });

  it('isBossWave: false는 아무 큐도 내지 않는다', () => {
    const resolver = new CueResolver();
    expect(resolver.resolve(
      [{ kind: 'prepareStarted', wave: 2, isBossWave: false }], 0, false, WAVE,
    )).toEqual([]);
  });
});

describe('CueResolver — attack이 아닌 경로의 예외', () => {
  it("pieceType이 'queen'이나 'knight'인 attack 이벤트는(실제로는 combat.ts가 만들지 않지만) 아무 큐도 내지 않는다", () => {
    // combat.ts:49에서 knight/queen은 'attack' 이벤트 자체를 push하지 않는다(퀸은 damage===0,
    // 나이트는 별도 knightBlast 경로) — 이 테스트는 그 사실에 기대지 않고, ATTACK_CUE_BY_PIECE에
    // 나중에 누군가 잘못된 매핑을 추가해도 이 계약이 여전히 지켜지는지 독립적으로 확인한다.
    const resolver = new CueResolver();
    expect(resolver.resolve([attackEvent('queen')], 0, false, WAVE)).toEqual([]);
    expect(resolver.resolve([attackEvent('knight')], 0, false, WAVE)).toEqual([]);
  });
});

describe('CueResolver — 일시정지', () => {
  it('paused=true면 이벤트가 있어도 아무 큐도 나오지 않는다 (이벤트 경로만 — phase는 별도 검증)', () => {
    const resolver = new CueResolver();
    expect(resolver.resolve([attackEvent('pawn')], 0, true, WAVE)).toEqual([]);
  });

  it('일시정지 중의 호출은 스로틀 상태를 소모하지 않는다 — 재개 직후 즉시 재생 허용', () => {
    const resolver = new CueResolver();
    expect(resolver.resolve([attackEvent('pawn')], 0, true, WAVE)).toEqual([]);   // paused: 무음, 상태도 그대로
    expect(resolver.resolve([attackEvent('pawn')], 0, false, WAVE)).toEqual(['pawn']); // 같은 시각에도 허용
  });
});

describe('CueResolver — phase 전환(victory/defeat), 스펙 §10.1 v1.3', () => {
  it('victory 전환 시 정확히 1회 울리고, 같은 terminal phase로 계속 호출해도 다시 울리지 않는다', () => {
    const resolver = new CueResolver();
    resolver.resolve([], 0, false, 'prepare');           // 최초 기준 phase 설정 — 전환 아님
    resolver.resolve([], 100, false, 'wave');             // prepare → wave — victory/defeat 아니므로 무음
    expect(resolver.resolve([], 200, false, 'victory')).toEqual(['victory']);   // wave → victory
    // 게임은 이 시점에 얼어붙지만 main.ts의 requestAnimationFrame은 영원히 계속 돈다 — 같은
    // terminal phase로 계속 resolve()가 불려도 절대 다시 울리면 안 된다(무한 반복 재생 방지).
    expect(resolver.resolve([], 300, false, 'victory')).toEqual([]);
    expect(resolver.resolve([], 1_000_000, false, 'victory')).toEqual([]);
  });

  it('defeat 전환 시 정확히 1회 울리고, 같은 terminal phase로 계속 호출해도 다시 울리지 않는다', () => {
    const resolver = new CueResolver();
    resolver.resolve([], 0, false, 'wave');
    expect(resolver.resolve([], 100, false, 'defeat')).toEqual(['defeat']);
    expect(resolver.resolve([], 200, false, 'defeat')).toEqual([]);
    expect(resolver.resolve([], 999_999, false, 'defeat')).toEqual([]);
  });

  it('무관한 전환(prepare → wave, wave → prepare)에서는 아무 큐도 나오지 않는다', () => {
    const resolver = new CueResolver();
    expect(resolver.resolve([], 0, false, 'prepare')).toEqual([]);   // 최초 호출 — 기준 설정만
    expect(resolver.resolve([], 100, false, 'wave')).toEqual([]);     // prepare → wave
    expect(resolver.resolve([], 200, false, 'prepare')).toEqual([]);  // wave → prepare
    expect(resolver.resolve([], 300, false, 'wave')).toEqual([]);     // prepare → wave (다시)
  });

  it('victory 전환과 이벤트 큐가 같은 프레임에 겹치면 둘 다 나온다', () => {
    const resolver = new CueResolver();
    resolver.resolve([], 0, false, 'wave');
    const cues = resolver.resolve([{ kind: 'waveCleared', wave: 20 }], 100, false, 'victory');
    expect(new Set(cues)).toEqual(new Set(['victory', 'waveClear']));
  });
});

describe('CueResolver — resolveUi (UI 제스처 전용 스로틀, 스펙 §10.1 v1.3/v1.4)', () => {
  it('첫 호출은 큐를 그대로 돌려주고, 스로틀 윈도우 안의 두 번째 호출은 null을 돌려준다', () => {
    const resolver = new CueResolver();
    const throttleMs = AUDIO_TUNING.cues.uiInvalid.throttleMs;

    expect(resolver.resolveUi('uiInvalid', 0)).toBe('uiInvalid');
    expect(resolver.resolveUi('uiInvalid', throttleMs - 1)).toBeNull();
    expect(resolver.resolveUi('uiInvalid', throttleMs)).toBe('uiInvalid');
  });

  it('서로 다른 UI 큐는 독립적인 스로틀 윈도우를 갖는다', () => {
    const resolver = new CueResolver();
    expect(resolver.resolveUi('uiBuy', 0)).toBe('uiBuy');
    // uiBuy가 막 스로틀을 걸었어도 uiSell/uiPlace/uiInvalid는 독립적으로 허용된다.
    expect(resolver.resolveUi('uiSell', 0)).toBe('uiSell');
    expect(resolver.resolveUi('uiPlace', 0)).toBe('uiPlace');
    expect(resolver.resolveUi('uiInvalid', 0)).toBe('uiInvalid');
  });

  it('resolveUi와 resolve()의 이벤트 경로는 같은 lastPlayedAt 상태를 공유하지만 큐 이름이 겹치지 않아 서로 간섭하지 않는다', () => {
    const resolver = new CueResolver();
    resolver.resolve([attackEvent('pawn')], 0, false, WAVE);   // pawn 큐 스로틀 시작
    // uiPlace는 별개의 큐 이름이므로 pawn의 스로틀과 무관하게 즉시 허용된다.
    expect(resolver.resolveUi('uiPlace', 0)).toBe('uiPlace');
  });
});

describe('CueResolver — uiPickup 제거 (v1.4)', () => {
  it("UiCueKind에서 uiPickup이 사라졌다 — AUDIO_TUNING.cues에도 해당 키가 없다", () => {
    // 타입 시스템이 이미 컴파일 타임에 uiPickup 참조를 막아 주지만(그게 이 변경의 요지),
    // 런타임 표에도 남은 잔재가 없는지 별도로 확인한다 — 예를 들어 AUDIO_TUNING 리터럴에
    // 실수로 여분의 키를 남겨 둬도 타입 에러 없이 통과할 수 있는 경우(구조적 타이핑의 초과 프로퍼티는
    // 리터럴 대입 시에만 걸린다)를 이 런타임 체크가 잡는다.
    expect(Object.keys(AUDIO_TUNING.cues)).not.toContain('uiPickup');
  });
});
