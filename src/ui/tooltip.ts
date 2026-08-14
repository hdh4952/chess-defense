import { CONFIG } from '../config';
import { pieceDamage } from '../core/combat';
import { sellPrice } from '../core/economy';
import { pieceAt } from '../core/pieces';
import type { GameState, Interaction } from '../types';
import { PIECE_NAME } from './layout';

/** 캔버스 위 기물 hover 툴팁 (스펙 7.7). mouse는 캔버스 클라이언트 좌표 */
export function updateTooltip(
  el: HTMLElement, state: GameState, it: Interaction, mouse: { x: number; y: number } | null,
): void {
  const sq = !it.dragging ? it.hoverSquare : null;
  const p = sq ? pieceAt(state, sq.file, sq.rank) : undefined;
  if (!p || !mouse) { el.hidden = true; return; }
  const def = CONFIG.pieces[p.type];
  // 나이트이면서 interval이 0(현재 설정 — 게임 규칙 변경으로 쿨다운 폐지)이면 "남은 쿨다운
  // 0.0s"를 바로 위 "이동 쿨다운 없음"과 나란히 보여주는 게 중복이다 — 어차피 이 나이트의
  // cooldown은 항상 0이므로(재무장이 즉시 일어남) 그 줄이 알려주는 정보가 없다. interval을
  // config에서 되돌리면(0이 아니게 되면) 이 줄도 자동으로 다시 나타난다.
  const suppressRemainingCooldown = p.type === 'knight' && def.interval === 0;
  const rows = p.type === 'queen'
    // 겹치는 퀸마다 배율이 한 단계씩 더 쌓인다 (recalcQueenBuffs: queenBuffCount += 1 per queen) —
    // "×2"로 고정 표기하면 두 번째 퀸이 아무 효과가 없다고 오해할 수 있다 (리뷰 Finding 3).
    ? ['공격력 — (버퍼)', `버프 효과: 겹치는 퀸마다 +100% (8방향 직선)`]
    : [
        `기본 공격력 ${def.damage} · 배율 ×${1 + p.queenBuffCount} · 최종 ${pieceDamage(p)}`,
        // 나이트는 이동 쿨다운을 표기한다. def.interval은 config 값 그대로이므로, 0(현재 설정 —
        // 게임 규칙 변경으로 나이트 쿨다운이 폐지됨)이면 "0s"처럼 거짓 정보를 주는 대신 쿨다운이
        // 없다는 사실을 그대로 알린다. interval을 config에서 되돌리면 문구도 자동으로 복원된다.
        p.type === 'knight'
          ? (def.interval > 0 ? `이동 쿨다운 ${def.interval}s` : '이동 쿨다운 없음')
          : `공격 주기 ${def.interval}s`,
        ...(suppressRemainingCooldown ? [] : [`남은 쿨다운 ${p.cooldown.toFixed(1)}s`]),
      ];
  el.innerHTML = `<b>${PIECE_NAME[p.type]}</b><br>${rows.join('<br>')}<br>판매가 ${sellPrice(p.type)}G`;
  el.hidden = false;
  el.style.left = `${mouse.x + 14}px`;
  el.style.top = `${mouse.y + 14}px`;
}
