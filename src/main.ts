import './style.css';
import { CONFIG } from './config';
import { createInitialState } from './core/state';
import { stepGame } from './core/step';
import { createTicker } from './core/ticker';
import { startWave } from './core/wave';
import { createAudioController } from './audio';
import { Effects } from './render/effects';
import { buildHighlights } from './render/highlights';
import { createFrameView, render } from './render/renderer';
import { Banners } from './ui/banners';
import { wireControls, wireMuteButton } from './ui/controls';
import { updateHud } from './ui/hud';
import { createLayout } from './ui/layout';
import { updateShop, wireShop } from './ui/shop';
import { updateSlots } from './ui/slots';
import { updateTooltip } from './ui/tooltip';
import { DragController } from './ui/drag';
import type { GameEvent } from './types';

const app = document.querySelector<HTMLDivElement>('#app')!;
const layout = createLayout(app);
const ctx = layout.canvas.getContext('2d')!;

const state = createInitialState();
const events: GameEvent[] = [];
const tick = createTicker();

// 공격 사운드로 시작해 v1.3에서 전체 효과음 세트로 확장했다 (스펙 §10.1). 코일레싱·스로틀·
// 보이스 상한 튜닝값은 src/audio/cues.ts의 AUDIO_TUNING 표 하나에 모여 있다. wireShop/DragController
// 보다 먼저 만들어야 두 곳에 UI 제스처 사운드(uiBuy/uiSell/uiPlace/uiInvalid)를 배선할 수 있다 —
// 이 네 큐는 core에 대응 GameEvent가 없으므로 audio 인스턴스를 직접 주입받는다. (v1.4: 집기/선택
// 시작(uiPickup)은 무음이 맞다는 사용자 판단으로 완전히 제거됐다 — src/ui/drag.ts 참고.)
const audio = createAudioController();

wireShop(layout, state, audio);
wireControls(layout, state);
layout.startBtn.addEventListener('click', () => { if (!state.paused) startWave(state); });
const drag = new DragController(state, layout, events, audio);
const banners = new Banners(layout);
const fx = new Effects();   // 속성별 공격 이펙트 + 화면 진동, 렌더 전용 (스펙 8.2, Task 19)
wireMuteButton(layout, audio);
// 자동재생 정책: 사용자 제스처 전에는 AudioContext가 절대 소리를 내지 않는다 — 아무 에러 없이
// 그냥 조용하다. 이 게임은 드래그 기반이라 pointerdown이 자연스러운 첫 제스처이므로 여기서
// 컨텍스트를 생성/재개한다. 매 pointerdown마다 불러도 안전하다(resumeOnGesture는 idempotent).
document.addEventListener('pointerdown', () => audio.unlock());

const tooltip = document.createElement('div');   // 사거리 미리보기·툴팁 (스펙 7.7, Task 18)
tooltip.id = 'tooltip';
tooltip.hidden = true;
document.body.appendChild(tooltip);
let mousePos: { x: number; y: number } | null = null;
document.addEventListener('pointermove', e => { mousePos = { x: e.clientX, y: e.clientY }; });

if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__game = state;
  (window as unknown as Record<string, unknown>).__drag = drag;
}

// frame() 예외 로깅 스로틀 (회귀 5). 매 호출마다 새 Error 인스턴스가 달려 있어 DevTools가
// 동일 에러로 묶어 접지 못하므로, 결함이 프레임마다(~60Hz) 계속 재발하면 콘솔·보존 메모리가
// 무한정 불어난다. 조용히 삼키지는 않되(검토 Item 3 요구사항), 첫 발생은 즉시 로그하고 이후는
// 일정 간격으로만 다시 로그해 그 사이 억제된 횟수를 함께 남긴다.
const FRAME_ERROR_LOG_INTERVAL_MS = 5000;
let lastFrameErrorLoggedAt = -Infinity;
let suppressedFrameErrorCount = 0;
function logFrameError(err: unknown): void {
  const t = performance.now();
  if (t - lastFrameErrorLoggedAt < FRAME_ERROR_LOG_INTERVAL_MS) {
    suppressedFrameErrorCount++;
    return;
  }
  const suffix = suppressedFrameErrorCount > 0 ? ` (그 사이 억제된 오류 ${suppressedFrameErrorCount}건)` : '';
  console.error(`[chess-defense] frame() 처리 중 오류 — 다음 프레임에서 계속 진행합니다${suffix}`, err);
  lastFrameErrorLoggedAt = t;
  suppressedFrameErrorCount = 0;
}

let last = performance.now();
function frame(now: number): void {
  // 프레임 본문 전체를 try로 감싸고, 다음 프레임 예약은 반드시 finally에서 한다 (검토 Item 3).
  // requestAnimationFrame은 1회성이라 콜백이 다음 호출을 스스로 다시 예약해야 하는데, 예약문이
  // 함수 맨 끝 한 줄뿐이면 그 앞의 어떤 throw(예: fx.update, buildHighlights, render, updateTooltip,
  // 각종 HUD 갱신 함수)도 루프를 영원히 멈춰 버린다 — 캔버스는 얼어붙고 에러도 화면에 드러나지
  // 않으며 새로고침 외에는 복구 수단이 없다. finally로 예약을 보장해 한 프레임의 예외가 다음
  // 프레임까지 막지 못하게 하고, catch에서 콘솔에 남겨 조용히 삼켜지지 않게 한다.
  try {
    const realDt = (now - last) / 1000;
    // stepGame이 던지면(현재는 안 던지지만 미래에 던질 수 있다) tick() 호출이 완주하지 못한다.
    // last를 tick() 뒤에 갱신하면 이런 경우 last가 갱신되지 않아, 다음 프레임의 realDt가 이번
    // 프레임 몫까지 두 번 누적된 값이 된다 — 게다가 그 예외는 createTicker의 while 루프를
    // acc -= fixedDt 전에 빠져나가므로, 결함이 지속되는 동안 accumulator가 매 프레임 maxFrame만큼
    // 계속 불어나다가 결함이 풀리는 순간 그 밀린 프레임을 한꺼번에 재생해 "멈춤 후 급가속"이
    // 벌어진다 (회귀 2). realDt를 이미 계산해 둔 지역 변수에 담아 뒀으므로, last는 tick() 호출
    // 성패와 무관하게 이 시점에 곧바로 갱신한다.
    last = now;
    tick(realDt, dt => stepGame(state, dt * state.speedMultiplier, events));

    for (const ev of events) { banners.onEvent(ev); fx.onEvent(ev); }
    // paused는 명시적으로 넘긴다 — stepGame이 일시정지 중 일찍 반환해 attack 이벤트 자체가
    // 생기지 않으므로 사실상 이미 조용하지만, cues.ts가 그 사실에만 기대지 않도록 방어한다.
    // phase는 victory/defeat 전환 감지용(cues.ts CueResolver.resolve 참고).
    audio.onFrame(events, now, state.paused, state.phase);
    banners.update(state, realDt);
    // 일시정지 중에는 이펙트도 멈춘다 — 그렇지 않으면 게임 상태는 얼어있는데 폭발/광선 페이드와
    // 화면 진동만 벽시계 기준으로 계속 진행돼 버린다 (banners.bossFlash의 Task 17 리뷰 수정과 동일한 사유).
    fx.update(state.paused ? 0 : realDt);

    const view = createFrameView();   // EMPTY_VIEW와 참조를 공유하지 않는 신규 인스턴스 (스펙 무관 — Task 17 리뷰 수정)
    const hl = buildHighlights(state, drag.interaction);   // 사거리/이동/퀸 라인 미리보기 (스펙 7.7, Task 18)
    view.highlights.push(...hl.highlights);
    view.lines.push(...hl.lines);
    if (banners.bossFlash) {                          // 파일 전체 붉은 강조 1초 (스펙 7.9)
      for (let rank = 1; rank <= CONFIG.board.ranks; rank++) {
        view.highlights.push({ square: { file: banners.bossFlash.file, rank }, color: 'rgba(220,50,40,0.28)' });
      }
    }
    view.shake = fx.shakeOffset();   // 룩/나이트 공격의 화면 진동을 렌더러에 전달 (스펙 8.2)
    render(ctx, state, view);
    // render()가 이미 view.shake만큼 translate했다가 자신의 save()/restore() 안에서 복구했으므로,
    // 그 바깥에서 fx.draw()를 그대로 부르면 보드는 흔들리는데 이펙트만 고정된 것처럼 보인다.
    // 동일한 오프셋으로 다시 translate한 뒤 이펙트를 그려 보드와 함께 흔들리게 하고,
    // 그리기 중 예외가 나도 변환 스택이 어긋나지 않도록 try/finally로 restore를 보장한다.
    ctx.save();
    ctx.translate(view.shake.x, view.shake.y);
    try {
      fx.draw(ctx);          // 보드 위 오버레이로 그린다
    } finally {
      ctx.restore();
    }
    updateTooltip(tooltip, state, drag.interaction, mousePos);   // 기물 hover 툴팁 (스펙 7.7, Task 18)
    updateHud(layout, state);
    updateShop(layout, state);
    updateSlots(layout, state);
    events.length = 0;
  } catch (err) {
    // 조용히 삼키지 않고 콘솔에 남긴다 — 그래야 장시간 플레이 중 한 프레임이 죽어도 원인을 추적할
    // 수 있다. 렌더/UI 갱신 중의 throw가 상태를 저절로 안전하게 만들어 주는 것은 아니다 — 예를
    // 들어 render()는 캔버스 컨텍스트에 save()/translate()를 걸어 둔 채로 죽을 수 있는데, 그쪽은
    // 이제 자체 try/finally로 restore를 보장한다(회귀 3). 이 catch는 그런 보호가 없는 지점의
    // throw까지 포함해 루프 자체가 멈추지 않게 하는 마지막 방어선일 뿐, "대부분 안전하다"는
    // 가정에 기대지 않는다. 매 프레임(~60Hz) 반복되는 결함이 콘솔을 무한정 채우지 않도록
    // logFrameError가 로그 빈도를 스로틀한다(회귀 5).
    logFrameError(err);
  } finally {
    requestAnimationFrame(frame);
  }
}
requestAnimationFrame(frame);
