import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { recalcQueenBuffs } from '../src/core/buff';
import { squareKey } from '../src/core/grid';
import {
  canPlaceAt, isKnightMove, moveOnBoard, pieceAt, placeFromSlot, recallToSlot, reorderSlots,
} from '../src/core/pieces';
import { slowCoverage } from '../src/core/slow';
import type { GameEvent, GameState, Piece, PieceType } from '../src/types';
import { boardPiece, enemyAt, waveState } from './helpers';

let seq = 0;
function slotPiece(s: GameState, type: PieceType, slotIndex: number): Piece {
  const p: Piece = { id: `sp-${seq++}`, type, square: null, slotIndex, cooldown: 0, queenBuffCount: 0, tier: 1 };
  s.pieces.push(p);
  return p;
}

/**
 * 나이트에게 "이미 남아 있는" 쿨다운. 조작(배치·이동·맞교환)이 이 값을 건드리지 않는다는 것이
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
    expect(canPlaceAt(s, 0, 7)).toBe(true);
    expect(canPlaceAt(s, 0, 8)).toBe(false);   // 스폰 구역
    expect(canPlaceAt(s, 3, 4)).toBe(false);   // 점유
    expect(canPlaceAt(s, -1, 3)).toBe(false);
  });
  it('placeFromSlot: 성공 시 슬롯에서 빠지고 보드에 놓인다', () => {
    const s = waveState();
    const p = slotPiece(s, 'pawn', 0);
    expect(placeFromSlot(s, p.id, 2, 3, [])).toBe(true);
    expect(p.square).toEqual({ file: 2, rank: 3 });
    expect(p.slotIndex).toBeNull();
    expect(pieceAt(s, 2, 3)).toBe(p);
  });
  it('일시정지 중 배치/이동/회수 불가 (스펙 7.7)', () => {
    const s = waveState();
    const p = slotPiece(s, 'pawn', 0);
    s.paused = true;
    expect(placeFromSlot(s, p.id, 2, 3, [])).toBe(false);
    s.paused = false;
    placeFromSlot(s, p.id, 2, 3, []);
    s.paused = true;
    expect(moveOnBoard(s, p.id, 2, 4, [])).toBe(false);
    expect(recallToSlot(s, p.id)).toBe(false);
  });
});

describe('이동/회수 — 쿨다운 유지 (스펙 5.1/10.5)', () => {
  it('일반 기물은 아무 빈 칸으로나 자유 이동, 쿨다운 유지', () => {
    const s = waveState();
    const r = boardPiece('rook', 0, 1);
    r.cooldown = 1.7;
    s.pieces.push(r);
    expect(moveOnBoard(s, r.id, 7, 7, [])).toBe(true);
    expect(r.square).toEqual({ file: 7, rank: 7 });
    expect(r.cooldown).toBe(1.7);              // 초기화 금지
  });
  it('회수→재배치에도 쿨다운 유지', () => {
    const s = waveState();
    const p = boardPiece('pawn', 3, 4);
    p.cooldown = 0.4;
    s.pieces.push(p);
    expect(recallToSlot(s, p.id)).toBe(true);
    expect(p.square).toBeNull();
    expect(p.slotIndex).toBe(0);
    expect(placeFromSlot(s, p.id, 5, 5, [])).toBe(true);
    expect(p.cooldown).toBe(0.4);
  });
  it('reorderSlots: 빈칸 이동과 맞교환', () => {
    const s = waveState();
    const a = slotPiece(s, 'pawn', 0);
    const b = slotPiece(s, 'rook', 1);
    expect(reorderSlots(s, a.id, 5)).toBe(true);   // 빈칸으로
    expect(a.slotIndex).toBe(5);
    expect(reorderSlots(s, a.id, 1)).toBe(true);   // b와 맞교환
    expect(a.slotIndex).toBe(1);
    expect(b.slotIndex).toBe(5);
  });
});

describe('퀸 버프 트리거 (스펙 10.5)', () => {
  it('배치/이동/회수 시 버프가 재계산된다', () => {
    const s = waveState();
    const q = slotPiece(s, 'queen', 0);
    const r = boardPiece('rook', 3, 5);
    s.pieces.push(r);
    placeFromSlot(s, q.id, 3, 1, []);          // 같은 파일
    expect(r.queenBuffCount).toBe(1);
    moveOnBoard(s, q.id, 4, 1, []);            // 라인 밖으로
    expect(r.queenBuffCount).toBe(0);
    moveOnBoard(s, q.id, 3, 1, []);
    expect(r.queenBuffCount).toBe(1);
    recallToSlot(s, q.id);
    expect(r.queenBuffCount).toBe(0);
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
 */
describe('나이트 (스펙 5.3 + 검토 노트 3)', () => {
  it('isKnightMove: L자만 허용', () => {
    expect(isKnightMove({ file: 3, rank: 4 }, { file: 4, rank: 6 })).toBe(true);
    expect(isKnightMove({ file: 3, rank: 4 }, { file: 5, rank: 5 })).toBe(true);
    expect(isKnightMove({ file: 3, rank: 4 }, { file: 3, rank: 5 })).toBe(false);
    expect(isKnightMove({ file: 3, rank: 4 }, { file: 5, rank: 6 })).toBe(false);
  });
  it('최초 배치는 아무 능력도 발동하지 않는다 — 피해도 이벤트도 쿨다운 변화도 없다', () => {
    const s = waveState();
    const n = slotPiece(s, 'knight', 0);
    n.cooldown = HELD_COOLDOWN;
    const e = enemyAt(1, 4, 5);                 // 예전 3×3 폭발 범위 한복판
    s.enemies.push(e);
    const ev: GameEvent[] = [];
    expect(placeFromSlot(s, n.id, 3, 4, ev)).toBe(true);
    // 예전에는 이 한 줄이 3 데미지 · knightBlast 이벤트 · 쿨다운 재시작을 동시에 일으켰다.
    // 이제 배치는 **기물을 그 칸에 놓는 것 외에 아무 일도 하지 않는다**. 세 단언을 따로 두는
    // 이유는 셋이 각각 다른 회귀를 잡기 때문이다: 피해는 tryKnightBlast의 부활을, 빈 이벤트
    // 배열은 조작에 딸린 연출·효과음의 부활을, 쿨다운은 이동 게이트의 부활을 막는다.
    expect(e.hp).toBe(e.maxHp);
    expect(ev).toEqual([]);
    expect(n.cooldown).toBe(HELD_COOLDOWN);
  });
  it('쿨다운이 남아 있어도 이동할 수 있다 — 남은 제약은 L자뿐, 점유 칸은 맞교환', () => {
    const s = waveState();
    const n = boardPiece('knight', 3, 4);
    n.cooldown = HELD_COOLDOWN;                 // 끝까지 0으로 내리지 않는 것이 이 테스트의 요지다
    const occupant = boardPiece('pawn', 4, 6);
    s.pieces.push(n, occupant);
    const ev: GameEvent[] = [];

    expect(moveOnBoard(s, n.id, 3, 5, ev)).toBe(false);   // L자 아님 — 유일하게 남은 이동 제약

    // 예전에는 쿨다운이 남아 있으면 L자여도 거부됐다('knightCooldown'). 사용자가 불쾌하다고
    // 지적한 바로 그 동작이고, 근거였던 폭발이 사라져 게이트째 삭제됐다 — 감속은 "언제
    // 움직였는가"가 아니라 "지금 어디 서 있는가"에만 달려 있어 이동을 막을 이유가 없다.
    expect(moveOnBoard(s, n.id, 4, 6, ev)).toBe(true);
    expect(n.square).toEqual({ file: 4, rank: 6 });
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
  it('회수→재배치를 반복해도 얻는 것이 없다 — 짜낼 "순간"이 사라졌고 회수는 손해다', () => {
    // 이 자리는 원래 스펙 5.1의 안티파밍 규칙("회수→재배치로 쿨다운을 우회해 폭발을 반복할 수
    // 없다")을 지키다가 interval이 0이 되며 "매번 폭발한다"로 뒤집혔던 테스트다. 이제는 규칙이
    // 아니라 대상이 없어졌다 — 배치가 피해를 주지 않으니 반복해서 짜낼 것이 없다. 오히려
    // 방향이 반대가 됐다는 점이 새 규칙의 핵심이라 그것까지 함께 단언한다: 감속은 **계속 서
    // 있어야** 유지되므로 회수는 이득이 아니라 그 즉시 오라를 잃는 손해다.
    const s = waveState();
    const n = slotPiece(s, 'knight', 0);
    const e = enemyAt(1, 4, 5);
    s.enemies.push(e);
    const ev: GameEvent[] = [];
    for (let i = 0; i < 3; i++) {
      expect(placeFromSlot(s, n.id, 3, 4, ev)).toBe(true);
      expect(slowCoverage(s).has(squareKey({ file: 4, rank: 6 }))).toBe(true);   // (3,4)의 L자 칸
      expect(recallToSlot(s, n.id)).toBe(true);
      expect(slowCoverage(s).size).toBe(0);     // 트레이로 돌아가면 덮는 칸이 하나도 없다
    }
    expect(e.hp).toBe(e.maxHp);
    expect(ev).toEqual([]);
  });
  it('퀸 버프를 받아도 배치는 여전히 무해하다 — 곱해질 공격력이 없다 (스펙 5.6)', () => {
    // 이전 판본은 "폭발 데미지는 폭발 시점 버프로 계산"이었다. 배치가 버프를 재계산한다는
    // 사실(스펙 10.5)은 그대로 살아 있으므로 남기고, 그 버프가 곱할 대상이 없어졌다는 것만
    // 바꿔 적는다 — 나이트의 damage가 0인 것은 밸런스 조정이 아니라 능력 교체의 기록이다.
    const s = waveState();
    s.pieces.push(boardPiece('queen', 0, 4));   // 4랭크 전체 버프
    const n = slotPiece(s, 'knight', 0);
    const e = enemyAt(1, 4, 5);
    s.enemies.push(e);
    const ev: GameEvent[] = [];
    expect(placeFromSlot(s, n.id, 3, 4, ev)).toBe(true);
    expect(n.queenBuffCount).toBe(1);           // 버프 재계산은 그대로
    expect(e.hp).toBe(e.maxHp);                 // 그러나 ×2 할 피해가 없다
    expect(ev).toEqual([]);
  });
  it('연속 L자 이동에 대기가 없다 — 쿨다운은 더 이상 이동 게이트가 아니다', () => {
    const s = waveState();
    const n = boardPiece('knight', 3, 4);       // d4
    n.cooldown = HELD_COOLDOWN;
    s.pieces.push(n);
    const e1 = enemyAt(1, 4, 5);                // e5 — 1차 목적지 (4,6)의 옛 3×3 폭발 범위 안
    const e2 = enemyAt(1, 2, 4);                // c4 — 2차 목적지 (2,5)의 옛 3×3 폭발 범위 안
    s.enemies.push(e1, e2);
    const ev: GameEvent[] = [];

    expect(moveOnBoard(s, n.id, 4, 6, ev)).toBe(true);
    expect(isKnightMove({ file: 4, rank: 6 }, { file: 2, rank: 5 })).toBe(true);
    expect(moveOnBoard(s, n.id, 2, 5, ev)).toBe(true);   // 한 틱도 기다리지 않고 곧바로 두 번째

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
    const displaced = boardPiece('knight', 4, 6);   // e6 — d4에서 L자로 도달 가능한 점유 칸, 자신도 나이트
    s.pieces.push(mover, displaced);
    const e = enemyAt(1, 4, 5);   // mover의 새 위치(4,6) 옛 3×3 폭발 범위 안
    s.enemies.push(e);
    const ev: GameEvent[] = [];

    expect(moveOnBoard(s, mover.id, 4, 6, ev)).toBe(true);
    expect(mover.square).toEqual({ file: 4, rank: 6 });
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
    expect(displacedField.has(squareKey({ file: 6, rank: 5 }))).toBe(false);   // 그건 mover 자리 (4,6)의 칸
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

  it('나이트의 제자리 이동도 no-op이다 (애초에 L자가 아니라 canLandAt에서도 걸러진다)', () => {
    const s = waveState();
    const n = boardPiece('knight', 3, 4);
    s.pieces.push(n);
    expect(moveOnBoard(s, n.id, 3, 4, [])).toBe(false);
  });

  it('트레이 → 점유된 보드 칸은 여전히 거부된다 (스왑은 board→board 전용, 트레이엔 밀려날 상대가 없다)', () => {
    const s = waveState();
    const occupant = boardPiece('bishop', 3, 4);
    const p = slotPiece(s, 'pawn', 0);
    s.pieces.push(occupant);
    expect(placeFromSlot(s, p.id, 3, 4, [])).toBe(false);
    expect(p.square).toBeNull();
    expect(occupant.square).toEqual({ file: 3, rank: 4 });
  });
});

describe('가드 보강 — 종료 페이즈·텔레포트 방지·범위 검증 (리뷰 조치)', () => {
  it('종료 페이즈(defeat)에서는 배치/이동/회수/재정렬 모두 불가', () => {
    const s = waveState();
    const onBoard = boardPiece('pawn', 2, 3);
    s.pieces.push(onBoard);
    const inSlot = slotPiece(s, 'rook', 1);
    s.phase = 'defeat';
    expect(placeFromSlot(s, inSlot.id, 4, 4, [])).toBe(false);
    expect(moveOnBoard(s, onBoard.id, 3, 3, [])).toBe(false);
    expect(recallToSlot(s, onBoard.id)).toBe(false);
    expect(reorderSlots(s, inSlot.id, 2)).toBe(false);
  });
  it('일시정지 중에는 재정렬도 불가', () => {
    const s = waveState();
    const a = slotPiece(s, 'pawn', 0);
    s.paused = true;
    expect(reorderSlots(s, a.id, 3)).toBe(false);
  });
  it('placeFromSlot: 이미 보드 위인 기물은 재배치할 수 없다 (L자 제한 우회 방지)', () => {
    const s = waveState();
    const n = boardPiece('knight', 3, 4);
    s.pieces.push(n);
    const ev: GameEvent[] = [];
    // (0,1)은 canPlaceAt 자체는 통과하는 빈 칸이지만 (3,4)에서 L자가 아니다 —
    // 이미 보드 위인 기물은 placeFromSlot으로 재배치할 수 없어야 이 우회가 막힌다.
    expect(placeFromSlot(s, n.id, 0, 1, ev)).toBe(false);
    expect(n.square).toEqual({ file: 3, rank: 4 });
    expect(ev.length).toBe(0);
  });
  it('placeFromSlot/moveOnBoard도 8랭크 목적지를 거부한다', () => {
    const s = waveState();
    const p = slotPiece(s, 'pawn', 0);
    expect(placeFromSlot(s, p.id, 3, 8, [])).toBe(false);

    const r = boardPiece('rook', 2, 6);
    s.pieces.push(r);
    expect(moveOnBoard(s, r.id, 2, 8, [])).toBe(false);

    const n = boardPiece('knight', 3, 6);
    // L자여도 8랭크(스폰 구역)에는 착지할 수 없다. 감속 오라는 8랭크에도 걸리므로(slowSquares)
    // "덮는 칸"과 "갈 수 있는 칸"이 여기서 갈라진다 — 두 함수를 분리해 둔 이유가 이 줄이다.
    s.pieces.push(n);
    expect(isKnightMove({ file: 3, rank: 6 }, { file: 4, rank: 8 })).toBe(true);
    expect(moveOnBoard(s, n.id, 4, 8, [])).toBe(false);
  });
  it('recallToSlot: 범위를 벗어난 preferredSlot은 무시하고 빈 슬롯에 배정한다', () => {
    const s = waveState();
    const p = boardPiece('pawn', 3, 4);
    s.pieces.push(p);
    expect(recallToSlot(s, p.id, 999)).toBe(true);
    expect(p.slotIndex).toBe(0);

    const q = boardPiece('rook', 1, 2);
    s.pieces.push(q);
    expect(recallToSlot(s, q.id, -1)).toBe(true);
    expect(q.slotIndex).toBe(1);
  });
});
