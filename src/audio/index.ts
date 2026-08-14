import type { GameEvent } from '../types';
import { CueResolver, type CueKind } from './cues';
import { AudioPlayer } from './player';

/** 재생만 필요로 하는 좁은 인터페이스 — 테스트에서 AudioPlayer 대신 스텁을 주입할 수 있게 한다. */
export interface CuePlayer {
  play(cue: CueKind): void;
  resumeOnGesture(): void;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
}

/** "무엇을 재생할지 결정"(cues.ts, DOM-free)과 "실제로 재생"(player.ts, Web Audio)을 잇는 얇은
 *  이음매. main.ts가 필요로 하는 것만 노출한다 — buildHighlights/render를 main.ts가 직접 잇는
 *  것과 같은 구조. */
export class AudioController {
  constructor(
    private readonly resolver: CueResolver = new CueResolver(),
    private readonly player: CuePlayer = new AudioPlayer(),
  ) {}

  /** main.ts의 frame() 루프에서 매 프레임 1회 호출한다. events는 여기서 비우지 않는다 —
   *  main.ts가 모든 소비자(banners/fx/audio)를 다 돌린 뒤 한 번만 비운다. */
  onFrame(events: readonly GameEvent[], now: number, paused: boolean): void {
    for (const cue of this.resolver.resolve(events, now, paused)) {
      this.player.play(cue);
    }
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
