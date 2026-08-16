import { canLandAt, findPiece, resolveLanding } from '../core/pieces';
import { TRAITS } from '../config';
import { attackTargets, blastTargets, knightMoves, queenLines } from '../core/patterns';
import { sameSquare } from '../core/grid';
import type { GameState, Interaction, Piece, Square } from '../types';
import type { ViewState } from './renderer';

// export: 테스트가 하이라이트 색을 좌표 존재 여부뿐 아니라 실제 색상 상수와 비교해 단언할 수
// 있도록 한다(문자열을 테스트 쪽에 따로 하드코딩해 중복시키지 않기 위함).
// 아래 네 색은 사용자가 직접 지정한 팔레트다. 톤을 바꾸고 싶으면 이 표만 고치면 된다 —
// 호출부는 전부 이 상수를 참조한다.
export const HIGHLIGHT_COLORS = {
  range: 'rgba(235, 97, 80, 0.5)',       // 기물이 공격할 수 있는 칸
  move: 'rgba(90, 200, 90, 0.40)',       // 나이트 이동 가능 칸
  // 퀸의 버프 칸 (+ 8방향 라인). #009FD9에 알파 0.5 — 불투명하면 28칸이 보드를 통째로 덮어
  // 격자와 스폰 표식이 가려지고, 위에 얹히는 선택 표식(노랑 0.5)이 초록으로 변하며, 같은 색인
  // 8방향 라인이 칸 색에 묻혀 사라진다.
  queenLine: 'rgba(0, 159, 217, 0.5)',
  origin: 'rgba(255, 255, 255, 0.25)',   // 기준 칸 — hover가 가리키는 착지 예정 칸(폰 등)
  selected: 'rgba(255, 255, 0, 0.5)',    // 선택/드래그 중인 기물이 실제로 서 있는 칸
  // 합성 대상 칸. 마젠타는 기존 팔레트(주황 사거리·초록 이동·파랑 퀸라인·노랑 선택) 어느 것과도
  // 겹치지 않고, 강화 단계 6색(흰/녹/파/보/노/빨)과도 구분된다 — 합성 미리보기가 그 위에 결과
  // 티어 링을 겹쳐 그리므로 둘이 같은 색이면 안 된다.
  merge: 'rgba(214, 51, 132, 0.55)',
};
const C = HIGHLIGHT_COLORS;   // 내부에서는 짧은 이름으로 사용 (호출부 가독성)

/** 활성 기물: 드래그 중 우선, 없으면 클릭 선택 */
function activePiece(state: GameState, it: Interaction): Piece | null {
  const id = it.dragging?.pieceId ?? it.selectedPieceId;
  return id ? findPiece(state, id) ?? null : null;
}

/**
 * 퀸의 8방향 라인을 anchor→각 방향 최원거리 칸의 선분으로 변환한다 (스펙 7.7 "8방향 라인 표시").
 * queenLines()가 반환하는 평탄화된 칸 목록을 anchor 기준 방향 부호(dx,dy)로 그룹핑해 방향당
 * 가장 먼 칸만 남긴다 — DIAG/ORTHO 오프셋을 여기서 다시 정의하지 않고 patterns.ts의 결과만으로
 * 방향을 복원하므로, 이 선분이 실제 버프 범위(queenLines)와 어긋날 수 없다.
 */
function queenLineSegments(anchor: Square): { from: Square; to: Square }[] {
  const furthest = new Map<string, { sq: Square; dist: number }>();
  for (const sq of queenLines(anchor)) {
    if (sameSquare(sq, anchor)) continue;
    const dx = Math.sign(sq.file - anchor.file);
    const dy = Math.sign(sq.rank - anchor.rank);
    const dist = Math.max(Math.abs(sq.file - anchor.file), Math.abs(sq.rank - anchor.rank));
    const key = `${dx},${dy}`;
    const cur = furthest.get(key);
    if (!cur || dist > cur.dist) furthest.set(key, { sq, dist });
  }
  return [...furthest.values()].map(({ sq }) => ({ from: anchor, to: sq }));
}

/**
 * 선택/드래그 중인 기물이 실제로 서 있는 칸(anchor가 아니라 piece.square 그 자체)을 표시한다
 * (사용자 요청 — 클릭-투-무브 중에는 사거리 미리보기가 마우스를 따라가므로, 두 클릭 사이에는
 * "무엇이 선택됐는지"를 보여줄 게 이 표식뿐이다). 트레이 기물(piece.square === null)은 보드 칸이
 * 없으므로 아무것도 push하지 않는다. 항상 각 브랜치의 마지막에 호출해야 한다 — render()는 배열
 * 순서대로 알파 블렌드하므로, range/queenLine 채우기보다 먼저 push되면 그 밑에 묻혀 버린다
 * (선택 칸은 대개 기물 자신의 사거리 안이기도 하다 — 비숍/룩/퀸 패턴이 자기 칸을 포함하므로).
 */
function pushSelected(highlights: ViewState['highlights'], piece: Piece): void {
  if (piece.square) highlights.push({ square: piece.square, color: C.selected });
}

/**
 * 이 기물이 anchor 칸에서 실제로 덮는 칸 — 주기 공격 사거리와 폭발 범위의 **합집합**이다.
 * 둘을 겸하는 기물(아치비숍·챈슬러)이 생기면서 하나만 그리면 절반이 사라진다. 중복은 제거한다
 * — 나이트처럼 attackTargets가 폭발 범위를 폴백으로 돌려주는 경우 같은 칸이 두 번 들어온다.
 */
function previewRange(piece: Piece, anchor: Square): Square[] {
  const t = TRAITS[piece.type];
  const pattern = t.pattern === 'none' ? [] : attackTargets(piece.type, anchor);
  const blast = blastTargets(piece.type, anchor);
  const seen = new Set<string>();
  return [...pattern, ...blast].filter(sq => {
    const k = `${sq.file},${sq.rank}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function buildHighlights(
  state: GameState, it: Interaction,
): Pick<ViewState, 'highlights' | 'lines' | 'mergePreview'> {
  const highlights: ViewState['highlights'] = [];
  const lines: ViewState['lines'] = [];
  let mergePreview: ViewState['mergePreview'] = null;
  const piece = activePiece(state, it);
  if (!piece) return { highlights, lines, mergePreview };

  const onBoard = piece.square !== null;
  const anchor: Square | null = it.hoverSquare ?? piece.square;   // 미리보기 기준 칸
  if (!anchor) return { highlights, lines, mergePreview };

  // 합성 미리보기 — allowMerge를 "드래그 중인가"에서 유도한다. drag.ts의 드롭 경로가 넘기는
  // 값과 같은 사실에서 나온 같은 값이므로, 미리보기가 실제로는 일어나지 않을 합성을 약속할 수
  // 없다(합성은 드래그 전용이라 클릭-투-무브 중에는 여기서도 null이 된다). 판정 자체를
  // resolveLanding 하나에 위임하는 것도 같은 이유다 — 8랭크·나이트 L자/쿨다운·티어 상한 게이트를
  // 미리보기가 따로 재구현하지 않는다.
  if (it.dragging && it.hoverSquare) {
    const landing = resolveLanding(state, piece, it.hoverSquare, true);
    if (landing.kind === 'merge') {
      mergePreview = { square: { ...it.hoverSquare }, tier: landing.resultTier };
      highlights.push({ square: { ...it.hoverSquare }, color: C.merge });
      pushSelected(highlights, piece);
      // 합성은 이동이 아니라 흡수다 — 사거리 미리보기를 그리면 "이 칸으로 옮겨간다"는 잘못된
      // 인상을 준다. 결과 티어를 보여주는 것으로 충분하다.
      return { highlights, lines, mergePreview };
    }
  }

  // ── 나이트류(L자 이동 제한): 폭발이 "착지 지점"에 묶여 있어 성질이 다르므로 따로 다룬다.
  // 아래 가산 블록처럼 anchor 기준으로 폭발을 그리면, 보드 위 나이트가 **자기 현재 칸**에서
  // 터지는 것처럼 보인다 — 실제로는 L자로 착지한 칸에서만 터진다.
  if (TRAITS[piece.type].moveL && onBoard) {
    // canLandAt 하나로 L자 + 이동 쿨다운 게이트를 적용한다 (검토 Item 1). 점유 칸은 더 이상 착지
    // 실격 사유가 아니다 — legalMoves는 점유된 L자 칸도 포함하고, 그 칸에 hover하면 폭발
    // 미리보기가 뜬다(moveOnBoard도 실제로 그 칸에서 스왑 후 폭발한다). 쿨다운 중에는 어떤
    // 후보도 통과하지 못해 legalMoves가 통째로 비고 초록도 폭발 미리보기도 뜨지 않는다 —
    // moveOnBoard가 실제로 거부하는 것과 정확히 일치한다. 초록 하이라이트와 hover 일치 판정
    // 양쪽에 이 legalMoves 하나만 쓴다 (리뷰 Finding 1).
    const legalMoves = knightMoves(piece.square!).filter(m => canLandAt(state, piece, m));
    for (const m of legalMoves) highlights.push({ square: m, color: C.move });
    if (it.hoverSquare && legalMoves.some(m => sameSquare(m, it.hoverSquare!))) {
      for (const sq of previewRange(piece, it.hoverSquare)) {
        highlights.push({ square: sq, color: C.range });
      }
    }
    // legalMoves가 쿨다운으로 비어도 선택 표식은 남는다 — "이동할 수 없다"와 "선택되지
    // 않았다"는 다른 상태다.
    pushSelected(highlights, piece);
    return { highlights, lines, mergePreview };
  }

  // ── 그 외 전부: hover가 실제로 착지 불가능한 칸이면 미리보기 자체를 그리지 않는다. 그러지
  // 않으면 moveOnBoard/placeFromSlot이 거부할 이동·배치·폭발을 미리 약속하게 된다 (검토 Item 1).
  // 보드 위 기물이 점유 칸(자기 칸 포함)에 hover하는 경우는 canLandAt이 거부하지 않는다 —
  // 점유 칸도 맞교환 대상이기 때문이고, 덕분에 "기물을 클릭해 사거리를 확인한다"는 가장 흔한
  // 조작이 별도 예외 없이 통과한다.
  if (it.hoverSquare && !canLandAt(state, piece, it.hoverSquare)) {
    // 미리보기는 접되 선택 표식은 남긴다 — 잘못된 칸에 hover했다고 "무엇이 선택됐는지"까지
    // 사라지면 오히려 방향을 잃는다.
    pushSelected(highlights, piece);
    return { highlights, lines, mergePreview };
  }

  // ★ 여기부터는 **가산**이다. 예전에는 퀸이면 버프 라인만, 아니면 사거리만 그리는 배타
  // 구조였는데, 버프와 공격을 겸하는 기물(아마존)이나 주기 공격과 폭발을 겸하는 기물
  // (아치비숍·챈슬러)이 생기면서 한쪽이 통째로 사라졌다. 각 축을 독립적으로 얹는다.
  if (TRAITS[piece.type].buffFactor > 0) {
    for (const sq of queenLines(anchor)) highlights.push({ square: sq, color: C.queenLine });
    for (const seg of queenLineSegments(anchor)) lines.push({ ...seg, color: C.queenLine });
  }
  const targets = previewRange(piece, anchor);
  const anchorIsOwnSquare = piece.square !== null && sameSquare(anchor, piece.square);
  // targets가 비어 있으면(퀸처럼 공격이 없는 기물) origin을 찍지 않는다 — 표시할 사거리가
  // 없는데 기준 칸만 덩그러니 남으면 "여기 뭔가 있다"는 잘못된 신호가 된다.
  if (targets.length > 0 && !targets.some(sq => sameSquare(sq, anchor)) && !anchorIsOwnSquare) {
    highlights.push({ square: anchor, color: C.origin });
  }
  for (const sq of targets) highlights.push({ square: sq, color: C.range });
  pushSelected(highlights, piece);
  return { highlights, lines, mergePreview };
}
