import { describe, expect, it } from 'vitest';
import { AUDIO_TUNING, CueResolver, type CueKind } from '../src/audio/cues';
import { CONFIG } from '../src/config';
import type { GameEvent, Phase, PieceType, Square } from '../src/types';

// cues.ts는 DOM-free 정책 계층이라는 것이 이 스위트의 요지다 — 그래서 이 파일에는
// `@vitest-environment happy-dom` 주석이 없다(기본 node 환경 그대로): document/window 없이도
// 전부 통과해야 "src/render/·src/ui/를 import하지 않고 Web Audio도 건드리지 않는다"는 아키텍처
// 요구가 실제로 지켜지고 있음을 보증한다.

const SQ: Square = { file: 0, rank: 0 };
// resolve()는 v1.3에서 phase 인자를 추가로 받는다 — attack/enemyDied 등 phase 전환과 무관한
// 기존 테스트는 이 중립값('wave')을 그대로 넘겨, phase 전환 감지 로직이 끼어들지 않게 한다.
const WAVE: Phase = 'wave';
// 감속 오라의 최고 단계. v1.13에서 enemySlowed가 tier를 싣게 됐으므로, "무음"을 단언할 때
// 특정 단계 하나만 보면 부족하다 — 가장 센 오라까지 포함해 훑는 데 쓴다.
const MAX_SLOW_TIER = CONFIG.merge.maxTier.knight;

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

  it('각 큐 종류는 서로 다른 스로틀 윈도우 시각을 독립적으로 갖는다 (bishop/rook/enemyDied)', () => {
    // 세 번째 큐로 attack 경로 밖(enemyDied)을 고르는 것이 요점이다 — 스로틀 맵의 키가 큐
    // 종류이지 이벤트 종류가 아님을 보이려면 서로 다른 경로에서 온 큐가 섞여야 한다.
    // (v1.10 전에는 이 자리에 knightBlast→'knight'가 있었다. 폭발 능력이 사라지며 그 큐도
    // 함께 없어졌으므로, 같은 불변식을 남은 비-attack 큐로 다시 쓴 것이다.)
    const resolver = new CueResolver();
    expect(resolver.resolve([attackEvent('bishop')], 0, false, WAVE)).toEqual(['bishop']);
    expect(resolver.resolve([attackEvent('rook')], 0, false, WAVE)).toEqual(['rook']);
    expect(resolver.resolve(
      [{ kind: 'enemyDied', enemyId: 'e1', square: SQ, isBoss: false, reward: 10 }], 0, false, WAVE,
    )).toEqual(['enemyDied']);
  });
});

// v1.10에서 나이트의 폭발이 감속 오라로 교체됐다. 예전 'knightBlast 매핑' 스위트(knightBlast
// → 'knight' 큐)가 지키던 것은 "나이트 능력이 발동하면 소리가 난다"였는데, 그 능력에는 이제
// 발동 순간이 없다 — 아래 두 스위트가 그 자리를 물려받는다: 감속 이벤트는 무음이라는 계약과,
// 'knight' 큐가 표에서 실제로 사라졌다는 확인.
describe('CueResolver — enemySlowed는 무음이다 (v1.10 감속 오라, v1.13 티어별 감속)', () => {
  it('감속 진입 이벤트는 티어가 무엇이든 몇 개가 오든 아무 큐도 내지 않는다', () => {
    // 감속은 순간 사건이 아니라 지속 상태다. 적은 오라를 드나들 때마다 감속 전이를 다시
    // 일으키고, 웨이브 하나에 적이 수십 마리이므로 전이도 웨이브당 수십 번 쌓인다 — 전이마다
    // 울리면 스로틀로 깎아도 초당 몇 회짜리 잡음으로 남는다. 그래서 게인을 낮추는 대신 큐
    // 자체를 주지 않기로 했다(감속 사실은 화면의 점선 고리와 "−30%"/"−45%" 라벨이 이미 전한다).
    //
    // ★ v1.13에서 감속량이 티어별로 갈라지고(T1 30% … T6 55%) 이벤트가 tier를 싣게 됐지만,
    // **소리 쪽은 여전히 티어 무관**이다 — 티어가 높아진다고 울릴 순간이 생기는 것은 아니다.
    // 그래서 전 티어를 한 프레임에 섞어 넣고 훑는다: 나중에 "센 오라만 소리를 준다" 같은
    // 분기가 들어오면 여기서 먼저 빨개진다.
    const resolver = new CueResolver();
    const events: GameEvent[] = Array.from({ length: 20 }, (_, i) => (
      { kind: 'enemySlowed', enemyId: `e${i}`, file: i % 8, y: 40 * i, tier: (i % MAX_SLOW_TIER) + 1 }
    ));
    expect(resolver.resolve(events, 0, false, WAVE)).toEqual([]);
    // 프레임을 한참 건너뛰어도 마찬가지 — 스로틀에 걸려 조용한 게 아니라 매핑 자체가 없다.
    // (스로틀이었다면 윈도우가 지난 이 호출에서 다시 울렸을 것이다.)
    expect(resolver.resolve(events, 10_000, false, WAVE)).toEqual([]);
  });

  it('같은 프레임에 섞인 다른 큐를 가리지 않는다', () => {
    // 무음 이벤트가 present 집합에 null로 끼어들어 뒤따르는 큐까지 삼키는 실수를 막는다.
    // 최고 티어를 쓰는 이유: 무음이 "약한 오라라서"가 아니라 이벤트 종류 자체의 결정임을 못박는다.
    const resolver = new CueResolver();
    const cues = resolver.resolve(
      [{ kind: 'enemySlowed', enemyId: 'e1', file: 0, y: 0, tier: MAX_SLOW_TIER }, attackEvent('pawn')],
      0, false, WAVE,
    );
    expect(cues).toEqual(['pawn']);
  });
});

describe("CueResolver — 'knight' 큐 제거 (v1.10)", () => {
  it('AUDIO_TUNING.cues에 knight 항목이 남아 있지 않다', () => {
    // 큐가 물고 있던 폭발음(blast-knight.ogg)은 능력과 함께 삭제됐다. uiPickup 때와 같은
    // 이유로 런타임 표까지 확인한다 — 리터럴에 여분의 키가 남아도 컴파일은 통과하고, 그러면
    // player.ts가 존재하지 않는 에셋을 계속 프리로드하려 든다.
    expect(Object.keys(AUDIO_TUNING.cues)).not.toContain('knight');
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

describe('CueResolver — attack 큐 전수 매핑 (ATTACK_CUE_BY_PIECE)', () => {
  // 표를 Partial이 아니라 전수 Record로 둔 이유("소리 없음"이 누락이 아니라 결정이 되도록)를
  // 테스트도 전수로 지킨다 — 기물이 추가되면 이 표가 먼저 빨개져서 결정을 강요한다.
  const EXPECTED: Record<PieceType, CueKind[]> = {
    pawn: ['pawn'],
    bishop: ['bishop'],
    rook: ['rook'],
    // 융합물은 재료의 주기 공격 소리를 그대로 물려받는다(새 에셋 없음).
    archbishop: ['bishop'],
    chancellor: ['rook'],
    // 셋 다 pattern이 'none'이라 combat.ts의 발사 루프가 통째로 건너뛴다 — 즉 이 입력은 실전에
    // 도달하지 않는다. 그래도 표에 잘못된 매핑이 끼어드는 쪽을 여기서 독립적으로 잡는다.
    // ⚠️ v1.10에서 knight/amazon이 무음인 **근거가 바뀌었다**: 예전에는 "주기 공격 대신 폭발음을
    // 따로 냈다"였지만, 이제는 낼 소리가 애초에 없다 — 감속은 지속 상태라 울릴 순간이 없다.
    knight: [],
    queen: [],
    amazon: [],
  };

  for (const [type, expected] of Object.entries(EXPECTED) as [PieceType, CueKind[]][]) {
    it(`${type}의 attack 이벤트는 ${expected.length === 0 ? '아무 큐도 내지 않는다' : `${expected[0]} 큐를 낸다`}`, () => {
      // 큐마다 새 resolver를 쓴다 — 공유하면 스로틀이 끼어들어 매핑이 아니라 시간을 측정하게 된다.
      const resolver = new CueResolver();
      expect(resolver.resolve([attackEvent(type)], 0, false, WAVE)).toEqual(expected);
    });
  }
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
