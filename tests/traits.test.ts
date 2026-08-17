import { describe, expect, it } from 'vitest';
import { CONFIG, TRAITS } from '../src/config';
import type { PieceTraits } from '../src/config';
import { updateCombat } from '../src/core/combat';
import { attackTargets, slowSquares, slowTargets } from '../src/core/patterns';
import { FUSION_RECIPES } from '../src/core/fusion';
import { buyPiece, canBuy } from '../src/core/economy';
import { squareKey } from '../src/core/grid';
import { resolveLanding } from '../src/core/pieces';
import type { GameEvent, PieceType, Square } from '../src/types';
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
 *
 * v1.11에서 `moveL`이 **삭제**됐다(나이트도 다른 기물과 똑같이 아무 칸으로나 재배치된다).
 * 그 축을 재던 단언들은 지우지 않고 방향을 돌려 남겼다: 표에 남은 축이 정확히 넷인지, 그리고
 * 사라진 L자가 어디로 갔는지(행마 → 감속 범위)를 묻는다. 축은 사라져도 스스로 실패를
 * 만들지 않으므로, 여기서 묻지 않으면 아무도 그 변화를 지키지 못한다.
 */

const ALL = Object.keys(TRAITS) as PieceType[];

const CENTER = { file: 3, rank: 4 };

/**
 * PieceTraits에 있어야 할 축 전부 — **표에서 유도하지 않고 바깥에 적는다.** 유도하면 축이
 * 늘거나 줄 때 기대값도 함께 움직여 아무것도 지키지 못한다. `satisfies`가 컴파일 시점에
 * 누락·오타·추가를 잡고(축을 건드리면 이 리터럴이 가장 먼저 빨개진다), 아래 두 테스트가
 * 런타임에 "그 축들이 실제로 기물을 서술하는가"를 묻는다.
 */
const AXIS_SET = {
  pattern: 0, slow: 0, buffFactor: 0, purchasable: 0,
} satisfies Record<keyof PieceTraits, 0>;
const AXES = (Object.keys(AXIS_SET) as (keyof PieceTraits)[]).sort();

/** 보드의 모든 칸. 이동 규칙을 8종에 대해 전수로 비교하려고 CONFIG에서 유도한다. */
const ALL_SQUARES: Square[] = Array.from(
  { length: CONFIG.board.files * CONFIG.board.ranks },
  (_, i) => ({ file: i % CONFIG.board.files, rank: Math.floor(i / CONFIG.board.files) + 1 }),
);

describe('TRAITS — 전수성과 일관성', () => {
  it('CONFIG.pieces와 정확히 같은 키를 갖는다', () => {
    expect(ALL.sort()).toEqual(Object.keys(CONFIG.pieces).sort());
  });

  it('★ 표의 축은 정확히 넷이다 — pattern · slow · buffFactor · purchasable', () => {
    // 위 테스트가 표의 **행**(기물)을 잠근다면 이것은 **열**(축)을 잠근다. v1.11에서 moveL이
    // 빠져나간 자리라 특히 필요하다: 축이 하나 사라지거나 늘어도 그 자체로는 아무 테스트도
    // 실패시키지 않는데, 이 파일의 모든 테스트는 "축마다 그것을 읽는 코드가 전수로 붙어
    // 있는가"라는 한 가지 질문의 반복이라 축 목록이 곧 이 스위트의 범위다. 목록이 표를 따라
    // 저절로 늘면 새 축은 아무도 검사하지 않은 채 들어온다.
    for (const type of ALL) {
      expect(Object.keys(TRAITS[type]).sort(), type).toEqual(AXES);
    }
  });

  it('★ 네 축은 저마다 표를 가른다 — 값이 하나뿐인 축은 아무 기물도 서술하지 못한다', () => {
    // moveL이 필드째 삭제된 이유가 정확히 이것이다. 나이트가 유일한 true였는데 그가 false가
    // 되자 8종 전부 false인 열만 남았고, 그런 열은 기물을 하나도 구분하지 못하면서 읽는 쪽에는
    // 계속 분기를 요구한다. 같은 질문을 새 축을 넣으려는 손에게도 던진다 — 표를 가르지 못하는
    // 값은 TRAITS가 아니라 CONFIG.pieces나 patterns.ts에 속한다(이 표의 세 축 분리 규칙).
    for (const axis of AXES) {
      expect(new Set(ALL.map(t => TRAITS[t][axis])).size, axis).toBeGreaterThan(1);
    }
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
      // v1.12에서 buyPiece가 보드에 직접 스폰하게 되면서 실패의 흔적이 늘었다 — null만 봐서는
      // 기물이 이미 판에 떨어진 뒤 null을 돌려주는 구현도 통과한다. rng는 `() => 0`으로 고정해
      // 스폰이 일어났다면 a1에 남도록 만들어 두고, 보드와 이벤트가 둘 다 그대로인지 묻는다.
      const ev: GameEvent[] = [];
      expect(buyPiece(s, type, ev, () => 0), type).toBeNull();
      expect(s.pieces, type).toEqual([]);
      expect(ev, type).toEqual([]);
    }
  });
});

describe('★ 감속은 넷만의 능력이다 — 그리고 L자는 이제 행마가 아니라 여기 산다', () => {
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

  it('★ 이동 규칙에는 기물 종류별 분기가 없다 — 8종이 정확히 같은 칸에 내린다', () => {
    // 여기 있던 것은 "slow와 moveL은 서로 다른 축"이라는 테스트였다. moveL이 사라져 비교
    // 대상이 없어졌지만, 그 테스트가 실제로 지키던 것 — **감속(능력)과 행마는 다른 규칙을
    // 탄다** — 은 그대로 유효하고 오히려 더 강해졌다: 이제 행마는 TRAITS의 어떤 축도 보지
    // 않는다. 그 사실을 표 쪽에서 묻는 자리가 이 파일이라 삭제하지 않고 방향만 돌린다.
    //
    // ★ 이 단언의 값어치는 **예전에 거부되던 이동이 지금 성공한다**는 데 있다. v1.11 이전에는
    // 나이트만 착지 후보가 L자 8칸(knightMoves)으로 좁혀졌고 나머지는 'knightPattern'으로
    // 거부됐다. 게이트를 지우기만 하면 그것을 되살려도 실패하는 테스트가 하나도 없다.
    const from = { file: 3, rank: 4 };
    // 남은 제약은 8랭크(적 스폰 구역) 금지 하나뿐이다. 바깥에서 적어야 inLandableBounds가
    // 조건을 하나 더 얻을 때 여기가 먼저 빨개진다.
    const landable = ALL_SQUARES.filter(sq => sq.rank <= CONFIG.board.ranks - 1);

    for (const type of ALL) {
      const s = waveState();
      const p = boardPiece(type, from.file, from.rank);
      s.pieces.push(p);
      // 자기 칸은 'self'(no-op)라 거부가 아니다 — 그것도 8종이 똑같으므로 함께 센다.
      const ok = ALL_SQUARES.filter(sq => resolveLanding(s, p, sq, false).kind !== 'reject');
      expect(ok.map(squareKey), type).toEqual(landable.map(squareKey));
    }

    // 위 루프가 공허하지 않다는 증거. 예전 규칙이 나이트에게 허용하던 칸은 L자 8칸뿐이었는데
    // 지금은 1~7랭크 전체다 — 즉 L자는 좁아진 것이 아니라 **행마에서 능력으로 자리를 옮겼다.**
    const lShaped = slowSquares(from);
    expect(lShaped).toHaveLength(8);
    expect(landable.length).toBeGreaterThan(lShaped.length);
    // 옮겨간 자리는 이동이 결코 갈 수 없는 8랭크까지 덮는다(적이 판에 들어오는 바로 그 랭크다).
    // 두 축이 같은 L_OFFSETS 표를 쓰면서도 필터가 다른 이유였고, 행마 쪽이 사라진 지금은
    // slowSquares가 그 표의 유일한 소비자다 — 8랭크를 여기서 빼면 감속에 구멍이 생긴다.
    const near = { file: 3, rank: 6 };
    expect(slowSquares(near).some(sq => sq.rank === CONFIG.board.ranks)).toBe(true);
    expect(landable.some(sq => sq.rank === CONFIG.board.ranks)).toBe(false);
  });
});
