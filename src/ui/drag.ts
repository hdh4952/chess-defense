import { moveOnBoard, pieceAt, findPiece } from '../core/pieces';
import { sellPiece, sellPrice } from '../core/economy';
import type { UiAudio } from '../audio';
import type { GameEvent, GameState, Interaction, Square } from '../types';
import { PIECE_NAME, type Layout } from './layout';
import { allySpriteUrl } from '../render/skins';

export interface RectLike { left: number; top: number; width: number; height: number }
export interface DropZones { board: RectLike; sell: RectLike }
export type DropTarget =
  | { kind: 'square'; file: number; rank: number }
  | { kind: 'sell' }
  | null;

function contains(r: RectLike, x: number, y: number): boolean {
  return x >= r.left && x < r.left + r.width && y >= r.top && y < r.top + r.height;
}

/**
 * 캔버스 로컬 좌표(0~640) → 그 아래 칸. 판 밖이면 null.
 *
 * ★ **v1.24에서 생긴 이음매다.** v1.23까지 보드는 직교 투영이라 화면 사각형과 판이 항등이었고,
 * 이 함수 자리에 `rect를 8등분한다`는 산수 두 줄이 있었다. 원근 쿼터뷰가 되면서 그 매핑이
 * **역투영**이 됐고, 그건 카메라를 아는 계층(render3d/)만 할 수 있다.
 *
 * 그래도 이 파일은 카메라를 몰라야 한다 — `ui/`가 `render3d/`를 의존하면 계층이 뒤집힌다
 * (types.ts의 `Interaction` 주석이 같은 문제를 다룬다). 그래서 **함수로 주입받는다**:
 * 여기는 "어디를 눌렀나"만 알고, "그 아래가 어느 칸인가"는 밖에서 온다.
 *
 * ★ **좌표는 0~1로 정규화해서 넘긴다** (v1.28). 캔버스가 보드보다 넓어지면서(플레이어 킹이
 * 판 밖에 선다) "캔버스 픽셀"이 더는 이 계층이 아는 값이 아니게 됐다 — 정규화하면 여기는
 * rect만 알면 되고 뷰 크기는 render3d/에 남는다.
 */
export type SquarePicker = (u: number, v: number) => Square | null;

/**
 * 화면 좌표 → 드롭 대상 (순수).
 *
 * ⚠️ **캔버스 안이라고 판 위인 것이 아니다** (v1.24). 원근에서 판은 사다리꼴이라 캔버스
 * 네 귀퉁이는 판 밖이고, `pickSquare`가 그때 null을 준다 — 그 경우 드롭은 실패(원위치 복귀)다.
 */
export function pickDropTarget(
  x: number, y: number, zones: DropZones, pickSquare: SquarePicker,
): DropTarget {
  if (contains(zones.sell, x, y)) return { kind: 'sell' };
  if (contains(zones.board, x, y)) {
    const sq = pickSquare(
      (x - zones.board.left) / zones.board.width,
      (y - zones.board.top) / zones.board.height,
    );
    return sq ? { kind: 'square', file: sq.file, rank: sq.rank } : null;
  }
  return null;
}

/**
 * 스펙 7.5 동작표 매핑 (순수). 실패 = 원위치 복귀.
 *
 * allowMerge — 이 드롭이 합성을 일으킬 수 있는가. 합성은 드래그 앤 드롭 전용이므로(사용자 결정)
 * 드래그 경로만 true를 넘기고 클릭-투-무브는 기본값 false 그대로 둔다. 같은 칸에 같은 종류
 * 기물을 놓는 조작이 드래그면 합성, 클릭이면 예전과 똑같은 맞교환이 된다.
 */
export function dropAction(
  state: GameState, pieceId: string,
  target: DropTarget, events: GameEvent[], allowMerge = false,
): boolean {
  if (!target) return false;
  if (target.kind === 'sell') return sellPiece(state, pieceId);
  // 출발지 분기가 v1.12에서 사라졌다 — 기물 보관함이 없어져 모든 드래그가 보드에서 시작한다.
  // 남은 목적지는 칸 아니면 판매 슬롯 둘뿐이고, 그 밖은 원위치 복귀다.
  return moveOnBoard(state, pieceId, target.file, target.rank, events, allowMerge);
}

const CLICK_DIST = 6;      // px 미만 이동이면 클릭으로 간주

export class DragController {
  readonly interaction: Interaction = { dragging: null, selectedPieceId: null, hoverSquare: null };
  private ghost: HTMLDivElement;
  private ghostImg: HTMLImageElement;
  private downAt: { x: number; y: number } | null = null;
  private zonesCache: DropZones | null = null;

  constructor(
    private state: GameState,
    private layout: Layout,
    private events: GameEvent[],
    private audio: UiAudio,
    /** 캔버스 좌표 → 칸. 카메라를 아는 계층이 넘겨준다 (위 `SquarePicker` 주석). */
    private pickSquare: SquarePicker,
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

    document.addEventListener('pointerdown', this.onDown);
    document.addEventListener('pointermove', this.onMove);
    document.addEventListener('pointerup', this.onUp);
    document.addEventListener('pointercancel', this.onCancel);   // 터치 취소 등 (검토 Finding 3)
    document.addEventListener('pointerleave', this.onPointerLeave); // 창 밖으로 나가면 hover 해제 (검토 Finding 8)
    document.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('resize', this.invalidateZones);      // 레이아웃 캐시 무효화 (검토 Finding 6)
    window.addEventListener('scroll', this.invalidateZones, true);
  }

  /** 모든 document/window 리스너와 고스트 DOM을 제거한다 (검토 Finding 7 — 테스트 격리·재구성용) */
  destroy(): void {
    document.removeEventListener('pointerdown', this.onDown);
    document.removeEventListener('pointermove', this.onMove);
    document.removeEventListener('pointerup', this.onUp);
    document.removeEventListener('pointercancel', this.onCancel);
    document.removeEventListener('pointerleave', this.onPointerLeave);
    document.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('resize', this.invalidateZones);
    window.removeEventListener('scroll', this.invalidateZones, true);
    this.ghost.remove();
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
        sell: this.layout.sellSlot.getBoundingClientRect(),
      };
    }
    return this.zonesCache;
  }

  /** 좌표 아래의 기물 — v1.12부터 보드 칸 하나만 본다(트레이가 사라졌다) */
  private pieceUnder(x: number, y: number): { pieceId: string } | null {
    const t = pickDropTarget(x, y, this.zones(), this.pickSquare);
    if (t?.kind === 'square') {
      const p = pieceAt(this.state, t.file, t.rank);
      return p ? { pieceId: p.id } : null;
    }
    return null;
  }

  private hideGhost(): void {
    this.ghost.style.display = 'none';
  }

  /*
   * ⚠️ 여기 있던 snapGhostTo(드롭 성공 시 고스트를 착지 칸으로 back-out 이징으로 붙이는 연출)를
   * v1.17에서 제거했다 — **사용자가 되돌리기를 요청했다.** back-out은 목표를 지나쳤다 되돌아
   * 오므로 기물이 흔들리는 것처럼 보이고, 그것이 이 게임의 조작감과 맞지 않았다.
   *
   * 되살릴 일이 있으면 "왜 넣었는지"는 남겨 둔다: 드롭 즉시 감추면 "어디에 놓였는가"가 눈으로
   * 따라가지지 않는다는 판단이었다. 다만 그 문제를 풀 방법이 오버슈트만은 아니다 — 착지 칸을
   * 한 프레임 강조하는 것처럼 **움직이지 않는** 표현도 같은 일을 한다.
   */
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
    // ⚠️ v1.10 이전에는 여기서 "쿨다운 중인 나이트는 집을 수조차 없다"고 거부하고 커서 옆에
    // 남은 시간을 띄웠다. 폭발이 사라지면서 그 게이트의 근거가 통째로 없어졌으므로(감속은
    // 언제 움직였는지와 무관하다) **모든 기물이 항상 집힌다.** 거부는 놓는 시점으로 미뤄지고,
    // L자가 아닌 칸에 떨어뜨리면 dropAction의 moveOnBoard가 false를 돌려주어 기존 uiInvalid
    // 경로로 자연히 흡수된다 — 새로 만들 처리가 없다.
    this.interaction.dragging = hit;
    this.ghostImg.src = allySpriteUrl(piece.type);
    this.ghostImg.alt = PIECE_NAME[piece.type];
    this.moveGhost(e);
    // 집기/선택 시작(uiPickup)은 소리를 내지 않는다 — v1.3에서는 짧은 틱음을 냈지만, 사용자가
    // 실제로 들어보고 무음이 낫다고 판단해 v1.4에서 큐 자체를 제거했다(게인 0이 아니라 삭제).
  };

  private onMove = (e: PointerEvent): void => {
    const t = pickDropTarget(e.clientX, e.clientY, this.zones(), this.pickSquare);
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
      overSell ? `+${sellPrice(piece!.type, piece!.tier)}G` : '';   // tier 누락은 현존 버그였다
  };

  private onUp = (e: PointerEvent): void => {
    if (e.button !== 0) return;                        // 좌클릭 해제만 드롭으로 취급 (검토 Finding 4)
    const wasClick = this.downAt
      && Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) < CLICK_DIST;
    this.downAt = null;
    const d = this.interaction.dragging;
    this.interaction.dragging = null;
    this.clearSellPreview();
    if (this.state.paused) { this.hideGhost(); return; }

    if (d && !wasClick) {                               // 드래그 드롭
      const target = pickDropTarget(e.clientX, e.clientY, this.zones(), this.pickSquare);
      // 드래그 경로만 합성을 허용한다 (사용자 결정 — 합성은 비가역이므로 "직접 집어 겹쳐 놓는"
      // 명확한 의도의 제스처에만 붙인다). 아래 클릭-투-무브 경로는 이 인자를 넘기지 않으므로
      // 같은 종류 기물 위에 놓아도 예전 그대로 맞교환이다.
      const ok = dropAction(this.state, d.pieceId, target, this.events, true);
      this.hideGhost();
      this.playDropCue(target, ok);
      this.interaction.selectedPieceId = null;           // 드래그 후에는 이전 클릭 선택을 남기지 않는다 (검토 Finding 1)
      return;
    }
    this.hideGhost();
    if (!wasClick) return;
    // 클릭-투-무브 (스펙 7.5 권장)
    const sel = this.interaction.selectedPieceId;
    const hit = this.pieceUnder(e.clientX, e.clientY);
    if (sel && (!hit || hit.pieceId !== sel)) {
      if (findPiece(this.state, sel)) {
        const target = pickDropTarget(e.clientX, e.clientY, this.zones(), this.pickSquare);
        const ok = dropAction(this.state, sel, target, this.events);
        this.playDropCue(target, ok);
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
   * - 그 외 성공(= 보드 → 보드 이동): uiPlace.
   *
   * ⚠️ v1.12에서 출발지 인자가 사라졌다. 트레이가 없어지면서 "트레이 내 재정렬은 무음"이라는
   * 예외 하나가 함께 사라졌고, 남은 성공 경로가 이동 하나뿐이라 분기가 필요 없어졌다.
   */
  private playDropCue(target: DropTarget, ok: boolean): void {
    if (!ok) { this.audio.playUi('uiInvalid', performance.now()); return; }
    if (!target) return;   // ok는 target이 있을 때만 true가 될 수 있다 — 타입 좁히기용 방어적 분기
    if (target.kind === 'sell') { this.audio.playUi('uiSell', performance.now()); return; }
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

}
