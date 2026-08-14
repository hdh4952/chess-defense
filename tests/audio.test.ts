import { describe, expect, it, vi } from 'vitest';
import { AudioController, type CuePlayer } from '../src/audio';
import { AUDIO_TUNING, CueResolver, type CueKind } from '../src/audio/cues';
import type { GameEvent, Phase, Square } from '../src/types';

const WAVE: Phase = 'wave';

// AudioController(src/audio/index.ts)는 cues.ts(정책)와 player.ts(재생)를 잇는 얇은 이음매다 —
// 여기서는 실제 AudioPlayer 대신 CuePlayer 인터페이스를 만족하는 스텁을 주입해, "이음매가 제대로
// 잇는가"만 Web Audio 없이 검증한다.

function makeStubPlayer(): CuePlayer & { played: CueKind[] } {
  return {
    played: [],
    play(cue) {
      this.played.push(cue);
    },
    resumeOnGesture: vi.fn(),
    setMuted: vi.fn(),
    isMuted: vi.fn(() => false),
  };
}

const SQ: Square = { file: 0, rank: 0 };
const pawnAttack: GameEvent = { kind: 'attack', pieceType: 'pawn', from: SQ, targets: [SQ] };

describe('AudioController.onFrame — cues.ts와 player.ts를 잇는 이음매', () => {
  it('resolve된 큐마다 player.play를 호출한다', () => {
    const player = makeStubPlayer();
    const controller = new AudioController(new CueResolver(), player);

    controller.onFrame([pawnAttack], 0, false, WAVE);

    expect(player.played).toEqual(['pawn']);
  });

  it('paused=true면 player.play를 전혀 호출하지 않는다', () => {
    const player = makeStubPlayer();
    const controller = new AudioController(new CueResolver(), player);

    controller.onFrame([pawnAttack], 0, true, WAVE);

    expect(player.played).toEqual([]);
  });

  it('phase가 victory로 전환되면(이벤트가 없어도) player.play가 victory로 호출된다', () => {
    const player = makeStubPlayer();
    const controller = new AudioController(new CueResolver(), player);

    controller.onFrame([], 0, false, 'prepare');
    controller.onFrame([], 100, false, 'victory');
    controller.onFrame([], 200, false, 'victory');   // 같은 terminal phase 반복 — 재생 없음

    expect(player.played).toEqual(['victory']);
  });

  it('playUi(cue, now)는 스로틀을 통과하면 player.play를 그 큐로 호출한다', () => {
    const player = makeStubPlayer();
    const controller = new AudioController(new CueResolver(), player);

    controller.playUi('uiBuy', 0);

    expect(player.played).toEqual(['uiBuy']);
  });

  it('playUi는 큐별 스로틀 윈도우 안의 재호출을 무시한다', () => {
    const player = makeStubPlayer();
    const controller = new AudioController(new CueResolver(), player);
    const throttleMs = AUDIO_TUNING.cues.uiInvalid.throttleMs;

    controller.playUi('uiInvalid', 0);
    controller.playUi('uiInvalid', throttleMs - 1);   // 윈도우 안 — 무시
    controller.playUi('uiInvalid', throttleMs);       // 윈도우 통과 — 재생

    expect(player.played).toEqual(['uiInvalid', 'uiInvalid']);
  });

  it('unlock()은 player.resumeOnGesture()를 호출한다 (자동재생 정책 대응 배선)', () => {
    const player = makeStubPlayer();
    const controller = new AudioController(new CueResolver(), player);

    controller.unlock();

    expect(player.resumeOnGesture).toHaveBeenCalledTimes(1);
  });

  it('setMuted/isMuted는 player에 그대로 위임된다', () => {
    const player = makeStubPlayer();
    const controller = new AudioController(new CueResolver(), player);

    controller.setMuted(true);
    controller.isMuted();

    expect(player.setMuted).toHaveBeenCalledWith(true);
    expect(player.isMuted).toHaveBeenCalledTimes(1);
  });
});
