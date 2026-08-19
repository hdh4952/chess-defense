import './style.css';
import { CONFIG } from './config';
import { createInitialState } from './core/state';
import { stepGame } from './core/step';
import { createTicker } from './core/ticker';
import { startWave } from './core/wave';
import { createAudioController } from './audio';
import { recordWaveCleared } from './progress';
import { VIEW_H, VIEW_W } from './render3d/coords';
import { Effects } from './render/effects';
import { EnemyFx } from './render/enemyFx';
import { PieceFx } from './render/pieceFx';
import { buildHighlights } from './render/highlights';
import { createFrameView } from './render/renderer';
import { Board3D } from './render3d';
import { Banners } from './ui/banners';
import { wireControls, wireMuteButton } from './ui/controls';
import { updateHud } from './ui/hud';
import { createLayout } from './ui/layout';
import { updateShop, wireShop } from './ui/shop';
import { updateTooltip } from './ui/tooltip';
import { createTitleScreen } from './ui/titleScreen';
import { DragController } from './ui/drag';
import type { Difficulty, GameEvent } from './types';

const app = document.querySelector<HTMLDivElement>('#app')!;

// 시작 화면 → BATTLE → 게임 (v1.5). 게임은 startGame이 불리기 전까지 전혀 부팅되지 않는다 —
// 캔버스도, 프레임 루프도, AudioContext도 그때 비로소 만들어진다. 결과 화면의 "다시 시작"은
// location.reload()이므로(ui/banners.ts) 별도 배선 없이 자연히 이 시작 화면으로 되돌아온다.
// ★ 난이도는 시작 화면이 넘겨준다 (v1.20). 여기서 다시 읽지 않는 이유는 titleScreen.ts의
// createTitleScreen 주석에 있다 — 누른 순간의 선택이 그대로 판에 굳어야 한다.
createTitleScreen(app, difficulty => startGame(app, difficulty));

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

function startGame(root: HTMLDivElement, difficulty: Difficulty): void {
  const layout = createLayout(root);   // innerHTML을 덮어써 시작 화면을 통째로 치운다
  // ★ 보드는 Three.js 씬이다 (v1.21). 카메라가 직교 투영이고 프러스텀이 보드에 맞춰져 있어
  // 그리는 좌표계는 여전히 0~640이다 — 그래서 아래 프레임 루프도, highlights/effects/enemyFx도,
  // 드롭 판정(ui/drag.ts)도 이 변경을 전혀 모른다(render3d/scene.ts의 투영 주석).
  const board = new Board3D(layout.canvas, layout.overlay);
  // ★ 판매 영역을 판 오른쪽 스트립(킹이 서 있는 자리)에 맞춘다 (v1.30). 보드가 캔버스에서
  //   차지하는 사각형은 카메라만 아는 값이라 3D 쪽에서 받아 온다 — 카메라가 고정이므로
  //   한 번만 계산하면 되고, 그래서 CSS가 아니라 여기서 넣는다.
  const br = board.boardRect();
  const gap = 6;
  Object.assign(layout.sellSlot.style, {
    left: `${br.right + gap}px`,
    top: `${br.top}px`,
    width: `${VIEW_W - br.right - gap * 2}px`,
    height: `${br.bottom - br.top}px`,
  });

  // 난이도는 여기서 상태에 굳는다 — 판이 시작된 뒤에는 어디서도 바뀌지 않는다(types.ts).
  const state = createInitialState(difficulty);
  const events: GameEvent[] = [];
  const tick = createTicker();

  // 공격 사운드로 시작해 v1.3에서 전체 효과음 세트로 확장했다 (스펙 §10.1). 코일레싱·스로틀·
  // 보이스 상한 튜닝값은 src/audio/cues.ts의 AUDIO_TUNING 표 하나에 모여 있다. wireShop/DragController
  // 보다 먼저 만들어야 두 곳에 UI 제스처 사운드(uiBuy/uiSell/uiPlace/uiInvalid)를 배선할 수 있다 —
  // 이 네 큐는 core에 대응 GameEvent가 없으므로 audio 인스턴스를 직접 주입받는다. (v1.4: 집기/선택
  // 시작(uiPickup)은 무음이 맞다는 사용자 판단으로 완전히 제거됐다 — src/ui/drag.ts 참고.)
  const audio = createAudioController();

  wireShop(layout, state, events, audio);
  wireControls(layout, state);
  layout.startBtn.addEventListener('click', () => { if (!state.paused) startWave(state); });
  // 드롭 판정에 **역투영을 주입한다** (v1.24 — 원근 쿼터뷰). ui/는 카메라를 모르고,
  // 카메라를 아는 render3d/가 "이 화면 좌표 아래는 어느 칸인가"에만 답한다(ui/drag.ts).
  const drag = new DragController(state, layout, events, audio, (x, y) => board.squareAt(x, y));
  const banners = new Banners(layout, state.difficulty);
  const fx = new Effects();        // 속성별 공격 이펙트 + 화면 진동, 렌더 전용 (스펙 8.2, Task 19)
  const enemyFx = new EnemyFx();   // 적별 표시 상태(피격 플래시·체력바 보간), 렌더 전용 (v1.15)
  const pieceFx = new PieceFx();   // 기물 공격 모션(찌르기·반동), 렌더 전용 (v1.22)
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
      // ★ 히트스톱 — 무거운 타격(룩 계열) 순간 시뮬레이션만 아주 짧게 멈춘다 (v1.15).
      //
      // ⚠️ **tick()에 0을 넘기는 것이 중요하다.** tick 호출을 아예 건너뛰면 accumulator에
      // 아무것도 더해지지 않는 것은 같지만, realDt를 넘기고 콜백에서 stepGame만 생략하면
      // accumulator가 계속 불어나 히트스톱이 풀리는 순간 밀린 프레임을 한꺼번에 재생한다 —
      // 이 파일이 위에서 이미 겪었다고 적어 둔 "멈춤 후 급가속"(회귀 2) 그 자체다.
      // 이펙트·플래시는 계속 흐른다: 세계만 멈추고 연출은 흐르는 것이 타격감의 정체다.
      const frozen = fx.tickHitstop(realDt);
      tick(frozen ? 0 : realDt, dt => stepGame(state, dt * state.speedMultiplier, events));

      // ★ 성취를 기록한다 (v1.19 · v1.20에서 기록 지점이 옮겨졌다 — 스킨 해금 조건).
      // 코어는 자기가 기록된다는 사실을 모른다: localStorage를 core/에 들이면 한 판의 결과가
      // 다음 판의 시작 상태를 바꾸는 통로가 생겨 헤드리스 밸런스 측정의 재현성이 깨진다
      // (progress.ts의 ★ 참고). 그래서 **밖에서 이벤트를 보고 적는다.**
      //
      // ★ **`victory` 페이즈가 아니라 `waveCleared` 이벤트를 본다** (v1.20, 사용자 결정:
      // "20웨이브 이상 클리어 시 해금, 모드 상관없이"). 승리만 보고 적으면 하드에서 30웨이브를
      // 넘기고 w31에 무너진 판이 **아무것도 남기지 못한다** — 이지 승리보다 멀리 갔는데도.
      // 웨이브 단위로 적으면 판의 결말과 무관하게 도달한 만큼이 남는다.
      for (const ev of events) {
        if (ev.kind === 'waveCleared') recordWaveCleared(ev.wave);
        banners.onEvent(ev); fx.onEvent(ev); enemyFx.onEvent(ev); pieceFx.onEvent(ev);
      }
      // paused는 명시적으로 넘긴다 — stepGame이 일시정지 중 일찍 반환해 attack 이벤트 자체가
      // 생기지 않으므로 사실상 이미 조용하지만, cues.ts가 그 사실에만 기대지 않도록 방어한다.
      // phase는 victory/defeat 전환 감지용(cues.ts CueResolver.resolve 참고).
      audio.onFrame(events, now, state.paused, state.phase);
      banners.update(state, realDt);
      // 일시정지 중에는 이펙트도 멈춘다 — 그렇지 않으면 게임 상태는 얼어있는데 광선·코인 페이드와
      // 화면 진동만 벽시계 기준으로 계속 진행돼 버린다 (banners.bossFlash의 Task 17 리뷰 수정과 동일한 사유).
      fx.update(state.paused ? 0 : realDt);
      // 적별 표시 상태(피격 플래시·체력바 보간)도 같은 규칙을 탄다 — 일시정지 중에는 멈춘다.
      // state를 함께 넘기는 이유는 죽은 적의 항목을 매 프레임 정리해야 하기 때문이다.
      enemyFx.update(state.paused ? 0 : realDt, state);
      // 공격 모션도 같은 규칙을 탄다 — 일시정지 중에는 기물이 찌르던 자세 그대로 얼어붙는다.
      pieceFx.update(state.paused ? 0 : realDt);

      // ★ 골드가 날아갈 **도착점의 캔버스 좌표**를 매 프레임 넣어 준다 (v1.15). 이 저장소에서
      // 캔버스와 DOM의 경계를 넘는 연출은 처음이라, 방향을 한쪽으로만 둔다: 렌더는 HUD가
      // 어디 있는지 모르고, 좌표를 밖에서 밀어 넣는다(드래그가 드롭 존 rect를 캐시하는
      // 방식의 선례를 따른다). getBoundingClientRect가 매 프레임 두 번이라 강제 레이아웃이
      // 걱정되지만, 두 요소 모두 크기가 고정이고 읽기만 하므로 레이아웃 무효화는 없다.
      // ★ v1.27에서 도착점이 HUD 골드 → **뽑기 버튼**으로 바뀌었다(HUD에서 골드 표시가
      //   사라졌다). 오히려 이쪽이 맞다: 번 돈이 그 돈을 쓰는 자리로 날아간다.
      const gRect = layout.drawBtn.getBoundingClientRect();
      const cRect = layout.canvas.getBoundingClientRect();
      fx.setGoldTarget(cRect.width > 0
        ? {
          x: (gRect.left + gRect.width / 2 - cRect.left) * (VIEW_W / cRect.width),
          y: (gRect.top + gRect.height / 2 - cRect.top) * (VIEW_H / cRect.height),
        }
        : null);

      const view = createFrameView();   // EMPTY_VIEW와 참조를 공유하지 않는 신규 인스턴스 (스펙 무관 — Task 17 리뷰 수정)
      const hl = buildHighlights(state, drag.interaction);   // 사거리/이동/퀸 라인 미리보기 (스펙 7.7, Task 18)
      view.highlights.push(...hl.highlights);
      view.lines.push(...hl.lines);
      view.mergePreview = hl.mergePreview;   // 합성 결과 티어 미리보기 (드래그 중에만 non-null)
      if (banners.bossFlash) {                          // 파일 전체 붉은 강조 1초 (스펙 7.9)
        for (let rank = 1; rank <= CONFIG.board.ranks; rank++) {
          view.highlights.push({ square: { file: banners.bossFlash.file, rank }, color: 'rgba(220,50,40,0.28)' });
        }
      }
      view.shake = fx.shakeOffset();   // 룩 공격의 화면 진동을 렌더러에 전달 (스펙 8.2)
      // ★ 한 번의 호출이 세 계층(바닥 데칼 · 3D 씬 · 화면 오버레이)을 전부 그린다. 예전에는
      // 이 자리에서 render()와 fx.draw()를 따로 부르고 그 사이에 shake만큼 translate를 손으로
      // 걸었는데, 계층이 셋이 된 지금 그 순서와 흔들림 처리는 그리는 쪽의 지식이다 —
      // 이펙트 목록만 넘기고 나머지는 Board3D가 안다(render3d/index.ts).
      board.render(state, view, fx.items(), enemyFx, pieceFx);
      updateTooltip(tooltip, state, drag.interaction, mousePos);   // 기물 hover 툴팁 (스펙 7.7, Task 18)
      updateHud(layout, state);
      updateShop(layout, state);
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
}
