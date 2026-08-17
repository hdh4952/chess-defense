import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUDIO_TUNING } from '../src/audio/cues';
import { AudioPlayer } from '../src/audio/player';

// player.ts는 실제 브라우저(AudioContext/fetch/decodeAudioData)에 의존한다. 이 스위트는 이
// 파일의 기본 환경(vitest-environment 주석 없음 = node)에서 두 가지를 검증한다:
//   1) AudioContext가 아예 없는 환경(이 파일 상단부)에서 조용히 no-op하는지
//   2) globalThis.AudioContext에 최소한의 가짜 구현을 꽂아 넣었을 때, 보이스 상한·피치
//      변주·음소거·자동재생 재개·디코드 실패 처리가 계약대로 동작하는지
// sprites.ts가 실제 SVG 래스터화를 검증할 수 없어 setSpriteForTest seam으로 drawImage 호출만
// 검증하듯, 여기서도 setBufferForTest seam으로 fetch+decodeAudioData 경로를 우회해 재생 로직만
// 검증한다 — "소리가 실제로 좋게 들리는가"는 헤드리스로도 이 스위트로도 확인할 수 없다.
//
// suspended 컨텍스트에서의 목소리 버스트(리뷰 Important 2)는 이 스위트의 페이크로도 재현되지만,
// 실제 Web Audio 엔진(headless Chrome)으로도 별도 재현해 확인했다 — 보고서 참고.

class FakeGainNode {
  gain = {
    value: 1,
    // 실제 AudioParam의 지수 램프를 흉내 낼 필요는 없다 — "결국 목표값에 도달했는가"만
    // 검증하면 되므로, 페이크에서는 즉시 반영한다.
    setTargetAtTime(target: number): void {
      this.value = target;
    },
  };
  connect(): void {}
  disconnect(): void {}
}

class FakeBufferSourceNode {
  buffer: unknown = null;
  playbackRate = { value: 1 };
  onended: (() => void) | null = null;
  started = false;
  connect(): void {}
  disconnect(): void {}
  start(): void {
    this.started = true;
  }
}

class FakeCompressorNode {
  connect(): void {}
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  destination = {};
  state: 'running' | 'suspended' = 'running';
  currentTime = 0;
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
  createDynamicsCompressor(): FakeCompressorNode {
    return new FakeCompressorNode();
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

describe('AudioPlayer — 보이스 상한 (3번째 방어, player.ts가 시행)', () => {
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

  it('v1.3에서 추가된 UI 큐(uiInvalid)도 동일한 보이스 상한을 따른다 — 4종 attack 큐 전용이 아니다', () => {
    installFakeAudioContext();
    const player = new AudioPlayer();
    player.setBufferForTest('uiInvalid', {} as AudioBuffer);

    for (let i = 0; i < AUDIO_TUNING.maxVoices + 3; i++) player.play('uiInvalid');

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

describe('AudioPlayer — suspended 컨텍스트에서는 목소리를 시작하지 않는다 (리뷰 Important 2)', () => {
  afterEach(uninstallFakeAudioContext);

  it('suspended 동안의 play()는 소스를 전혀 만들지 않는다 (목소리 상한이 소진되지 않는다)', () => {
    installFakeAudioContext();
    const player = new AudioPlayer();
    player.setBufferForTest('pawn', {} as AudioBuffer);

    player.resumeOnGesture();                  // 컨텍스트 생성 (running으로 시작)
    const ctx = FakeAudioContext.instances[0];
    ctx.state = 'suspended';                    // 브라우저가 다시 정지시킨 상황(백그라운딩 등)을 흉내

    for (let i = 0; i < AUDIO_TUNING.maxVoices + 2; i++) player.play('pawn');

    // 가드가 없으면 여기서 maxVoices개의 소스가 start()된 채 쌓여(onended는 결코 안 옴) 상한이
    // 영구히 소진된다 — 가드가 있으면 애초에 하나도 만들어지지 않는다.
    expect(ctx.createdSources).toHaveLength(0);
  });

  it('suspended 동안 쌓인 요청 없이, resume 이후에는 정상적으로 다시 재생된다 (버스트 없음)', () => {
    installFakeAudioContext();
    const player = new AudioPlayer();
    player.setBufferForTest('pawn', {} as AudioBuffer);

    player.resumeOnGesture();
    const ctx = FakeAudioContext.instances[0];
    ctx.state = 'suspended';
    for (let i = 0; i < AUDIO_TUNING.maxVoices + 2; i++) player.play('pawn'); // 전부 버려짐
    expect(ctx.createdSources).toHaveLength(0);

    ctx.state = 'running';                      // resume() 완료 상황을 흉내
    player.play('pawn');
    // suspended 동안의 요청이 큐잉돼 있다가 한꺼번에 터지는 게 아니라, resume 이후 새로 들어온
    // 요청 1건만큼만 재생된다.
    expect(ctx.createdSources).toHaveLength(1);
  });
});

describe('AudioPlayer — 피치 변주 (디튠)', () => {
  afterEach(uninstallFakeAudioContext);

  // 이 케이스는 원래 'knight'(폭발음)로 쟀다. v1.10에서 폭발이 감속 오라로 바뀌며 그 큐가
  // 사라졌지만, 이 테스트가 지키는 불변식은 "어느 큐인가"가 아니라 "어떤 큐든 재생마다 디튠이
  // 걸린다"이므로 같은 attack 계열의 bishop으로 바꿔 그대로 유지한다. (앞의 보이스 상한 케이스가
  // pawn·uiInvalid를 쓰므로, 여기서 bishop을 쓰면 세 계열이 골고루 이 스위트를 지난다.)
  it('재생마다 playbackRate가 AUDIO_TUNING.pitchVariation 범위 안에서 흔들린다', () => {
    installFakeAudioContext();
    const player = new AudioPlayer();
    player.setBufferForTest('bishop', {} as AudioBuffer);

    for (let i = 0; i < AUDIO_TUNING.maxVoices; i++) player.play('bishop');

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
    expect(master.gain.value).toBe(AUDIO_TUNING.masterGain);
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

describe('AudioPlayer — 디코드 실패 (리뷰 Important 1: 재시도 래치)', () => {
  afterEach(uninstallFakeAudioContext);

  it('fetch가 실패해도 던지지 않고, 같은 큐에 대해서는 최초 1회만 콘솔에 로그한다', async () => {
    installFakeAudioContext();
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (() => { fetchCalls++; return Promise.reject(new Error('network down')); }) as typeof fetch;
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

  it('실패가 확정된 뒤에는 다시 fetch를 시도하지 않는다 — 스로틀만으로 제한되는 재시도 스톰 방지', async () => {
    installFakeAudioContext();
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (() => { fetchCalls++; return Promise.reject(new Error('network down')); }) as typeof fetch;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const player = new AudioPlayer();
      player.play('rook');
      await flushMicrotasks();
      expect(fetchCalls).toBe(1);        // 최초 1회는 실제로 시도한다

      // 실패가 확정된 뒤 여러 번 더 play()해도(예: 초당 몇 회씩, 세션 내내) fetch가 다시
      // 일어나지 않는다 — 이게 없으면 구형 Safari의 OGG 미지원이나 404 배포 오류에서 스로틀
      // 상한(초당 최대 몇 회)만큼 fetch+decodeAudioData가 세션 내내 반복된다.
      for (let i = 0; i < 20; i++) player.play('rook');
      await flushMicrotasks();

      expect(fetchCalls).toBe(1);
    } finally {
      errorSpy.mockRestore();
      globalThis.fetch = originalFetch;
    }
  });
});
