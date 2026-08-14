import type { GameState } from '../types';
import type { Layout } from './layout';

/**
 * 일시정지 / 배속 2x / 탭 이탈 자동 일시정지 배선 (스펙 7.7). 배선은 1회만 호출.
 * 버튼 라벨(⏸/▶, ▶▶Nx)은 매 프레임 updateHud가 state로부터 다시 그린다 — 여기서는 state만 변경한다.
 */
export function wireControls(layout: Layout, state: GameState): void {
  layout.hud.pauseBtn.addEventListener('click', () => {
    if (state.phase === 'victory' || state.phase === 'defeat') return;
    state.paused = !state.paused;
  });
  layout.hud.speedBtn.addEventListener('click', () => {
    state.speedMultiplier = state.speedMultiplier === 1 ? 2 : 1;   // 이동·쿨다운·준비 시간 모두 적용
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && (state.phase === 'prepare' || state.phase === 'wave')) {
      state.paused = true;    // 자동 일시정지 (수동 해제만 가능, 스펙 7.7 — 절대 자동 재개하지 않는다)
    }
  });
}

/** 음소거 토글에 필요한 최소 인터페이스 — src/audio/index.ts의 AudioController가 이를 만족한다.
 *  여기서 AudioController를 직접 import하지 않고 구조적 타입으로 받는 이유는, sprites.ts를
 *  ui/drag.ts가 그러듯 ui/ → audio/ 의존은 자연스럽지만, 굳이 구체 클래스에 묶이지 않아도 되기
 *  때문이다(테스트에서 가짜 구현을 주입하기도 쉬워진다). */
export interface MuteControllable {
  isMuted(): boolean;
  setMuted(muted: boolean): void;
}

/**
 * 음소거 버튼 배선 (첫 슬라이스: 공격 사운드 전용, 스펙 7.6/§10.1 v1.2). 음소거 상태는
 * AudioController가 메모리에만 들고 있다 — 세이브 시스템이 없는 이 게임에서 localStorage로
 * 영속화할 이유가 없다. 버튼 라벨은 이 파일이 유일한 변경 지점(클릭)이므로 wireControls의
 * pauseBtn/speedBtn처럼 updateHud에 맡기지 않고 여기서 직접 동기화한다.
 */
export function wireMuteButton(layout: Layout, audio: MuteControllable): void {
  const sync = (): void => {
    const muted = audio.isMuted();
    layout.hud.muteBtn.textContent = muted ? '🔇' : '🔊';
    layout.hud.muteBtn.setAttribute('aria-pressed', String(muted));
  };
  layout.hud.muteBtn.addEventListener('click', () => {
    audio.setMuted(!audio.isMuted());
    sync();
  });
  sync();
}
