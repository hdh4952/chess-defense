import { CONFIG } from '../config';
import { fileCenterX, rankToTopY } from '../core/grid';
import type { GameEvent, Square } from '../types';

const SQ = CONFIG.board.squarePx;
const center = (sq: Square) => ({ x: fileCenterX(sq.file), y: rankToTopY(sq.rank) + SQ / 2 });

interface Fx {
  kind: 'shock' | 'crack' | 'beam' | 'explosion' | 'ember' | 'puff';
  x: number; y: number;
  x2?: number; y2?: number;      // 라인형(crack/beam)의 끝점
  vx?: number; vy?: number;      // 파티클 속도
  t: number; ttl: number;
}

/**
 * 속성별 공격 이펙트 + 화면 진동 (스펙 8.2). 렌더 전용 — GameState를 읽거나 쓰지 않고
 * GameEvent 스트림만 소비한다. 데미지/처치 판정에는 절대 관여하지 않는다.
 */
export class Effects {
  private list: Fx[] = [];
  private shake = 0;

  onEvent(ev: GameEvent): void {
    if (ev.kind === 'attack') {
      if (ev.pieceType === 'pawn') {
        for (const sq of ev.targets) {
          const c = center(sq);
          this.list.push({ kind: 'shock', ...c, t: 0, ttl: 0.1 });
        }
      } else if (ev.pieceType === 'rook' || ev.pieceType === 'bishop') {
        const kind = ev.pieceType === 'rook' ? 'crack' : 'beam';
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
    }
    if (ev.kind === 'knightBlast') {
      const c = center(ev.square);
      this.list.push({ kind: 'explosion', ...c, t: 0, ttl: 0.35 });
      for (let i = 0; i < 14; i++) {
        const ang = (i / 14) * Math.PI * 2;
        this.list.push({
          kind: 'ember', ...c,
          vx: Math.cos(ang) * (60 + (i % 3) * 40), vy: Math.sin(ang) * (60 + (i % 3) * 40),
          t: 0, ttl: 0.5,
        });
      }
      this.shake = Math.max(this.shake, 0.25);
    }
    if (ev.kind === 'enemyDied') {
      const c = center(ev.square);
      this.list.push({ kind: 'puff', ...c, t: 0, ttl: 0.25 });
    }
  }

  update(dt: number): void {
    for (const f of this.list) {
      f.t += dt;
      if (f.kind === 'ember') { f.x += f.vx! * dt; f.y += f.vy! * dt; }
    }
    this.list = this.list.filter(f => f.t < f.ttl);
    this.shake = Math.max(0, this.shake - dt);
  }

  shakeOffset(): { x: number; y: number } {
    if (this.shake <= 0) return { x: 0, y: 0 };
    const a = this.shake * 14;
    return { x: (Math.random() - 0.5) * a, y: (Math.random() - 0.5) * a };
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
        case 'explosion': {        // 나이트 — 불: 방사형 폭발
          const r = 10 + (1 - k) * SQ * 1.4;
          const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
          g.addColorStop(0, 'rgba(255,200,80,0.9)');
          g.addColorStop(0.6, 'rgba(240,90,30,0.6)');
          g.addColorStop(1, 'rgba(240,90,30,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'ember': {            // 잔불 파티클
          ctx.fillStyle = '#ff8c3a';
          ctx.fillRect(f.x - 2, f.y - 2, 4, 4);
          break;
        }
        case 'puff': {             // 처치 연출
          ctx.fillStyle = '#999';
          ctx.beginPath(); ctx.arc(f.x, f.y, (1 - k) * 14, 0, Math.PI * 2); ctx.fill();
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
