import { canLandAt, findPiece } from '../core/pieces';
import { attackTargets, knightMoves, queenLines } from '../core/patterns';
import { sameSquare } from '../core/grid';
import type { GameState, Interaction, Piece, Square } from '../types';
import type { ViewState } from './renderer';

const C = {
  range: 'rgba(80, 160, 255, 0.35)',     // 공격 범위
  move: 'rgba(90, 200, 90, 0.40)',       // 나이트 이동 가능 칸
  queenLine: 'rgba(255, 213, 74, 0.55)', // 퀸 8방향 라인
  origin: 'rgba(255, 255, 255, 0.25)',   // 기준 칸
};

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
      return { highlights, lines };
    }
    for (const sq of queenLines(anchor)) highlights.push({ square: sq, color: C.queenLine });
    for (const seg of queenLineSegments(anchor)) lines.push({ ...seg, color: C.queenLine });
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
    return { highlights, lines };
  }
  // 비숍/룩(및 나이트-슬롯의 3×3 폭발)은 attackTargets 자체가 자기 칸을 포함하므로, origin을
  // 별도로 push하면 같은 칸이 두 번 그려진다 (리뷰 Finding 2). attackTargets 결과에 이미 anchor가
  // 있는지로 판단해 중복을 피한다 — 폰처럼 자기 칸을 포함하지 않는 패턴에는 origin이 그대로 남는다.
  const targets = attackTargets(piece.type, anchor);
  if (!targets.some(sq => sameSquare(sq, anchor))) highlights.push({ square: anchor, color: C.origin });
  for (const sq of targets) highlights.push({ square: sq, color: C.range });
  return { highlights, lines };
}
