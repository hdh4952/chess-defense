import { canLandAt, findPiece, resolveLanding } from '../core/pieces';
import { TRAITS } from '../config';
import { attackTargets, knightMoves, queenLines, slowTargets } from '../core/patterns';
import { sameSquare } from '../core/grid';
import type { GameState, Interaction, Piece, Square } from '../types';
import { SLOW_RGB } from './palette';
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
  // 감속 오라가 덮는 칸. 두 알파의 뜻이 "강한 감속 / 약한 감속"이 **아니라는 것**이 이 표식의
  // 전부다 — 감속은 정확히 ×0.7 한 번뿐이라 강도 축이 존재하지 않는다. 색을 하나만 두는 이유가
  // 그것이다. 얼음색(render/palette.ts)을 공유해서 캔버스의 상시 꺾쇠·적 고리·"−30%" 라벨과
  // 같은 능력이라는 것이 색으로 읽힌다.
  //
  // ★ 특히 queenLine(#009FD9)과 반드시 갈라져야 한다 — 아마존은 buffFactor>0이면서 감속도
  // 하는 유일한 기물이라, 한 번의 선택으로 두 색이 같은 화면에 동시에 그려진다.
  slow: `rgba(${SLOW_RGB}, 0.42)`,
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
 * 이 기물이 anchor 칸에서 덮는 칸 — **공격 사거리와 감속 범위를 합치지 않고 갈라서** 돌려준다.
 *
 * 예전에는 사거리 ∪ 폭발 범위의 합집합이었다. 그때는 둘 다 "여기 있으면 맞는다"라 한 색이
 * 맞았지만, 감속은 피해를 주지 않으므로 같은 주황으로 칠하면 거짓말이 된다 — 나이트는 이제
 * 공격력이 0이라 그 거짓말이 특히 크다. 색이 갈라지려면 배열부터 갈라져 있어야 한다.
 *
 * 중복 제거가 없어진 것도 그래서다. 두 집합이 겹칠 일이 없다(L자 오프셋은 대각선·직선·퀸
 * 라인 어디에도 속하지 않는다) — 겹치더라도 이제는 서로 다른 색으로 두 번 칠하는 것이 맞다.
 */
function previewRange(piece: Piece, anchor: Square): { attack: Square[]; slow: Square[] } {
  return {
    attack: attackTargets(piece.type, anchor),
    slow: slowTargets(piece.type, anchor),
  };
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

  // ── 나이트류(L자 이동 제한): 이동 후보를 초록으로 깔고, 그중 hover한 칸의 **착지 후 오라**를
  // 미리 보여준다. 현재 칸의 오라를 여기서 또 칠하지 않는 이유는 renderer가 이미 상시로 그리고
  // 있기 때문이다 — 여기서 겹쳐 칠하면 같은 칸에 알파가 두 겹 얹혀 "저기는 더 느리다"로 읽힌다.
  if (TRAITS[piece.type].moveL && onBoard) {
    // canLandAt 하나로 L자 게이트를 적용한다 (검토 Item 1). 점유 칸은 착지 실격 사유가 아니다 —
    // legalMoves는 점유된 L자 칸도 포함하고, moveOnBoard도 그 칸에서 스왑을 수행한다.
    // 초록 하이라이트와 hover 일치 판정 양쪽에 이 legalMoves 하나만 쓴다 (리뷰 Finding 1).
    const legalMoves = knightMoves(piece.square!).filter(m => canLandAt(state, piece, m));
    for (const m of legalMoves) highlights.push({ square: m, color: C.move });
    if (it.hoverSquare && legalMoves.some(m => sameSquare(m, it.hoverSquare!))) {
      const preview = previewRange(piece, it.hoverSquare);
      for (const sq of preview.attack) highlights.push({ square: sq, color: C.range });
      for (const sq of preview.slow) highlights.push({ square: sq, color: C.slow });
    }
    pushSelected(highlights, piece);
    return { highlights, lines, mergePreview };
  }

  // ── 그 외 전부: hover가 실제로 착지 불가능한 칸이면 미리보기 자체를 그리지 않는다. 그러지
  // 않으면 moveOnBoard/placeFromSlot이 거부할 이동·배치를 미리 약속하게 된다 (검토 Item 1).
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
  // 구조였는데, 버프와 감속을 겸하는 기물(아마존)이나 주기 공격과 감속을 겸하는 기물
  // (아치비숍·챈슬러)이 생기면서 한쪽이 통째로 사라졌다. 각 축을 독립적으로 얹는다.
  if (TRAITS[piece.type].buffFactor > 0) {
    for (const sq of queenLines(anchor)) highlights.push({ square: sq, color: C.queenLine });
    for (const seg of queenLineSegments(anchor)) lines.push({ ...seg, color: C.queenLine });
  }
  const { attack, slow } = previewRange(piece, anchor);
  const anchorIsOwnSquare = piece.square !== null && sameSquare(anchor, piece.square);
  // ★ 감속 링은 자기 칸(anchor)을 **포함하지 않는다** — 3×3 폭발은 포함했었다. 그래서 예전의
  // "targets가 anchor를 덮는가" 검사만으로는 버프 기물(아마존)에 origin이 새로 찍히는 회귀가
  // 생긴다. buffFactor 항이 그 구멍을 막는다(queenLines는 항상 자기 칸을 포함한다).
  // 반대로 트레이의 나이트는 origin이 찍히는 것이 **맞다** — L자 링만으로는 기물이 어디에
  // 서는지가 화면에 나오지 않기 때문이고, 이것은 의도된 동작 변경이다.
  const anchorCovered = attack.some(sq => sameSquare(sq, anchor)) || TRAITS[piece.type].buffFactor > 0;
  if (attack.length + slow.length > 0 && !anchorCovered && !anchorIsOwnSquare) {
    highlights.push({ square: anchor, color: C.origin });
  }
  for (const sq of attack) highlights.push({ square: sq, color: C.range });
  for (const sq of slow) highlights.push({ square: sq, color: C.slow });
  pushSelected(highlights, piece);
  return { highlights, lines, mergePreview };
}
