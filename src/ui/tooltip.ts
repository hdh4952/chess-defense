import { CONFIG } from '../config';
import { pieceDamage } from '../core/combat';
import { sellPrice } from '../core/economy';
import { pieceAt } from '../core/pieces';
import type { GameState } from '../types';
import type { Interaction } from './drag';
import { PIECE_NAME } from './layout';

/** 캔버스 위 기물 hover 툴팁 (스펙 7.7). mouse는 캔버스 클라이언트 좌표 */
export function updateTooltip(
  el: HTMLElement, state: GameState, it: Interaction, mouse: { x: number; y: number } | null,
): void {
  const sq = !it.dragging ? it.hoverSquare : null;
  const p = sq ? pieceAt(state, sq.file, sq.rank) : undefined;
  if (!p || !mouse) { el.hidden = true; return; }
  const def = CONFIG.pieces[p.type];
  const rows = p.type === 'queen'
    ? ['공격력 — (버퍼)', `버프 효과 ×2 (8방향 직선)`]
    : [
        `기본 공격력 ${def.damage} · 배율 ×${1 + p.queenBuffCount} · 최종 ${pieceDamage(p)}`,
        p.type === 'knight' ? `이동 쿨다운 ${def.interval}s` : `공격 주기 ${def.interval}s`,
        `남은 쿨다운 ${p.cooldown.toFixed(1)}s`,
      ];
  el.innerHTML = `<b>${PIECE_NAME[p.type]}</b><br>${rows.join('<br>')}<br>판매가 ${sellPrice(p.type)}G`;
  el.hidden = false;
  el.style.left = `${mouse.x + 14}px`;
  el.style.top = `${mouse.y + 14}px`;
}
