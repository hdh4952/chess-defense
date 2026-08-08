import { CONFIG } from '../config';
import { moveOnBoard, pieceAt, placeFromSlot, recallToSlot, reorderSlots, findPiece } from '../core/pieces';
import { sellPiece, sellPrice } from '../core/economy';
import type { GameEvent, GameState, Square } from '../types';
import type { Layout } from './layout';
import { ALLY_GLYPH } from '../render/renderer';

export interface RectLike { left: number; top: number; width: number; height: number }
export interface DropZones { board: RectLike; slots: RectLike[]; sell: RectLike }
export type DropTarget =
  | { kind: 'square'; file: number; rank: number }
  | { kind: 'slot'; index: number }
  | { kind: 'sell' }
  | null;

export interface Interaction {
  dragging: { pieceId: string; from: 'slot' | 'board' } | null;
  selectedPieceId: string | null;
  hoverSquare: Square | null;
}

function contains(r: RectLike, x: number, y: number): boolean {
  return x >= r.left && x < r.left + r.width && y >= r.top && y < r.top + r.height;
}

/** 화면 좌표 → 드롭 대상 (순수) */
export function pickDropTarget(x: number, y: number, zones: DropZones): DropTarget {
  if (contains(zones.sell, x, y)) return { kind: 'sell' };
  for (let i = 0; i < zones.slots.length; i++) {
    if (contains(zones.slots[i], x, y)) return { kind: 'slot', index: i };
  }
  if (contains(zones.board, x, y)) {
    const files = CONFIG.board.files, ranks = CONFIG.board.ranks;
    const file = Math.floor((x - zones.board.left) / (zones.board.width / files));
    const row = Math.floor((y - zones.board.top) / (zones.board.height / ranks));
    return { kind: 'square', file, rank: ranks - row };
  }
  return null;
}

/** 스펙 7.5 동작표 매핑 (순수). 실패 = 원위치 복귀 */
export function dropAction(
  state: GameState, pieceId: string, from: 'slot' | 'board',
  target: DropTarget, events: GameEvent[],
): boolean {
  if (!target) return false;
  if (target.kind === 'sell') return sellPiece(state, pieceId);
  if (from === 'slot') {
    if (target.kind === 'square') return placeFromSlot(state, pieceId, target.file, target.rank, events);
    return reorderSlots(state, pieceId, target.index);
  }
  if (target.kind === 'square') return moveOnBoard(state, pieceId, target.file, target.rank, events);
  return recallToSlot(state, pieceId, target.index);
}

const CLICK_DIST = 6;      // px 미만 이동이면 클릭으로 간주

export class DragController {
  readonly interaction: Interaction = { dragging: null, selectedPieceId: null, hoverSquare: null };
  private ghost: HTMLDivElement;
  private downAt: { x: number; y: number } | null = null;
  private cooldownLabel: HTMLDivElement;

  constructor(
    private state: GameState,
    private layout: Layout,
    private events: GameEvent[],
  ) {
    this.ghost = document.createElement('div');
    this.ghost.style.cssText =
      'position:fixed;pointer-events:none;font-size:44px;z-index:10;display:none;' +
      'color:#fff;text-shadow:0 0 3px #000;transform:translate(-50%,-50%)';
    document.body.appendChild(this.ghost);
    this.cooldownLabel = document.createElement('div');
    this.cooldownLabel.style.cssText =
      'position:fixed;pointer-events:none;font:12px system-ui;color:#ffd54a;' +
      'background:#000a;padding:2px 6px;border-radius:4px;z-index:11;display:none';
    document.body.appendChild(this.cooldownLabel);

    document.addEventListener('pointerdown', this.onDown);
    document.addEventListener('pointermove', this.onMove);
    document.addEventListener('pointerup', this.onUp);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') this.interaction.selectedPieceId = null;
    });
  }

  private zones(): DropZones {
    return {
      board: this.layout.canvas.getBoundingClientRect(),
      slots: [...this.layout.slotGrid.children].map(c => c.getBoundingClientRect()),
      sell: this.layout.sellSlot.getBoundingClientRect(),
    };
  }

  /** 좌표 아래의 (기물, 출발지) — 슬롯 칸 또는 보드 칸 */
  private pieceUnder(x: number, y: number): { pieceId: string; from: 'slot' | 'board' } | null {
    const t = pickDropTarget(x, y, this.zones());
    if (t?.kind === 'slot') {
      const p = this.state.pieces.find(pc => pc.slotIndex === t.index);
      return p ? { pieceId: p.id, from: 'slot' } : null;
    }
    if (t?.kind === 'square') {
      const p = pieceAt(this.state, t.file, t.rank);
      return p ? { pieceId: p.id, from: 'board' } : null;
    }
    return null;
  }

  private onDown = (e: PointerEvent): void => {
    if (this.state.paused || e.button !== 0) return;   // 일시정지 중 조작 불가 (스펙 7.7)
    this.downAt = { x: e.clientX, y: e.clientY };
    const hit = this.pieceUnder(e.clientX, e.clientY);
    if (!hit) return;
    const piece = findPiece(this.state, hit.pieceId)!;
    if (piece.type === 'knight' && hit.from === 'board' && piece.cooldown > 0) {
      this.showCooldown(e, piece.cooldown);            // 쿨다운 중: 시작 거부 + 표시 (스펙 5.3)
      return;
    }
    this.interaction.dragging = hit;
    this.ghost.textContent = ALLY_GLYPH[piece.type];
    this.moveGhost(e);
  };

  private onMove = (e: PointerEvent): void => {
    const t = pickDropTarget(e.clientX, e.clientY, this.zones());
    this.interaction.hoverSquare = t?.kind === 'square' ? { file: t.file, rank: t.rank } : null;
    const d = this.interaction.dragging;
    if (!d) return;
    this.moveGhost(e);
    const piece = findPiece(this.state, d.pieceId);
    const overSell = t?.kind === 'sell';
    this.layout.sellSlot.classList.toggle('armed', overSell);
    this.layout.sellSlot.querySelector('#sell-preview')!.textContent =
      overSell && piece ? `+${sellPrice(piece.type)}G` : '';   // 환급 프리뷰 (스펙 7.3)
  };

  private onUp = (e: PointerEvent): void => {
    const wasClick = this.downAt
      && Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) < CLICK_DIST;
    this.downAt = null;
    const d = this.interaction.dragging;
    this.interaction.dragging = null;
    this.ghost.style.display = 'none';
    this.layout.sellSlot.classList.remove('armed');
    this.layout.sellSlot.querySelector('#sell-preview')!.textContent = '';
    if (this.state.paused) return;

    if (d && !wasClick) {                               // 드래그 드롭
      dropAction(this.state, d.pieceId, d.from, pickDropTarget(e.clientX, e.clientY, this.zones()), this.events);
      return;
    }
    if (!wasClick) return;
    // 클릭-투-무브 (스펙 7.5 권장)
    const sel = this.interaction.selectedPieceId;
    const hit = this.pieceUnder(e.clientX, e.clientY);
    if (sel && (!hit || hit.pieceId !== sel)) {
      const piece = findPiece(this.state, sel);
      if (piece) {
        const from: 'slot' | 'board' = piece.square ? 'board' : 'slot';
        dropAction(this.state, sel, from, pickDropTarget(e.clientX, e.clientY, this.zones()), this.events);
      }
      this.interaction.selectedPieceId = null;
      return;
    }
    this.interaction.selectedPieceId = hit && hit.pieceId !== sel ? hit.pieceId : null;
  };

  private moveGhost(e: PointerEvent): void {
    this.ghost.style.display = 'block';
    this.ghost.style.left = `${e.clientX}px`;
    this.ghost.style.top = `${e.clientY}px`;
  }

  private showCooldown(e: PointerEvent, remain: number): void {
    this.cooldownLabel.textContent = `이동 쿨다운 ${remain.toFixed(1)}s`;
    this.cooldownLabel.style.left = `${e.clientX + 12}px`;
    this.cooldownLabel.style.top = `${e.clientY - 8}px`;
    this.cooldownLabel.style.display = 'block';
    setTimeout(() => { this.cooldownLabel.style.display = 'none'; }, 800);
  }
}
