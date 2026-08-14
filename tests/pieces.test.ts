import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { recalcQueenBuffs } from '../src/core/buff';
import {
  canPlaceAt, isKnightMove, moveOnBoard, pieceAt, placeFromSlot, recallToSlot, reorderSlots,
} from '../src/core/pieces';
import type { GameEvent, GameState, Piece, PieceType } from '../src/types';
import { boardPiece, enemyAt, waveState } from './helpers';

let seq = 0;
function slotPiece(s: GameState, type: PieceType, slotIndex: number): Piece {
  const p: Piece = { id: `sp-${seq++}`, type, square: null, slotIndex, cooldown: 0, queenBuffCount: 0 };
  s.pieces.push(p);
  return p;
}

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

describe('나이트 (스펙 5.3 + 검토 노트 3)', () => {
  it('isKnightMove: L자만 허용', () => {
    expect(isKnightMove({ file: 3, rank: 4 }, { file: 4, rank: 6 })).toBe(true);
    expect(isKnightMove({ file: 3, rank: 4 }, { file: 5, rank: 5 })).toBe(true);
    expect(isKnightMove({ file: 3, rank: 4 }, { file: 3, rank: 5 })).toBe(false);
    expect(isKnightMove({ file: 3, rank: 4 }, { file: 5, rank: 6 })).toBe(false);
  });
  it('최초 배치: 9칸 폭발 + 쿨다운 재시작 (config 값 그대로 — 현재 0이라 즉시 재무장, 스펙 변경)', () => {
    const s = waveState();
    const n = slotPiece(s, 'knight', 0);
    const e = enemyAt(1, 4, 5);
    s.enemies.push(e);
    const ev: GameEvent[] = [];
    expect(placeFromSlot(s, n.id, 3, 4, ev)).toBe(true);
    expect(e.hp).toBe(7);                       // 3 데미지
    // 이전: interval이 3.0이라 쿨다운도 3.0으로 재시작했다. 이제 CONFIG.pieces.knight.interval이
    // 0이므로(게임 규칙 변경, 사용자 승인) 쿨다운은 즉시 0으로 재무장한다 — 리터럴 대신 config
    // 값으로 단언해 되돌림에도 이 테스트가 자동으로 맞아떨어지게 한다.
    expect(n.cooldown).toBe(CONFIG.pieces.knight.interval);
    expect(ev.some(x => x.kind === 'knightBlast')).toBe(true);
  });
  it('쿨다운 중 보드 이동 불가, L자 아니면 불가, 점유 칸은 맞교환으로 허용 (스펙 변경)', () => {
    const s = waveState();
    const n = boardPiece('knight', 3, 4);
    n.cooldown = 1.0;
    const occupant = boardPiece('pawn', 4, 6);
    s.pieces.push(n, occupant);
    expect(moveOnBoard(s, n.id, 5, 5, [])).toBe(false);  // 쿨다운 중
    n.cooldown = 0;
    expect(moveOnBoard(s, n.id, 3, 5, [])).toBe(false);  // L자 아님
    // 이전: 점유 칸이라 거부됐다. 이제 보드 위 기물에게 점유 칸은 실격 사유가 아니라 맞교환
    // 대상이다 — 나이트는 여전히 L자(여기서는 (3,4)→(4,6))를 만족해야 하지만, 통과하면 점유자와
    // 자리를 맞바꾸고 새 위치에서 폭발한다.
    expect(moveOnBoard(s, n.id, 4, 6, [])).toBe(true);
    expect(n.square).toEqual({ file: 4, rank: 6 });
    expect(occupant.square).toEqual({ file: 3, rank: 4 });   // 점유자는 나이트의 이전 자리로 밀려난다
    expect(n.cooldown).toBe(CONFIG.pieces.knight.interval);  // 이동 후 재시작 (config 값)
  });
  it('이동 완료 시 새 위치에서 폭발', () => {
    const s = waveState();
    const n = boardPiece('knight', 3, 4);
    s.pieces.push(n);
    const e = enemyAt(1, 5, 6);
    s.enemies.push(e);
    moveOnBoard(s, n.id, 5, 5, []);
    expect(e.hp).toBe(7);
  });
  it('회수→재배치로 폭발이 반복된다 (쿨다운 폐지로 안티파밍 규칙 삭제 — 게임 규칙 변경, 사용자 승인)', () => {
    // 이전에는 이 테스트가 "회수→재배치로 쿨다운을 우회해 폭발을 반복할 수 없다"를 검증했다
    // (스펙 5.1의 안티파밍 규칙). CONFIG.pieces.knight.interval이 0으로 바뀌면서 나이트는 애초에
    // 쿨다운이 존재하지 않으므로 우회할 쿨다운 자체가 없다 — 회수 없이 그 자리에 다시 배치하기만
    // 해도 매번 폭발한다. 이 스펙 조항은 사용자가 명시적으로 승인하고 폐기했다.
    const s = waveState();
    const n = slotPiece(s, 'knight', 0);
    const e = enemyAt(1, 4, 5);
    s.enemies.push(e);
    placeFromSlot(s, n.id, 3, 4, []);           // 폭발 1회 (10 → 7)
    expect(e.hp).toBe(7);
    // 쿨다운이 즉시 config 값(현재 0)으로 재무장 — 우회할 쿨다운이 없다. 리터럴 대신 config
    // 참조로 단언해, 값을 되돌려도(스펙 되돌림) 이 줄이 자동으로 맞아떨어지게 한다.
    expect(n.cooldown).toBe(CONFIG.pieces.knight.interval);
    recallToSlot(s, n.id);
    placeFromSlot(s, n.id, 3, 4, []);           // 재배치 즉시 다시 폭발 (7 → 4)
    expect(e.hp).toBe(4);
    expect(n.square).toEqual({ file: 3, rank: 4 });
    recallToSlot(s, n.id);
    placeFromSlot(s, n.id, 3, 4, []);           // 몇 번이든 반복된다 (4 → 1)
    expect(e.hp).toBe(1);
  });
  it('폭발 데미지는 폭발 시점 버프로 계산 (스펙 5.6)', () => {
    const s = waveState();
    s.pieces.push(boardPiece('queen', 0, 4));   // 4랭크 전체 버프
    const n = slotPiece(s, 'knight', 0);
    const e = enemyAt(1, 4, 5);
    s.enemies.push(e);
    placeFromSlot(s, n.id, 3, 4, []);           // 배치 → 버프 재계산 → 폭발
    expect(e.hp).toBe(4);                       // 3 × 2 = 6 데미지
  });
  it('쿨다운 대기 없이 연속으로 L자 이동해도 매번 폭발한다 (게임 규칙 변경 — interval 0, 사용자 승인)', () => {
    const s = waveState();
    const n = boardPiece('knight', 3, 4);       // d4
    s.pieces.push(n);
    const e1 = enemyAt(1, 4, 6);                // e6 — 1차 목적지 (4,6)의 3×3 폭발 범위 안
    const e2 = enemyAt(1, 2, 4);                // c4 — 2차 목적지 (2,5)의 3×3 폭발 범위 안
    s.enemies.push(e1, e2);

    expect(moveOnBoard(s, n.id, 4, 6, [])).toBe(true);   // 1차 이동+폭발, 쿨 0 → 즉시 재무장
    expect(e1.hp).toBe(7);
    expect(n.cooldown).toBe(CONFIG.pieces.knight.interval);

    expect(isKnightMove({ file: 4, rank: 6 }, { file: 2, rank: 5 })).toBe(true);
    expect(moveOnBoard(s, n.id, 2, 5, [])).toBe(true);   // 대기 없이 곧바로 2차 L자 이동+폭발
    expect(e2.hp).toBe(7);
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

  it('나이트가 점유된 L자 칸으로 맞교환 이동하면 자신만 폭발하고, 밀려난 기물이 나이트여도 폭발하지 않는다', () => {
    const s = waveState();
    const mover = boardPiece('knight', 3, 4);       // d4
    const displaced = boardPiece('knight', 4, 6);   // e6 — d4에서 L자로 도달 가능한 점유 칸, 자신도 나이트
    s.pieces.push(mover, displaced);
    const e = enemyAt(1, 4, 5);   // mover의 새 위치(4,6) 3×3 폭발 범위 안
    s.enemies.push(e);
    const ev: GameEvent[] = [];

    expect(moveOnBoard(s, mover.id, 4, 6, ev)).toBe(true);
    expect(mover.square).toEqual({ file: 4, rank: 6 });
    expect(displaced.square).toEqual({ file: 3, rank: 4 });   // 밀려난 나이트는 mover의 이전 자리로

    expect(e.hp).toBe(7);                                      // mover의 폭발 데미지(3)만 적용
    const blastEvents = ev.filter(x => x.kind === 'knightBlast');
    expect(blastEvents).toHaveLength(1);                        // 폭발은 정확히 1회 — mover만, displaced는 없음
    expect(blastEvents[0]).toEqual({ kind: 'knightBlast', square: { file: 4, rank: 6 } });
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
    const n = boardPiece('knight', 3, 4);       // 쿨다운 0
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

    const n = boardPiece('knight', 3, 6);       // 쿨다운 0
    s.pieces.push(n);
    expect(isKnightMove({ file: 3, rank: 6 }, { file: 4, rank: 8 })).toBe(true); // L자이지만 8랭크
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
