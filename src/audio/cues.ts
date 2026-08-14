import type { GameEvent, PieceType } from '../types';

/**
 * "무엇을 재생할지 결정"하는 정책 계층 — DOM-free, Web Audio 미접촉. render/highlights.ts가
 * render/renderer.ts(부수효과)에서 분리돼 순수하게 테스트 가능한 것과 같은 이유로 분리했다.
 * src/render/·src/ui/를 import하지 않는다 — 이 파일만 봐도 "무엇이 울리는가"를 전부 검증할 수 있다.
 *
 * 실제 재생(AudioContext/디코딩/보이스 관리)은 src/audio/player.ts가 맡는다.
 */

/** attack 이벤트 중 소리를 내는 기물 3종 + knightBlast. 퀸은 공격하지 않으므로(damage=0) 대상이 아니다. */
export type CueKind = 'pawn' | 'bishop' | 'rook' | 'knight';

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
    knight: { throttleMs: 200, gain: 0.8 },
  },
  maxVoices: 8,
  pitchVariation: 0.05,
  masterGain: 0.8,
  muteRampSeconds: 0.05,
};

const ATTACK_CUE_BY_PIECE: Partial<Record<PieceType, CueKind>> = {
  pawn: 'pawn',
  bishop: 'bishop',
  rook: 'rook',
  // knight/queen은 'attack' 이벤트를 발생시키지 않는다(combat.ts: knight는 별도 knightBlast로
  // 처리되고, queen은 damage===0이라 애초에 건너뛴다) — 매핑을 넣어도 도달하지 않지만, 넣지
  // 않음으로써 "attack 이벤트로는 오지 않는 타입"이라는 사실을 이 표 자체가 드러내게 둔다.
};

/** GameEvent 한 건 → 재생할 큐 종류. 소리를 내지 않는 이벤트는 null. */
function cueForEvent(ev: GameEvent): CueKind | null {
  if (ev.kind === 'attack') return ATTACK_CUE_BY_PIECE[ev.pieceType] ?? null;
  if (ev.kind === 'knightBlast') return 'knight';
  return null;
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

  resolve(events: readonly GameEvent[], now: number, paused: boolean): CueKind[] {
    // 일시정지 중에는 아무것도 재생하지 않는다. stepGame이 paused면 일찍 반환해 attack 이벤트
    // 자체가 생기지 않으므로 사실상 이 분기에 도달할 events는 비어 있겠지만, 의도를 코드로
    // 명시하고 호출부 실수(예: 이벤트 배열을 스킵 없이 그대로 넘기는 변경)에도 방어하기 위해
    // 명시적으로 게이팅한다. 스로틀 상태도 건드리지 않는다 — 일시정지가 스로틀 타이머를
    // 소모시키면 재개 직후 정상적으로 울려야 할 소리까지 억제될 수 있다.
    if (paused) return [];

    const present = new Set<CueKind>();
    for (const ev of events) {
      const cue = cueForEvent(ev);
      if (cue) present.add(cue);
    }

    const out: CueKind[] = [];
    for (const cue of present) {
      const last = this.lastPlayedAt.get(cue);
      const throttleMs = AUDIO_TUNING.cues[cue].throttleMs;
      if (last !== undefined && now - last < throttleMs) continue;
      this.lastPlayedAt.set(cue, now);
      out.push(cue);
    }
    return out;
  }
}
