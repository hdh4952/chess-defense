import { canLandAt, findPiece } from '../core/pieces';
import { attackTargets, knightMoves, queenLines } from '../core/patterns';
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

export function buildHighlights(
  state: GameState, it: Interaction,
): Pick<ViewState, 'highlights' | 'lines'> {
  const highlights: ViewState['highlights'] = [];
  const lines: ViewState['lines'] = [];
  const piece = activePiece(state, it);
  if (!piece) return { highlights, lines };

  const onBoard = piece.square !== null;
  const anchor: Square | null = it.hoverSquare ?? piece.square;   // 미리보기 기준 칸
  if (!anchor) return { highlights, lines };

  if (piece.type === 'queen') {
    // hover가 실제 착지 제안일 때만 canLandAt으로 검증한다 — hover가 없어 anchor가 퀸의 현재 칸으로
    // 대체된 경우는 "제안"이 아니므로 검증 대상에서 제외한다. hover가 퀸 자신의 현재 칸을 가리키는
    // 경우도 별도 예외 없이 canLandAt이 자연히 통과시킨다 — 점유 칸이 더 이상 착지 실격 사유가
    // 아니게 되면서(게임 규칙 변경: 보드 위 기물은 점유 칸도 맞교환 대상), "자기 자신이 점유한
    // 칸"이라는 이유로 거부될 일 자체가 없어졌다. 예전에는 이 자기 칸 케이스만 따로 가려내는
    // hoveringOwnSquare 예외가 필요했지만(회귀 1), 이제 canLandAt 자체의 의미 변화에 흡수돼
    // 불필요해졌다 — 지웠는데도 이 브랜치의 세 회귀 1 테스트가 그대로 통과하는 것으로 확인했다.
    if (it.hoverSquare && !canLandAt(state, piece, it.hoverSquare)) {
      // 착지 불가 hover라 미리보기 전체를 접지만, "무엇이 선택됐는지"는 여기서도 계속 보여야
      // 한다 — 잘못된 칸에 hover한 순간 선택 표식마저 사라지면 오히려 방향을 잃는다.
      pushSelected(highlights, piece);
      return { highlights, lines };
    }
    for (const sq of queenLines(anchor)) highlights.push({ square: sq, color: C.queenLine });
    for (const seg of queenLineSegments(anchor)) lines.push({ ...seg, color: C.queenLine });
    pushSelected(highlights, piece);
    return { highlights, lines };
  }
  if (piece.type === 'knight' && onBoard) {
    // canLandAt 하나로 L자 + 이동 쿨다운 게이트를 적용한다 (검토 Item 1). 점유 칸은 더 이상 착지
    // 실격 사유가 아니다 (게임 규칙 변경, 사용자 승인 — 보드 위 기물은 점유 칸도 맞교환 대상) — 그
    // 결과 legalMoves는 점유된 L자 칸도 그대로 포함하고, 그 칸에 hover하면 폭발 미리보기가 뜬다
    // (moveOnBoard도 실제로 그 칸에서 스왑 후 폭발한다 — 미리보기와 실제 규칙이 어긋나지 않는다).
    // 쿨다운 중에는 여전히 어떤 후보 칸도 canLandAt을 통과하지 못해 legalMoves가 통째로 비고, 초록
    // 하이라이트도 폭발 미리보기도 뜨지 않는다 — moveOnBoard가 실제로 거부하는 것과 정확히 일치한다.
    // 초록 하이라이트와 hover 일치 판정 양쪽에 이 legalMoves 하나만 동일하게 사용한다 (리뷰 Finding 1
    // — 이전에는 hover 판정이 미필터링된 knightMoves()를 써서, 착지 불가능한 칸에도 폭발 미리보기가 떴다).
    const legalMoves = knightMoves(piece.square!).filter(m => canLandAt(state, piece, m));
    for (const m of legalMoves) highlights.push({ square: m, color: C.move });
    if (it.hoverSquare && legalMoves.some(m => sameSquare(m, it.hoverSquare!))) {
      for (const sq of attackTargets('knight', it.hoverSquare)) highlights.push({ square: sq, color: C.range });
    }
    // legalMoves가 쿨다운으로 통째로 비어도(위 쿨다운 케이스) 선택 표식은 그대로 남는다 —
    // "이동할 수 없다"와 "선택되지 않았다"는 다른 상태이므로.
    pushSelected(highlights, piece);
    return { highlights, lines };
  }
  // 폰/비숍/룩과 슬롯의 나이트: hover가 실제로 착지 불가능한 칸(8랭크·범위 밖, 그리고 트레이
  // 기물이라면 점유 칸까지)이면 moveOnBoard/placeFromSlot이 거부할 이동·배치·폭발을 미리 약속하지
  // 않도록 미리보기 자체를 그리지 않는다 (검토 Item 1). 보드 위 기물이 점유 칸(자기 자신의 현재
  // 칸 포함)에 hover하는 경우는 canLandAt이 더 이상 거부하지 않는다 — 점유 칸도 맞교환 대상으로
  // 허용되기 때문이다(게임 규칙 변경). 그 결과 "기물을 클릭해 사거리를 확인한다"는 가장 흔한
  // 조작(hover가 자기 칸과 같음)도 별도 예외 없이 canLandAt 하나로 자연히 통과한다 — 예전에
  // 필요했던 hoveringOwnSquare 예외(회귀 1)는 canLandAt의 의미 변화에 흡수돼 불필요해졌다.
  if (it.hoverSquare && !canLandAt(state, piece, it.hoverSquare)) {
    // 착지 불가 hover라 미리보기 전체를 접지만, 선택 표식은 여기서도 유지한다 (퀸 브랜치와 동일한
    // 이유 — 잘못된 칸에 hover했다고 "무엇이 선택됐는지"까지 사라지면 안 된다).
    pushSelected(highlights, piece);
    return { highlights, lines };
  }
  // 비숍/룩(및 나이트-슬롯의 3×3 폭발)은 attackTargets 자체가 자기 칸을 포함하므로, origin을
  // 별도로 push하면 같은 칸이 두 번 그려진다 (리뷰 Finding 2). attackTargets 결과에 이미 anchor가
  // 있는지로 판단해 중복을 피한다 — 폰처럼 자기 칸을 포함하지 않는 패턴에는 origin이 그대로 남는다.
  // anchor가 기물 자신의 칸과 같을 때도 origin을 건너뛴다 — 그 칸은 아래에서 pushSelected가
  // C.selected로 이미 표시하므로, 흰 반투명 origin까지 얹으면 같은 칸에 두 마커가 겹쳐 찍힌다.
  const targets = attackTargets(piece.type, anchor);
  const anchorIsOwnSquare = piece.square !== null && sameSquare(anchor, piece.square);
  if (!targets.some(sq => sameSquare(sq, anchor)) && !anchorIsOwnSquare) {
    highlights.push({ square: anchor, color: C.origin });
  }
  for (const sq of targets) highlights.push({ square: sq, color: C.range });
  pushSelected(highlights, piece);
  return { highlights, lines };
}
