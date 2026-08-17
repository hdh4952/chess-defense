import { CONFIG, TRAITS, slowPercent } from '../config';
import { fileCenterX, rankToTopY } from '../core/grid';
import { SLOW_INK } from './palette';
import { prefersReducedMotion } from './enemyFx';
import { tierRingColor } from './tiers';
import type { GameEvent, Square } from '../types';

const SQ = CONFIG.board.squarePx;
const center = (sq: Square) => ({ x: fileCenterX(sq.file), y: rankToTopY(sq.rank) + SQ / 2 });

/**
 * 히트스톱 길이(초). 사용자 요청 "30~50ms"의 중앙값이다.
 *
 * **벽시계 기준**이라 배속과 무관하게 항상 40ms다. 게임 시간 기준으로 두면 2배속에서 20ms가
 * 되어 사실상 사라지는데, 타격감은 실제로 흐른 시간에 달려 있다.
 */
const HITSTOP_SECONDS = 0.04;

/**
 * 히트스톱 최소 간격(초). 룩 여러 기가 엇갈려 발사하면 매 프레임 발동해 게임이 끊기는 것처럼
 * 보인다 — 오디오 스로틀(룩 200ms)과 같은 이유로 같은 자릿수를 쓴다.
 */
const HITSTOP_MIN_GAP = 0.25;

/**
 * 감속 진입 라벨. 숫자는 CONFIG에서 유도한다 — 계수를 바꾸면 이 문구도 따라온다.
 * ★ v1.13부터 **티어마다 다르다**(T1 −30% · T2 −35% …). 상수로 굳히면 T3 오라에 들어간 적에게
 * −30%라고 거짓말하게 되므로, 이벤트가 실어 보낸 티어에서 그때그때 만든다.
 */
const slowLabel = (tier: number): string => `−${slowPercent(tier)}%`;

interface Fx {
  kind: 'shock' | 'crack' | 'beam' | 'puff' | 'coin' | 'mergeBurst' | 'frostTag' | 'spawnMark'
    | 'splitArrow' | 'dmgNum' | 'blockMark';
  x: number; y: number;
  x2?: number; y2?: number;      // 라인형(crack/beam)의 끝점
  amount?: number;               // coin 전용 — 표시할 골드 액수
  label?: string;                // frostTag 전용 — 티어에서 유도한 "−35%" 같은 문구
  enemyId?: string;              // dmgNum 전용 — 같은 적의 연속 피격을 합치는 키
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
  /**
   * 남은 히트스톱(초). 무거운 타격 순간 시뮬레이션을 아주 짧게 멈춰 타격감을 준다 (v1.15).
   *
   * ★ shake와 같은 자리에 두는 이유가 있다 — 둘 다 **화면 전체**에 걸리는 피드백이고,
   * 둘 다 "이펙트 목록"이 아니라 스칼라 상태다. 그리고 둘 다 일시정지에서 진행을 멈춰야
   * 하는데, 그 가드가 이미 이 클래스 안에 있다.
   */
  private hitstop = 0;
  /** 마지막 히트스톱 이후 흐른 시간. 연속 발동을 막는 스로틀에 쓴다. */
  private sinceHitstop = HITSTOP_MIN_GAP;

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
        if (kind === 'crack') {
          this.shake = Math.max(this.shake, 0.15);
          // ★ 히트스톱은 **룩 계열(pattern 'rook')**에만 걸린다 — 룩과 챈슬러다.
          //   사용자 요청은 "룩/나이트만"이었지만 나이트는 v1.10에서 폭발을 잃고 공격 자체가
          //   없어져(공격력 0) 걸 순간이 없다. 요청의 의도는 "무거운 타격"이고, 이 게임에
          //   남은 무거운 타격이 crack(관통 균열 + 화면 진동)이라 그대로 이어받는다.
          if (this.sinceHitstop >= HITSTOP_MIN_GAP && !prefersReducedMotion()) {
            this.hitstop = HITSTOP_SECONDS;
            this.sinceHitstop = 0;
          }
        }
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
      // 이미 같거나 더 센 감속을 받는 적이 다른 오라로 넘어갈 때는 뜨지 않는다 — 최댓값
      // 하나만 적용되므로 정말 아무 일도 일어나지 않았기 때문이다. 반대로 T1 → T3처럼
      // **세지는** 경우는 실제 변화라 새 수치와 함께 다시 뜬다(v1.13).
      //
      // 좌표는 칸 중심이 아니라 적의 실제 픽셀 위치다(ev.y). 적은 칸 사이를 연속으로 움직이므로
      // 칸 중심에 띄우면 최대 40px 어긋난 자리에 라벨이 뜬다.
      this.list.push({
        kind: 'frostTag', x: fileCenterX(ev.file), y: Math.max(16, ev.y - 42),
        label: slowLabel(ev.tier), t: 0, ttl: 0.7,
      });
    }
    if (ev.kind === 'pieceSpawned') {
      // ★ 이 연출이 없으면 기능이 성립하지 않는다. 스폰 위치를 플레이어가 고르지 않으므로,
      // 어디에 생겼는지 화면이 말해 주지 않으면 56칸을 눈으로 훑어야 한다 — 예전에는 트레이의
      // 정해진 자리에 들어와 찾을 필요가 아예 없었다.
      // 구매·지급을 같은 표식으로 그린다: 플레이어에게는 "기물이 어디 생겼는가"라는 같은
      // 질문이고, 무엇을 받았는지는 지급일 때만 배너가 따로 알린다(banners.ts).
      // ttl이 다른 이펙트보다 긴 이유도 같다 — 후반에는 상점을 누른 뒤 시선이 보드로 옮겨
      // 오기까지 시간이 걸린다.
      const c = center(ev.square);
      this.list.push({ kind: 'spawnMark', ...c, t: 0, ttl: 1.2 });
    }
    if (ev.kind === 'enemyHit') {
      // ★ **적별로 합친다.** 이 이벤트는 한 프레임에 기물 수 × 사거리 안 적 수만큼 나올 수
      //   있어서(이 게임의 이벤트 중 유일하게 그렇다) 하나씩 팝업을 띄우면 화면이 숫자로
      //   덮인다. 같은 적의 팝업이 아직 살아 있으면 값을 더하고 수명을 되돌린다 — 룩 여러
      //   기가 한 적을 때리는 흔한 상황에서 "총 얼마나 들어갔는가"가 한 숫자로 읽힌다.
      const y = Math.max(14, ev.y - 26);
      if (ev.blocked) {
        // 막힌 피격은 숫자가 아니라 표식이다. "0"을 띄우면 데미지 0인 공격과 구분되지 않고,
        // 장갑형 문턱에 막혔다는 사실이 이 게임에서 가장 배우기 어려운 규칙이다.
        this.list.push({ kind: 'blockMark', x: fileCenterX(ev.file), y, t: 0, ttl: 0.5 });
        return;
      }
      if (ev.damage <= 0) return;
      const merged = this.list.find(f => f.kind === 'dmgNum' && f.enemyId === ev.enemyId);
      if (merged) {
        merged.amount = (merged.amount ?? 0) + ev.damage;
        merged.t = 0;
        merged.y = y;
        return;
      }
      this.list.push({
        kind: 'dmgNum', x: fileCenterX(ev.file), y, amount: ev.damage, enemyId: ev.enemyId,
        t: 0, ttl: 0.6,
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
    if (ev.kind === 'enemySplit') {
      // 분열은 "여기서 갈라졌다"를 말해야 한다 — 처치 연출(puff)만 나면 그냥 죽은 것과
      // 구분되지 않고, 플레이어는 새로 나타난 적 둘의 출처를 모른다.
      const c = center(ev.square);
      this.list.push({ kind: 'splitArrow', ...c, amount: ev.count, t: 0, ttl: 0.45 });
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

  /**
   * 히트스톱을 벽시계 시간으로 진행시키고, **이번 프레임에 시뮬레이션을 멈춰야 하는가**를
   * 돌려준다. 이펙트 자체(update/draw)는 계속 돈다 — 세계만 멈추고 연출은 흐르는 것이
   * 타격감의 정체다.
   *
   * ⚠️ update(dt)와 **따로** 진행시키는 이유: update의 dt는 일시정지 중 0으로 눌리는데,
   * 히트스톱은 일시정지와 무관하게(정지 중에는 애초에 발동하지 않으므로) 벽시계로 풀려야
   * 한다. 같은 dt를 쓰면 히트스톱이 걸린 순간 일시정지하면 영원히 풀리지 않는다.
   */
  tickHitstop(realDt: number): boolean {
    this.sinceHitstop += realDt;
    if (this.hitstop <= 0) return false;
    this.hitstop = Math.max(0, this.hitstop - realDt);
    return true;
  }

  shakeOffset(): { x: number; y: number } {
    // 캐시된 내부 객체를 그대로 참조로 돌려주면, 호출부가 이 반환값을 "이번 프레임 소유"라고 믿고
    // 직접 대입/변형할 때(예: main.ts가 view.shake에 그대로 얹는 패턴) Effects의 내부 상태를
    // 오염시킬 수 있다 — 이 브랜치에 이미 정확히 이 필드에서 참조 공유 버그가 한 번 있었다
    // (renderer.ts의 EMPTY_VIEW.shake, Task 17 리뷰). 매 호출마다 얕은 복사본을 돌려준다.
    return { ...this.lastShakeOffset };
  }

  draw(ctx: CanvasRenderingContext2D): void {
    // 모션 축소 요청 시 **움직임만** 끈다 — 숫자·표식 같은 정보는 그대로 보여준다.
    const reduced = prefersReducedMotion();
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
        // ★ crack·beam은 v1.15에서 세 겹이 됐다: **잔광 → 테두리 → 코어**.
        //   잔광은 시간이 갈수록 **넓어지며 옅어지고**(잉크가 퍼지는 것처럼), 코어는 반대로
        //   **얇아진다**. 두 방향이 반대라야 "번쩍 터진 뒤 잦아든다"로 읽힌다 — 둘 다 넓어지면
        //   그냥 흐려지는 것이고, 둘 다 얇아지면 처음부터 약해 보인다.
        //   폭을 k(1 → 0)로 만드는 것이 요점이고, 알파는 draw 앞머리에서 이미 k가 걸려 있다.
        case 'crack': {            // 룩 — 땅: 갈색 균열 + 밝은 테두리 + 흙빛 잔광
          if (!reduced) {
            ctx.save();
            ctx.globalAlpha *= 0.35 * k;
            ctx.lineWidth = 6 + (1 - k) * 14;
            ctx.strokeStyle = '#c9a06a';
            line(ctx, f);
            ctx.restore();
          }
          ctx.lineWidth = 6; ctx.strokeStyle = '#f0e0c0';
          line(ctx, f);
          ctx.lineWidth = 1.5 + k * 2.5; ctx.strokeStyle = '#7a5230';
          line(ctx, f);
          break;
        }
        case 'beam': {             // 비숍 — 빛: 흰-금 광선 + 어두운 테두리 + 금빛 잔광
          if (!reduced) {
            ctx.save();
            ctx.globalAlpha *= 0.4 * k;
            ctx.lineWidth = 5 + (1 - k) * 16;
            ctx.strokeStyle = '#ffe9a8';
            line(ctx, f);
            ctx.restore();
          }
          ctx.lineWidth = 5; ctx.strokeStyle = '#4a4020';
          line(ctx, f);
          ctx.lineWidth = 0.8 + k * 2.2; ctx.strokeStyle = '#fff6cf';
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
          ctx.strokeText(f.label!, f.x, f.y);
          ctx.fillStyle = SLOW_INK;
          ctx.fillText(f.label!, f.x, f.y);
          break;
        }
        case 'spawnMark': {        // 기물 스폰 — 칸을 감싸며 조여드는 이중 사각형
          // 확장이 아니라 **수축**이다. 퍼지는 링(mergeBurst·shock)은 "여기서 무슨 일이
          // 일어났다"를 말하지만, 조여드는 테두리는 시선을 그 칸 **안으로** 모은다 — 찾게
          // 하는 것이 목적인 유일한 연출이라 방향이 반대다.
          const grow = (1 - k) * SQ * 0.9;               // k: 1 → 0 이므로 시간이 갈수록 작아진다
          const r = SQ * 0.5 + grow;
          for (const [w, color] of [[5, 'rgba(10, 26, 36, 0.5)'], [2.5, '#ffe27a']] as const) {
            ctx.lineWidth = w; ctx.strokeStyle = color;
            ctx.strokeRect(f.x - r, f.y - r, r * 2, r * 2);
          }
          break;
        }
        case 'splitArrow': {       // 분열 — 부모 자리에서 양옆으로 벌어지는 쐐기 둘
          // 좌우로 **벌어지는** 것이 요점이다. 분열체가 인접 파일에 태어나므로 연출의
          // 방향이 규칙과 같아야 "어디로 갔는지"가 읽힌다.
          const spread = (1 - k) * SQ * 0.7;
          ctx.lineWidth = 3; ctx.strokeStyle = '#7BD16B';   // TRAIT_COLOR.splitter와 같은 톤
          for (const dir of [-1, 1]) {
            ctx.beginPath();
            ctx.moveTo(f.x + dir * spread, f.y - 7);
            ctx.lineTo(f.x + dir * (spread + 9), f.y);
            ctx.lineTo(f.x + dir * spread, f.y + 7);
            ctx.stroke();
          }
          break;
        }
        case 'dmgNum': {           // 피해 숫자 — 위로 떠오르며 페이드
          // coin과 같은 이유로 마지막 구간에서만 사라진다. 색은 체력바 채움(#e04b3a)과 같은
          // 계열이라 "체력이 이만큼 깎였다"가 두 곳에서 같은 색으로 읽힌다.
          ctx.globalAlpha = Math.min(1, k / 0.35);
          const dy = reduced ? 0 : (1 - k) * 22;
          ctx.font = 'bold 15px system-ui';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(20,6,6,0.85)';
          const text = String(Math.round(f.amount ?? 0));
          ctx.strokeText(text, f.x, f.y - dy);
          ctx.fillStyle = '#ff8f7a';
          ctx.fillText(text, f.x, f.y - dy);
          break;
        }
        case 'blockMark': {        // 막힌 피격 — 숫자 대신 사선이 그어진 고리
          // 형태로 말한다: 고리(피격은 있었다) + 사선(들어가지 않았다). 색은 장갑형 표식과
          // 같은 회청(#9AA7B4)이라 "무엇이 막았는가"가 적 유형 표식과 이어진다.
          ctx.globalAlpha = Math.min(1, k / 0.4);
          ctx.strokeStyle = '#9AA7B4'; ctx.lineWidth = 2.5;
          const r = 7;
          ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, Math.PI * 2); ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(f.x - r * 0.7, f.y + r * 0.7);
          ctx.lineTo(f.x + r * 0.7, f.y - r * 0.7);
          ctx.stroke();
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
