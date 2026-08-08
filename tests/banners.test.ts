// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createInitialState } from '../src/core/state';
import { createLayout } from '../src/ui/layout';
import { Banners } from '../src/ui/banners';
import type { GameEvent, GameState } from '../src/types';

function makeApp(): HTMLElement {
  const app = document.createElement('div');
  document.body.appendChild(app);
  return app;
}

/**
 * 실제 style.css 내용을 <style> 태그로 주입한다. Vitest 기본 설정(test.css 미설정)에서는
 * `import '../src/style.css'`가 빈 모듈로 스텁되어 happy-dom이 시트를 전혀 보지 못한다
 * (별도 스파이크로 확인: 주입 없이는 getComputedStyle(...).pointerEvents === '').
 * 반면 실제 CSS 텍스트를 <style> 태그로 넣으면 happy-dom이 이를 파싱해 computed style을
 * 정확히 돌려준다 — 그래서 이 방식으로 실제 규칙(#banner-root, .result-overlay)을 검증한다.
 */
function injectRealStylesheet(): void {
  const css = readFileSync(resolve(__dirname, '../src/style.css'), 'utf-8');
  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);
}

/**
 * main.ts frame()의 하이라이트 변환 로직(주석 "파일 전체 붉은 강조 1초")을 그대로 미러링한다.
 * main.ts는 #app을 즉시 조회하고 requestAnimationFrame 루프를 무한히 예약하는 진입점 모듈이라
 * 직접 import해 단위 테스트하기 부적합하므로(다른 UI 모듈처럼 wireX(layout, state) 형태의
 * 순수 함수가 아님), 동일한 4줄짜리 변환을 여기 복제해 검증한다.
 * main.ts의 해당 스니펫이 바뀌면 이 헬퍼도 함께 갱신해야 한다.
 */
function bossFlashHighlights(bossFlash: { file: number; t: number } | null): { square: { file: number; rank: number }; color: string }[] {
  const highlights: { square: { file: number; rank: number }; color: string }[] = [];
  if (bossFlash) {
    for (let rank = 1; rank <= 8; rank++) {
      highlights.push({ square: { file: bossFlash.file, rank }, color: 'rgba(220,50,40,0.28)' });
    }
  }
  return highlights;
}

function setup(): { layout: ReturnType<typeof createLayout>; state: GameState; banners: Banners } {
  const layout = createLayout(makeApp());
  const state = createInitialState();
  const banners = new Banners(layout);
  return { layout, state, banners };
}

describe('Banners.onEvent — prepareStarted 배너 (스펙 7.9 1단계)', () => {
  it('isBossWave: true면 배너 엘리먼트를 생성한다', () => {
    const { layout, banners } = setup();
    banners.onEvent({ kind: 'prepareStarted', wave: 5, isBossWave: true });
    const els = layout.bannerRoot.querySelectorAll('.banner');
    expect(els).toHaveLength(1);
    expect(els[0].textContent).toContain('BOSS WAVE');
  });

  it('isBossWave: false면 배너를 생성하지 않는다', () => {
    const { layout, banners } = setup();
    banners.onEvent({ kind: 'prepareStarted', wave: 2, isBossWave: false });
    expect(layout.bannerRoot.querySelectorAll('.banner')).toHaveLength(0);
  });
});

describe('Banners.onEvent — bossSpawned (스펙 7.9 2단계)', () => {
  it('bossFlash를 해당 파일로 설정하고 파일명을 담은 배너를 생성한다 (file→letter 오프바이원 검출)', () => {
    const { layout, banners } = setup();
    banners.onEvent({ kind: 'bossSpawned', file: 3 }); // 3 -> 'd'
    expect(banners.bossFlash).toEqual({ file: 3, t: 1.0 });
    const els = layout.bannerRoot.querySelectorAll('.banner');
    expect(els).toHaveLength(1);
    expect(els[0].textContent).toContain('d파일');
    expect(els[0].textContent).not.toContain('c파일');
    expect(els[0].textContent).not.toContain('e파일');
  });

  it('file 0 -> a, file 7 -> h (경계값)', () => {
    const { banners: b0 } = setup();
    b0.onEvent({ kind: 'bossSpawned', file: 0 });
    expect(b0.bossFlash!.file).toBe(0);

    const { layout: layout0 } = setup();
    const banners0 = new Banners(layout0);
    banners0.onEvent({ kind: 'bossSpawned', file: 0 });
    expect(layout0.bannerRoot.querySelector('.banner')!.textContent).toContain('a파일');

    const { layout: layout7 } = setup();
    const banners7 = new Banners(layout7);
    banners7.onEvent({ kind: 'bossSpawned', file: 7 });
    expect(banners7.bossFlash).toEqual({ file: 7, t: 1.0 });
    expect(layout7.bannerRoot.querySelector('.banner')!.textContent).toContain('h파일');
  });
});

describe('Banners.update — bossFlash 타이머 만료', () => {
  it('경과 시간 합이 1.0을 넘으면 bossFlash가 null이 된다', () => {
    const { banners, state } = setup();
    banners.onEvent({ kind: 'bossSpawned', file: 4 });
    expect(banners.bossFlash).not.toBeNull();

    banners.update(state, 0.4);
    expect(banners.bossFlash).not.toBeNull();
    banners.update(state, 0.4);
    expect(banners.bossFlash).not.toBeNull();
    banners.update(state, 0.4); // 누적 1.2s > 1.0s
    expect(banners.bossFlash).toBeNull();
  });

  it('활성 상태에서 main.ts와 동일한 변환을 거치면 해당 파일의 8개 랭크 전부, 그리고 오직 그 파일만 하이라이트된다', () => {
    const { banners, state } = setup();
    banners.onEvent({ kind: 'bossSpawned', file: 2 });
    banners.update(state, 0.1); // 아직 활성 (t = 0.9)

    const highlights = bossFlashHighlights(banners.bossFlash);
    expect(highlights).toHaveLength(8);
    const ranks = highlights.map(h => h.square.rank).sort((a, b) => a - b);
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(highlights.every(h => h.square.file === 2)).toBe(true);
  });

  it('만료 후에는 하이라이트가 비어 있다', () => {
    const { banners, state } = setup();
    banners.onEvent({ kind: 'bossSpawned', file: 2 });
    banners.update(state, 1.5);
    expect(banners.bossFlash).toBeNull();
    expect(bossFlashHighlights(banners.bossFlash)).toEqual([]);
  });
});

describe('Banners.update — 결과 화면 (스펙 3.2)', () => {
  it('victory 도달 시 웨이브 도달/처치 수/획득 골드를 담은 오버레이를 정확히 한 번만 렌더한다', () => {
    const { layout, banners, state } = setup();
    state.wave = 20;
    state.stats.totalKills = 137;
    state.stats.totalGoldEarned = 4200;
    state.phase = 'victory';

    banners.update(state, 0.1);
    banners.update(state, 0.1);
    banners.update(state, 0.1);

    const overlays = layout.bannerRoot.querySelectorAll('.result-overlay');
    expect(overlays).toHaveLength(1);
    const box = overlays[0].querySelector('.result-box')!;
    expect(box.textContent).toContain('20');
    expect(box.textContent).toContain('137');
    expect(box.textContent).toContain('4200');
    expect(box.textContent).toContain('승리');
  });

  it('defeat 도달 시에도 정확히 한 번만 렌더하고 패배 문구를 담는다', () => {
    const { layout, banners, state } = setup();
    state.wave = 7;
    state.stats.totalKills = 42;
    state.stats.totalGoldEarned = 900;
    state.phase = 'defeat';

    banners.update(state, 0.1);
    banners.update(state, 0.1);
    banners.update(state, 0.1);

    const overlays = layout.bannerRoot.querySelectorAll('.result-overlay');
    expect(overlays).toHaveLength(1);
    expect(overlays[0].textContent).toContain('패배');
    expect(overlays[0].textContent).toContain('7');
    expect(overlays[0].textContent).toContain('42');
    expect(overlays[0].textContent).toContain('900');
  });

  it('다시 시작 버튼 클릭은 location.reload를 호출한다', () => {
    const { layout, banners, state } = setup();
    state.phase = 'defeat';
    banners.update(state, 0.1);

    const reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload: reloadSpy },
      writable: true,
    });

    const btn = layout.bannerRoot.querySelector<HTMLButtonElement>('#restart')!;
    btn.click();
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });
});

describe('배너 레이어는 클릭을 가로채지 않는다 (스펙 요구사항 4 — 드래그 앤 드롭 보호)', () => {
  it('#banner-root는 pointer-events: none, .result-overlay는 pointer-events: auto로 해석된다', () => {
    injectRealStylesheet();
    const { layout, banners, state } = setup();

    const rootStyle = getComputedStyle(layout.bannerRoot);
    expect(layout.bannerRoot.id).toBe('banner-root');
    expect(rootStyle.pointerEvents).toBe('none');

    state.phase = 'victory';
    banners.update(state, 0.1);
    const overlay = layout.bannerRoot.querySelector<HTMLElement>('.result-overlay')!;
    const overlayStyle = getComputedStyle(overlay);
    expect(overlayStyle.pointerEvents).toBe('auto');
  });

  it('일반 경고 배너(.banner)는 인라인으로 pointer-events를 auto로 덮어쓰지 않는다 (부모의 none 상속 유지)', () => {
    const { layout, banners } = setup();
    banners.onEvent({ kind: 'bossSpawned', file: 1 });
    const banner = layout.bannerRoot.querySelector<HTMLElement>('.banner')!;
    expect(banner.style.pointerEvents).toBe('');
  });
});

describe('배너 엘리먼트는 페이드 후 DOM에서 제거된다 (장기 플레이 누적 방지)', () => {
  it('showBanner가 예약한 setTimeout이 실행되면 엘리먼트가 remove()된다', () => {
    vi.useFakeTimers();
    try {
      const { layout, banners } = setup();
      banners.onEvent({ kind: 'bossSpawned', file: 5 });
      expect(layout.bannerRoot.querySelectorAll('.banner')).toHaveLength(1);
      vi.advanceTimersByTime(2600);
      expect(layout.bannerRoot.querySelectorAll('.banner')).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('main.ts events 배선 계약 — Banners는 자신이 소비한 이벤트를 지우지 않는다', () => {
  it('onEvent 호출 후에도 원본 이벤트 배열은 그대로 남아 다른 소비자가 읽을 수 있다', () => {
    const { banners } = setup();
    const events: GameEvent[] = [
      { kind: 'bossSpawned', file: 6 },
      { kind: 'prepareStarted', wave: 10, isBossWave: true },
    ];
    for (const ev of events) banners.onEvent(ev);
    expect(events).toHaveLength(2); // banners가 배열을 비우지 않았다
  });
});
