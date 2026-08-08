import { CONFIG } from '../config';
import { fileLabel } from '../core/grid';
import type { GameEvent, GameState } from '../types';
import type { Layout } from './layout';

export class Banners {
  /** 보스 스폰 파일 강조 (1초). main이 렌더 하이라이트로 변환 (스펙 7.9) */
  bossFlash: { file: number; t: number } | null = null;
  private resultShown = false;

  constructor(private layout: Layout) {}

  onEvent(ev: GameEvent): void {
    if (ev.kind === 'prepareStarted' && ev.isBossWave) {
      this.showBanner('⚠ BOSS WAVE');                    // 2초 표시 후 페이드
    }
    if (ev.kind === 'bossSpawned') {
      this.bossFlash = { file: ev.file, t: 1.0 };
      this.showBanner(`♚ 보스 등장 — ${fileLabel(ev.file)}파일!`);
    }
  }

  update(state: GameState, dt: number): void {
    if (this.bossFlash) {
      this.bossFlash.t -= dt;
      if (this.bossFlash.t <= 0) this.bossFlash = null;
    }
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
        <p>도달 웨이브 <b>${state.wave} / ${CONFIG.wave.total}</b></p>
        <p>처치 수 <b>${state.stats.totalKills}</b></p>
        <p>획득 골드 <b>${state.stats.totalGoldEarned}G</b></p>
        <button id="restart">다시 시작</button>
      </div>`;
    this.layout.bannerRoot.appendChild(el);
    el.querySelector('#restart')!.addEventListener('click', () => location.reload());
  }
}
