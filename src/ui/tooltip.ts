import { CONFIG, tierMultiplier } from '../config';
import { pieceDamage, pieceGold } from '../core/combat';
import { sellPrice } from '../core/economy';
import { pieceAt } from '../core/pieces';
import { tierRingColor } from '../render/tiers';
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
        // 강화 단계는 별도 항목이 아니라 곱셈의 한 항으로 보여준다 — 최종 공격력이 어떻게
        // 나왔는지 한 줄로 읽혀야 한다. T1이면 ×1이라 생략한다(정보가 없는 항이므로).
        `기본 공격력 ${def.damage}`
          + (p.tier > 1 ? ` · 강화 ×${tierMultiplier(p.tier)}` : '')
          + ` · 배율 ×${1 + p.queenBuffCount} · 최종 ${pieceDamage(p)}`,
        // 나이트는 이동 쿨다운을 표기한다. def.interval은 config 값 그대로이므로, 0(현재 설정 —
        // 게임 규칙 변경으로 나이트 쿨다운이 폐지됨)이면 "0s"처럼 거짓 정보를 주는 대신 쿨다운이
        // 없다는 사실을 그대로 알린다. interval을 config에서 되돌리면 문구도 자동으로 복원된다.
        p.type === 'knight'
          ? (def.interval > 0 ? `이동 쿨다운 ${def.interval}s` : '이동 쿨다운 없음')
          : `공격 주기 ${def.interval}s`,
        // 골드를 벌지 않는 기물(현재 비숍 외 전부)에는 줄 자체를 만들지 않는다 — "공격당 +0G"는
        // 알려주는 정보가 없다. config에서 다른 기물에 값을 주면 그 기물에도 자동으로 나타난다.
        ...(def.goldPerAttack > 0 ? [`공격당 +${pieceGold(p)}G (버프 미적용)`] : []),
        ...(suppressRemainingCooldown ? [] : [`남은 쿨다운 ${p.cooldown.toFixed(1)}s`]),
      ];
  // 강화 단계는 이름 옆에 붙인다 — 툴팁의 모든 수치가 이 값에 비례하므로 가장 먼저 읽혀야 한다.
  const tierTag = p.tier > 1 ? ` <span style="color:${tierRingColor(p.tier)}">T${p.tier}</span>` : '';
  el.innerHTML = `<b>${PIECE_NAME[p.type]}${tierTag}</b><br>${rows.join('<br>')}`
    + `<br>판매가 ${sellPrice(p.type, p.tier)}G`;
  el.hidden = false;
  el.style.left = `${mouse.x + 14}px`;
  el.style.top = `${mouse.y + 14}px`;
}
