import { describe, expect, it } from 'vitest';
import { CONFIG, TRAITS, enemyHp } from '../src/config';
import { applyAttack, pieceDamage, updateCombat } from '../src/core/combat';
import { drawPiece, emptySquares } from '../src/core/economy';
import { enemySquare, sameSquare } from '../src/core/grid';
import { attackTargets, queenLines } from '../src/core/patterns';
import type { GameEvent } from '../src/types';
import { boardPiece, enemyAt, waveState, gachaRng } from './helpers';

describe('pieceDamage (스펙 5.6)', () => {
  it('기본 × (1 + 퀸 수): 룩 5 → 버프 1개면 10', () => {
    const r = boardPiece('rook', 0, 1);
    expect(pieceDamage(r)).toBe(5);
    r.queenBuffCount = 1;
    expect(pieceDamage(r)).toBe(10);
    r.queenBuffCount = 3;
    expect(pieceDamage(r)).toBe(20);
  });
});

describe('applyAttack', () => {
  it('한 칸의 모든 적 동시 타격 (다중 타격, 스펙 5.1)', () => {
    const s = waveState();
    const a = enemyAt(1, 2, 5);
    const b = enemyAt(1, 2, 5);
    s.enemies.push(a, b);
    applyAttack(s, [{ file: 2, rank: 5 }], 3, []);
    expect(a.hp).toBe(7);
    expect(b.hp).toBe(7);
  });
  it('처치: 골드 = maxHp, 통계 갱신, enemyDied 이벤트 (스펙 4.1/6)', () => {
    const s = waveState();
    s.enemies.push(enemyAt(1, 2, 5, false, 'victim'));
    const ev: GameEvent[] = [];
    applyAttack(s, [{ file: 2, rank: 5 }], 10, ev);
    expect(s.enemies).toHaveLength(0);
    expect(s.gold).toBe(300 + 10);
    expect(s.stats.totalKills).toBe(1);
    expect(s.stats.totalGoldEarned).toBe(10);
    expect(ev).toContainEqual({
      kind: 'enemyDied', enemyId: 'victim', square: { file: 2, rank: 5 }, isBoss: false, reward: 10,
    });
  });
  it('범위 밖 적은 무피해', () => {
    const s = waveState();
    const far = enemyAt(1, 5, 5);
    s.enemies.push(far);
    applyAttack(s, [{ file: 2, rank: 5 }], 10, []);
    expect(far.hp).toBe(10);
  });
  it('한 번의 타격으로 여러 적 동시 처치 — 각각 보상·이벤트 지급, 제거 누락/중복 없음', () => {
    const s = waveState();
    s.enemies.push(enemyAt(1, 2, 5, false, 'v1'), enemyAt(1, 2, 5, false, 'v2'));
    const ev: GameEvent[] = [];
    applyAttack(s, [{ file: 2, rank: 5 }], 10, ev);
    expect(s.enemies).toHaveLength(0);
    expect(s.gold).toBe(300 + 20);
    expect(s.stats.totalKills).toBe(2);
    expect(s.stats.totalGoldEarned).toBe(20);
    // ★ v1.15부터 피격마다 enemyHit이 함께 나온다 — 적 2마리이므로 hit 2 + died 2 = 4다.
    // 종류별로 세는 것이 총수를 세는 것보다 낫다: 새 이벤트가 하나 늘 때마다 무관한 테스트가
    // 깨지는 대신, "처치 이벤트가 적 수만큼 정확히 난다"는 원래 요지만 지킨다.
    expect(ev.filter(x => x.kind === 'enemyDied')).toHaveLength(2);
    expect(ev.filter(x => x.kind === 'enemyHit')).toHaveLength(2);
    expect(ev).toContainEqual({
      kind: 'enemyDied', enemyId: 'v1', square: { file: 2, rank: 5 }, isBoss: false, reward: 10,
    });
    expect(ev).toContainEqual({
      kind: 'enemyDied', enemyId: 'v2', square: { file: 2, rank: 5 }, isBoss: false, reward: 10,
    });
  });
  it('보스 처치: 보상 = maxHp(420), enemyDied 이벤트에 isBoss: true', () => {
    const s = waveState();
    s.enemies.push(enemyAt(5, 2, 5, true, 'boss'));
    const ev: GameEvent[] = [];
    applyAttack(s, [{ file: 2, rank: 5 }], 420, ev);
    expect(s.enemies).toHaveLength(0);
    expect(s.gold).toBe(300 + 420);
    expect(s.stats.totalGoldEarned).toBe(420);
    expect(ev).toContainEqual({
      kind: 'enemyDied', enemyId: 'boss', square: { file: 2, rank: 5 }, isBoss: true, reward: 420,
    });
  });
});

describe('updateCombat — 주기 공격 (스펙 5.2/5.4/5.5)', () => {
  it('폰: 0.5초마다 전방 대각선의 적을 2씩 타격', () => {
    const s = waveState();
    const p = boardPiece('pawn', 3, 4);
    const e = enemyAt(1, 2, 5);           // (d4) 폰의 ↖ 대상 칸 c5
    s.pieces.push(p);
    s.enemies.push(e);
    updateCombat(s, 1 / 60, []);           // 쿨 0 + 적 존재 → 즉시 발사
    expect(e.hp).toBe(8);
    expect(p.cooldown).toBeCloseTo(0.5);
    for (let i = 0; i < 30; i++) updateCombat(s, 1 / 60, []); // +0.5초
    expect(e.hp).toBe(6);
  });
  it('사거리에 적이 없으면 쿨다운 0에서 대기 (허공 발사 없음)', () => {
    const s = waveState();
    const p = boardPiece('pawn', 3, 4);
    s.pieces.push(p);
    updateCombat(s, 1, []);
    expect(p.cooldown).toBe(0);
    s.enemies.push(enemyAt(1, 4, 5));      // 적 진입
    const ev: GameEvent[] = [];
    updateCombat(s, 1 / 60, ev);           // 즉시 발사
    expect(s.enemies[0].hp).toBe(8);
    expect(ev.some(x => x.kind === 'attack')).toBe(true);
  });
  it('룩: 같은 파일 전체 관통 — 여러 칸의 적을 한 번에 타격', () => {
    const s = waveState();
    s.pieces.push(boardPiece('rook', 3, 1));
    const near = enemyAt(1, 3, 3);
    const far = enemyAt(1, 3, 8);
    const other = enemyAt(1, 4, 3);
    s.enemies.push(near, far, other);
    updateCombat(s, 1 / 60, []);
    expect(near.hp).toBe(5);
    expect(far.hp).toBe(5);
    expect(other.hp).toBe(10);             // 다른 파일·다른 랭크 → 룩 범위 밖
  });
  it('비숍: 대각선 관통, 주기 3초', () => {
    const s = waveState();
    const b = boardPiece('bishop', 3, 4);  // d4
    s.pieces.push(b);
    const e = enemyAt(1, 6, 7);            // g7 — d4 대각선
    s.enemies.push(e);
    updateCombat(s, 1 / 60, []);
    // 비숍의 공격력은 경제 기물로 바뀌며 낮아졌고 앞으로도 다시 조정될 수 있다 — 여기서 고정하려는
    // 것은 "대각선 끝의 적이 실제로 맞는다"는 사실이지 특정 숫자가 아니므로 CONFIG에서 유도한다.
    expect(e.hp).toBe(enemyHp(1) - CONFIG.pieces.bishop.damage);
    expect(b.cooldown).toBeCloseTo(CONFIG.pieces.bishop.interval);
  });
  // v1.12에서 '슬롯 기물: 쿨다운은 흐르지만 발사하지 않는다'가 사라졌다 — 보관함이 없어져
  // square가 널이 아니게 됐고(모든 기물이 항상 보드 위), 그래서 "보드 밖에서 대기하는 기물"이라는
  // 상태를 만들 방법 자체가 없다. 다만 그 테스트가 실제로 지키던 것은 트레이가 아니라 **쿨다운
  // 규칙**(발사와 무관하게 흐른다 · 0에서 멈춘다, 스펙 5.1 ID 유지)이었고 그 규칙은 그대로
  // 살아 있으므로, 발사 조건이 서지 않는 보드 기물로 다시 단언한다.
  it('쿨다운은 발사하지 않는 동안에도 계속 줄고 0에서 멈춘다 (음수 금지, 스펙 5.1 ID 유지)', () => {
    const s = waveState();
    const p = boardPiece('pawn', 3, 4);
    p.cooldown = 2.0;
    s.pieces.push(p);
    const e = enemyAt(1, 3, 5);            // d5 — 폰의 대각선(c5·e5) 밖이라 발사가 안 걸린다
    s.enemies.push(e);
    updateCombat(s, 1.5, []);
    expect(p.cooldown).toBeCloseTo(0.5);   // 계속 감소
    expect(e.hp).toBe(enemyHp(1));         // 발사는 없음
    updateCombat(s, 1.0, []);              // 남은 쿨다운보다 큰 dt
    expect(p.cooldown).toBe(0);            // 0에서 멈춤 (음수 금지)
    expect(e.hp).toBe(enemyHp(1));
  });
  it('버프 반영: 퀸 버프 1개면 폰이 4씩 타격', () => {
    const s = waveState();
    const p = boardPiece('pawn', 3, 4);
    p.queenBuffCount = 1;
    s.pieces.push(p);
    const e = enemyAt(1, 2, 5);
    s.enemies.push(e);
    updateCombat(s, 1 / 60, []);
    expect(e.hp).toBe(6);
  });
  it('goldPerAttack: 발사 1회당 정액 골드 + goldGained 이벤트 (비숍)', () => {
    const s = waveState();
    const gold0 = s.gold;
    const b = boardPiece('bishop', 3, 4);
    s.pieces.push(b);
    s.enemies.push(enemyAt(1, 6, 7));
    const ev: GameEvent[] = [];
    updateCombat(s, 1 / 60, ev);
    const G = CONFIG.pieces.bishop.goldPerAttack;
    expect(s.gold).toBe(gold0 + G);
    expect(s.stats.totalGoldEarned).toBe(G);      // 통계에도 반영 (처치 골드와 같은 취급)
    expect(ev).toContainEqual({ kind: 'goldGained', square: { file: 3, rank: 4 }, amount: G });

    updateCombat(s, CONFIG.pieces.bishop.interval, ev);   // 쿨다운 만료 → 두 번째 발사
    expect(s.gold).toBe(gold0 + 2 * G);
  });
  it('goldPerAttack: 사거리에 적이 없으면 발사도 골드도 없다', () => {
    const s = waveState();
    const gold0 = s.gold;
    s.pieces.push(boardPiece('bishop', 3, 4));
    s.enemies.push(enemyAt(1, 3, 5));      // d5 — 같은 파일, 대각선 아님
    const ev: GameEvent[] = [];
    updateCombat(s, 10, ev);               // 쿨다운이 충분히 지나도
    expect(s.gold).toBe(gold0);
    expect(ev.some(e => e.kind === 'goldGained')).toBe(false);
  });
  it('goldPerAttack: 적을 죽이든 여러 마리를 맞히든 액수는 같다 (정액)', () => {
    const G = CONFIG.pieces.bishop.goldPerAttack;
    const many = waveState();
    many.pieces.push(boardPiece('bishop', 3, 4));
    many.enemies.push(enemyAt(1, 4, 5), enemyAt(1, 5, 6), enemyAt(1, 2, 3));   // 대각선 3마리
    updateCombat(many, 1 / 60, []);
    expect(many.stats.totalGoldEarned).toBe(G);

    // 처치가 일어나면 처치 보상(maxHp)이 별도로 더해질 뿐, 공격 골드 자체는 그대로다.
    const kill = waveState();
    const weak = enemyAt(1, 4, 5);
    weak.hp = 1;
    kill.pieces.push(boardPiece('bishop', 3, 4));
    kill.enemies.push(weak);
    updateCombat(kill, 1 / 60, []);
    expect(kill.stats.totalGoldEarned).toBe(G + weak.maxHp);
  });
  it('goldPerAttack: 퀸 버프는 공격력만 올리고 골드에는 적용되지 않는다', () => {
    const s = waveState();
    const b = boardPiece('bishop', 3, 4);
    b.queenBuffCount = 3;                  // 공격력 ×4
    s.pieces.push(b);
    const e = enemyAt(1, 6, 7);
    s.enemies.push(e);
    updateCombat(s, 1 / 60, []);
    expect(e.hp).toBe(enemyHp(1) - CONFIG.pieces.bishop.damage * 4);
    expect(s.stats.totalGoldEarned).toBe(CONFIG.pieces.bishop.goldPerAttack);
  });
  // v1.12에서 'goldPerAttack: 슬롯의 비숍은 쿨다운만 흐르고 골드는 못 번다'를 삭제했다.
  // 재현 불가능한 상태(트레이)를 전제로 했을 뿐이고, 이 테스트가 지키던 불변식 —
  // **발사하지 않으면 골드도 없다** — 는 같은 describe의 'goldPerAttack: 사거리에 적이 없으면
  // 발사도 골드도 없다'가 그대로 덮는다(그쪽도 쿨다운을 10초 흘려 놓고 골드가 0임을 본다).
  it('goldPerAttack 0인 기물(폰·룩)은 골드를 벌지 않는다', () => {
    const s = waveState();
    const gold0 = s.gold;
    s.pieces.push(boardPiece('pawn', 3, 4), boardPiece('rook', 0, 1));
    s.enemies.push(enemyAt(1, 2, 5), enemyAt(1, 0, 3));
    const ev: GameEvent[] = [];
    updateCombat(s, 1 / 60, ev);
    expect(ev.some(e => e.kind === 'attack')).toBe(true);      // 공격은 분명히 했는데
    expect(ev.some(e => e.kind === 'goldGained')).toBe(false);  // 골드는 없다
    expect(s.gold).toBe(gold0);
  });
  it('나이트·퀸은 주기 발사가 없다', () => {
    const s = waveState();
    const n = boardPiece('knight', 3, 4);
    const q = boardPiece('queen', 3, 5);
    n.cooldown = 3.0;
    s.pieces.push(n, q);
    const e = enemyAt(1, 3, 4);            // 나이트 자신 칸
    s.enemies.push(e);
    updateCombat(s, 3.0, []);              // 쿨다운이 정확히 0에 도달 — 발사 게이트가 실제로 열리는 지점
    expect(e.hp).toBe(10);                 // 쿨 0이어도 나이트는 안 때림
    expect(n.cooldown).toBe(0);            // 이동 쿨다운은 0까지 감소 (나이트 예외로 재설정되지 않음)
  });
});

/**
 * updateCombat이 `p.square`를 널 검사 없이 그대로 쓰는 근거를 여기서 지킨다 (v1.12).
 *
 * 예전 루프는 `if (!p.square) continue`로 트레이 기물을 걸러냈고, 그 한 줄이 빠지면 전투가
 * 조용히 널을 만졌다. 보관함이 사라지면서 그 분기도 사라졌는데 — 검사를 없앤 것이 옳으려면
 * "기물은 언제나 실제 칸 위에 있고, 그 칸이 곧 사거리의 원점"이 **획득 경로에서부터** 참이어야
 * 한다. 아래 세 테스트가 그 전제(스폰 직후 · 만석 · 버프 정산)를 각각 붙잡는다.
 */
describe('보관함 폐지 이후의 전투 (v1.12)', () => {
  it('구매한 기물은 대기 없이 스폰된 그 칸에서 즉시 발사한다', () => {
    const s = waveState();
    const ev: GameEvent[] = [];
    // 스폰 칸을 테스트가 알 수 있도록 난수를 고정한다 (Math.random 금지).
    const p = drawPiece(s, ev, gachaRng('pawn'));
    expect(p).not.toBeNull();
    const sq = p!.square;
    // 이벤트의 square가 실제 위치와 어긋나면 무음 실패다 — 위치를 플레이어가 고르지 않으므로
    // 이 이벤트가 "새 기물이 어디 생겼는지"를 알리는 유일한 단서다.
    expect(ev).toContainEqual({ kind: 'pieceSpawned', square: sq, pieceType: 'pawn', bought: true });

    const target = attackTargets('pawn', sq).find(t => !sameSquare(t, sq))!;
    s.enemies.push(enemyAt(1, target.file, target.rank));
    const fired: GameEvent[] = [];
    updateCombat(s, 1 / 60, fired);
    expect(s.enemies[0].hp).toBe(enemyHp(1) - CONFIG.pieces.pawn.damage);
    // from이 스폰 칸과 같아야 사거리 원점이 실제 위치라는 뜻이 된다.
    expect(fired).toContainEqual({
      kind: 'attack', pieceType: 'pawn', from: sq, targets: attackTargets('pawn', sq),
    });
  });

  it('보드가 꽉 차도(= 더는 살 수 없는 상태) 한 기물도 건너뛰지 않는다', () => {
    const s = waveState();
    // 놓을 수 있는 칸을 전부 폰으로 메운다 — 예전 같으면 초과분이 트레이로 밀려나 발사 대상에서
    // 빠졌겠지만, 이제 그런 상태가 없으니 여기 있는 전부가 싸운다.
    for (const sq of emptySquares(s)) s.pieces.push(boardPiece('pawn', sq.file, sq.rank));
    expect(s.pieces).toHaveLength(CONFIG.board.files * (CONFIG.board.ranks - 1));
    expect(emptySquares(s)).toHaveLength(0);   // 만석 = 구매·지급이 막히는 조건 그 자체

    const e = enemyAt(1, 3, 5);                // d5 — c4·e4 두 폰의 대각선이 겹치는 칸
    const at = enemySquare(e);                 // 적의 칸은 y에서 유도된다 — 좌표를 두 번 적지 않는다
    const attackers = s.pieces.filter(p => attackTargets(p.type, p.square).some(t => sameSquare(t, at)));
    expect(attackers.length).toBeGreaterThan(1);   // 여럿이 때리는 칸이어야 "건너뜀"이 드러난다
    s.enemies.push(e);
    updateCombat(s, 1 / 60, []);
    expect(e.hp).toBe(enemyHp(1) - attackers.length * CONFIG.pieces.pawn.damage);
  });

  it('스폰이 곧 배치 — 퀸 라인에 떨어진 기물은 첫 발부터 버프받은 화력으로 쏜다', () => {
    const s = waveState();
    const q = boardPiece('queen', 0, 1);       // a1
    s.pieces.push(q);
    // 첫 빈 칸이 퀸 라인 위라는 것이 이 테스트의 전제다. 난수 0은 emptySquares의 0번을 뽑는다.
    const first = emptySquares(s)[0];
    expect(queenLines(q.square).some(t => sameSquare(t, first))).toBe(true);

    // recalcQueenBuffs를 여기서 부르지 않는 것이 요점이다 — 트레이 시절에는 "배치"라는 별도
    // 시점이 그 정산을 맡았지만, 이제 스폰 자체가 배치라 drawPiece가 그 책임을 진다.
    const p = drawPiece(s, [], gachaRng('pawn'))!;
    expect(p.square).toEqual(first);
    expect(p.queenBuffCount).toBe(TRAITS.queen.buffFactor);

    const target = attackTargets('pawn', p.square).find(t => !sameSquare(t, p.square))!;
    const e = enemyAt(1, target.file, target.rank);
    s.enemies.push(e);
    updateCombat(s, 1 / 60, []);
    expect(e.hp).toBe(enemyHp(1) - CONFIG.pieces.pawn.damage * (1 + TRAITS.queen.buffFactor));
  });
});
