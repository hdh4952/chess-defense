import { CONFIG, TRAITS, tierMultiplier } from '../config';
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
  const suppressRemainingCooldown = TRAITS[p.type].blast && def.interval === 0;
  const t = TRAITS[p.type];
  // ★ 배타 삼항을 **가산**으로 바꿨다. 예전에는 "퀸이면 버퍼 3행, 아니면 데미지 4행"이었는데,
  // 버프와 공격을 겸하는 기물(아마존)이 생기면서 그 구조로는 한쪽이 통째로 사라진다.
  // 각 행을 "이 기물이 그 성질을 갖는가"로 독립 판단한다.
  const rows: string[] = [];

  if (def.damage > 0) {
    // 강화 단계는 별도 항목이 아니라 곱셈의 한 항으로 보여준다 — 최종 공격력이 어떻게 나왔는지
    // 한 줄로 읽혀야 한다. T1이면 ×1이라 생략한다(정보가 없는 항이므로).
    rows.push(
      `기본 공격력 ${def.damage}`
      + (p.tier > 1 ? ` · 강화 ×${tierMultiplier(p.tier)}` : '')
      + ` · 배율 ×${1 + p.queenBuffCount} · 최종 ${pieceDamage(p)}`,
    );
  } else if (t.buffFactor > 0) {
    // 공격력이 0인 순수 버퍼(퀸)에만 이 줄을 준다. "기본 공격력 0"은 알려주는 정보가 없다.
    rows.push('공격력 — (버퍼)');
  }

  if (t.buffFactor > 0) {
    // 버프량은 이 기물의 강화 단계에서 유도한다 (recalcQueenBuffs: += tierMultiplier × 계수).
    // "+100%" 고정 표기는 T1 퀸에서만 참이다 — T3 퀸은 +400%, T6은 +3200%다. 아마존은 계수가
    // 절반이라 같은 티어에서도 값이 다르다.
    rows.push(`버프 효과: +${tierMultiplier(p.tier) * t.buffFactor * 100}% (8방향 직선)`);
    rows.push('여러 버퍼의 라인이 겹치면 그만큼 더 쌓인다');
  }

  // 주기 공격과 이동 폭발은 서로 다른 축이다. 겸업 기물은 **둘 다** 갖는다.
  if (t.pattern !== 'none') rows.push(`공격 주기 ${def.interval}s`);
  if (t.blast) {
    // 폭발 여부는 **항상** 적는다. 예전에는 이 자리에 쿨다운만 적혀 있었는데, 주기 공격이
    // 없는 기물(나이트·아마존)은 그러면 "폭발한다"는 사실 자체가 툴팁 어디에도 안 나온다.
    rows.push('이동·배치할 때 주변 9칸 폭발');
    // 주기 공격이 없는 기물에게 interval은 곧 이동 쿨다운이다. 겸업 기물은 위의 "공격 주기"
    // 줄이 같은 값을 이미 쓰고 있으므로(폭발과 공격이 쿨다운을 공유한다) 중복해 적지 않는다.
    // def.interval이 0이면 "0s"라는 거짓 정보 대신 쿨다운이 없다는 사실을 그대로 알린다.
    if (t.pattern === 'none') {
      rows.push(def.interval > 0 ? `이동 쿨다운 ${def.interval}s` : '이동 쿨다운 없음');
    }
  }
  // 골드를 벌지 않는 기물에는 줄 자체를 만들지 않는다 — "공격당 +0G"는 알려주는 정보가 없다.
  if (def.goldPerAttack > 0) rows.push(`공격당 +${pieceGold(p)}G (버프 미적용)`);
  // 쿨다운이 늘 0인 기물에 "남은 쿨다운 0.0s"를 보여주는 건 바로 윗줄과 중복이다.
  if (!suppressRemainingCooldown) rows.push(`남은 쿨다운 ${p.cooldown.toFixed(1)}s`);

  // 강화 단계는 이름 옆에 붙인다 — 툴팁의 모든 수치가 이 값에 비례하므로 가장 먼저 읽혀야 한다.
  const tierTag = p.tier > 1 ? ` <span style="color:${tierRingColor(p.tier)}">T${p.tier}</span>` : '';
  el.innerHTML = `<b>${PIECE_NAME[p.type]}${tierTag}</b><br>${rows.join('<br>')}`
    + `<br>판매가 ${sellPrice(p.type, p.tier)}G`;
  el.hidden = false;
  el.style.left = `${mouse.x + 14}px`;
  el.style.top = `${mouse.y + 14}px`;
}
