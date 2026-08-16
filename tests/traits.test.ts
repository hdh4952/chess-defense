import { describe, expect, it } from 'vitest';
import { CONFIG, TRAITS } from '../src/config';
import { updateCombat } from '../src/core/combat';
import { attackTargets, blastTargets, knightBlastTargets } from '../src/core/patterns';
import { placeFromSlot } from '../src/core/pieces';
import { buyPiece, canBuy } from '../src/core/economy';
import type { GameEvent, PieceType } from '../src/types';
import { boardPiece, enemyAt, waveState } from './helpers';

/**
 * TRAITS 표가 지켜야 할 성질.
 *
 * 이 표를 만든 이유는 `type === 'knight'` 술어가 코드 곳곳에 흩어져 있었고 **컴파일 시
 * 전수성이 보장되는 것이 하나도 없었기** 때문이다. 기물이 늘면 그 술어들은 조용히 false를
 * 돌려주고, 새 기물은 "공격은 하는데 소리도 이펙트도 없는" 상태로 배포된다. 아래 테스트는
 * 그 침묵을 소리 나는 실패로 바꾼다.
 */

const ALL = Object.keys(TRAITS) as PieceType[];

describe('TRAITS — 전수성과 일관성', () => {
  it('CONFIG.pieces와 정확히 같은 키를 갖는다', () => {
    expect(ALL.sort()).toEqual(Object.keys(CONFIG.pieces).sort());
  });

  it('공격 패턴이 없고 폭발도 없는 기물은 사거리가 비어 있다', () => {
    for (const type of ALL) {
      const t = TRAITS[type];
      if (t.pattern === 'none' && !t.blast) {
        expect(attackTargets(type, { file: 3, rank: 4 }), type).toEqual([]);
      } else {
        expect(attackTargets(type, { file: 3, rank: 4 }).length, type).toBeGreaterThan(0);
      }
    }
  });

  it('blast 기물만 폭발 범위를 갖고, 그 범위는 3×3이다', () => {
    for (const type of ALL) {
      const got = blastTargets(type, { file: 3, rank: 4 });
      expect(got, type).toEqual(TRAITS[type].blast ? knightBlastTargets({ file: 3, rank: 4 }) : []);
    }
  });

  it('공격력이 0인 기물은 주기 발사 루프에서 제외된다', () => {
    // updateCombat의 제외 가드가 pattern과 damage 둘 다를 보는지 — 어느 한쪽만 보면
    // "패턴은 있는데 공격력 0" 또는 그 반대인 기물이 조용히 새어 나간다.
    for (const type of ALL) {
      if (CONFIG.pieces[type].damage > 0 && TRAITS[type].pattern !== 'none') continue;
      const s = waveState();
      const p = boardPiece(type, 3, 4);
      s.pieces.push(p);
      const e = enemyAt(1, 3, 4);
      s.enemies.push(e);
      const ev: GameEvent[] = [];
      updateCombat(s, 1 / 60, ev);
      expect(ev.some(x => x.kind === 'attack'), type).toBe(false);
    }
  });

  it('버프를 주는 기물은 퀸과 아마존뿐이고, 아마존 계수는 퀸의 절반이다', () => {
    // 퀸의 티어는 보드 전체 화력의 지수라, 버프를 겸하는 기물이 늘면 그 배율이 곱으로 겹친다.
    const buffers = ALL.filter(t => TRAITS[t].buffFactor > 0).sort();
    expect(buffers).toEqual(['amazon', 'queen']);
    expect(TRAITS.amazon.buffFactor).toBe(TRAITS.queen.buffFactor / 2);
  });

  it('★ 구매 불가 기물은 canBuy를 통과하지 못한다 — 융합물이 상점에 새지 않는다', () => {
    const nonPurchasable = ALL.filter(t => !TRAITS[t].purchasable);
    expect(nonPurchasable.length).toBeGreaterThan(0);
    for (const type of nonPurchasable) {
      const s = waveState();
      s.gold = 999999;
      expect(canBuy(s, type), type).toBe(false);
      expect(buyPiece(s, type), type).toBeNull();
    }
  });
});

describe('★ 폭발 쿨다운은 그 기물 자신의 interval을 읽는다 (하드코딩 회귀 방지)', () => {
  it('폭발 후 쿨다운 = CONFIG.pieces[그 기물 타입].interval', () => {
    // 예전에는 tryKnightBlast가 CONFIG.pieces.knight.interval을 **하드코딩**하고 있었다.
    // 폭발하는 기물이 나이트뿐이라 값이 같아 어떤 테스트도 잡지 못했지만, 폭발을 겸하는
    // 기물이 생기면 그 기물이 나이트의 쿨다운(현재 0 = 무제한)을 물려받아 무제한 폭발기가 된다.
    for (const type of ALL) {
      if (!TRAITS[type].blast) continue;
      const s = waveState();
      const p = boardPiece(type, 3, 4);
      p.square = null; p.slotIndex = 0;
      s.pieces.push(p);
      expect(placeFromSlot(s, p.id, 3, 4, [])).toBe(true);
      expect(p.cooldown, type).toBe(CONFIG.pieces[type].interval);
    }
  });

  it('★ 폭발 기물이 여럿이고 서로 다른 interval을 갖는다 — 위 단언이 더 이상 공허하지 않다', () => {
    // 나이트 하나뿐일 때는 하드코딩과 올바른 구현의 결과가 같아 테스트가 아무것도 증명하지
    // 못했다. 융합물이 생기면서 비로소 구분된다 — 챈슬러가 나이트의 interval 0을 물려받았다면
    // 드래그 반복만으로 무제한 폭발하는 기물이 됐을 것이다.
    const blasters = ALL.filter(t => TRAITS[t].blast);
    expect(blasters.length).toBeGreaterThan(1);
    const intervals = new Set(blasters.map(t => CONFIG.pieces[t].interval));
    expect(intervals.size).toBeGreaterThan(1);
    expect(CONFIG.pieces.chancellor.interval).toBeGreaterThan(0);
    expect(CONFIG.pieces.knight.interval).toBe(0);
  });
});
