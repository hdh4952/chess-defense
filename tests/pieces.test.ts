import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { recalcQueenBuffs } from '../src/core/buff';
import { emptySquares } from '../src/core/economy';
import { fusionResult } from '../src/core/fusion';
import { squareKey } from '../src/core/grid';
import { canPlaceAt, moveOnBoard, pieceAt, resolveLanding } from '../src/core/pieces';
import { slowCoverage } from '../src/core/slow';
import type { GameEvent, PieceType } from '../src/types';
import { boardPiece, enemyAt, waveState } from './helpers';

/*
 * ⚠️ 여기 있던 slotPiece(트레이 기물 생성기)가 v1.12에서 삭제됐다 — 기물 보관함이 사라지면서
 * Piece.square가 널이 아니게 됐고, 구매·지급이 곧 배치가 됐다(economy.ts가 빈 칸에 직접
 * 스폰한다). 이 파일에서 기물을 만드는 방법이 boardPiece 하나뿐이라는 것 자체가 이 변경의
 * 기록이다: **"트레이발 착지"라는 출발지를 이제 타입 수준에서 표현할 수 없다.**
 */

/** 이 게임의 기물 종류 전부. 표를 두 곳에 적지 않도록 CONFIG에서 유도한다. */
const ALL_TYPES = Object.keys(CONFIG.pieces) as PieceType[];

/**
 * 나이트에게 "이미 남아 있는" 쿨다운. 조작(이동·맞교환)이 이 값을 건드리지 않는다는 것이
 * 아래 여러 단언의 요지다.
 *
 * 리터럴 1.5를 쓰지 않고 interval에서 유도하는 이유는 이 값이 **interval과 반드시 달라야**
 * 단언이 뜻을 갖기 때문이다. 지금은 interval이 0이라 아무 상수나 통과하지만, 누군가 3.0으로
 * 되돌리는 순간 "건드리지 않았다"와 "interval로 재시작했다"가 같은 값이 되어 구별력이 조용히
 * 사라진다. 여기서 유도해 두면 그때도 자동으로 갈라진다.
 */
const HELD_COOLDOWN = CONFIG.pieces.knight.interval + 1.5;

describe('배치 규칙 (스펙 2.1)', () => {
  it('1~7랭크 빈 칸만 가능, 8랭크·점유 칸 불가', () => {
    const s = waveState();
    s.pieces.push(boardPiece('rook', 3, 4));
    expect(canPlaceAt(s, 0, 1)).toBe(true);
    expect(canPlaceAt(s, 0, CONFIG.board.ranks - 1)).toBe(true);
    expect(canPlaceAt(s, 0, CONFIG.board.ranks)).toBe(false);   // 스폰 구역
    expect(canPlaceAt(s, 3, 4)).toBe(false);                    // 점유
    expect(canPlaceAt(s, -1, 3)).toBe(false);
  });

  it('canPlaceAt이 스폰 후보 칸(emptySquares)과 정확히 같은 집합을 말한다 (v1.12)', () => {
    // v1.12에서 canPlaceAt의 주 소비자가 바뀌었다: 예전에는 트레이 → 보드 배치를 판정했는데,
    // 이제는 **구매·지급 스폰**(economy.emptySquares)과 미리보기가 쓴다. 두 술어가 갈라지면
    // "상점은 살 수 있다고 하는데 놓을 자리가 없는" 상태가 조용히 생기고, 그것이 economy.ts가
    // 랭크 상한을 리터럴로 적지 말라고 경고하는 이유다. 여기서 보드 전체를 훑어 두 정의를
    // 맞대 둔다 — 8랭크 제외까지 포함해 한 칸이라도 어긋나면 실패한다.
    const s = waveState();
    s.pieces.push(boardPiece('rook', 3, 4), boardPiece('pawn', 0, 1));
    const free = new Set(emptySquares(s).map(squareKey));
    for (let file = 0; file < CONFIG.board.files; file++) {
      for (let rank = 1; rank <= CONFIG.board.ranks; rank++) {
        expect(canPlaceAt(s, file, rank), `${file},${rank}`)
          .toBe(free.has(squareKey({ file, rank })));
      }
    }
  });

  it('이동 성공 시 옛 칸이 비고 새 칸에서 잡힌다', () => {
    // 예전 "placeFromSlot: 슬롯에서 빠지고 보드에 놓인다"의 자리다. 트레이가 사라져 출발지가
    // 슬롯이 아니라 칸이 됐을 뿐, 지키는 사실은 그대로다 — 조작이 끝난 뒤 pieceAt이 그 기물을
    // **새 칸에서만** 집어야 한다. 옛 칸까지 함께 보는 이유는 square만 갱신하고 색인을 남기는
    // 회귀(= 한 기물이 두 칸에 보이는 상태)를 잡기 위해서다.
    const s = waveState();
    const p = boardPiece('pawn', 2, 3);
    s.pieces.push(p);
    expect(moveOnBoard(s, p.id, 5, 6, [])).toBe(true);
    expect(p.square).toEqual({ file: 5, rank: 6 });
    expect(pieceAt(s, 5, 6)).toBe(p);
    expect(pieceAt(s, 2, 3)).toBeUndefined();
  });

  it('일시정지 중에는 이동 불가 (스펙 7.7)', () => {
    // 예전에는 배치·이동·회수 셋을 함께 쟀다. 앞뒤 둘이 v1.12에서 사라져(구매·지급이 곧
    // 배치이고, 보드에서 치우는 방법은 판매뿐이다) 일시정지가 막을 대상이 이동 하나만 남았다.
    const s = waveState();
    const p = boardPiece('pawn', 2, 3);
    s.pieces.push(p);
    s.paused = true;
    expect(moveOnBoard(s, p.id, 2, 4, [])).toBe(false);
    expect(p.square).toEqual({ file: 2, rank: 3 });
    s.paused = false;
    expect(moveOnBoard(s, p.id, 2, 4, [])).toBe(true);
  });
});

describe('이동 — 쿨다운 유지 (스펙 5.1/10.5)', () => {
  it('일반 기물은 아무 빈 칸으로나 자유 이동, 쿨다운 유지', () => {
    const s = waveState();
    const r = boardPiece('rook', 0, 1);
    r.cooldown = 1.7;
    s.pieces.push(r);
    expect(moveOnBoard(s, r.id, 7, 7, [])).toBe(true);
    expect(r.square).toEqual({ file: 7, rank: 7 });
    expect(r.cooldown).toBe(1.7);              // 초기화 금지
  });

  it('몇 번을 옮겨 다녀도 쿨다운은 그대로 — 이제 "세탁"을 시도할 경로가 이동뿐이다', () => {
    // 원래 이 자리는 "회수 → 재배치에도 쿨다운 유지"였다. 트레이가 사라져 기물을 보드 밖으로
    // 잠깐 빼는 경로 자체가 없어졌으므로(치우는 방법은 판매뿐이고 그건 기물이 죽는 것이다),
    // 쿨다운을 초기화할 후보로 남은 것은 이동밖에 없다. 그래서 대상만 바꿔 그대로 살린다.
    const s = waveState();
    const p = boardPiece('pawn', 3, 4);
    p.cooldown = 0.4;
    s.pieces.push(p);
    for (const [file, rank] of [[5, 5], [0, 1], [3, 4], [7, 7]]) {
      expect(moveOnBoard(s, p.id, file, rank, [])).toBe(true);
      expect(p.cooldown).toBe(0.4);
    }
  });

  /*
   * ⚠️ 여기 있던 "reorderSlots: 빈칸 이동과 맞교환"이 v1.12에서 삭제됐다 — 재정렬할 트레이가
   * 없다(함수 자체가 사라졌다). 다만 그 테스트가 쥐고 있던 두 불변식은 살아 있고, 자리만
   * 슬롯에서 칸으로 옮겼다: "빈칸으로 이동"은 바로 위 두 테스트가, "맞교환"은 아래 맞교환
   * 스위트가 각각 이어받는다.
   */
});

describe('퀸 버프 트리거 (스펙 10.5)', () => {
  it('이동은 양방향으로 버프를 재계산한다 — 들어올 때도 나갈 때도', () => {
    // 예전에는 배치·이동·회수 셋을 함께 쟀다. 남은 것은 이동뿐이지만 요지는 그대로다:
    // moveOnBoard가 recalcQueenBuffs를 부르지 않으면 퀸이 떠난 라인에 버프가 눌어붙는다.
    const s = waveState();
    const q = boardPiece('queen', 3, 1);
    const r = boardPiece('rook', 3, 5);         // 퀸과 같은 파일
    s.pieces.push(q, r);
    recalcQueenBuffs(s);
    expect(r.queenBuffCount).toBe(1);
    expect(moveOnBoard(s, q.id, 4, 1, [])).toBe(true);   // 라인 밖으로
    expect(r.queenBuffCount).toBe(0);
    expect(moveOnBoard(s, q.id, 3, 1, [])).toBe(true);   // 다시 라인 안으로
    expect(r.queenBuffCount).toBe(1);
  });
});

/*
 * 나이트 — v1.10부터 이 파일에 남은 것은 **조작 규칙뿐**이다.
 *
 * 예전에는 배치·이동이 곧 능력 발동이었다(3×3 폭발 + 쿨다운 재시작 + knightBlast 이벤트).
 * 그래서 아래 테스트들이 "얼마나 아팠는가"를 재고 있었는데, 폭발이 감속 오라로 바뀌면서 그
 * 순간 자체가 없어졌다 — 감속은 기물이 서 있기만 하면 core/slow.ts가 매 틱 판정하는 상태다.
 * 옮겨 적은 기준은 하나다: **pieces.ts가 여전히 책임지는 것만 여기서 잰다.** 감속의 세기·중첩
 * 금지·8랭크 포함 같은 능력 자체의 규칙은 slow/patterns 쪽 책임이라 여기서 재지 않고, 대신
 * "조작이 능력을 발동시키지 않는다"와 "오라의 출처는 조작이 아니라 위치다"만 붙잡는다.
 *
 * v1.11에서 그 "조작 규칙"마저 특별할 것이 없어졌다 — L자 이동 제약이 사라져(사용자 결정)
 * 나이트가 다른 기물과 완전히 같은 규칙을 탄다. 그래서 아래 테스트 대부분은 이제 **아무 일도
 * 일어나지 않는다**를 재는데, 그 무해함이야말로 이 능력 교체의 결과물이라 지우지 않고 남긴다.
 *
 * v1.12에서는 **출발지**가 통째로 하나가 됐다. 트레이가 사라져 "최초 배치"라는 별도 경로가
 * 없으므로(구매·지급이 곧 스폰이고 그 단언은 economy/grant 쪽 책임이다), 아래 모든 조작이
 * 보드 → 보드 한 줄기로 모였다.
 */
describe('나이트 (스펙 5.3 + 검토 노트 3)', () => {
  /*
   * ⚠️ 여기 있던 `isKnightMove: L자만 허용` 단위 테스트가 삭제됐다 — 함수 자체가 v1.11에서
   * 사라졌기 때문이다(나이트도 다른 기물과 똑같이 재배치된다, 사용자 결정). 대상이 없어진
   * 유일한 경우라 지웠지만, 자리를 그냥 비우면 누군가 게이트를 되살려도 실패할 테스트가
   * 하나도 없다. 그래서 같은 자리에 **부호를 뒤집어** 다시 심는다: 예전 knightPattern에
   * 걸리던 이동이 지금은 성공한다.
   */
  it('L자가 아닌 이동이 전부 성공한다 — 이동 제약이 사라졌다 (v1.11)', () => {
    const s = waveState();
    const n = boardPiece('knight', 3, 4);        // d4
    s.pieces.push(n);

    // 세 방향을 따로 두는 이유는 되살아날 수 있는 게이트가 하나가 아니기 때문이다. 직선·대각선은
    // "L자 판정"의 부활을, 마지막 원거리 이동은 "한 수 거리 제한" 같은 더 약한 대체 게이트의
    // 도입을 각각 잡는다 — 남은 제약은 8랭크 금지뿐이고 그것은 아래 가드 스위트가 맡는다.
    expect(moveOnBoard(s, n.id, 3, 5, [])).toBe(true);   // 직선 한 칸 (룩처럼)
    expect(n.square).toEqual({ file: 3, rank: 5 });
    expect(moveOnBoard(s, n.id, 5, 7, [])).toBe(true);   // 대각선 두 칸 (비숍처럼)
    expect(n.square).toEqual({ file: 5, rank: 7 });
    expect(moveOnBoard(s, n.id, 0, 1, [])).toBe(true);   // 보드 반대편 끝까지 한 번에
    expect(n.square).toEqual({ file: 0, rank: 1 });
  });

  it('적 한복판으로 들어와도 아무 능력도 발동하지 않는다 — 피해도 이벤트도 쿨다운 변화도 없다', () => {
    // 원래 "최초 배치(트레이 → 보드)는 아무 능력도 발동하지 않는다"였다. v1.12에서 그 경로가
    // 사라졌으므로 **도착**이라는 사실만 남기고 출발지를 보드로 옮겼다 — 구매·지급 스폰이
    // 무해한지는 economy 쪽이 스폰 이벤트로 따로 잰다.
    const s = waveState();
    const n = boardPiece('knight', 0, 1);       // 적에서 멀리 떨어진 구석에서 출발
    n.cooldown = HELD_COOLDOWN;
    s.pieces.push(n);
    const e = enemyAt(1, 4, 5);                 // 목적지 (3,4)의 예전 3×3 폭발 범위 한복판
    s.enemies.push(e);
    const ev: GameEvent[] = [];
    expect(moveOnBoard(s, n.id, 3, 4, ev)).toBe(true);
    // 예전에는 이 한 줄이 3 데미지 · knightBlast 이벤트 · 쿨다운 재시작을 동시에 일으켰다.
    // 이제 조작은 **기물을 그 칸에 놓는 것 외에 아무 일도 하지 않는다**. 세 단언을 따로 두는
    // 이유는 셋이 각각 다른 회귀를 잡기 때문이다: 피해는 tryKnightBlast의 부활을, 빈 이벤트
    // 배열은 조작에 딸린 연출·효과음의 부활을, 쿨다운은 이동 게이트의 부활을 막는다.
    expect(e.hp).toBe(e.maxHp);
    expect(ev).toEqual([]);
    expect(n.cooldown).toBe(HELD_COOLDOWN);
  });

  it('쿨다운이 남아 있어도 이동할 수 있고, L자 아닌 점유 칸도 그냥 맞교환이다', () => {
    const s = waveState();
    const n = boardPiece('knight', 3, 4);       // d4
    n.cooldown = HELD_COOLDOWN;                 // 끝까지 0으로 내리지 않는 것이 이 테스트의 요지다
    const occupant = boardPiece('pawn', 3, 7);  // d7 — 같은 파일 세 칸 위, 예전이라면 L자가 아니라 거부됐다
    s.pieces.push(n, occupant);
    const ev: GameEvent[] = [];

    // 나이트 전용 거부 사유 둘이 연달아 사라진 자리다. 쿨다운 게이트('knightCooldown')는
    // 폭발이 없어지며(v1.10), L자 게이트('knightPattern')는 사용자 결정으로(v1.11) 지워졌다.
    // 둘을 한 줄에서 함께 재는 이유는 어느 하나만 되살아나도 이 한 줄이 빨개지기 때문이다 —
    // 감속은 "언제 움직였는가"도 "어떻게 갔는가"도 아니라 "지금 어디 서 있는가"에만 달려 있다.
    expect(moveOnBoard(s, n.id, 3, 7, ev)).toBe(true);
    expect(n.square).toEqual({ file: 3, rank: 7 });
    expect(occupant.square).toEqual({ file: 3, rank: 4 });   // 점유자는 나이트의 이전 자리로 밀려난다
    expect(n.cooldown).toBe(HELD_COOLDOWN);     // 이동도 쿨다운을 재시작하지 않는다
    expect(ev).toEqual([]);
  });

  it('이동은 자리만 옮긴다 — 새 위치에서 피해는 없고 감속 범위만 따라간다', () => {
    const s = waveState();
    const n = boardPiece('knight', 3, 4);
    s.pieces.push(n);
    const e = enemyAt(1, 5, 6);                 // 예전 목적지 (5,5)의 3×3 폭발 범위 안
    s.enemies.push(e);
    expect(moveOnBoard(s, n.id, 5, 5, [])).toBe(true);
    expect(e.hp).toBe(e.maxHp);

    // 부정 단언만 남기면 나이트를 통째로 지워도 이 파일이 초록이 된다. 능력이 없어진 것이
    // 아니라 **위치에서 파생되는 것으로 바뀌었을 뿐**이라는 사실을 여기서 한 번 붙잡는다.
    // 오라의 세기가 아니라 출처를 재는 단언이다: moveOnBoard의 부수효과가 아니라 기물이 지금
    // 서 있는 칸이 오라를 만든다.
    const field = slowCoverage(s);
    expect(field.has(squareKey({ file: 6, rank: 7 }))).toBe(true);    // 새 자리 (5,5)의 L자 칸
    expect(field.has(squareKey({ file: 4, rank: 6 }))).toBe(false);   // 옛 자리 (3,4)의 L자 칸
  });

  it('같은 칸을 오가며 반복 조작해도 얻는 것이 없다 — 짜낼 "순간"이 없고 오라는 현재 칸만 따라간다', () => {
    // 이 자리는 원래 스펙 5.1의 안티파밍 규칙("회수→재배치로 쿨다운을 우회해 폭발을 반복할 수
    // 없다")을 지키다가 interval이 0이 되며 "매번 폭발한다"로 뒤집혔던 테스트다. v1.10에 규칙이
    // 아니라 대상이 없어졌고(배치가 피해를 주지 않으니 반복해서 짜낼 것이 없다), v1.12에는
    // 그 반복 수단이던 **회수 자체가 사라졌다** — 트레이가 없으니 기물을 잠깐 치울 수 없다.
    // 그래서 왕복을 "보드 ↔ 트레이"에서 "칸 ↔ 칸"으로 바꿔 그대로 살린다. 방향이 반대라는
    // 사실은 여전히 요지다: 감속은 **계속 그 칸에 서 있어야** 유지되므로 떠나는 즉시 잃는다.
    const s = waveState();
    const n = boardPiece('knight', 0, 1);
    s.pieces.push(n);
    const e = enemyAt(1, 4, 5);
    s.enemies.push(e);
    const ev: GameEvent[] = [];
    const covered = squareKey({ file: 4, rank: 6 });   // (3,4)의 L자 칸이자 (0,1)에서는 안 닿는 칸
    for (let i = 0; i < 3; i++) {
      expect(moveOnBoard(s, n.id, 3, 4, ev)).toBe(true);
      expect(slowCoverage(s).has(covered)).toBe(true);
      expect(moveOnBoard(s, n.id, 0, 1, ev)).toBe(true);
      expect(slowCoverage(s).has(covered)).toBe(false);   // 떠나는 즉시 잃는다
    }
    expect(e.hp).toBe(e.maxHp);
    expect(ev).toEqual([]);
  });

  it('퀸 버프를 받아도 조작은 여전히 무해하다 — 곱해질 공격력이 없다 (스펙 5.6)', () => {
    // 이전 판본은 "폭발 데미지는 폭발 시점 버프로 계산"이었다. 조작이 버프를 재계산한다는
    // 사실(스펙 10.5)은 그대로 살아 있으므로 남기고, 그 버프가 곱할 대상이 없어졌다는 것만
    // 바꿔 적는다 — 나이트의 damage가 0인 것은 밸런스 조정이 아니라 능력 교체의 기록이다.
    const s = waveState();
    s.pieces.push(boardPiece('queen', 0, 4));   // 4랭크 전체 버프
    const n = boardPiece('knight', 7, 1);       // 아직 퀸의 어느 라인에도 걸리지 않는 칸
    s.pieces.push(n);
    recalcQueenBuffs(s);
    expect(n.queenBuffCount).toBe(0);
    const e = enemyAt(1, 4, 5);
    s.enemies.push(e);
    const ev: GameEvent[] = [];
    expect(moveOnBoard(s, n.id, 3, 4, ev)).toBe(true);
    expect(n.queenBuffCount).toBe(1);           // 버프 재계산은 그대로
    expect(e.hp).toBe(e.maxHp);                 // 그러나 ×2 할 피해가 없다
    expect(ev).toEqual([]);
  });

  it('연속 이동에 대기가 없다 — 쿨다운은 더 이상 이동 게이트가 아니다', () => {
    const s = waveState();
    const n = boardPiece('knight', 3, 4);       // d4
    n.cooldown = HELD_COOLDOWN;
    s.pieces.push(n);
    const e1 = enemyAt(1, 3, 6);                // d6 — 1차 목적지 (3,7)의 옛 3×3 폭발 범위 안
    const e2 = enemyAt(1, 1, 4);                // b4 — 2차 목적지 (0,4)의 옛 3×3 폭발 범위 안
    s.enemies.push(e1, e2);
    const ev: GameEvent[] = [];

    // 두 수 모두 L자가 아니다(직선 3칸 → 대각선 3칸). 예전에는 첫 수가 L자 게이트에, 둘째 수가
    // 쿨다운 게이트에 걸렸다 — 이제 어느 쪽도 없어 연달아 그냥 통과한다.
    expect(moveOnBoard(s, n.id, 3, 7, ev)).toBe(true);
    expect(moveOnBoard(s, n.id, 0, 4, ev)).toBe(true);   // 한 틱도 기다리지 않고 곧바로 두 번째

    expect(n.cooldown).toBe(HELD_COOLDOWN);     // 두 번 움직여도 쿨다운은 손대지 않는다
    expect(e1.hp).toBe(e1.maxHp);
    expect(e2.hp).toBe(e2.maxHp);
    expect(ev).toEqual([]);
  });
});

describe('보드 위 기물 맞교환 — 점유 칸으로의 이동은 스왑이다 (게임 규칙 변경, 사용자 승인)', () => {
  it('점유된 칸으로 이동하면 두 기물이 서로 자리를 맞바꾼다', () => {
    const s = waveState();
    const a = boardPiece('rook', 0, 1);
    const b = boardPiece('bishop', 5, 5);
    s.pieces.push(a, b);
    expect(moveOnBoard(s, a.id, 5, 5, [])).toBe(true);
    expect(a.square).toEqual({ file: 5, rank: 5 });
    expect(b.square).toEqual({ file: 0, rank: 1 });
  });

  it('맞교환 후에도 두 기물의 쿨다운은 각자 정확히 그대로 유지된다 (쿨다운은 칸이 아니라 기물에 묶여 있다)', () => {
    const s = waveState();
    const a = boardPiece('rook', 0, 1);
    a.cooldown = 1.3;
    const b = boardPiece('bishop', 5, 5);
    b.cooldown = 2.7;
    s.pieces.push(a, b);
    expect(moveOnBoard(s, a.id, 5, 5, [])).toBe(true);
    expect(a.cooldown).toBe(1.3);
    expect(b.cooldown).toBe(2.7);
  });

  it('퀸과 맞교환하면 양쪽 위치 기준으로 버프가 재계산된다', () => {
    const s = waveState();
    const q = boardPiece('queen', 0, 1);                // a1
    const oldFileObserver = boardPiece('rook', 0, 4);   // a4 — 퀸의 이전 자리(a1)와 같은 파일
    const newFileObserver = boardPiece('bishop', 5, 4); // f4 — 퀸이 이동해 갈 자리(f3)와 같은 파일
    const swapTarget = boardPiece('pawn', 5, 3);        // f3 — 퀸이 맞교환할 대상
    s.pieces.push(q, oldFileObserver, newFileObserver, swapTarget);
    recalcQueenBuffs(s);
    expect(oldFileObserver.queenBuffCount).toBe(1);   // 퀸 원래 자리와 같은 파일 → 버프
    expect(newFileObserver.queenBuffCount).toBe(0);   // 아직 퀸이 그 파일에 없음

    expect(moveOnBoard(s, q.id, 5, 3, [])).toBe(true);  // 퀸이 f3의 폰과 맞교환
    expect(q.square).toEqual({ file: 5, rank: 3 });
    expect(swapTarget.square).toEqual({ file: 0, rank: 1 });   // 폰은 퀸의 이전 자리로

    expect(oldFileObserver.queenBuffCount).toBe(0);   // 퀸이 떠나 더 이상 버프 없음 — 재계산 증거
    expect(newFileObserver.queenBuffCount).toBe(1);   // 퀸이 도착한 파일이라 새로 버프 — 재계산 증거
  });

  it('나이트끼리 맞교환해도 아무 능력도 터지지 않고, 밀려난 쪽의 감속 범위도 새 칸을 따라간다', () => {
    const s = waveState();
    const mover = boardPiece('knight', 3, 4);       // d4
    // d7 — 같은 파일 세 칸 위. 예전에는 이 자리를 "d4에서 L자로 도달 가능한 점유 칸"으로 골라야
    // 했지만(v1.11에 제약이 사라졌다), 이제는 오히려 L자가 **아닌** 칸을 골라 둔다. 나이트도
    // 다른 기물과 똑같이 맞교환한다는 것이 이 스위트가 지켜야 할 사실이기 때문이다.
    const displaced = boardPiece('knight', 3, 7);
    s.pieces.push(mover, displaced);
    const e = enemyAt(1, 4, 6);   // mover의 새 위치(3,7) 옛 3×3 폭발 범위 안
    s.enemies.push(e);
    const ev: GameEvent[] = [];

    expect(moveOnBoard(s, mover.id, 3, 7, ev)).toBe(true);
    expect(mover.square).toEqual({ file: 3, rank: 7 });
    expect(displaced.square).toEqual({ file: 3, rank: 4 });   // 밀려난 나이트는 mover의 이전 자리로

    // 예전 규칙은 "직접 움직인 기물만 폭발한다"였고, 그 구분이 필요했던 이유는 폭발이 조작에
    // 딸린 사건이라 "누가 움직였는가"를 물을 수 있었기 때문이다. 감속에는 그 물음이 없다 —
    // 밀려난 쪽도 새 칸에 서 있다는 이유만으로 그냥 오라를 갖는다.
    expect(e.hp).toBe(e.maxHp);
    expect(ev).toEqual([]);

    // except로 mover를 빼고 밀려난 쪽의 오라만 따로 본다. 합집합만 보면 둘 다 나이트라 맞교환
    // 전후가 같은 집합이어서 아무것도 증명하지 못한다 — 자리를 서로 바꿨을 뿐이기 때문이다.
    const displacedField = slowCoverage(s, mover);
    expect(displacedField.has(squareKey({ file: 2, rank: 2 }))).toBe(true);    // 새 자리 (3,4)의 L자 칸
    expect(displacedField.has(squareKey({ file: 4, rank: 5 }))).toBe(false);   // 그건 mover 자리 (3,7)의 칸
  });

  it('제자리로의 이동은 아무 일도 하지 않고 false를 반환한다 (no-op)', () => {
    const s = waveState();
    const p = boardPiece('rook', 3, 4);
    p.cooldown = 1.5;
    s.pieces.push(p);
    const ev: GameEvent[] = [];
    expect(moveOnBoard(s, p.id, 3, 4, ev)).toBe(false);
    expect(p.square).toEqual({ file: 3, rank: 4 });
    expect(p.cooldown).toBe(1.5);
    expect(ev.length).toBe(0);
  });

  it('나이트의 제자리 이동도 똑같이 no-op이다 — 이제 이것을 막는 것은 sameSquare 가드 하나뿐이다', () => {
    // 예전에는 제자리가 L자가 아니라는 이유로 canLandAt에서도 한 번 더 걸렸다. 그 이중 방어가
    // v1.11에 한 겹 벗겨졌으므로(L자 게이트 삭제) 나이트를 일반 기물과 따로 재는 의미가
    // 오히려 지금 생겼다 — moveOnBoard 앞머리의 sameSquare 가드가 빠지면 위 룩 테스트와 함께
    // 여기도 무너져야 한다. 두 기물이 같은 이유로 함께 실패하는 것이 정상이다.
    const s = waveState();
    const n = boardPiece('knight', 3, 4);
    s.pieces.push(n);
    const ev: GameEvent[] = [];
    expect(moveOnBoard(s, n.id, 3, 4, ev)).toBe(false);
    expect(n.square).toEqual({ file: 3, rank: 4 });
    expect(ev.length).toBe(0);
  });
});

/*
 * ★ 착지 거부 사유의 소멸 (v1.12).
 *
 * 이 스위트는 예전 "트레이 → 점유된 보드 칸은 여전히 거부된다"의 **부호를 뒤집은** 자리다.
 * 그 거부에는 두 이름이 있었다 — 다른 종류가 점유했으면 'typeMismatch', 같은 종류지만 티어가
 * 다르면 'tierMismatch'. 둘 다 **출발지가 트레이일 때만** 존재하던 분기였다: 밀려난 기물이
 * 돌아갈 칸이 없으니 맞교환이 불가능했고, 그래서 거부할 수밖에 없었다.
 *
 * 기물 보관함이 사라져 모든 기물이 항상 보드 위에 있다(사용자 결정). 밀려날 기물의 출발 칸이
 * **항상 존재하므로** 두 사유는 대상 자체를 잃었고 RejectReason에서 삭제됐다. 남은 사유는
 * 'outOfBounds'와 'tierOverflow' 둘뿐이며 **둘 다 기물 종류와 무관하다.**
 */
describe('★ 점유 칸의 거부 사유 소멸 — 이제 전부 맞교환이다 (v1.12)', () => {
  const DEST = { file: 4, rank: 4 };

  it('다른 종류가 점유한 칸도 그냥 맞교환이다 (예전 typeMismatch)', () => {
    const s = waveState();
    // 융합 레시피에도 없는 조합을 고른다 — 합성 후보였다가 티어에서 걸린 것이 아니라
    // **애초에 합칠 수 없는 조합**이 거부되지 않는다는 것이 여기서 볼 사실이다.
    const mover = boardPiece('pawn', 0, 1);
    const occupant = boardPiece('bishop', DEST.file, DEST.rank);
    expect(fusionResult(mover.type, occupant.type)).toBeNull();
    s.pieces.push(mover, occupant);

    // 두 제스처를 함께 재는 이유는 예전 거부가 합성 분기(allowMerge=true) 안에 살았기 때문이다.
    expect(resolveLanding(s, mover, DEST, true)).toMatchObject({ kind: 'swap' });
    expect(resolveLanding(s, mover, DEST, false)).toMatchObject({ kind: 'swap' });

    // 판정만이 아니라 실제 경로까지 확인한다 — 맞교환이 성사돼야 "거부가 사라졌다"가 참이다.
    expect(moveOnBoard(s, mover.id, DEST.file, DEST.rank, [], true)).toBe(true);
    expect(mover.square).toEqual(DEST);
    expect(occupant.square).toEqual({ file: 0, rank: 1 });
  });

  it('같은 종류라도 티어가 다르면 그냥 맞교환이다 (예전 tierMismatch)', () => {
    const s = waveState();
    const mover = boardPiece('rook', 0, 1, 1);
    const occupant = boardPiece('rook', DEST.file, DEST.rank, 2);
    s.pieces.push(mover, occupant);

    expect(resolveLanding(s, mover, DEST, true)).toMatchObject({ kind: 'swap' });
    expect(moveOnBoard(s, mover.id, DEST.file, DEST.rank, [], true)).toBe(true);
    expect(mover.square).toEqual(DEST);
    expect(occupant.square).toEqual({ file: 0, rank: 1 });
    // 맞교환이지 흡수가 아니다. 두 기물이 그대로 남고 티어도 손대지 않는다.
    expect(s.pieces).toHaveLength(2);
    expect(mover.tier).toBe(1);
    expect(occupant.tier).toBe(2);
  });

  it('융합 재료 조합이어도 티어가 다르면 맞교환이다 — "합성 후보였다가 거부"라는 경우가 없다', () => {
    const s = waveState();
    const mover = boardPiece('knight', 0, 1, 1);
    const occupant = boardPiece('bishop', DEST.file, DEST.rank, 2);
    expect(fusionResult(mover.type, occupant.type)).not.toBeNull();   // 레시피는 있다
    s.pieces.push(mover, occupant);
    expect(resolveLanding(s, mover, DEST, true)).toMatchObject({ kind: 'swap' });
  });

  it('종류 × 티어 전 조합을 훑어도 reject가 하나도 나오지 않는다', () => {
    // 이름 붙은 위 세 테스트로는 "우리가 고른 조합만 통과한다"까지밖에 말할 수 없다. 거부
    // **사유가 타입에서 사라졌다**는 것은 전수 단언이라야 뜻이 맞는다: 8종 × 8종 × 티어 조합 ×
    // 두 제스처 어디에서도 점유 칸이 실격을 만들지 못한다. 상한(maxTier=6) 근처를 건드리지
    // 않도록 티어를 1·2로만 두어 tierOverflow와 섞이지 않게 한다 — 그쪽은 아래에서 따로 잰다.
    for (const moverType of ALL_TYPES) {
      for (const occType of ALL_TYPES) {
        for (const [moverTier, occTier] of [[1, 1], [1, 2], [2, 1]]) {
          for (const allowMerge of [false, true]) {
            const s = waveState();
            const mover = boardPiece(moverType, 0, 1, moverTier);
            const occupant = boardPiece(occType, DEST.file, DEST.rank, occTier);
            s.pieces.push(mover, occupant);
            const landing = resolveLanding(s, mover, DEST, allowMerge);
            const label = `${moverType}T${moverTier} → ${occType}T${occTier} (allowMerge=${allowMerge})`;
            expect(landing.kind, label).not.toBe('reject');

            // 합성 제스처가 아니면 점유 칸은 **무조건** 맞교환이다. 클릭-투-무브에는 합성
            // 분기가 아예 열리지 않으므로 종류도 티어도 결과를 바꾸지 못한다.
            if (!allowMerge) expect(landing.kind, label).toBe('swap');
            // 합성 제스처여도 티어가 다르면 맞교환이고(예전 tierMismatch),
            // 티어가 같아도 합칠 수 없는 조합이면 맞교환이다(예전 typeMismatch).
            else if (moverTier !== occTier) expect(landing.kind, label).toBe('swap');
            else if (moverType !== occType && !fusionResult(moverType, occType)) {
              expect(landing.kind, label).toBe('swap');
            }
          }
        }
      }
    }
  });

  it('tierOverflow는 여전히 살아 있다 — 위 훑기가 공회전이 아니라는 증거', () => {
    // 전수 단언이 "reject가 없다"라고만 말하면, 누군가 resolveLanding에서 reject 자체를 없애도
    // 초록이다. 남은 두 사유가 정말 도달 가능하다는 것을 함께 붙잡아 그 구멍을 막는다
    // (다른 하나인 outOfBounds는 아래 8랭크 가드가 맡는다).
    const s = waveState();
    const max = CONFIG.merge.maxTier.rook;
    const mover = boardPiece('rook', 0, 1, max);
    const occupant = boardPiece('rook', DEST.file, DEST.rank, max);
    s.pieces.push(mover, occupant);
    expect(resolveLanding(s, mover, DEST, true))
      .toMatchObject({ kind: 'reject', reason: 'tierOverflow' });
    // 그러나 합성 제스처가 아니면 상한과 무관하게 맞교환이다 — 상한이 이동까지 막지는 않는다.
    expect(resolveLanding(s, mover, DEST, false)).toMatchObject({ kind: 'swap' });
  });
});

describe('가드 보강 — 종료 페이즈·겹침 방지·범위 검증 (리뷰 조치)', () => {
  it('종료 페이즈(defeat/victory)에서는 이동이 막힌다', () => {
    // 예전에는 배치·이동·회수·재정렬 넷을 함께 쟀다. v1.12에서 셋이 사라져 이동만 남았지만,
    // 대신 두 종료 페이즈를 함께 돈다 — interactable이 화이트리스트(prepare/wave)라 어느 한쪽만
    // 재면 "defeat만 특별히 막는" 구현으로 되돌아가도 초록이 된다.
    for (const phase of ['defeat', 'victory'] as const) {
      const s = waveState();
      const p = boardPiece('pawn', 2, 3);
      s.pieces.push(p);
      s.phase = phase;
      expect(moveOnBoard(s, p.id, 3, 3, []), phase).toBe(false);
      expect(p.square, phase).toEqual({ file: 2, rank: 3 });
    }
  });

  it('어떤 이동도 한 칸에 두 기물을 겹쳐 놓지 않는다', () => {
    // 원래 여기 있던 "placeFromSlot: 이미 보드 위인 기물은 이 경로를 탈 수 없다"의 자리다.
    // 그 가드가 막던 것은 트레이발 착지가 맞교환 판정을 받아 **밀려난 기물을 되돌려 놓지 못한
    // 채** 두 기물이 같은 칸에 겹치는 사고였다. 경로가 통째로 사라졌으니 가드도 사라졌지만,
    // 지켜야 할 사실은 그대로다 — pieceAt류가 전부 첫 일치만 집으므로 겹침이 한 번 생기면
    // 아래 깔린 기물이 영원히 조작 불가능해진다. 이제 겹침을 만들 수 있는 유일한 후보는
    // 맞교환이고(출발 칸을 반드시 비워야 한다), 그래서 대상만 바꿔 살린다.
    const s = waveState();
    const mover = boardPiece('knight', 3, 4);
    s.pieces.push(mover, boardPiece('rook', 5, 5), boardPiece('pawn', 0, 1), boardPiece('bishop', 7, 7));
    const ev: GameEvent[] = [];
    for (const [file, rank] of [[5, 5], [0, 1], [7, 7], [2, 2], [5, 5]]) {
      expect(moveOnBoard(s, mover.id, file, rank, ev)).toBe(true);
      expect(mover.square).toEqual({ file, rank });
      const occupied = new Set(s.pieces.map(p => squareKey(p.square)));
      expect(occupied.size, `${file},${rank} 이후`).toBe(s.pieces.length);
    }
  });

  it('moveOnBoard는 8랭크(스폰 구역) 목적지를 거부한다 — 유일하게 남은 착지 제약', () => {
    const s = waveState();
    const spawnRank = CONFIG.board.ranks;   // 리터럴 8 금지 — 보드 크기가 곧 스폰 구역의 정의다
    const r = boardPiece('rook', 2, 6);
    const n = boardPiece('knight', 3, 6);
    s.pieces.push(r, n);
    expect(moveOnBoard(s, r.id, 2, spawnRank, [])).toBe(false);
    expect(moveOnBoard(s, n.id, 4, spawnRank, [])).toBe(false);

    // 나이트도 8랭크만은 못 간다. 이동 제약이 통째로 사라진 뒤(v1.11) **유일하게 남은 제약**이라
    // 여기서 사유까지 확인한다: true/false만 보면 "L자 게이트가 되살아나 우연히 같은 답을 냈다"와
    // 구별되지 않기 때문이다. 룩과 나란히 두는 것은 둘이 정말 같은 사유로 걸리는지를 보기 위함이다.
    const knightDest = { file: 4, rank: spawnRank };
    expect(resolveLanding(s, n, knightDest, false))
      .toMatchObject({ kind: 'reject', reason: 'outOfBounds' });
    expect(resolveLanding(s, r, { file: 2, rank: spawnRank }, false))
      .toMatchObject({ kind: 'reject', reason: 'outOfBounds' });
    // 합성 제스처로도 우회할 수 없다 — 경계 검사가 합성 분기보다 **앞에** 있다는 순서가 규칙이다.
    expect(resolveLanding(s, n, knightDest, true))
      .toMatchObject({ kind: 'reject', reason: 'outOfBounds' });

    // 그런데 감속 오라는 8랭크에도 걸린다(slowSquares) — (3,6)의 L자 칸인 (4,8)이 그것이다.
    // "덮는 칸"과 "갈 수 있는 칸"이 정확히 여기서 갈라지고, 두 범위를 별도 함수로 둔 이유가
    // 이 두 줄이다: 같은 칸이 능력에는 닿지만 착지에는 닫혀 있다.
    expect(slowCoverage(s).has(squareKey(knightDest))).toBe(true);
  });

  /*
   * ⚠️ 여기 있던 "recallToSlot: 범위를 벗어난 preferredSlot은 무시하고 빈 슬롯에 배정한다"가
   * v1.12에서 삭제됐다 — 돌아갈 슬롯이 없어 함수째 사라졌고(기물을 보드에서 치우는 방법은
   * 이제 판매뿐이다), 그 인자를 검증할 대상 자체가 없다. 슬롯 배정이 아니라 **칸 배정**이 된
   * 새 규칙(빈 칸 무작위 스폰)의 범위 검증은 economy 쪽 책임으로 옮겨 갔다.
   */
});
