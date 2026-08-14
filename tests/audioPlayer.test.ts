import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUDIO_TUNING } from '../src/audio/cues';
import { AudioPlayer } from '../src/audio/player';

// player.ts는 실제 브라우저(AudioContext/fetch/decodeAudioData)에 의존한다. 이 스위트는 이
// 파일의 기본 환경(vitest-environment 주석 없음 = node)에서 두 가지를 검증한다:
//   1) AudioContext가 아예 없는 환경(이 파일 상단부)에서 조용히 no-op하는지
//   2) globalThis.AudioContext에 최소한의 가짜 구현을 꽂아 넣었을 때, 보이스 상한·피치
//      변주·음소거·자동재생 재개·디코드 실패 로깅이 계약대로 동작하는지
// sprites.ts가 실제 SVG 래스터화를 검증할 수 없어 setSpriteForTest seam으로 drawImage 호출만
// 검증하듯, 여기서도 setBufferForTest seam으로 fetch+decodeAudioData 경로를 우회해 재생 로직만
// 검증한다 — "소리가 실제로 좋게 들리는가"는 헤드리스로도 이 스위트로도 확인할 수 없다.

class FakeGainNode {
  gain = { value: 1 };
  connect(): void {}
}

class FakeBufferSourceNode {
  buffer: unknown = null;
  playbackRate = { value: 1 };
  onended: (() => void) | null = null;
  started = false;
  connect(): void {}
  start(): void {
    this.started = true;
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  destination = {};
  state: 'running' | 'suspended' = 'running';
  resumeCalls = 0;
  createdSources: FakeBufferSourceNode[] = [];
  createdGains: FakeGainNode[] = [];

  constructor() {
    FakeAudioContext.instances.push(this);
  }
  createGain(): FakeGainNode {
    const g = new FakeGainNode();
    this.createdGains.push(g);
    return g;
  }
  createBufferSource(): FakeBufferSourceNode {
    const s = new FakeBufferSourceNode();
    this.createdSources.push(s);
    return s;
  }
  decodeAudioData(): Promise<unknown> {
    return Promise.resolve({});
  }
  resume(): Promise<void> {
    this.resumeCalls++;
    this.state = 'running';
    return Promise.resolve();
  }
}

function installFakeAudioContext(): void {
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
}
function uninstallFakeAudioContext(): void {
  delete (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
  FakeAudioContext.instances = [];
}
const flushMicrotasks = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

describe('AudioPlayer — AudioContext가 없는 환경(이 파일의 기본 node 환경)', () => {
  it('전제: 이 환경에는 AudioContext가 없다', () => {
    expect(typeof AudioContext).toBe('undefined');
  });

  it('play/resumeOnGesture/setMuted 모두 예외 없이 조용히 아무 일도 하지 않는다', () => {
    const player = new AudioPlayer();
    expect(() => player.play('pawn')).not.toThrow();
    expect(() => player.resumeOnGesture()).not.toThrow();
    expect(() => player.setMuted(true)).not.toThrow();
    // muted 플래그 자체는 AudioContext 유무와 무관하게(순수 상태로) 계속 추적된다.
    expect(player.isMuted()).toBe(true);
  });
});

describe('AudioPlayer — 보이스 상한 (스펙 3번째 방어, player.ts가 시행)', () => {
  afterEach(uninstallFakeAudioContext);

  it('상한을 넘는 요청은 최신 쪽을 버리고, 만들어진 목소리는 모두 끊기지 않고 시작된다', () => {
    installFakeAudioContext();
    const player = new AudioPlayer();
    player.setBufferForTest('pawn', {} as AudioBuffer);

    for (let i = 0; i < AUDIO_TUNING.maxVoices + 3; i++) player.play('pawn');

    const ctx = FakeAudioContext.instances[0];
    expect(ctx.createdSources).toHaveLength(AUDIO_TUNING.maxVoices);
    expect(ctx.createdSources.every(s => s.started)).toBe(true);
  });

  it('목소리 하나가 종료되면(onended) 자리가 하나 다시 열린다', () => {
    installFakeAudioContext();
    const player = new AudioPlayer();
    player.setBufferForTest('pawn', {} as AudioBuffer);

    for (let i = 0; i < AUDIO_TUNING.maxVoices; i++) player.play('pawn');
    const ctx = FakeAudioContext.instances[0];
    expect(ctx.createdSources).toHaveLength(AUDIO_TUNING.maxVoices);

    ctx.createdSources[0].onended?.();   // 자연 종료
    player.play('pawn');
    expect(ctx.createdSources).toHaveLength(AUDIO_TUNING.maxVoices + 1);
  });
});

describe('AudioPlayer — 피치 변주 (디튠)', () => {
  afterEach(uninstallFakeAudioContext);

  it('재생마다 playbackRate가 AUDIO_TUNING.pitchVariation 범위 안에서 흔들린다', () => {
    installFakeAudioContext();
    const player = new AudioPlayer();
    player.setBufferForTest('knight', {} as AudioBuffer);

    for (let i = 0; i < AUDIO_TUNING.maxVoices; i++) player.play('knight');

    const ctx = FakeAudioContext.instances[0];
    expect(ctx.createdSources.length).toBeGreaterThan(0);
    const v = AUDIO_TUNING.pitchVariation;
    for (const s of ctx.createdSources) {
      expect(s.playbackRate.value).toBeGreaterThanOrEqual(1 - v);
      expect(s.playbackRate.value).toBeLessThanOrEqual(1 + v);
    }
  });
});

describe('AudioPlayer — 음소거 (마스터 게인)', () => {
  afterEach(uninstallFakeAudioContext);

  it('마스터 게인 노드(컨텍스트당 최초 createGain)가 음소거 상태를 반영한다', () => {
    installFakeAudioContext();
    const player = new AudioPlayer();
    player.setBufferForTest('pawn', {} as AudioBuffer);

    player.setMuted(true);   // 컨텍스트 생성 전 음소거 — 생성 시점 초기값에 반영돼야 한다
    player.play('pawn');     // 여기서 ensureContext()가 처음 컨텍스트/마스터 게인을 만든다

    const ctx = FakeAudioContext.instances[0];
    const master = ctx.createdGains[0];
    expect(master.gain.value).toBe(0);

    player.setMuted(false);
    expect(master.gain.value).toBe(1);
  });
});

describe('AudioPlayer — resumeOnGesture (자동재생 정책 대응)', () => {
  afterEach(uninstallFakeAudioContext);

  it('컨텍스트가 suspended일 때만 resume()을 호출한다', () => {
    installFakeAudioContext();
    const player = new AudioPlayer();

    player.resumeOnGesture();   // 최초 호출 — 컨텍스트를 만든다 (state: running으로 시작)
    const ctx = FakeAudioContext.instances[0];
    expect(ctx.resumeCalls).toBe(0);

    ctx.state = 'suspended';
    player.resumeOnGesture();
    expect(ctx.resumeCalls).toBe(1);
  });
});

describe('AudioPlayer — 디코드 실패', () => {
  afterEach(uninstallFakeAudioContext);

  it('fetch가 실패해도 던지지 않고, 같은 큐에 대해서는 최초 1회만 콘솔에 로그한다', async () => {
    installFakeAudioContext();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new Error('network down'))) as typeof fetch;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const player = new AudioPlayer();
      expect(() => player.play('rook')).not.toThrow();
      await flushMicrotasks();
      expect(() => player.play('rook')).not.toThrow();
      await flushMicrotasks();

      expect(errorSpy).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
      globalThis.fetch = originalFetch;
    }
  });
});
