import { CONFIG } from '../config';
import { moveOnBoard, pieceAt, placeFromSlot, recallToSlot, reorderSlots, findPiece } from '../core/pieces';
import { sellPiece, sellPrice } from '../core/economy';
import type { UiAudio } from '../audio';
import type { GameEvent, GameState, Interaction } from '../types';
import { PIECE_NAME, type Layout } from './layout';
import { ALLY_SPRITE_URL } from '../render/sprites';

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
  private ghostImg: HTMLImageElement;
  private downAt: { x: number; y: number } | null = null;
  private cooldownLabel: HTMLDivElement;
  private cooldownTimer: ReturnType<typeof setTimeout> | null = null;
  private zonesCache: DropZones | null = null;

  constructor(
    private state: GameState,
    private layout: Layout,
    private events: GameEvent[],
    private audio: UiAudio,
  ) {
    this.ghost = document.createElement('div');
    this.ghost.className = 'drag-ghost';
    this.ghost.style.cssText =
      'position:fixed;pointer-events:none;z-index:10;display:none;transform:translate(-50%,-50%)';
    // 고스트는 <img> 하나만 담는다. .drag-ghost-icon 클래스(style.css)가 빠지면 <img>는 SVG의
    // width/height 속성값 그대로인 45×45로 고정 렌더된다 — 45×45는 부모(.drag-ghost, 48×48)보다
    // 오히려 작아 뷰포트를 뒤덮는 일은 일어나지 않는다(그건 PNG 시절 얘기고, 45×45 SVG로는
    // 재검토에서 재현되지 않음을 실측 확인했다). 그래도 클래스를 유지하는 진짜 이유는: 클래스가
    // 없으면 이미지가 45×45에 고정된 채여서 나중에 .drag-ghost 크기를 바꿔도 따라가지 못하고,
    // object-fit:contain도 빠져 종횡비 보정이 없어진다 — 반드시 이 클래스를 유지한다.
    this.ghostImg = document.createElement('img');
    this.ghostImg.className = 'drag-ghost-icon';
    // el.draggable = false만으로는 브라우저 간(그리고 이 저장소의 happy-dom 테스트 환경) 요소
    // 속성에 반영된다는 보장이 없다 — draggable="false" 속성 자체를 명시적으로 박아 둔다.
    this.ghostImg.setAttribute('draggable', 'false');
    this.ghost.appendChild(this.ghostImg);
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
    this.ghostImg.src = ALLY_SPRITE_URL[piece.type];
    this.ghostImg.alt = PIECE_NAME[piece.type];
    this.moveGhost(e);
    // 집기/선택 시작(uiPickup)은 소리를 내지 않는다 — v1.3에서는 짧은 틱음을 냈지만, 사용자가
    // 실제로 들어보고 무음이 낫다고 판단해 v1.4에서 큐 자체를 제거했다(게인 0이 아니라 삭제).
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
      const target = pickDropTarget(e.clientX, e.clientY, this.zones());
      const ok = dropAction(this.state, d.pieceId, d.from, target, this.events);
      this.playDropCue(d.from, target, ok);
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
        const target = pickDropTarget(e.clientX, e.clientY, this.zones());
        const ok = dropAction(this.state, sel, from, target, this.events);
        this.playDropCue(from, target, ok);
      }
      this.interaction.selectedPieceId = null;
      return;
    }
    // 새 선택이든 해제든 소리는 나지 않는다(v1.4 — 위 onDown 주석 참고).
    this.interaction.selectedPieceId = hit && hit.pieceId !== sel ? hit.pieceId : null;
  };

  /**
   * 드롭/클릭-투-무브 결과에 맞는 사운드를 재생한다 (스펙 §10.1 v1.3).
   * - 거부(ok=false): uiInvalid — 게임이 이미 조용히 기물을 원위치로 되돌리는 그 순간의, 유일하게
   *   들리는 피드백이다.
   * - 판매(target.kind==='sell'): uiSell.
   * - 트레이 내 재정렬(from==='slot' && target.kind==='slot'): 스펙이 열거한 세 가지
   *   (트레이→보드 배치/보드→보드 이동/보드→트레이 회수)에 포함되지 않으므로 의도적으로 무음.
   * - 그 외 성공(트레이→보드 배치, 보드→보드 이동, 보드→트레이 회수): uiPlace.
   */
  private playDropCue(from: 'slot' | 'board', target: DropTarget, ok: boolean): void {
    if (!ok) { this.audio.playUi('uiInvalid', performance.now()); return; }
    if (!target) return;   // ok는 target이 있을 때만 true가 될 수 있다 — 타입 좁히기용 방어적 분기
    if (target.kind === 'sell') { this.audio.playUi('uiSell', performance.now()); return; }
    if (target.kind === 'slot' && from === 'slot') return;   // 재정렬 — 무음 (위 문서 참고)
    this.audio.playUi('uiPlace', performance.now());
  }

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
