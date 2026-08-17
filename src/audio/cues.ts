import type { GameEvent, PieceType, Phase } from '../types';

/**
 * "무엇을 재생할지 결정"하는 정책 계층 — DOM-free, Web Audio 미접촉. render/highlights.ts가
 * render/renderer.ts(부수효과)에서 분리돼 순수하게 테스트 가능한 것과 같은 이유로 분리했다.
 * src/render/·src/ui/를 import하지 않는다 — 이 파일만 봐도 "무엇이 울리는가"를 전부 검증할 수 있다.
 *
 * 실제 재생(AudioContext/디코딩/보이스 관리)은 src/audio/player.ts가 맡는다.
 *
 * v1.3에서 전체 효과음 세트로 확장했다 (스펙 §10.1). 세 가지 트리거 경로가 이 파일 하나에 모인다:
 *   1) GameEvent → cueForEvent (attack + enemyDied/enemyLeaked/bossSpawned/waveCleared/
 *      prepareStarted) — resolve()가 소비.
 *   2) state.phase 전환(victory/defeat) — GameEvent가 아니라 상태값이므로 resolve()가 phase를
 *      별도 인자로 받아 이전 프레임과 비교한다. cues.ts가 이미 스로틀 상태(lastPlayedAt)를 들고
 *      있으므로 previousPhase도 여기 두는 것이 일관적이다.
 *   3) UI 제스처(구매/판매/배치/거부) — core에는 대응하는 GameEvent가 없다(있어서도 안 된다,
 *      src/core/는 드래그·클릭을 몰라야 한다). ui/가 resolveUi()를 직접 불러 스로틀만 공유해
 *      받는다. (v1.4에서 집기/선택 시작은 무음으로 확정돼 uiPickup 큐 자체가 사라졌다 — 아래
 *      참고.)
 */

/**
 * attack 이벤트 중 소리를 내는 기물 3종. 나머지는 damage가 0이라 발사 자체를 하지 않는다.
 *
 * ⚠️ v1.10에서 'knight'가 빠졌다. 그 큐는 폭발음(blast-knight.ogg)이었는데 폭발 능력이
 * 사라졌다 — 감속은 지속 상태라 울릴 순간이 없다. 큐 종류를 남겨 두면 AUDIO_TUNING·CUE_URL·
 * 테스트가 전부 "언젠가 울릴 소리"를 계속 부양하게 되므로 함께 걷어냈다.
 */
export type AttackCueKind = 'pawn' | 'bishop' | 'rook';

/** core GameEvent(전투 외)·phase 전환에서 나오는 큐. */
export type CoreCueKind =
  | 'enemyDied' | 'bossDied' | 'enemyLeaked' | 'bossSpawn' | 'waveClear' | 'victory' | 'defeat';

/**
 * UI 제스처 전용 큐 — src/core/에는 대응하는 GameEvent가 존재하지 않는다(의도적으로).
 * uiPickup(집기/선택 시작)은 v1.3에 있었으나 v1.4에서 사용자 요청으로 완전히 제거했다 — 게인을
 * 0으로 낮춰 무음화한 게 아니라 큐 자체가 없다(에셋도 삭제, `src/ui/drag.ts` 호출부도 삭제).
 */
export type UiCueKind = 'uiBuy' | 'uiSell' | 'uiPlace' | 'uiInvalid';

export type CueKind = AttackCueKind | CoreCueKind | UiCueKind;

export interface CueTuning {
  /** 이 큐가 다시 재생되기까지 최소 간격(ms). 프레임 내 코일레싱 이후에도 남는 스트림(비동기
   *  쿨다운으로 발사되는 여러 기물)을 억제한다. */
  throttleMs: number;
  /** 믹스 게인(0~1). player.ts가 마스터 게인과 곱해 적용한다. */
  gain: number;
}

/**
 * ============================================================================
 * 튜닝 테이블 — 이 슬라이스의 핵심. 실제 플레이로 들어보고 "이상하다" 싶으면 아래 숫자만 고친다.
 * 코드 변경도, 다른 파일을 뒤질 필요도 없다.
 * ============================================================================
 *
 * - throttleMs: 폰은 ~120ms, 나머지는 ~200ms로 시작 (스펙 지정값). 폰은 공격 간격
 *   (`CONFIG.pieces.pawn.interval` = 0.5s)이 가장 짧고 보드 위 개수에 상한이 없어 가장 자주
 *   겹치므로 더 촘촘히 허용하되, 그래도 초당 1000/120 ≈ 8.3회를 넘는 스트림은 막는다.
 * - gain: 폰은 여러 마리가 동시에 울릴 수 있는 잦은 소리라 믹스에서 가장 낮게, 나이트(블라스트)는
 *   드물고 임팩트가 커야 하므로 가장 높게 잡았다.
 * - maxVoices: 동시 재생 목소리 상한(~8). 넘으면 재생 중인 소리를 끊지 않고 최신 요청만 버린다
 *   (player.ts가 시행).
 * - pitchVariation: 재생마다 playbackRate를 ±5% 무작위로 흔든다. 같은 0.1초 샘플을 초당 2회
 *   그대로 반복하면 기관총처럼 들리는 문제의 표준적인 해법이다 (player.ts가 적용).
 * - masterGain: 전체 믹스 볼륨(0~1). "너무 시끄럽다"는 사용자가 가장 먼저 손댈 값이므로, 이
 *   자리에 마스터 하나로 모아 뒀다 — player.ts는 마스터 게인 노드 뒤에 DynamicsCompressorNode를
 *   하나 더 붙여 안전판으로 삼지만(여러 큐가 피크에서 겹치면 이론상 합이 1을 넘어 destination에서
 *   클리핑할 수 있음), 그건 마지막 방어선이지 볼륨 조절 수단이 아니다 — 소리가 크면 이 값을 낮춘다.
 * - muteRampSeconds: 음소거 토글 시 게인이 이 시간(초) 동안 부드럽게 램프된다. 0에 가까우면(즉시
 *   전환) 재생 중인 소리 한가운데서 계단식으로 끊겨 클릭음이 날 수 있다.
 *
 * 참고 — 1배속/2배속 체감이 균일하지 않다: 스로틀은 벽시계 기준이라, 폰이 스로틀 상한을 채울
 * 만큼 모이면(대략 1배속 5마리, 2배속 3마리 이상) 그 이후로는 폰 레이어가 1배속·2배속에서
 * 사실상 똑같이 들린다(초당 ≈8.3회로 이미 포화). 반면 비숍/룩은 공격 간격이 3초로 훨씬 길어
 * 그 대수에서는 포화되지 않으므로, 2배속에서 실제로 정확히 2배 자주 울린다 — 그래서 후반
 * 웨이브·2배속으로 갈수록 믹스가 비숍/룩 쪽으로 기우는 것이 정상이다. 플레이 중 "왜 갑자기
 * 소리가 달라지지" 싶으면 이 문단을 먼저 의심할 것.
 *
 * v1.3 추가분 (스펙 §10.1):
 * - enemyDied는 새로운 "attack"이다 — 룩 일제사격 한 번에 여러 마리가 죽고, 후반 웨이브는 한
 *   프레임에 수십 마리가 죽는다. pawn과 같은 이유로 throttleMs를 짧게(100ms) 잡고 gain도 낮춘다.
 *   (resolve()의 프레임 내 코일레싱이 "한 프레임에 여러 마리" 쪽은 이미 처리하므로, 이 스로틀은
 *   "연속된 여러 프레임에 걸쳐 죽는" 쪽을 억제한다.)
 * - 그 외(bossDied/enemyLeaked/bossSpawn/waveClear/victory/defeat/uiBuy/uiSell/uiPlace/uiInvalid)는
 *   충분히 드물어 bishop/rook과 같은 기본값(200ms)에서 시작한다 — victory/defeat는 애초에
 *   게임당 정확히 1회만 나오므로 스로틀 값 자체가 사실상 의미 없다.
 *
 * v1.4: uiPickup(집기/선택 시작)을 완전히 제거했다(사용자 요청 — 무음이 맞는 느낌이었다). 그
 * 자리를 대신하던 짧은 select_001 샘플은 이제 uiPlace가 물려받는다(배치/이동/회수 성공음 —
 * 기존 drop_002는 폐기, NOTICE.md 참고). uiPlace의 throttleMs/gain 값 자체는 그대로다.
 */
export const AUDIO_TUNING: {
  cues: Record<CueKind, CueTuning>;
  maxVoices: number;
  pitchVariation: number;
  masterGain: number;
  muteRampSeconds: number;
} = {
  cues: {
    pawn: { throttleMs: 120, gain: 0.35 },
    bishop: { throttleMs: 200, gain: 0.55 },
    rook: { throttleMs: 200, gain: 0.6 },

    enemyDied: { throttleMs: 100, gain: 0.35 },
    bossDied: { throttleMs: 200, gain: 0.7 },
    enemyLeaked: { throttleMs: 200, gain: 0.5 },
    bossSpawn: { throttleMs: 200, gain: 0.75 },
    waveClear: { throttleMs: 200, gain: 0.6 },
    victory: { throttleMs: 200, gain: 0.8 },
    defeat: { throttleMs: 200, gain: 0.8 },

    uiBuy: { throttleMs: 200, gain: 0.4 },
    uiSell: { throttleMs: 200, gain: 0.4 },
    uiPlace: { throttleMs: 200, gain: 0.4 },
    uiInvalid: { throttleMs: 200, gain: 0.45 },
  },
  maxVoices: 8,
  pitchVariation: 0.05,
  masterGain: 0.8,
  muteRampSeconds: 0.05,
};

/**
 * attack 이벤트 → 큐. **Partial이 아니라 전수 Record이고 값에 null을 허용한다.**
 * 예전에는 Partial이라 새 기물을 추가해도 컴파일이 통과했고, 그 기물의 공격은 완전 무음이
 * 됐다 — 침묵으로 실패하는 종류의 구멍이라 테스트도 잡지 못한다. null을 명시하게 하면
 * "소리가 없다"가 누락이 아니라 결정이 된다.
 *
 * knight/queen/amazon이 null인 이유: 셋 다 'attack' 이벤트를 내지 않는다 — damage가 0이고
 * pattern이 'none'이라 발사 루프에서 제외된다. 도달하지 않는 값이지만 명시해 둔다.
 * ★ v1.10부터 나이트에게는 **어떤 소리도 없다**. 폭발음이 능력과 함께 사라졌고, 감속은
 * 지속 상태라 울릴 순간이 없다(아래 enemySlowed 참조).
 */
const ATTACK_CUE_BY_PIECE: Record<PieceType, CueKind | null> = {
  pawn: 'pawn',
  bishop: 'bishop',
  rook: 'rook',
  knight: null,
  queen: null,
  // 융합물은 재료의 주기 공격 소리를 그대로 쓴다 — 새 에셋이 필요 없고, "이 기물은 무엇에서
  // 왔는가"가 소리로도 드러난다. 아마존은 주기 공격이 없어 null이다.
  archbishop: 'bishop',
  chancellor: 'rook',
  amazon: null,
};

/**
 * GameEvent 한 건 → 재생할 큐 종류. 소리를 내지 않는 이벤트는 null.
 *
 * - enemyDied는 isBoss로 갈라진다(bossDied/enemyDied) — 두 큐 모두 존재해야 보스 처치가 일반
 *   처치와 다르게 들린다.
 * - enemyLeaked는 isBoss와 무관하게 항상 같은 큐다(스펙 명시 — 일반/보스 누수를 굳이 나누지
 *   않는다). isBoss 필드가 있지만 여기서는 읽지 않는다.
 * - prepareStarted는 isBossWave일 때만 bossSpawn을 낸다 — 스펙 7.9의 2단계 경고(준비 시작 시
 *   1회 + 실제 스폰 시 1회, 10초 간격) 중 첫 번째. 같은 큐를 재사용하므로 cueForEvent 관점에서는
 *   bossSpawned와 구별되지 않는다(의도적 — 플레이어에게는 "보스온다" 신호가 같은 소리면 충분하다).
 */
function cueForEvent(ev: GameEvent): CueKind | null {
  switch (ev.kind) {
    case 'attack': return ATTACK_CUE_BY_PIECE[ev.pieceType];
    // 골드 획득은 무음 — 언제나 같은 프레임의 attack 이벤트와 짝을 이루므로 이미 그 기물의
    // 공격 소리가 난다. 전용 큐를 주면 비숍이 발사할 때마다 소리가 두 겹으로 겹칠 뿐이다.
    case 'goldGained': return null;
    // ★ 감속 진입은 **무음이다.** 소리를 붙일 수 있는 유일한 순간이지만 붙이지 않는다:
    // 웨이브 하나에 적이 최대 46마리이고 각자 오라를 여러 번 드나들므로, 전이마다 울리면
    // 초당 수 회짜리 잡음이 된다. 배치의 청각 피드백은 uiPlace가 이미 담당하고, 감속이
    // 실제로 걸렸다는 사실은 화면(적에게 붙는 점선 고리 + "−30%")이 말한다.
    case 'enemySlowed': return null;
    // 합성은 무음 — 전용 효과음 에셋이 없고, 합성 성사는 화면(티어 링 교체 + 합성 이펙트)이
    // 이미 분명히 알린다.
    case 'merged': return null;
    // 지급은 구매와 같은 종류의 사건이라 같은 소리를 쓴다. 실패(트레이 만석)는 거부음이다.
    // 지급은 구매와 같은 소리를 쓴다 — 같은 종류의 사건이라서다. 구매 쪽은 UI가 직접
    // playUi('uiBuy')를 부르므로(shop.ts) 여기서 또 울리면 두 겹이 된다.
    case 'pieceSpawned': return ev.bought ? null : 'uiBuy';
    case 'grantDiscarded': return 'uiInvalid';
    // 피격은 무음이다. 한 프레임에 수십 번 발행될 수 있으므로 소리를 붙이면 그대로 잡음이고,
    // 발사음(attack)이 이미 같은 프레임에 울린다 — 피격은 그 발사의 결과이지 별개 사건이 아니다.
    case 'enemyHit': return null;
    case 'enemyDied': return ev.isBoss ? 'bossDied' : 'enemyDied';
    // 분열은 무음이다. 같은 프레임에 enemyDied가 이미 울리므로 전용 큐를 주면 처치음과
    // 두 겹으로 겹치고, 분열은 "죽었다"의 결과이지 별개의 사건이 아니다. 갈라졌다는 사실은
    // 화면(부모 자리의 분열 이펙트 + 새로 나타난 적 둘)이 말한다.
    case 'enemySplit': return null;
    case 'enemyLeaked': return 'enemyLeaked';
    case 'bossSpawned': return 'bossSpawn';
    case 'waveCleared': return 'waveClear';
    case 'prepareStarted': return ev.isBossWave ? 'bossSpawn' : null;
  }
}

/**
 * 이번 프레임에 실제로 재생할 큐를 결정한다. 두 가지 방어를 여기서 시행한다:
 *   1) 프레임 내 코일레싱 — 같은 큐가 여러 번 나와도 한 번만 (Set으로 중복 제거)
 *   2) 큐별 최소 간격 스로틀 — 큐 종류마다 독립적인 시각을 기억해 두고 그보다 이르면 버린다
 * 세 번째 방어(보이스 상한)는 실제 재생 타이밍/개수를 다루는 player.ts의 몫이다.
 *
 * 시계는 반드시 인자로 주입한다(performance.now()를 이 파일 안에서 직접 부르지 않는다) — 그래야
 * 테스트가 실제 시계나 setTimeout 없이 시간을 결정론적으로 움직일 수 있다.
 */
export class CueResolver {
  private lastPlayedAt = new Map<CueKind, number>();
  /** victory/defeat 전환 감지용. null = 아직 한 번도 resolve()가 불리지 않음. */
  private previousPhase: Phase | null = null;

  /**
   * phase는 GameEvent가 아니라 상태값이므로 별도 인자로 받는다 — victory/defeat는 "그 순간에
   * 발생한 이벤트"가 아니라 "그 프레임 이후로 계속 유지되는 상태"라서, 매 프레임 같은 phase를
   * 다시 넘겨받아도(게임이 멈춘 뒤 main.ts의 requestAnimationFrame은 영원히 계속 돈다) 최초
   * 전환 프레임에서만 정확히 1회 큐를 낸다.
   */
  resolve(events: readonly GameEvent[], now: number, paused: boolean, phase: Phase): CueKind[] {
    const out: CueKind[] = [];

    // phase 전환 감지는 paused와 무관하게 항상 수행한다 — victory/defeat는 UI 일시정지 여부와
    // 상관없이 "정확히 한 번" 울려야 하는 종단 상태 전환이지, 매 프레임 재생/억제를 오가는
    // 스트림이 아니다. (실전에서는 stepGame이 paused 중 phase를 바꾸지 않으므로 이 독립성이
    // 관측되는 경우는 없지만, paused 게이팅에 우연히 얽히지 않도록 명시적으로 분리해 둔다.)
    if (phase !== this.previousPhase) {
      this.previousPhase = phase;
      if (phase === 'victory') out.push('victory');
      else if (phase === 'defeat') out.push('defeat');
    }

    // 일시정지 중에는 이벤트 경로에서는 아무것도 재생하지 않는다. stepGame이 paused면 일찍
    // 반환해 attack 이벤트 자체가 생기지 않으므로 사실상 이 분기에 도달할 events는 비어
    // 있겠지만, 의도를 코드로 명시하고 호출부 실수(예: 이벤트 배열을 스킵 없이 그대로 넘기는
    // 변경)에도 방어하기 위해 명시적으로 게이팅한다. 스로틀 상태도 건드리지 않는다 — 일시정지가
    // 스로틀 타이머를 소모시키면 재개 직후 정상적으로 울려야 할 소리까지 억제될 수 있다.
    if (paused) return out;

    const present = new Set<CueKind>();
    for (const ev of events) {
      const cue = cueForEvent(ev);
      if (cue) present.add(cue);
    }

    for (const cue of present) {
      const last = this.lastPlayedAt.get(cue);
      const throttleMs = AUDIO_TUNING.cues[cue].throttleMs;
      if (last !== undefined && now - last < throttleMs) continue;
      this.lastPlayedAt.set(cue, now);
      out.push(cue);
    }
    return out;
  }

  /**
   * UI 제스처(구매/판매/배치/거부) 전용 진입점 — 대응하는 GameEvent가 없으므로 resolve()의
   * events 배열을 거치지 않는다. 프레임 내 코일레싱은 애초에 필요 없다(제스처 1건 = 호출 1건),
   * 하지만 큐별 최소 간격 스로틀은 resolve()와 동일하게 필요하다(예: 상점 버튼 연타) —
   * resolve()와 같은 lastPlayedAt 맵을 공유해 큐 종류별 스로틀 상태를 하나로 유지한다(UI 큐
   * 이름은 core 큐와 겹치지 않으므로 충돌하지 않는다).
   */
  resolveUi(cue: UiCueKind, now: number): CueKind | null {
    const last = this.lastPlayedAt.get(cue);
    const throttleMs = AUDIO_TUNING.cues[cue].throttleMs;
    if (last !== undefined && now - last < throttleMs) return null;
    this.lastPlayedAt.set(cue, now);
    return cue;
  }
}
