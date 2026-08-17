import { CONFIG, TRAITS, slowPercent, tierMultiplier } from '../config';
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
  const t = TRAITS[p.type];
  // 주기 공격이 없는 기물(나이트·퀸·아마존)은 쿨다운이 영원히 0이라 "남은 쿨다운 0.0s"가
  // 알려주는 정보가 없다. 예전에는 이 판정이 blast를 봤지만 이제 근거가 더 단순하다 —
  // 쿨다운을 소비하는 것은 주기 공격뿐이므로 pattern 하나로 결정된다.
  const suppressRemainingCooldown = t.pattern === 'none';
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

  // 주기 공격과 감속 오라는 서로 다른 축이다. 겸업 기물(아치비숍·챈슬러)은 **둘 다** 갖는다.
  if (t.pattern !== 'none') rows.push(`공격 주기 ${def.interval}s`);
  if (t.slow) {
    // 감속 여부는 **항상** 적는다. 주기 공격이 없는 기물(나이트·아마존)은 이 줄이 없으면
    // 툴팁 어디에도 "이 기물이 무엇을 하는가"가 나오지 않는다 — 공격력 줄도 없기 때문이다.
    rows.push(`L자 8칸의 적 이동속도 −${slowPercent()}% (지속 · 8랭크 포함)`);
    // ★ 이 줄이 없으면 플레이어는 나이트를 겹쳐 놓거나 합성해서 더 느리게 만들려고 한다.
    // 둘 다 효과가 없고, 합성은 오히려 덮는 칸이 줄어 손해다. 규칙을 말해 주는 편이 낫다.
    rows.push('중첩·강화로 더 느려지지 않는다');
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
