import { AUDIO_TUNING, type CueKind } from './cues';

import firePawnUrl from '../assets/sounds/fire-pawn.ogg';
import fireBishopUrl from '../assets/sounds/fire-bishop.ogg';
import fireRookUrl from '../assets/sounds/fire-rook.ogg';
import blastKnightUrl from '../assets/sounds/blast-knight.ogg';

/**
 * Web Audio 래퍼 — "소리를 실제로 낸다"만 담당한다(무엇을 낼지는 cues.ts가 결정). DOM/브라우저
 * API에 의존하므로 src/render/sprites.ts와 같은 이유로 src/audio/(core 밖)에 둔다.
 *
 * Kenney CC0 에셋 4종 (출처·원본 파일명은 NOTICE.md). 에셋 자체는 변경하지 않는다.
 */
const CUE_URL: Record<CueKind, string> = {
  pawn: firePawnUrl,
  bishop: fireBishopUrl,
  rook: fireRookUrl,
  knight: blastKnightUrl,
};

type AudioContextCtor = new () => AudioContext;

/** Node(테스트 기본 환경)와 구형 브라우저에는 AudioContext가 없다 — sprites.ts의
 *  `browserAvailable` 가드와 같은 스타일로, typeof 체크만으로 존재 여부를 판단한다
 *  (미선언 전역을 typeof로 검사하는 것은 ReferenceError를 던지지 않는다). webkit 접두사
 *  버전(구형 Safari)도 함께 본다. */
function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof AudioContext !== 'undefined') return AudioContext;
  const w = globalThis as unknown as { webkitAudioContext?: AudioContextCtor };
  if (typeof w.webkitAudioContext !== 'undefined') return w.webkitAudioContext;
  return null;
}

export class AudioPlayer {
  private readonly ctorAvailable = getAudioContextCtor() !== null;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;

  private buffers = new Map<CueKind, AudioBuffer>();
  private pending = new Map<CueKind, Promise<AudioBuffer | null>>();
  private failedLogged = new Set<CueKind>();

  private activeVoices = 0;

  /** AudioContext를 (필요하면) 만들고 돌려준다. 브라우저에 생성자가 없으면 null. */
  private ensureContext(): AudioContext | null {
    if (!this.ctorAvailable) return null;
    if (!this.ctx) {
      const Ctor = getAudioContextCtor()!;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : AUDIO_TUNING.masterGain;
      // 마스터 게인 뒤에 컴프레서를 하나 둔다 — 여러 큐가 피크에서 우연히 겹치면(폰은 서로
      // 안 겹치지만 폰+비숍+룩+나이트가 동시에 울리는 경우는 있다) 합산 게인이 1을 넘어
      // destination에서 하드클립될 수 있어, 톤을 바꾸려는 목적이 아니라 순수히 그 상황의
      // 안전판으로 넣었다. Web Audio 기본값(threshold -24dB, knee 30, ratio 12, attack 3ms,
      // release 250ms)을 그대로 쓴다 — 리미터로만 쓰기에 충분하고 값을 따로 튜닝할 이유가 없다.
      const compressor = this.ctx.createDynamicsCompressor();
      this.master.connect(compressor);
      compressor.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  /**
   * 자동재생 정책 대응 — 브라우저는 사용자 제스처 전에는 오디오 재생을 막는다. main.ts가 첫
   * pointerdown(드래그 시작 제스처, 게임이 자연히 갖고 있는 제스처)에서 이 메서드를 부른다.
   * AudioContext 생성 자체를 여기서 트리거하고, 이미 있는데 suspended면 resume한다.
   * 이 호출 없이도 게임은 조용히 그냥 동작한다 — 에러 없는 침묵이 이 슬라이스의 가장 흔한
   * 실패 모드이므로, 여러 번 불러도 안전하게(idempotent) 만들어 뒀다.
   */
  resumeOnGesture(): void {
    const ctx = this.ensureContext();
    if (ctx && ctx.state === 'suspended') {
      // resume()은 reject될 수 있다(예: 일부 브라우저의 정책 위반) — 실패해도 재생이 조용히
      // 안 되는 것 이상의 문제는 없으므로(startVoice의 ctx.state 가드가 이미 그 상황을 흡수한다),
      // 여기서는 unhandled rejection만 막는다.
      void ctx.resume().catch(() => {});
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) {
      const target = muted ? 0 : AUDIO_TUNING.masterGain;
      // .value에 바로 대입하면 재생 중인 소리 한가운데서 계단식으로 끊겨 클릭음이 난다.
      // setTargetAtTime으로 짧게 램프해 부드럽게 전환한다(AUDIO_TUNING.muteRampSeconds).
      this.master.gain.setTargetAtTime(target, this.ctx.currentTime, AUDIO_TUNING.muteRampSeconds);
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  /** 큐 하나 재생 시도. 컨텍스트가 없거나(비브라우저) 디코드에 실패했으면 조용히 아무 일도 하지 않는다. */
  play(cue: CueKind): void {
    if (!this.ctorAvailable) return;
    // 이 큐는 이미 디코드 실패가 확정됐다 — 다시 fetch/decode를 시도하지 않는다. 이 가드가
    // 없으면 pending 맵 항목이 실패할 때마다(.finally에서) 지워져, 다음 play() 호출이 매번
    // 새 fetch+decodeAudioData를 다시 시작한다. 실패가 영구적이면(예: 구형 Safari의 OGG 미지원,
    // 배포 경로 오류로 인한 404) 스로틀만으로 제한되는 무한 재시도 스톰이 된다 — failedLogged가
    // "로그는 한 번만"뿐 아니라 "시도도 한 번만"의 래치 역할을 겸한다.
    if (this.failedLogged.has(cue)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;

    const cached = this.buffers.get(cue);
    if (cached) {
      this.startVoice(ctx, cue, cached);
      return;
    }
    // 최초 1회(큐별)만 fetch+decode한다 — 이후에는 항상 캐시된 AudioBuffer를 재사용한다.
    void this.loadBuffer(ctx, cue).then(buffer => {
      if (buffer) this.startVoice(ctx, cue, buffer);
    });
  }

  private loadBuffer(ctx: AudioContext, cue: CueKind): Promise<AudioBuffer | null> {
    const pending = this.pending.get(cue);
    if (pending) return pending;

    const promise = fetch(CUE_URL[cue])
      .then(res => res.arrayBuffer())
      .then(data => ctx.decodeAudioData(data))
      .then(buffer => {
        this.buffers.set(cue, buffer);
        return buffer;
      })
      .catch((err: unknown) => {
        // 디코드 실패는 게임을 멈추지 않는다 — sprites.ts의 img.onerror 처리와 같은 원칙(조용히
        // 삼키면 프로덕션 404와 구분이 안 되므로 최소 한 번은 로그), 이후로는 매 play() 호출마다
        // 다시 로그를 남기지 않고 조용히 무음으로 남는다.
        if (!this.failedLogged.has(cue)) {
          this.failedLogged.add(cue);
          console.error(`[chess-defense] 사운드 디코드 실패: ${cue} (${CUE_URL[cue]})`, err);
        }
        return null;
      })
      .finally(() => {
        this.pending.delete(cue);
      });
    this.pending.set(cue, promise);
    return promise;
  }

  private startVoice(ctx: AudioContext, cue: CueKind, buffer: AudioBuffer): void {
    // 컨텍스트가 running이 아니면(대개 suspended — resumeOnGesture 이전이거나, iOS 오디오
    // 인터럽션/백그라운딩 등으로 브라우저가 다시 정지시킨 경우) 아예 시작하지 않는다. suspended
    // 상태에서도 start()는 예외 없이 받아들여지지만 실제로는 재생되지 않고 onended도 결코
    // 발생하지 않는다 — activeVoices가 상한까지 차오른 채 영원히 멈춰(그 뒤로는 매 큐가 조용히
    // 버려짐) 있다가, resume() 시점에 그동안 쌓인 소리가 전부 한꺼번에 터진다. 헤드리스
    // 크롬으로 실측 확인: 이 가드 없이는 8개 모두 start()되고 onended가 0회, resume() 후
    // 8개가 동시에 발화; 가드를 넣으면 suspended 동안은 아무 소스도 만들어지지 않는다.
    if (ctx.state !== 'running') return;
    // 동시 재생 목소리 상한(AUDIO_TUNING.maxVoices) — 넘으면 이미 재생 중인 소리는 그대로 두고
    // (끊지 않고) 이 최신 요청만 버린다. 재생 중인 소리를 stop()하면 그 소리가 부자연스럽게
    // 뚝 끊기는 게 코일레싱/스로틀보다 더 귀에 거슬리기 때문에 "버리는 쪽"을 최신 쪽으로 정했다.
    if (this.activeVoices >= AUDIO_TUNING.maxVoices) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    // 재생마다 ±pitchVariation만큼 playbackRate를 흔든다 — 같은 짧은 샘플을 그대로 반복하면
    // 기관총처럼 들리는 문제의 표준적인 해법(디튠).
    const variation = AUDIO_TUNING.pitchVariation;
    source.playbackRate.value = 1 + (Math.random() * 2 - 1) * variation;

    const gain = ctx.createGain();
    gain.gain.value = AUDIO_TUNING.cues[cue].gain;
    source.connect(gain);
    gain.connect(this.master!);

    this.activeVoices++;
    source.onended = () => {
      this.activeVoices = Math.max(0, this.activeVoices - 1);
      // GC가 알아서 걷어가긴 하지만(끝난 소스는 회수 가능), 명시적으로 그래프에서 떼어내
      // 정리 타이밍을 GC에 기대지 않게 한다.
      source.disconnect();
      gain.disconnect();
    };
    source.start();
  }

  /**
   * 테스트 전용 seam — 실제 브라우저 없이는 fetch+decodeAudioData 경로를 구동할 수 없다
   * (sprites.ts의 setSpriteForTest와 같은 이유·같은 패턴). 이미 디코드된 것으로 취급할
   * AudioBuffer 스탠드인을 직접 주입한다. 프로덕션 코드 경로는 절대 호출하지 않는다.
   */
  setBufferForTest(cue: CueKind, buffer: AudioBuffer | null): void {
    if (buffer) this.buffers.set(cue, buffer);
    else this.buffers.delete(cue);
  }
}
