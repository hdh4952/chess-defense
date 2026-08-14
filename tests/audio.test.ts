import { describe, expect, it, vi } from 'vitest';
import { AudioController, type CuePlayer } from '../src/audio';
import { CueResolver, type CueKind } from '../src/audio/cues';
import type { GameEvent, Square } from '../src/types';

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

    controller.onFrame([pawnAttack], 0, false);

    expect(player.played).toEqual(['pawn']);
  });

  it('paused=true면 player.play를 전혀 호출하지 않는다', () => {
    const player = makeStubPlayer();
    const controller = new AudioController(new CueResolver(), player);

    controller.onFrame([pawnAttack], 0, true);

    expect(player.played).toEqual([]);
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
