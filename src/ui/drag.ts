import { CONFIG } from '../config';
import { moveOnBoard, pieceAt, placeFromSlot, recallToSlot, reorderSlots, findPiece } from '../core/pieces';
import { sellPiece, sellPrice } from '../core/economy';
import type { GameEvent, GameState, Interaction } from '../types';
import type { Layout } from './layout';
import { ALLY_GLYPH } from '../render/renderer';

export interface RectLike { left: number; top: number; width: number; height: number }
export interface DropZones { board: RectLike; slots: RectLike[]; sell: RectLike }
export type DropTarget =
  | { kind: 'square'; file: number; rank: number }
  | { kind: 'slot'; index: number }
  | { kind: 'sell' }
  | null;

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
  private cooldownTimer: ReturnType<typeof setTimeout> | null = null;
  private zonesCache: DropZones | null = null;

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
    document.addEventListener('pointercancel', this.onCancel);   // 터치 취소 등 (검토 Finding 3)
    document.addEventListener('pointerleave', this.onPointerLeave); // 창 밖으로 나가면 hover 해제 (검토 Finding 8)
    document.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('resize', this.invalidateZones);      // 레이아웃 캐시 무효화 (검토 Finding 6)
    window.addEventListener('scroll', this.invalidateZones, true);
  }

  /** 모든 document/window 리스너와 고스트·라벨 DOM을 제거한다 (검토 Finding 7 — 테스트 격리·재구성용) */
  destroy(): void {
    document.removeEventListener('pointerdown', this.onDown);
    document.removeEventListener('pointermove', this.onMove);
    document.removeEventListener('pointerup', this.onUp);
    document.removeEventListener('pointercancel', this.onCancel);
    document.removeEventListener('pointerleave', this.onPointerLeave);
    document.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('resize', this.invalidateZones);
    window.removeEventListener('scroll', this.invalidateZones, true);
    if (this.cooldownTimer !== null) clearTimeout(this.cooldownTimer);
    this.ghost.remove();
    this.cooldownLabel.remove();
  }

  /** 캔버스/슬롯/판매 슬롯의 getBoundingClientRect는 매 pointermove(~100Hz)마다 부르면 강제 레이아웃을
   *  유발한다 (스펙 9.4 — 드래그 응답성이 곧 보스전 난이도). 드래그 시작 시점에 한 번 새로 읽고,
   *  이후에는 resize/scroll이 오기 전까지 캐시를 재사용한다. hoverSquare는 드래그 중이 아니어도
   *  계속 갱신돼야 하므로(Task 18 범위 미리보기), 캐시만 하고 계산 자체를 건너뛰지는 않는다. */
  private invalidateZones = (): void => {
    this.zonesCache = null;
  };

  private zones(): DropZones {
    if (!this.zonesCache) {
      this.zonesCache = {
        board: this.layout.canvas.getBoundingClientRect(),
        slots: [...this.layout.slotGrid.children].map(c => c.getBoundingClientRect()),
        sell: this.layout.sellSlot.getBoundingClientRect(),
      };
    }
    return this.zonesCache;
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

  private hideGhost(): void {
    this.ghost.style.display = 'none';
  }

  private clearSellPreview(): void {
    this.layout.sellSlot.classList.remove('armed');
    this.layout.sellSlot.querySelector('#sell-preview')!.textContent = '';
  }

  private onDown = (e: PointerEvent): void => {
    if (this.state.paused || e.button !== 0) return;   // 일시정지 중 조작 불가 (스펙 7.7)
    this.zonesCache = null;                             // 드래그 시작 시점의 최신 레이아웃으로 갱신
    this.downAt = { x: e.clientX, y: e.clientY };
    const hit = this.pieceUnder(e.clientX, e.clientY);
    if (!hit) return;
    const piece = findPiece(this.state, hit.pieceId)!;
    if (piece.type === 'knight' && hit.from === 'board' && piece.cooldown > 0) {
      this.showCooldown(e, piece.cooldown);            // 쿨다운 중: 시작 거부 + 표시 (스펙 5.3)
      // downAt을 비워 onUp이 "클릭"으로 오인하지 않게 한다 (검토 Item 1) — 그렇지 않으면 드래그
      // 시작이 거부된 이 눌림이 onUp에서 클릭-투-무브로 새어나가 쿨다운 중인 나이트가 그대로
      // selectedPieceId가 되고, buildHighlights가 (결과가 비어 있더라도) 선택 상태를 만든다.
      // 애초에 "거부된 눌림"이 어떤 제스처로도 이어지지 않게 막는 편이 더 명확하다.
      this.downAt = null;
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
    if (d) this.moveGhost(e);

    // 판매 프리뷰는 드래그 중인 기물뿐 아니라 클릭으로 선택된 기물에도 적용된다
    // (검토 Finding 1 — 스펙 7.3의 프리뷰는 확인창이 없는 유일한 안전장치이므로 두 제스처 모두 필요).
    const activeId = d?.pieceId ?? this.interaction.selectedPieceId;
    const piece = activeId ? findPiece(this.state, activeId) : undefined;
    const overSell = t?.kind === 'sell' && !!piece;
    this.layout.sellSlot.classList.toggle('armed', overSell);
    this.layout.sellSlot.querySelector('#sell-preview')!.textContent =
      overSell ? `+${sellPrice(piece!.type)}G` : '';
  };

  private onUp = (e: PointerEvent): void => {
    if (e.button !== 0) return;                        // 좌클릭 해제만 드롭으로 취급 (검토 Finding 4)
    const wasClick = this.downAt
      && Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) < CLICK_DIST;
    this.downAt = null;
    const d = this.interaction.dragging;
    this.interaction.dragging = null;
    this.hideGhost();
    this.clearSellPreview();
    if (this.state.paused) return;

    if (d && !wasClick) {                               // 드래그 드롭
      dropAction(this.state, d.pieceId, d.from, pickDropTarget(e.clientX, e.clientY, this.zones()), this.events);
      this.interaction.selectedPieceId = null;           // 드래그 후에는 이전 클릭 선택을 남기지 않는다 (검토 Finding 1)
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

  /** 포인터 취소(터치 취소 등) — 드롭을 시도하지 않고 진행 중이던 제스처만 정리한다 (검토 Finding 3) */
  private onCancel = (): void => {
    this.downAt = null;
    this.interaction.dragging = null;
    this.hideGhost();
    this.clearSellPreview();
  };

  /** 포인터가 창 밖으로 나가면 hover 표시를 남기지 않는다 (검토 Finding 8) */
  private onPointerLeave = (): void => {
    this.interaction.hoverSquare = null;
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    this.interaction.selectedPieceId = null;
    if (this.interaction.dragging) {                     // 진행 중인 드래그도 함께 취소한다 (검토 Finding 3)
      this.interaction.dragging = null;
      this.downAt = null;
      this.hideGhost();
      this.clearSellPreview();
    }
  };

  private moveGhost(e: PointerEvent): void {
    this.ghost.style.display = 'block';
    this.ghost.style.left = `${e.clientX}px`;
    this.ghost.style.top = `${e.clientY}px`;
  }

  private showCooldown(e: PointerEvent, remain: number): void {
    if (this.cooldownTimer !== null) clearTimeout(this.cooldownTimer);   // 중첩 타이머 방지 (검토 Finding 5)
    this.cooldownLabel.textContent = `이동 쿨다운 ${remain.toFixed(1)}s`;
    this.cooldownLabel.style.left = `${e.clientX + 12}px`;
    this.cooldownLabel.style.top = `${e.clientY - 8}px`;
    this.cooldownLabel.style.display = 'block';
    this.cooldownTimer = setTimeout(() => {
      this.cooldownLabel.style.display = 'none';
      this.cooldownTimer = null;
    }, 800);
  }
}
