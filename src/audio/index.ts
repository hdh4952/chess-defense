import type { GameEvent, Phase } from '../types';
import { CueResolver, type CueKind, type UiCueKind } from './cues';
import { AudioPlayer } from './player';

/** 재생만 필요로 하는 좁은 인터페이스 — 테스트에서 AudioPlayer 대신 스텁을 주입할 수 있게 한다. */
export interface CuePlayer {
  play(cue: CueKind): void;
  resumeOnGesture(): void;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
}

/** UI 제스처(구매/판매/배치/집기/거부)만 필요로 하는 좁은 인터페이스 — src/ui/의 각 파일이 이걸로
 *  AudioController를 참조한다(구체 클래스에 묶이지 않는다). controls.ts의 MuteControllable과
 *  같은 목적의 구조적 타입이다. */
export interface UiAudio {
  playUi(cue: UiCueKind, now: number): void;
}

/** "무엇을 재생할지 결정"(cues.ts, DOM-free)과 "실제로 재생"(player.ts, Web Audio)을 잇는 얇은
 *  이음매. main.ts가 필요로 하는 것만 노출한다 — buildHighlights/render를 main.ts가 직접 잇는
 *  것과 같은 구조. */
export class AudioController implements UiAudio {
  constructor(
    private readonly resolver: CueResolver = new CueResolver(),
    private readonly player: CuePlayer = new AudioPlayer(),
  ) {}

  /** main.ts의 frame() 루프에서 매 프레임 1회 호출한다. events는 여기서 비우지 않는다 —
   *  main.ts가 모든 소비자(banners/fx/audio)를 다 돌린 뒤 한 번만 비운다. phase는 victory/defeat
   *  전환 감지(cues.ts CueResolver.resolve 참고)를 위해 매 프레임 그대로 전달한다. */
  onFrame(events: readonly GameEvent[], now: number, paused: boolean, phase: Phase): void {
    for (const cue of this.resolver.resolve(events, now, paused, phase)) {
      this.player.play(cue);
    }
  }

  /** src/ui/의 드래그·상점 등에서 제스처가 "성공/거부"로 확정되는 그 지점에 직접 호출한다 —
   *  대응하는 GameEvent가 없다(core는 UI 제스처를 모른다). now는 호출부(ui/)가 performance.now()로
   *  직접 넘긴다 — cues.ts는 여전히 시계를 자체 호출하지 않는다. */
  playUi(cue: UiCueKind, now: number): void {
    const resolved = this.resolver.resolveUi(cue, now);
    if (resolved) this.player.play(resolved);
  }

  /** 첫 사용자 제스처(pointerdown)에서 호출 — 자동재생 정책 대응 (player.ts 참고). */
  unlock(): void {
    this.player.resumeOnGesture();
  }

  setMuted(muted: boolean): void {
    this.player.setMuted(muted);
  }

  isMuted(): boolean {
    return this.player.isMuted();
  }
}

export function createAudioController(): AudioController {
  return new AudioController();
}
