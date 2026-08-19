import { waveTotal } from '../config';
import { fileLabel } from '../core/grid';
import type { GameEvent, GameState } from '../types';
import type { Layout } from './layout';

export class Banners {
  /** 보스 스폰 파일 강조 (1초). main이 렌더 하이라이트로 변환 (스펙 7.9) */
  bossFlash: { file: number; t: number } | null = null;
  private resultShown = false;

  constructor(private layout: Layout) {}

  /**
   * ★★ **배너는 보스 등장 하나뿐이다** (v1.32, 사용자 결정: "최대 고비 이런 문구 다 지우고
   * 보스 출현만 나오도록").
   *
   * 예전에는 넷이었다 — 보스 웨이브 예고(`⚠ 최대 고비 — BOSS WAVE`) · 무상 지급 획득 ·
   * 보드 만석 환급 · 보스 등장. 배너는 화면 한가운데를 2.6초 가리므로 종류가 늘수록 **정작
   * 급한 하나가 묻힌다.** 이 게임에서 반응이 필요한 순간은 보스가 실제로 내려오는 그 순간
   * 하나이고, 나머지 셋은 급하지 않다.
   *
   * ★ 없앤 셋이 말하던 것은 대부분 다른 곳이 이미 말한다:
   *   - 보스 웨이브 예고 → **타이머 알약이 붉어진다**(v1.29). 배너보다 먼저 읽히고 사라지지도
   *     않는다.
   *   - 무상 지급 → 캔버스의 **스폰 표식**이 어디에 생겼는지 가리킨다.
   *
   * ⚠️ **다만 두 가지는 정말로 사라졌다** — 지급받은 기물이 *무엇*인지, 그리고 보드가 가득 차
   *   지급이 환급으로 바뀌었다는 사실이다. 후자는 예전 주석이 "조용히 버리면 무음 실패가 하나
   *   더 늘므로 알린다"고 적어 둔 바로 그 경우다. 골드는 늘어나므로 완전한 무음은 아니지만,
   *   **왜** 늘었는지는 화면이 말하지 않는다.
   */
  onEvent(ev: GameEvent): void {
    if (ev.kind === 'bossSpawned') {
      this.bossFlash = { file: ev.file, t: 1.0 };
      this.showBanner(`♚ 보스 등장 — ${fileLabel(ev.file)}파일!`);
    }
  }

  update(state: GameState, dt: number): void {
    // 일시정지 중에는 실시간(realDt) 카운트다운을 멈춘다 — 그렇지 않으면 게임 상태는 얼어있는데
    // "1초 안에 반응하라"는 강조 표시만 벽시계 기준으로 계속 사라진다 (Task 17 리뷰 수정).
    if (this.bossFlash && !state.paused) {
      this.bossFlash.t -= dt;
      if (this.bossFlash.t <= 0) this.bossFlash = null;
    }
    // 결과 화면 판정은 게이팅하지 않는다 — victory/defeat는 종단 상태이며 일시정지 여부와 무관하게 표시돼야 한다.
    if (!this.resultShown && (state.phase === 'victory' || state.phase === 'defeat')) {
      this.resultShown = true;
      this.showResult(state);
    }
  }

  private showBanner(text: string): void {
    const el = document.createElement('div');
    el.className = 'banner';
    el.textContent = text;
    this.layout.bannerRoot.appendChild(el);
    setTimeout(() => el.remove(), 2600);                 // 2s 표시 + 0.6s 페이드(CSS)
  }

  /** 결과 화면 (스펙 3.2): 도달 웨이브 / 처치 수 / 획득 골드 */
  private showResult(state: GameState): void {
    const el = document.createElement('div');
    el.className = 'result-overlay';
    el.innerHTML = `
      <div class="result-box">
        <h1>${state.phase === 'victory' ? '🏆 승리!' : '💀 패배'}</h1>
        <p>도달 웨이브 <b>${state.wave} / ${waveTotal(state.difficulty)}</b></p>
        <p>처치 수 <b>${state.stats.totalKills}</b></p>
        <p>획득 골드 <b>${state.stats.totalGoldEarned}G</b></p>
        <button id="restart">다시 시작</button>
      </div>`;
    this.layout.bannerRoot.appendChild(el);
    el.querySelector('#restart')!.addEventListener('click', () => location.reload());
  }
}
