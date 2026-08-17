import { CONFIG, TRAITS, slowPercent } from '../config';
import { fileCenterX, rankToTopY } from '../core/grid';
import { SLOW_INK } from './palette';
import { tierRingColor } from './tiers';
import type { GameEvent, Square } from '../types';

const SQ = CONFIG.board.squarePx;
const center = (sq: Square) => ({ x: fileCenterX(sq.file), y: rankToTopY(sq.rank) + SQ / 2 });

/** 감속 진입 라벨. 숫자는 CONFIG에서 유도한다 — multiplier를 바꾸면 이 문구도 따라온다. */
const SLOW_LABEL = `−${slowPercent()}%`;

interface Fx {
  kind: 'shock' | 'crack' | 'beam' | 'puff' | 'coin' | 'mergeBurst' | 'frostTag';
  x: number; y: number;
  x2?: number; y2?: number;      // 라인형(crack/beam)의 끝점
  amount?: number;               // coin 전용 — 표시할 골드 액수
  color?: string;                // mergeBurst 전용 — 결과 티어 색
  t: number; ttl: number;
}

/**
 * 속성별 공격 이펙트 + 화면 진동 (스펙 8.2). 렌더 전용 — GameState를 읽거나 쓰지 않고
 * GameEvent 스트림만 소비한다. 데미지/처치 판정에는 절대 관여하지 않는다.
 *
 * ⚠️ **나이트 계열은 이 계층에 지속 연출을 갖지 않는다**(v1.10). 감속은 사건이 아니라 상태라
 * 이벤트 스트림으로 표현할 수 없고, 오라 범위와 감속당한 적은 renderer.ts가 매 프레임 state를
 * 직접 읽어 그린다. 여기 남은 것은 진입 순간의 "−30%" 라벨 하나뿐이다 — 그것만이 사건이다.
 * 예전의 폭발(explosion + ember 14개 + 진동 0.25)은 능력과 함께 통째로 사라졌으므로,
 * "나이트 이펙트가 왜 없지?"라는 질문의 답은 여기 있다. 되살리지 말 것.
 */
export class Effects {
  private list: Fx[] = [];
  private shake = 0;
  // shakeOffset()가 호출될 때마다 새 난수를 뽑으면, 일시정지 중처럼 update(dt)가 dt=0으로
  // 계속 호출되는(rAF는 멈추지 않으므로) 상황에서도 매 프레임 새 오프셋이 나와 "보드는 얼어있는데
  // 화면만 영원히 떨리는" 결과가 된다 (Task 19 리뷰 발견 1). 그래서 난수는 오직 update()가
  // dt>0으로(=시간이 실제로 흘렀을 때만) 호출될 때 한 번만 다시 뽑고, shakeOffset()은 그 결과를
  // 그대로 돌려주는 순수 getter로 둔다 — 책임을 main.ts(호출부)가 아니라 shake 값을 실제로
  // 소유·감쇠시키는 이 클래스 안에 둬야, 이 클래스를 쓰는 다른 어떤 호출부도 이 가드를 따로
  // 재구현할 필요가 없다.
  private lastShakeOffset: { x: number; y: number } = { x: 0, y: 0 };

  onEvent(ev: GameEvent): void {
    if (ev.kind === 'attack') {
      // TRAITS.pattern으로 분기한다 — 예전에는 타입 이름을 직접 봤고 else가 없어서, 새 기물이
      // 늘면 **컴파일도 테스트도 통과하는데 화면에는 아무것도 안 그려지는** 상태가 됐다.
      const pattern = TRAITS[ev.pieceType].pattern;
      if (pattern === 'pawn') {
        for (const sq of ev.targets) {
          const c = center(sq);
          this.list.push({ kind: 'shock', ...c, t: 0, ttl: 0.1 });
        }
      } else if (pattern === 'rook' || pattern === 'bishop') {
        const kind = pattern === 'rook' ? 'crack' : 'beam';
        const from = center(ev.from);
        // 방향별 가장 먼 대상 칸까지 라인 (관통 연출)
        const dirs = new Map<string, Square>();
        for (const sq of ev.targets) {
          const df = Math.sign(sq.file - ev.from.file), dr = Math.sign(sq.rank - ev.from.rank);
          if (df === 0 && dr === 0) continue;
          const key = `${df},${dr}`;
          const prev = dirs.get(key);
          const dist = Math.abs(sq.file - ev.from.file) + Math.abs(sq.rank - ev.from.rank);
          if (!prev || dist > Math.abs(prev.file - ev.from.file) + Math.abs(prev.rank - ev.from.rank)) {
            dirs.set(key, sq);
          }
        }
        for (const far of dirs.values()) {
          const c = center(far);
          this.list.push({ kind, x: from.x, y: from.y, x2: c.x, y2: c.y, t: 0, ttl: kind === 'beam' ? 0.3 : 0.25 });
        }
        if (kind === 'crack') this.shake = Math.max(this.shake, 0.15);
      }
      // pattern 'none'은 주기 발사가 없으므로 attack 이벤트가 오지 않는다. 새 패턴을 추가하면
      // 여기 분기도 함께 늘려야 한다 — 안 늘리면 그 기물만 조용히 무연출이 된다.
    }
    if (ev.kind === 'enemySlowed') {
      // 감속이 **막 걸린** 순간에만 뜬다(코어가 false→true 전이에서만 발행). 나이트를 놓는
      // 순간 범위 안 적들에게 동시에 뜨고, 그것이 곧 "이 배치가 방금 무엇을 했는가"다 —
      // 폭발이 담당하던 배치 피드백을 이쪽이 물려받되 **실제로 일어난 일만** 보여준다.
      // 아무것도 안 뜨면 그 배치가 지금은 아무 일도 하지 않았다는 정직한 신호다.
      //
      // 이미 감속 중인 적이 다른 나이트의 범위로 넘어갈 때는 뜨지 않는다 — 중첩이 없으므로
      // 정말로 아무 일도 일어나지 않았기 때문이다. 중첩 금지가 시간축에서도 보이는 지점이다.
      //
      // 좌표는 칸 중심이 아니라 적의 실제 픽셀 위치다(ev.y). 적은 칸 사이를 연속으로 움직이므로
      // 칸 중심에 띄우면 최대 40px 어긋난 자리에 라벨이 뜬다.
      this.list.push({
        kind: 'frostTag', x: fileCenterX(ev.file), y: Math.max(16, ev.y - 42), t: 0, ttl: 0.7,
      });
    }
    if (ev.kind === 'goldGained') {
      // 공격 이펙트(0.3초)보다 길게 살려 둔다 — 광선이 사라진 뒤에도 "번 돈"이 잠깐 남아야
      // 플레이어가 비숍이 무슨 일을 했는지 눈으로 따라갈 수 있다.
      const c = center(ev.square);
      this.list.push({ kind: 'coin', ...c, amount: ev.amount, t: 0, ttl: 0.9 });
    }
    if (ev.kind === 'merged') {
      // 합성 순간 — 결과 티어 색으로 퍼지는 링 한 겹. 비가역 조작이므로 "방금 무슨 일이
      // 일어났는지"가 분명해야 한다.
      const c = center(ev.square);
      this.list.push({ kind: 'mergeBurst', ...c, color: tierRingColor(ev.tier) ?? '#ffffff', t: 0, ttl: 0.45 });
    }
    if (ev.kind === 'enemyDied') {
      const c = center(ev.square);
      this.list.push({ kind: 'puff', ...c, t: 0, ttl: 0.25 });
    }
  }

  update(dt: number): void {
    for (const f of this.list) f.t += dt;
    this.list = this.list.filter(f => f.t < f.ttl);
    if (dt > 0) {                    // dt===0(일시정지 프레임)에는 감쇠도 재추첨도 건너뛴다
      this.shake = Math.max(0, this.shake - dt);
      this.lastShakeOffset = this.rollShakeOffset();
    }
  }

  private rollShakeOffset(): { x: number; y: number } {
    if (this.shake <= 0) return { x: 0, y: 0 };
    const a = this.shake * 14;
    return { x: (Math.random() - 0.5) * a, y: (Math.random() - 0.5) * a };
  }

  shakeOffset(): { x: number; y: number } {
    // 캐시된 내부 객체를 그대로 참조로 돌려주면, 호출부가 이 반환값을 "이번 프레임 소유"라고 믿고
    // 직접 대입/변형할 때(예: main.ts가 view.shake에 그대로 얹는 패턴) Effects의 내부 상태를
    // 오염시킬 수 있다 — 이 브랜치에 이미 정확히 이 필드에서 참조 공유 버그가 한 번 있었다
    // (renderer.ts의 EMPTY_VIEW.shake, Task 17 리뷰). 매 호출마다 얕은 복사본을 돌려준다.
    return { ...this.lastShakeOffset };
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const f of this.list) {
      const k = 1 - f.t / f.ttl;   // 1 → 0
      ctx.save();
      ctx.globalAlpha = k;
      switch (f.kind) {
        case 'shock': {            // 폰 — 노말: 회백색 충격파 + 어두운 테두리
          ctx.beginPath();
          ctx.arc(f.x, f.y, 8 + (1 - k) * 16, 0, Math.PI * 2);
          ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 4; ctx.stroke();
          ctx.strokeStyle = '#d8d8d0'; ctx.lineWidth = 2; ctx.stroke();
          break;
        }
        case 'crack': {            // 룩 — 땅: 갈색 균열 + 밝은 테두리
          ctx.lineWidth = 6; ctx.strokeStyle = '#f0e0c0';
          line(ctx, f);
          ctx.lineWidth = 3.5; ctx.strokeStyle = '#7a5230';
          line(ctx, f);
          break;
        }
        case 'beam': {             // 비숍 — 빛: 흰-금 광선 + 어두운 테두리
          ctx.lineWidth = 5; ctx.strokeStyle = '#4a4020';
          line(ctx, f);
          ctx.lineWidth = 2; ctx.strokeStyle = '#fff6cf';
          line(ctx, f);
          break;
        }
        case 'puff': {             // 처치 연출
          ctx.fillStyle = '#999';
          ctx.beginPath(); ctx.arc(f.x, f.y, (1 - k) * 14, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'mergeBurst': {       // 합성 성사 — 결과 티어 색으로 퍼지는 링
          ctx.beginPath();
          ctx.arc(f.x, f.y, 16 + (1 - k) * 30, 0, Math.PI * 2);
          ctx.lineWidth = 3 + k * 4;
          ctx.strokeStyle = f.color!;
          ctx.stroke();
          break;
        }
        case 'frostTag': {         // 감속 진입 — 적 머리 위 "−30%"
          // coin과 같은 이유로 마지막 구간에서만 사라지게 한다 — 선형이면 읽기 전에 흐려진다.
          ctx.globalAlpha = Math.min(1, k / 0.35);
          ctx.font = 'bold 13px system-ui';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          // 문자열이 '−'(U+2212)로 시작한다. '×'로 시작하는 fillText는 퀸 버프 배지라는
          // 규칙이 renderer.test.ts에 못박혀 있어, 배수(×0.7)가 아니라 감산량으로 적는다 —
          // 어차피 플레이어에게는 "얼마나 느려지는가"가 곧 감산량이다.
          ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(8,22,36,0.85)';
          ctx.strokeText(SLOW_LABEL, f.x, f.y);
          ctx.fillStyle = SLOW_INK;
          ctx.fillText(SLOW_LABEL, f.x, f.y);
          break;
        }
        case 'coin': {             // 골드 획득 — 위로 떠오르며 사라지는 "+10G"
          // 마지막 30%에서만 서서히 사라지게 한다: 선형 알파(k)로 두면 뜨자마자 흐려져서
          // 숫자를 읽을 시간이 없다.
          ctx.globalAlpha = Math.min(1, k / 0.3);
          const y = f.y - (1 - k) * 30;
          ctx.font = 'bold 20px system-ui';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineWidth = 4; ctx.strokeStyle = '#3a2c05';   // 밝은 칸 위에서도 읽히도록 테두리
          ctx.strokeText(`+${f.amount}G`, f.x, y);
          ctx.fillStyle = '#ffd34d';
          ctx.fillText(`+${f.amount}G`, f.x, y);
          break;
        }
      }
      ctx.restore();
    }
  }
}

function line(ctx: CanvasRenderingContext2D, f: { x: number; y: number; x2?: number; y2?: number }): void {
  ctx.beginPath();
  ctx.moveTo(f.x, f.y);
  ctx.lineTo(f.x2!, f.y2!);
  ctx.stroke();
}
