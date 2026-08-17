import { describe, expect, it } from 'vitest';
import { CONFIG, TRAITS } from '../src/config';
import { updateCombat } from '../src/core/combat';
import { attackTargets, knightMoves, slowSquares, slowTargets } from '../src/core/patterns';
import { FUSION_RECIPES } from '../src/core/fusion';
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
 *
 * v1.10에서 `blast`가 `slow`로 교체됐다. 이 파일이 하는 일은 그대로다 — 축이 하나 바뀌었을
 * 뿐 "표의 필드마다 그 필드를 읽는 코드가 전수로 붙어 있는가"를 묻는다.
 */

const ALL = Object.keys(TRAITS) as PieceType[];

const CENTER = { file: 3, rank: 4 };

describe('TRAITS — 전수성과 일관성', () => {
  it('CONFIG.pieces와 정확히 같은 키를 갖는다', () => {
    expect(ALL.sort()).toEqual(Object.keys(CONFIG.pieces).sort());
  });

  it('사거리는 pattern 하나로만 갈린다 — 감속 기물이라고 칸이 붙지 않는다', () => {
    // v1.10 이전에는 attackTargets의 'none'이 나이트에게 폭발 범위(3×3)를 돌려주는 폴백이라,
    // "공격력 0인 기물의 사거리"가 화면에 주황색으로 칠해졌다. 폴백이 사라진 지금은 두 축이
    // 완전히 분리돼야 한다: 감속을 하든 말든 사거리는 pattern이 정한다.
    for (const type of ALL) {
      if (TRAITS[type].pattern === 'none') {
        expect(attackTargets(type, CENTER), type).toEqual([]);
      } else {
        expect(attackTargets(type, CENTER).length, type).toBeGreaterThan(0);
      }
    }
    // 위 단언이 공허하지 않다는 증거 — 감속 기물 넷이 두 쪽에 걸쳐 있다. 나이트·아마존은
    // 사거리가 비고, 아치비숍·챈슬러는 재료의 패턴으로 쏜다. slow가 pattern의 별명이었다면
    // 이 두 줄 중 하나는 실패한다.
    const slowers = ALL.filter(t => TRAITS[t].slow);
    expect(slowers.some(t => attackTargets(t, CENTER).length === 0)).toBe(true);
    expect(slowers.some(t => attackTargets(t, CENTER).length > 0)).toBe(true);
  });

  it('slow 기물만 감속 범위를 갖고, 그 범위는 L자 8칸이다', () => {
    // 범위를 리터럴로 적지 않고 slowSquares와 대조한다 — 미리보기(highlights)와 실제
    // 규칙(core/slow.ts)이 이 함수 하나만 보게 만든 것이 v1.10의 설계이고, 여기서 오프셋을
    // 다시 펼치면 이 테스트가 세 번째 출처가 되어 그 설계를 스스로 깬다.
    expect(slowSquares(CENTER).length).toBe(8);   // 대조군이 빈 배열이 아님을 먼저 못 박는다
    for (const type of ALL) {
      expect(slowTargets(type, CENTER), type).toEqual(TRAITS[type].slow ? slowSquares(CENTER) : []);
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

  it('주기 공격을 하는 기물만 interval을 갖는다 — 융합물이 나이트의 0을 물려받지 않는다', () => {
    // 이 자리에 있던 "폭발 후 쿨다운 = 그 기물 자신의 interval" 회귀 테스트의 절반이다.
    // 이동 쿨다운은 폭발과 함께 사라졌지만(hasMoveCooldown 삭제), 그 테스트가 실제로 지키던
    // 것 — **융합물의 interval은 나이트(0)가 아니라 주기 공격을 담당하는 재료의 것** — 은
    // 그대로 유효하다. 챈슬러가 0을 물려받으면 매 틱 발사하는 기물이 된다.
    for (const type of ALL) {
      expect(CONFIG.pieces[type].interval > 0, type).toBe(TRAITS[type].pattern !== 'none');
    }
    expect(CONFIG.pieces.archbishop.interval).toBe(CONFIG.pieces.bishop.interval);
    expect(CONFIG.pieces.chancellor.interval).toBe(CONFIG.pieces.rook.interval);
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

describe('★ 감속은 넷만의 능력이고, 행마 규칙(moveL)과는 다른 축이다', () => {
  it('감속 기물은 나이트와 나이트를 재료로 쓰는 융합물 셋뿐이다', () => {
    // 목록을 TRAITS에서 유도하지 않고 **바깥에서** 적는다. 표로부터 유도하면 표가 바뀔 때
    // 기대값도 함께 바뀌어 아무것도 지키지 못한다. 새 기물에 slow를 붙이는 것은 밸런스
    // 결정이므로(오라는 중첩도 티어 배수도 없어 기물 수가 곧 커버리지다), 이 줄을 고치는
    // 손이 그 결정을 의식하게 만드는 것이 이 단언의 전부다.
    expect(ALL.filter(t => TRAITS[t].slow).sort())
      .toEqual(['amazon', 'archbishop', 'chancellor', 'knight']);

    // 왜 하필 그 넷인가 — 나이트와 **나이트를 재료로 쓰는 융합물**이다. 융합물의 설계 근거가
    // "재료의 주기 공격 + 나이트의 능력 겸업"이라, 레시피가 늘면 감속 기물도 함께 늘어야
    // 한다. 위 목록만 있으면 레시피가 추가될 때 "감속 없는 나이트 융합물"이 조용히 나온다.
    expect(TRAITS.knight.slow).toBe(true);
    const fromKnight = FUSION_RECIPES
      .filter(([a, b]) => a === 'knight' || b === 'knight')
      .map(([, , result]) => result);
    expect(fromKnight.length).toBeGreaterThan(0);
    for (const type of fromKnight) expect(TRAITS[type].slow, type).toBe(true);
  });

  it('slow와 moveL은 서로 다른 축이다 — 아치비숍은 감속하되 L자로 움직이지 않는다', () => {
    // 두 필드는 나이트에서만 함께 true라 "같은 것을 두 번 적은 것"처럼 보이고, 실제로 한
    // 번은 합치자는 말이 나온다. 융합물이 정확히 그 착각을 깨는 자리다: 감속(능력)은 물려받고
    // 행마 제약은 물려받지 않는다 — 상속했다면 아치비숍이 인접 칸으로 미는 조작조차 못 해
    // 룩보다 기동성이 낮아진다. 합쳐진 필드 하나로는 이 기물을 표현할 방법이 없다.
    expect(TRAITS.archbishop.slow).toBe(true);
    expect(TRAITS.archbishop.moveL).toBe(false);

    // 포함 관계가 한 방향뿐이다: moveL이면 반드시 slow지만 그 역은 아니다. 역까지 성립하면
    // 두 필드가 정말 같은 것이 되므로, 아래 세 줄이 함께 초록일 때만 분리가 정당하다.
    expect(ALL.filter(t => TRAITS[t].moveL)).toEqual(['knight']);
    for (const type of ALL) if (TRAITS[type].moveL) expect(TRAITS[type].slow, type).toBe(true);
    expect(ALL.some(t => TRAITS[t].slow && !TRAITS[t].moveL)).toBe(true);

    // 두 축은 칸 집합에서도 갈린다 — 감속은 8랭크(스폰 구역)를 덮고 행마는 그리로 갈 수 없다.
    // 그래서 두 필드는 서로 다른 함수를 부른다(slowSquares / knightMoves). 하나로 합치는
    // 순간 나이트는 적이 판에 들어오는 바로 그 랭크를 놓치거나, 스폰 구역으로 걸어 들어간다.
    const sq = { file: 3, rank: 6 };
    expect(slowSquares(sq).some(s => s.rank === CONFIG.board.ranks)).toBe(true);
    expect(knightMoves(sq).some(s => s.rank === CONFIG.board.ranks)).toBe(false);
  });
});
