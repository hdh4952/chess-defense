import { CONFIG, TRAITS } from '../config';
import { fileCenterX, rankToTopY, squareKey } from '../core/grid';
import { prefersReducedMotion } from './enemyFx';
import type { GameEvent, Square } from '../types';

/**
 * 기물별 **공격 모션** — 찌르기와 반동 (v1.22).
 *
 * ★ **왜 필요했는가.** v1.21까지 폰이 적을 때리면 대각선 두 칸에 충격파가 뜨고 피해가
 * 들어갔지만 **폰 자신은 미동도 하지 않았다.** 화면에 "누가 때렸는가"가 없으니 피해가
 * 어디선가 저절로 발생하는 것처럼 보였다 — 이펙트가 대상 칸에만 있고 공격자 쪽에는
 * 아무것도 없었기 때문이다.
 *
 * ★ **이 클래스가 따로 있는 이유는 계층 규칙이다** (`enemyFx.ts`와 같은 사유). `core/`는
 * DOM-free이자 **연출-free**여야 하므로 "이 기물이 0.1초 전에 찔렀다"를 `Piece`에 올릴 수
 * 없다 — 그것은 게임 상태가 아니라 그림 상태다. 그리고 `render/`는 GameState를 읽기만
 * 하는 것이 원칙이라, 상태를 가져야 하는 연출은 전용 클래스에 가둔다. 이 파일이 세 번째
 * 예다(`Effects` · `EnemyFx` · `PieceFx`).
 *
 * ★ **칸으로 키를 잡는다.** `attack` 이벤트에는 기물 id가 없고 출발 칸(`from`)만 있다.
 * 한 칸에는 기물이 하나뿐이므로 칸이 곧 식별자다 — 코어에 id를 실어 보내게 고치는 것보다
 * 이쪽이 훨씬 좁은 변경이다. ⚠️ 대신 모션이 도는 0.22초 사이에 그 칸의 기물이 팔리거나
 * 다른 기물이 들어오면 **새 기물이 남은 모션을 이어받는다.** 실제로 일어나기 어렵고
 * (드래그 한 번에 0.22초), 일어나도 기물 하나가 한 번 까딱하는 것이 전부다.
 */

const SQ = CONFIG.board.squarePx;

/**
 * 뻗는 시간과 되돌아오는 시간 (초, 벽시계).
 *
 * ★ **뻗는 쪽이 훨씬 짧다.** 타격은 순간이고 회복은 그보다 느리다 — 둘을 같게 두면
 * 찌르기가 아니라 "앞뒤로 흔들리는" 것으로 읽힌다. 합이 0.22인 것은 폰의 공격 주기가
 * 0.5초이고 2배속에서 0.25초이기 때문이다: 모션이 그보다 길면 **영원히 끝나지 않아**
 * 폰이 계속 앞으로 기울어진 채 떨게 된다.
 */
const OUT_SECONDS = 0.045;
const BACK_SECONDS = 0.175;
const TOTAL_SECONDS = OUT_SECONDS + BACK_SECONDS;

/**
 * 공격 유형별 모션. **근접과 원거리가 반대 방향으로 움직인다** — 폰은 적 쪽으로 찌르고,
 * 룩·비숍은 쏘고 나서 **반동으로 물러난다.** 그래서 모션만 보고도 "저건 때리러 간 것"과
 * "저건 쏜 것"이 갈린다.
 */
interface Motion {
  /** 진행 방향 변위(보드 px). 음수면 뒤로 */
  offset: number;
  /** 진행 방향으로 숙이는 각(rad). 음수면 뒤로 젖힌다 */
  pitch: number;
}
const THRUST: Motion = { offset: 14, pitch: 0.42 };
const RECOIL: Motion = { offset: -5, pitch: -0.17 };

export interface StrikePose {
  /** 단위 방향 (보드 좌표계: +x 오른쪽, +y 아래). 변위와 기울기가 모두 이 축을 따른다 */
  dx: number;
  dy: number;
  /** 지금 이 순간의 변위(보드 px) */
  offset: number;
  /** 지금 이 순간의 기울기(rad) */
  pitch: number;
}

interface Strike {
  dx: number;
  dy: number;
  motion: Motion;
  t: number;
}

/** 뻗을 때는 빠르게 붙었다가(ease-out) 되돌아올 때는 부드럽게 놓는다(ease-in-out). */
function progress(t: number): number {
  if (t < OUT_SECONDS) {
    const k = t / OUT_SECONDS;
    return 1 - (1 - k) * (1 - k) * (1 - k);
  }
  const k = Math.min(1, (t - OUT_SECONDS) / BACK_SECONDS);
  return 1 - (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
}

const center = (sq: Square): { x: number; y: number } =>
  ({ x: fileCenterX(sq.file), y: rankToTopY(sq.rank) + SQ / 2 });

export class PieceFx {
  private strikes = new Map<string, Strike>();

  onEvent(ev: GameEvent): void {
    if (ev.kind !== 'attack') return;
    if (ev.targets.length === 0) return;          // 방향을 만들 수 없다 (코어는 이 경우 이벤트를 내지 않는다)

    // ★ **대상들의 무게중심을 향한다.** 폰은 앞 대각선 **둘**을 동시에 때리므로 어느 한쪽으로
    //   달려들면 나머지 한쪽이 거짓이 된다 — 두 칸의 중심은 정확히 정면이라, 폰은 "앞으로
    //   찌른다". 가장자리 파일이라 대각선이 하나뿐이면 그 방향이 중심이 되어 비스듬히 찌른다.
    //   규칙을 다시 쓰지 않고 이벤트가 실어 보낸 대상 목록에서 그대로 유도하는 것이 요점이다.
    const from = center(ev.from);
    let sx = 0, sy = 0;
    for (const t of ev.targets) {
      const c = center(t);
      sx += c.x - from.x;
      sy += c.y - from.y;
    }
    const len = Math.hypot(sx, sy);
    if (len === 0) return;                        // 대상이 자기 칸뿐 — 방향이 없다

    const pattern = TRAITS[ev.pieceType].pattern;
    this.strikes.set(squareKey(ev.from), {
      dx: sx / len, dy: sy / len,
      motion: pattern === 'pawn' ? THRUST : RECOIL,
      t: 0,
    });
  }

  /**
   * dt가 0이면(일시정지) 진행하지 않는다 — `Effects`·`EnemyFx`와 같은 규칙이다. 그러지 않으면
   * 게임은 얼어 있는데 기물만 계속 찌른다.
   */
  update(dt: number): void {
    if (dt <= 0) return;
    for (const [key, s] of this.strikes) {
      s.t += dt;
      if (s.t >= TOTAL_SECONDS) this.strikes.delete(key);
    }
  }

  /**
   * 이 칸의 기물이 지금 취해야 할 자세. 아무것도 안 하는 중이면 null.
   *
   * ★ 모션 축소를 요청했으면 **항상 null**이다. 이 연출은 순수한 움직임이라 끄면 그만이고,
   * 정보(피해 숫자·충격파)는 그대로 남는다 — "움직임만 끄고 정보는 끄지 않는다"는 원칙
   * (`enemyFx.ts`의 `prefersReducedMotion`)이 여기서는 통째로 적용된다.
   */
  poseAt(square: Square): StrikePose | null {
    if (prefersReducedMotion()) return null;
    const s = this.strikes.get(squareKey(square));
    if (!s) return null;
    const k = progress(s.t);
    return { dx: s.dx, dy: s.dy, offset: s.motion.offset * k, pitch: s.motion.pitch * k };
  }
}
