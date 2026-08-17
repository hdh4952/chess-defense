import { CONFIG } from '../config';
import type { Enemy, GameEvent, GameState } from '../types';

/**
 * 적별 **표시 상태** — 피격 플래시와 체력바 보간 (v1.15).
 *
 * ★ 이 클래스가 따로 있는 이유는 계층 규칙이다. `src/core/`는 DOM-free이자 **연출-free**여야
 * 하므로 "이 적이 0.1초 전에 맞았다"나 "체력바가 아직 옛 값을 향해 움직이는 중이다" 같은
 * 값을 `Enemy`에 올릴 수 없다 — 그것은 게임 상태가 아니라 그림 상태다. 그리고 `render/`는
 * GameState를 **읽기만** 하는 것이 원칙이라, 상태를 가져야 하는 연출은 `Effects`처럼 전용
 * 클래스에 가둔다. 이 파일은 그 두 번째 예다.
 *
 * ⚠️ **적 id로 키를 잡으므로 죽은 적의 항목을 반드시 지워야 한다.** 한 판에 452마리 + 분열체가
 * 지나가므로 정리하지 않으면 Map이 단조 증가한다. update()가 매 프레임 살아 있는 id만 남긴다.
 */

/** 피격 플래시 지속 시간. 사용자 요청은 "2프레임"이고 60fps 기준 그 값이다. */
const FLASH_SECONDS = 2 / 60;

/**
 * 체력바가 실제 값을 따라잡는 시간(초). 사용자 요청 그대로 0.2다.
 *
 * 지수 감쇠가 아니라 **고정 시간 선형 접근**을 쓴다 — 지수는 영원히 도달하지 않아 막대가
 * 미세하게 떨리고, "죽었는데 막대가 남아 있다"가 생긴다.
 */
const HP_LERP_SECONDS = 0.2;

export class EnemyFx {
  private flash = new Map<string, number>();
  private shownHp = new Map<string, number>();

  onEvent(ev: GameEvent): void {
    if (ev.kind === 'enemyHit') {
      // 막힌 피격(damage 0)도 번쩍인다 — "맞았는데 안 들어갔다"가 화면에 드러나야 하고,
      // 그 사실은 함께 뜨는 데미지 팝업이 "0"이 아니라 막힘 표식을 그리는 것으로 구분된다.
      this.flash.set(ev.enemyId, FLASH_SECONDS);
    }
  }

  /**
   * 매 프레임: 플래시 감쇠 · 체력바 보간 · **죽은 적 항목 정리**.
   *
   * dt가 0이면(일시정지) 아무것도 진행하지 않는다 — Effects와 같은 규칙이다. 그러지 않으면
   * 게임은 얼어 있는데 막대만 벽시계 기준으로 계속 움직인다.
   */
  update(dt: number, state: GameState): void {
    const live = new Set(state.enemies.map(e => e.id));
    for (const id of this.flash.keys()) if (!live.has(id)) this.flash.delete(id);
    for (const id of this.shownHp.keys()) if (!live.has(id)) this.shownHp.delete(id);
    if (dt <= 0) {
      // 정지 중에도 **새로 스폰된 적**의 초기값은 잡아 둬야 한다. 그러지 않으면 정지가 풀린
      // 첫 프레임에 막대가 0에서 치솟는다.
      for (const e of state.enemies) if (!this.shownHp.has(e.id)) this.shownHp.set(e.id, effectiveHp(e));
      return;
    }
    for (const [id, t] of this.flash) {
      const next = t - dt;
      if (next <= 0) this.flash.delete(id); else this.flash.set(id, next);
    }
    for (const e of state.enemies) {
      const target = effectiveHp(e);
      const cur = this.shownHp.get(e.id);
      if (cur === undefined) { this.shownHp.set(e.id, target); continue; }
      // 최대 체력 기준 고정 속도로 다가간다 — 체력이 큰 보스와 작은 일반 적이 같은 0.2초를 쓴다.
      const step = ((e.maxHp + e.auraBonus) / HP_LERP_SECONDS) * dt;
      this.shownHp.set(e.id, cur > target ? Math.max(target, cur - step) : Math.min(target, cur + step));
    }
  }

  /** 0 = 없음, 1 = 방금 맞음. 렌더가 흰색을 이 비율로 덮는다. */
  flashAmount(enemyId: string): number {
    return (this.flash.get(enemyId) ?? 0) / FLASH_SECONDS;
  }

  /** 체력바가 그릴 값. 아직 관측하지 못한 적은 실제 값을 그대로 쓴다(첫 프레임 튐 방지). */
  displayHp(e: Enemy): number {
    return this.shownHp.get(e.id) ?? effectiveHp(e);
  }
}

/** 오라 보너스를 포함한 유효 체력. 음수(적립)는 0으로 하한 짓는다 — 막대는 음수를 못 그린다. */
function effectiveHp(e: Enemy): number {
  return Math.max(0, e.hp + e.auraBonus);
}

/**
 * 사용자가 모션 축소를 요청했는가. 브라우저가 아닌 환경(테스트)에서는 false다.
 *
 * ⚠️ 이 저장소에는 그동안 이 처리가 **하나도 없었다.** v1.15에서 연출을 늘리면서 처음
 * 도입한다 — 화면 진동·플래시·비행 텍스트는 전정 장애가 있는 사용자에게 실제로 문제가 된다.
 * 정보(데미지 숫자·체력바)는 끄지 않고 **움직임만** 끄는 것이 원칙이다.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** 적 스프라이트 크기 — renderer와 같은 값을 쓰기 위한 재노출(리터럴 중복 방지). */
export const ENEMY_SPRITE_PX = CONFIG.enemy.spritePx;
