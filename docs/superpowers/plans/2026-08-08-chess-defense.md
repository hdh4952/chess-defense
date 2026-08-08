# 체스 디펜스 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `chess-defense-game-spec.md` v1.0을 그대로 구현한 웹 브라우저용 체스 디펜스(8×8 실시간 재배치형 타워 디펜스, 20웨이브)를 완성한다.

**Architecture:** DOM 없이 동작하는 순수 TypeScript 게임 코어(고정 타임스텝 `stepGame` + 상태 객체 + 이벤트 큐)와 표현 레이어(Canvas 2D 렌더러 + DOM 오버레이 UI)를 완전히 분리한다. 코어는 전부 Vitest로 TDD하고, UI/렌더는 코어의 함수만 호출하며 수동 검증한다.

**Tech Stack:** TypeScript(strict), Vite, Vitest, HTML5 Canvas 2D, 순수 DOM. 런타임 외부 의존성 0개.

## Global Constraints

스펙 원문 값을 그대로 따른다. 모든 태스크의 요구사항에 아래가 암묵적으로 포함된다.

- 언어 TypeScript / 빌드 Vite / 렌더링 HTML5 Canvas 2D / UI는 DOM 오버레이 / 백엔드·세이브·사운드 없음 (스펙 10.1)
- **모든 밸런스 수치는 `src/config.ts` 한 곳에서만 관리** — 다른 파일에 밸런스 매직 넘버 금지 (스펙 10.5)
- **쿨다운은 기물 ID(=Piece 객체) 기준으로 유지.** 이동·회수·재배치 어느 경우에도 초기화 금지 (스펙 5.1, 10.5)
- **퀸 버프 재계산 트리거: 배치/이동/회수/판매/나이트 이동 전부.** 매 프레임 계산 금지 (스펙 10.5)
- 적 렌더링 지터는 표시 전용, 판정은 논리 좌표(적 중심 좌표가 속한 칸) 기준 (스펙 2.2, 7.8)
- 게임오버는 체력 감소 처리 직후 **즉시** phase 전환, 같은 프레임의 나머지 적 처리 중단 (스펙 10.5)
- 20웨이브는 보스 처치·누수 양쪽 모두 승리. 누수 시 체력 −5 선적용 후 0 이하면 패배 우선 (스펙 3.1, 10.5)
- 일시정지 중 기물 구매·배치·이동·판매 전부 불가 (스펙 7.7)
- 배속 2x는 적 이동·기물 쿨다운·준비 시간에 모두 적용, 렌더링은 배속과 무관하게 60fps (스펙 7.7, 10.2)
- 좌표계: 파일 a~h = 코드 0~7, 랭크 1~8. 적은 8랭크(상단) 스폰 → 1랭크(하단)로 직진. 기물 배치는 1~7랭크만 (스펙 2)
- 커밋 메시지는 한국어 요약 + conventional commit 접두사(`feat:`, `test:`, `chore:`), 태스크마다 최소 1커밋

## 스펙 검토 노트 (구현 전 공유 사항)

구현 자체는 스펙 그대로 진행한다. 아래는 구현에 영향 없는 기록/해석 사항이다.

1. **9.4 폰 추격 수치의 기하학적 상한.** 폰은 `(f, r)`에서 `(f−1, r+1)`, `(f+1, r+1)`만 공격하므로, 보스가 있는 한 칸 `(F, R)`을 동시에 때릴 수 있는 폰은 최대 **2개**(`(F−1, R−1)`, `(F+1, R−1)`)다. 또 보스가 1랭크에 있는 6초는 0랭크가 없어 폰이 커버할 수 없다. 따라서 폰 1개의 완벽 추격 피해는 42초 × 4DPS = **168**(스펙 표기 192), 폰만의 이론 최대는 2개 × 168 = **336**이다. 스펙 9.4의 "웨이브 5 보스(420)는 폰 3개로 처치" 주장은 성립하지 않으며, 실제로는 혼합 편성(예: 추격 폰 2 + 보스 파일 룩 80 + 비숍 12 = 428 > 420)이 필요하다. 보스 누수는 −5로 생존 가능하고 웨이브는 클리어 처리되므로 진행 불가 벽은 아니다. Task 20 시뮬레이션에서 실측치를 로그로 남기고, 밸런싱은 스펙 9.5 플레이테스트 항목으로 넘긴다.
2. **스폰 소요 표기.** 스펙 4.5의 "스폰 소요 n×1.0s"는 첫 스폰 기준점에 따라 (n−1)s가 될 수 있다. 첫 스폰은 웨이브 시작 즉시(t≈0), 이후 1.0초 간격으로 구현한다.
3. **나이트 "배치 시 1회" 폭발의 해석.** 쿨다운 우회 금지 원칙(스펙 5.1)과 함께 해석해 "**쿨다운이 0일 때만 폭발하고, 폭발 시 쿨다운 3초 재시작**"으로 구현한다. 슬롯→보드 배치 자체는 쿨다운 중에도 허용하되 폭발만 생략된다. 회수→재배치 반복으로 폭발을 반복하는 우회가 차단된다. 구매 직후 쿨다운은 0이므로 최초 배치는 항상 폭발한다("최초 배치 시점부터 카운트 시작"과 일치).
4. **적 스폰 y 좌표.** 적 중심이 보드 상단 모서리(y=0, 8랭크 진입)에서 시작해 하단 모서리(y=640) 통과 시 소멸로 정의하면 종주가 정확히 8칸 × 3초 = 24초(보스 48초)가 되어 스펙 4.1과 일치한다.
5. **공격 발사 조건.** 사거리 안에 적이 없으면 쿨다운 0에서 대기(발사하지 않음)하고, 적이 들어오는 즉시 발사한다. 이렇게 해야 "적이 칸에 3초 체류 = 폰 6회 타격"(스펙 9.2)이 정렬 운에 관계없이 보장되고, 허공 발사 이펙트도 없다.

## 파일 구조

```
chess-defense/
├── index.html                  # 진입 HTML (캔버스/패널 컨테이너)
├── package.json / tsconfig.json
├── src/
│   ├── config.ts               # CONFIG 상수 + enemyHp/enemyCount (스펙 10.3 그대로)
│   ├── types.ts                # PieceType/Square/Piece/Enemy/GameState/GameEvent
│   ├── core/                   # ── DOM 없는 순수 게임 로직 (전부 단위 테스트) ──
│   │   ├── grid.ts             # 좌표 변환 (rank↔y, 칸 판정)
│   │   ├── state.ts            # createInitialState
│   │   ├── enemy.ts            # 적 생성/이동/1랭크 통과/패배 판정
│   │   ├── wave.ts             # 준비 시간/스폰/웨이브 종료/승리
│   │   ├── patterns.ts         # 기물별 공격 대상 칸·나이트 행마 (순수 함수)
│   │   ├── buff.ts             # 퀸 버프 재계산
│   │   ├── economy.ts          # 구매/판매/슬롯 배정
│   │   ├── combat.ts           # 쿨다운·발사·데미지·처치·골드
│   │   ├── pieces.ts           # 배치/이동/회수/재정렬 + 나이트 특수 규칙
│   │   ├── step.ts             # stepGame — 스펙 10.2 순서의 1틱 업데이트
│   │   └── ticker.ts           # 고정 타임스텝 어큐뮬레이터
│   ├── render/                 # ── Canvas 2D (수동 검증) ──
│   │   ├── renderer.ts         # 보드/기물/적/체력바/뱃지/비네트
│   │   ├── highlights.ts       # 사거리 미리보기·퀸 라인·나이트 이동 칸 → ViewState
│   │   └── effects.ts          # 공격 이펙트(노말/땅/빛/불) + 화면 흔들림
│   ├── ui/                     # ── DOM 오버레이 (수동 검증) ──
│   │   ├── layout.ts           # 화면 골격 생성 (HUD/슬롯/상점/판매/버튼)
│   │   ├── hud.ts              # 체력/골드/웨이브/남은 적/타이머 갱신
│   │   ├── shop.ts             # 상점 버튼 + 활성화 상태
│   │   ├── slots.ts            # 4×4 슬롯 렌더
│   │   ├── drag.ts             # 포인터 드래그 + 클릭-투-무브 + 드롭 판정
│   │   ├── tooltip.ts          # 기물 툴팁
│   │   └── banners.ts          # 보스 경고 배너/마커 + 결과 화면
│   ├── style.css
│   └── main.ts                 # 부트스트랩: rAF 루프, 이벤트 배선
└── tests/                      # Vitest (node 환경, DOM 불필요)
    ├── config.test.ts  grid.test.ts  enemy.test.ts  wave.test.ts
    ├── ticker.test.ts  step.test.ts  patterns.test.ts  buff.test.ts
    ├── economy.test.ts combat.test.ts pieces.test.ts integration.test.ts
    ├── drag.test.ts    simulation.test.ts
    └── helpers.ts              # 테스트용 상태/적 생성 헬퍼
```

**의존 방향:** `ui/`, `render/`, `main.ts` → `core/` → `config.ts`/`types.ts`. 역방향 import 금지. `core/` 안에서는 `pieces.ts → combat.ts/buff.ts → patterns.ts → grid.ts` 순의 단방향.

## 태스크 개요 (스펙 §11 개발 우선순위와의 대응)

| Task | 내용 | 스펙 단계 |
|---|---|---|
| 1 | Vite+TS+Vitest 스캐폴딩, git 초기화 | — |
| 2 | config.ts / types.ts + 체력·마릿수 공식 검증 | 1차 |
| 3 | 좌표 유틸 grid.ts | 1차 |
| 4 | 초기 상태 + 적 생성/이동/통과/패배 | 1차 |
| 5 | 웨이브 흐름(준비/스폰/클리어/승리) | 5차 |
| 6 | stepGame 오케스트레이션 + 고정 타임스텝 | 1차 |
| 7 | 캔버스 렌더러 + 부트스트랩 (첫 실행 데모) | 1차 |
| 8 | 공격 패턴 patterns.ts | 2~3차 |
| 9 | 퀸 버프 buff.ts | 4차 |
| 10 | 경제 economy.ts | 2차 |
| 11 | 전투 combat.ts (주기 공격·처치·골드) | 2~3차 |
| 12 | 기물 배치/이동/회수 + 나이트 특수 규칙 | 2~3차 |
| 13 | 전투를 stepGame에 통합 (엔드투엔드 웨이브 1) | 2차 |
| 14 | UI 셸: 레이아웃/HUD/상점/슬롯/시작 버튼 | 2차 |
| 15 | 드래그 앤 드롭 + 클릭-투-무브 | 2차 |
| 16 | 일시정지/배속/자동 일시정지 | 6차 |
| 17 | 보스 경고 연출 + 결과 화면 | 5차 |
| 18 | 사거리 미리보기/퀸 시각화/툴팁/판매 프리뷰 | 6차 |
| 19 | 공격 이펙트 (노말/땅/빛/불/오라) | 7차 |
| 20 | 통합 시뮬레이션 + 밸런스 리포트 | 8차 |

코어(2~13)를 UI(14~19)보다 먼저 완성하는 순서라 스펙 §11의 단계 순서와는 다르지만, 태스크 13 종료 시점에 헤드리스로 전 게임이 돌고, 태스크 7부터는 눈으로 확인 가능한 데모가 존재한다.

---

### Task 1: 프로젝트 스캐폴딩

**Files:**
- Create: `package.json`, `tsconfig.json`, `index.html`, `.gitignore`, `src/main.ts`, `src/style.css`, `tests/smoke.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `npm run dev` / `npm test` / `npm run build`가 동작하는 빈 프로젝트

- [ ] **Step 1: git 초기화와 .gitignore**

```bash
git init
```

`.gitignore`:
```
node_modules/
dist/
```

- [ ] **Step 2: package.json 작성**

```json
{
  "name": "chess-defense",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 3: 의존성 설치**

Run: `npm install`
Expected: 에러 없이 완료 (`node_modules/` 생성)

- [ ] **Step 4: tsconfig.json 작성**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "types": ["vite/client"]
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 5: index.html / main.ts / style.css 작성**

`index.html`:
```html
<!doctype html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>체스 디펜스</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

`src/main.ts`:
```ts
import './style.css';

document.querySelector<HTMLDivElement>('#app')!.textContent = 'chess-defense';
```

`src/style.css`:
```css
body { margin: 0; }
```

- [ ] **Step 6: 스모크 테스트 작성 및 실행**

`tests/smoke.test.ts`:
```ts
import { describe, expect, it } from 'vitest';

describe('smoke', () => {
  it('vitest가 동작한다', () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run: `npm test`
Expected: 1 passed

Run: `npm run dev` 후 브라우저에서 `chess-defense` 텍스트 확인, `npm run build` 성공 확인

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: Vite + TypeScript + Vitest 스캐폴딩"
```

---

### Task 2: config.ts / types.ts + 공식 검증

**Files:**
- Create: `src/config.ts`, `src/types.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `CONFIG` 상수 객체 (스펙 10.3 그대로), `enemyHp(wave: number): number`, `enemyCount(wave: number): number`
  - 타입: `PieceType`, `Square {file, rank}`, `Piece`, `Enemy`, `Phase`, `GameStats`, `GameState`, `GameEvent`

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/config.test.ts`

스펙 4.3 공식과 4.5 테이블 전체를 대조한다.

```ts
import { describe, expect, it } from 'vitest';
import { CONFIG, enemyCount, enemyHp } from '../src/config';

describe('enemyHp (스펙 4.3 / 4.5)', () => {
  it('웨이브 1~10은 10 + (w-1)', () => {
    expect(enemyHp(1)).toBe(10);
    expect(enemyHp(5)).toBe(14);
    expect(enemyHp(10)).toBe(19);
  });
  it('웨이브 11~20은 19 + 3*(w-10)', () => {
    expect(enemyHp(11)).toBe(22);
    expect(enemyHp(15)).toBe(34);
    expect(enemyHp(20)).toBe(49);
  });
  it('보스 체력 = 일반 체력 × 30 (스펙 4.5: 420/570/1020/1470)', () => {
    const m = CONFIG.enemy.bossHpMultiplier;
    expect(enemyHp(5) * m).toBe(420);
    expect(enemyHp(10) * m).toBe(570);
    expect(enemyHp(15) * m).toBe(1020);
    expect(enemyHp(20) * m).toBe(1470);
  });
});

describe('enemyCount (스펙 4.4 / 4.5)', () => {
  it('일반 웨이브는 10 + 2*(w-1)', () => {
    expect(enemyCount(1)).toBe(10);
    expect(enemyCount(4)).toBe(16);
    expect(enemyCount(19)).toBe(46);
  });
  it('5의 배수 웨이브는 보스 1마리', () => {
    for (const w of [5, 10, 15, 20]) expect(enemyCount(w)).toBe(1);
  });
  it('전체 마릿수 합계는 452 (스펙 4.5)', () => {
    let total = 0;
    for (let w = 1; w <= 20; w++) total += enemyCount(w);
    expect(total).toBe(452);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL — "Cannot find module '../src/config'"

- [ ] **Step 3: src/config.ts 작성 (스펙 10.3 원문 그대로)**

```ts
export const CONFIG = {
  board: { files: 8, ranks: 8, squarePx: 80 },

  player: { startHp: 30, startGold: 300, hpLossNormal: 1, hpLossBoss: 5 },

  wave: {
    total: 20,
    prepareSeconds: 10,
    clearBonus: 300,
    spawnInterval: 1.0,
    countBase: 10,
    countPerWave: 2,        // 10 + 2*(w-1)
    bossEvery: 5,
  },

  enemy: {
    hpBase: 10,
    hpPerWaveEarly: 1,      // w <= 10
    hpPerWaveLate: 3,       // w >= 11
    hpScalingBreakpoint: 10,
    secondsPerSquare: 3.0,
    bossHpMultiplier: 30,
    bossSpeedMultiplier: 0.5,
    spritePx: 44,
    jitterPx: 8,
  },

  pieces: {
    pawn:   { cost: 100, damage: 2, interval: 0.5 },
    knight: { cost: 300, damage: 3, interval: 3.0 },  // 이동 쿨다운
    bishop: { cost: 300, damage: 3, interval: 3.0 },
    rook:   { cost: 500, damage: 5, interval: 3.0 },
    queen:  { cost: 900, damage: 0, interval: 0   },
  },

  economy: { sellRatio: 0.5 },
  slots: { rows: 4, cols: 4 },
} as const;

export function enemyHp(wave: number): number {
  const { hpBase, hpPerWaveEarly, hpPerWaveLate, hpScalingBreakpoint } = CONFIG.enemy;
  return wave <= hpScalingBreakpoint
    ? hpBase + (wave - 1) * hpPerWaveEarly
    : hpBase + (hpScalingBreakpoint - 1) * hpPerWaveEarly
      + (wave - hpScalingBreakpoint) * hpPerWaveLate;
}

export function enemyCount(wave: number): number {
  if (wave % CONFIG.wave.bossEvery === 0) return 1;   // 보스 단독
  return CONFIG.wave.countBase + CONFIG.wave.countPerWave * (wave - 1);
}
```

- [ ] **Step 4: src/types.ts 작성 (스펙 10.4 + 이벤트 타입)**

```ts
export type PieceType = 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen';

/** file 0(a)~7(h), rank 1~8 */
export interface Square { file: number; rank: number }

export interface Piece {
  id: string;              // 쿨다운은 이 ID 기준으로 유지된다
  type: PieceType;
  square: Square | null;   // null = 슬롯
  slotIndex: number | null;
  cooldown: number;        // 초. 이동/회수해도 초기화되지 않음
  queenBuffCount: number;
}

export interface Enemy {
  id: string;
  file: number;       // 스폰 파일 고정
  y: number;          // 픽셀 단위 세로 위치 (0 = 보드 상단, 연속값)
  hp: number;
  maxHp: number;      // = 처치 보상 골드
  isBoss: boolean;
  speed: number;      // px/s
  jitterX: number;    // 렌더 전용
}

export type Phase = 'prepare' | 'wave' | 'victory' | 'defeat';

export interface GameStats { totalKills: number; totalGoldEarned: number }

export interface GameState {
  hp: number;
  gold: number;
  wave: number;              // 1..20
  phase: Phase;
  prepareTimer: number;
  spawnTimer: number;
  spawnedCount: number;
  speedMultiplier: 1 | 2;
  paused: boolean;
  pieces: Piece[];
  enemies: Enemy[];
  stats: GameStats;
}

/** 코어 → 렌더/UI 단방향 알림. 매 프레임 소비 후 비운다. */
export type GameEvent =
  | { kind: 'attack'; pieceType: PieceType; from: Square; targets: Square[] }
  | { kind: 'knightBlast'; square: Square }
  | { kind: 'enemyDied'; enemyId: string; square: Square; isBoss: boolean; reward: number }
  | { kind: 'enemyLeaked'; enemyId: string; file: number; isBoss: boolean }
  | { kind: 'bossSpawned'; file: number }
  | { kind: 'waveCleared'; wave: number }
  | { kind: 'prepareStarted'; wave: number; isBossWave: boolean };
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run tests/config.test.ts`
Expected: PASS (전체)

- [ ] **Step 6: Commit**

```bash
git add src/config.ts src/types.ts tests/config.test.ts
git commit -m "feat: 설정 상수·타입 정의 및 체력/마릿수 공식 (스펙 10.3/10.4)"
```

---

### Task 3: 좌표 유틸 grid.ts

**Files:**
- Create: `src/core/grid.ts`
- Test: `tests/grid.test.ts`

**Interfaces:**
- Consumes: `CONFIG.board`
- Produces:
  - `BOARD_W: number`, `BOARD_H: number` (640, 640)
  - `rankToTopY(rank: number): number` — 해당 랭크 칸의 상단 y
  - `yToRank(y: number): number` — 세로 픽셀 → 랭크 (0~7행 클램프)
  - `fileCenterX(file: number): number`
  - `inBoard(file: number, rank: number): boolean`
  - `enemySquare(e: { file: number; y: number }): Square` — 적 중심 기준 현재 칸 (스펙 2.2)
  - `sameSquare(a: Square, b: Square): boolean`
  - `fileLabel(file: number): string` — 0 → 'a'

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/grid.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import {
  BOARD_H, BOARD_W, enemySquare, fileCenterX, fileLabel,
  inBoard, rankToTopY, sameSquare, yToRank,
} from '../src/core/grid';

describe('grid', () => {
  it('보드 크기는 8×80 = 640px', () => {
    expect(BOARD_W).toBe(640);
    expect(BOARD_H).toBe(640);
  });
  it('rank 8이 최상단(y=0), rank 1이 최하단(y=560)', () => {
    expect(rankToTopY(8)).toBe(0);
    expect(rankToTopY(1)).toBe(560);
  });
  it('yToRank: 픽셀 y → 랭크 (경계 포함)', () => {
    expect(yToRank(0)).toBe(8);
    expect(yToRank(79.9)).toBe(8);
    expect(yToRank(80)).toBe(7);
    expect(yToRank(639)).toBe(1);
    expect(yToRank(9999)).toBe(1);   // 클램프
    expect(yToRank(-5)).toBe(8);     // 클램프
  });
  it('fileCenterX', () => {
    expect(fileCenterX(0)).toBe(40);
    expect(fileCenterX(7)).toBe(600);
  });
  it('inBoard 경계', () => {
    expect(inBoard(0, 1)).toBe(true);
    expect(inBoard(7, 8)).toBe(true);
    expect(inBoard(-1, 4)).toBe(false);
    expect(inBoard(8, 4)).toBe(false);
    expect(inBoard(3, 0)).toBe(false);
    expect(inBoard(3, 9)).toBe(false);
  });
  it('enemySquare는 중심 좌표 기준 (스펙 2.2)', () => {
    expect(enemySquare({ file: 2, y: 120 })).toEqual({ file: 2, rank: 7 });
  });
  it('sameSquare / fileLabel', () => {
    expect(sameSquare({ file: 1, rank: 2 }, { file: 1, rank: 2 })).toBe(true);
    expect(sameSquare({ file: 1, rank: 2 }, { file: 2, rank: 1 })).toBe(false);
    expect(fileLabel(0)).toBe('a');
    expect(fileLabel(7)).toBe('h');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/grid.test.ts`
Expected: FAIL — "Cannot find module '../src/core/grid'"

- [ ] **Step 3: src/core/grid.ts 구현**

```ts
import { CONFIG } from '../config';
import type { Square } from '../types';

const SQ = CONFIG.board.squarePx;

export const BOARD_W = CONFIG.board.files * SQ;
export const BOARD_H = CONFIG.board.ranks * SQ;

/** rank r 칸의 상단 y (rank 8 = 최상단 행) */
export function rankToTopY(rank: number): number {
  return (CONFIG.board.ranks - rank) * SQ;
}

/** 세로 픽셀 → 랭크. 보드 밖은 가장자리 랭크로 클램프 */
export function yToRank(y: number): number {
  const row = Math.min(CONFIG.board.ranks - 1, Math.max(0, Math.floor(y / SQ)));
  return CONFIG.board.ranks - row;
}

export function fileCenterX(file: number): number {
  return file * SQ + SQ / 2;
}

export function inBoard(file: number, rank: number): boolean {
  return file >= 0 && file < CONFIG.board.files && rank >= 1 && rank <= CONFIG.board.ranks;
}

/** 적의 현재 칸 = 중심 좌표가 속한 칸 (스펙 2.2) */
export function enemySquare(e: { file: number; y: number }): Square {
  return { file: e.file, rank: yToRank(e.y) };
}

export function sameSquare(a: Square, b: Square): boolean {
  return a.file === b.file && a.rank === b.rank;
}

export function fileLabel(file: number): string {
  return 'abcdefgh'[file];
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/grid.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/grid.ts tests/grid.test.ts
git commit -m "feat: 보드 좌표 변환 유틸 (칸 판정 기준 스펙 2.2)"
```

---

### Task 4: 초기 상태 + 적 생성/이동/통과/패배

**Files:**
- Create: `src/core/state.ts`, `src/core/enemy.ts`
- Test: `tests/enemy.test.ts`

**Interfaces:**
- Consumes: `CONFIG`, `enemyHp`, `BOARD_H`
- Produces:
  - `createInitialState(): GameState`
  - `createEnemy(wave: number, file: number, isBoss: boolean, id: string): Enemy`
  - `moveEnemies(state: GameState, dt: number): void`
  - `processLeaks(state: GameState, events: GameEvent[]): void` — 1랭크 통과 → 소멸 + 체력 감소 + 패배 판정

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/enemy.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { createEnemy, moveEnemies, processLeaks } from '../src/core/enemy';
import { BOARD_H } from '../src/core/grid';
import { createInitialState } from '../src/core/state';
import type { GameEvent } from '../src/types';

describe('createInitialState (스펙 3)', () => {
  it('골드 300, 체력 30, 기물 0개, 웨이브 1 준비 10초', () => {
    const s = createInitialState();
    expect(s.hp).toBe(30);
    expect(s.gold).toBe(300);
    expect(s.wave).toBe(1);
    expect(s.phase).toBe('prepare');
    expect(s.prepareTimer).toBe(10);
    expect(s.pieces).toEqual([]);
    expect(s.enemies).toEqual([]);
    expect(s.speedMultiplier).toBe(1);
    expect(s.paused).toBe(false);
    expect(s.stats).toEqual({ totalKills: 0, totalGoldEarned: 0 });
  });
});

describe('createEnemy (스펙 4.1/4.2)', () => {
  it('일반 적: 1칸당 3초 → 80/3 px/s, 체력 = enemyHp, y는 0에서 시작', () => {
    const e = createEnemy(1, 3, false, 'e-1');
    expect(e.speed).toBeCloseTo(80 / 3);
    expect(e.hp).toBe(10);
    expect(e.maxHp).toBe(10);
    expect(e.y).toBe(0);
    expect(e.isBoss).toBe(false);
  });
  it('보스: 속도 1/2, 체력 ×30', () => {
    const b = createEnemy(5, 0, true, 'boss');
    expect(b.speed).toBeCloseTo(80 / 6);
    expect(b.hp).toBe(420);
  });
  it('지터는 ID 기반 결정론적, ±jitterPx 이내 (스펙 7.8)', () => {
    const a1 = createEnemy(1, 0, false, 'x');
    const a2 = createEnemy(1, 0, false, 'x');
    expect(a1.jitterX).toBe(a2.jitterX);
    expect(Math.abs(a1.jitterX)).toBeLessThanOrEqual(CONFIG.enemy.jitterPx);
  });
});

describe('이동과 1랭크 통과 (스펙 3/9.1)', () => {
  function waveState() {
    const s = createInitialState();
    s.phase = 'wave';
    return s;
  }

  it('moveEnemies: y += speed * dt', () => {
    const s = waveState();
    const e = createEnemy(1, 0, false, 'e-1');
    s.enemies.push(e);
    moveEnemies(s, 3);
    expect(e.y).toBeCloseTo(80);
  });
  it('일반 적 통과: 소멸 + 체력 −1 + enemyLeaked 이벤트', () => {
    const s = waveState();
    const e = createEnemy(1, 2, false, 'e-1');
    e.y = BOARD_H + 1;
    s.enemies.push(e);
    const ev: GameEvent[] = [];
    processLeaks(s, ev);
    expect(s.enemies).toHaveLength(0);
    expect(s.hp).toBe(29);
    expect(ev).toEqual([{ kind: 'enemyLeaked', enemyId: 'e-1', file: 2, isBoss: false }]);
  });
  it('보스 통과: 체력 −5', () => {
    const s = waveState();
    const b = createEnemy(5, 0, true, 'boss');
    b.y = BOARD_H;
    s.enemies.push(b);
    processLeaks(s, []);
    expect(s.hp).toBe(25);
  });
  it('체력 0 도달 → 즉시 defeat, 같은 프레임 나머지 처리 중단 (스펙 10.5)', () => {
    const s = waveState();
    s.hp = 1;
    const e1 = createEnemy(1, 0, false, 'e-1');
    const e2 = createEnemy(1, 1, false, 'e-2');
    e1.y = BOARD_H;
    e2.y = BOARD_H;
    s.enemies.push(e1, e2);
    processLeaks(s, []);
    expect(s.phase).toBe('defeat');
    expect(s.hp).toBe(0);
    expect(s.enemies).toHaveLength(1); // e-2는 처리되지 않고 그 자리에 남는다
  });
  it('통과 직전(y < BOARD_H)에는 소멸하지 않는다', () => {
    const s = waveState();
    const e = createEnemy(1, 0, false, 'e-1');
    e.y = BOARD_H - 0.01;
    s.enemies.push(e);
    processLeaks(s, []);
    expect(s.enemies).toHaveLength(1);
    expect(s.hp).toBe(30);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/enemy.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: src/core/state.ts 구현**

```ts
import { CONFIG } from '../config';
import type { GameState } from '../types';

export function createInitialState(): GameState {
  return {
    hp: CONFIG.player.startHp,
    gold: CONFIG.player.startGold,
    wave: 1,
    phase: 'prepare',
    prepareTimer: CONFIG.wave.prepareSeconds,
    spawnTimer: 0,
    spawnedCount: 0,
    speedMultiplier: 1,
    paused: false,
    pieces: [],
    enemies: [],
    stats: { totalKills: 0, totalGoldEarned: 0 },
  };
}
```

- [ ] **Step 4: src/core/enemy.ts 구현**

```ts
import { CONFIG, enemyHp } from '../config';
import type { Enemy, GameEvent, GameState } from '../types';
import { BOARD_H } from './grid';

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function createEnemy(wave: number, file: number, isBoss: boolean, id: string): Enemy {
  const hp = enemyHp(wave) * (isBoss ? CONFIG.enemy.bossHpMultiplier : 1);
  const base = CONFIG.board.squarePx / CONFIG.enemy.secondsPerSquare;
  const j = CONFIG.enemy.jitterPx;
  return {
    id, file, y: 0, hp, maxHp: hp, isBoss,
    speed: base * (isBoss ? CONFIG.enemy.bossSpeedMultiplier : 1),
    jitterX: (hashId(id) % (2 * j + 1)) - j,
  };
}

export function moveEnemies(state: GameState, dt: number): void {
  if (state.phase !== 'wave') return;
  for (const e of state.enemies) e.y += e.speed * dt;
}

/** 1랭크 통과: 소멸 + 체력 감소. 체력 0이면 즉시 defeat 전환 후 중단 (스펙 10.5) */
export function processLeaks(state: GameState, events: GameEvent[]): void {
  if (state.phase !== 'wave') return;
  for (let i = 0; i < state.enemies.length; i++) {
    const e = state.enemies[i];
    if (e.y < BOARD_H) continue;
    state.enemies.splice(i, 1);
    i--;
    state.hp -= e.isBoss ? CONFIG.player.hpLossBoss : CONFIG.player.hpLossNormal;
    events.push({ kind: 'enemyLeaked', enemyId: e.id, file: e.file, isBoss: e.isBoss });
    if (state.hp <= 0) {
      state.hp = 0;
      state.phase = 'defeat';
      return;
    }
  }
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run tests/enemy.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/state.ts src/core/enemy.ts tests/enemy.test.ts
git commit -m "feat: 초기 상태·적 이동·1랭크 통과·패배 판정"
```

---

### Task 5: 웨이브 흐름 (준비/스폰/클리어/승리)

**Files:**
- Create: `src/core/wave.ts`
- Test: `tests/wave.test.ts`

**Interfaces:**
- Consumes: `enemyCount`, `createEnemy`, `CONFIG.wave`
- Produces:
  - `updatePrepare(state: GameState, dt: number): void` — 카운트다운, 0 도달 시 자동 시작
  - `startWave(state: GameState): void` — 수동 시작에도 사용 (prepare에서만 동작)
  - `updateSpawning(state: GameState, dt: number, events: GameEvent[], rng: () => number): void`
  - `checkWaveEnd(state: GameState, events: GameEvent[]): void` — 클리어 보너스/다음 웨이브/승리
  - `remainingEnemies(state: GameState): number` — HUD "남은 적" (미스폰 + 생존)
  - 적 ID 규칙: `e-{wave}-{spawnedCount}` (결정론적)

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/wave.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { createEnemy } from '../src/core/enemy';
import { createInitialState } from '../src/core/state';
import {
  checkWaveEnd, remainingEnemies, startWave, updatePrepare, updateSpawning,
} from '../src/core/wave';
import type { GameEvent } from '../src/types';

const rngFile = (file: number) => () => file / 8; // floor(rng*8) === file

describe('준비 시간 (스펙 3/4.4)', () => {
  it('10초 경과 시 자동으로 웨이브 시작', () => {
    const s = createInitialState();
    updatePrepare(s, 9.99);
    expect(s.phase).toBe('prepare');
    updatePrepare(s, 0.02);
    expect(s.phase).toBe('wave');
    expect(s.spawnedCount).toBe(0);
  });
  it('수동 시작 가능, prepare가 아닐 때는 무시', () => {
    const s = createInitialState();
    startWave(s);
    expect(s.phase).toBe('wave');
    startWave(s); // 이미 wave — 상태 불변
    expect(s.phase).toBe('wave');
  });
});

describe('스폰 (스펙 4.1/4.4)', () => {
  it('시작 즉시 1마리, 이후 1.0초 간격', () => {
    const s = createInitialState();
    startWave(s);
    updateSpawning(s, 0.1, [], rngFile(3));
    expect(s.enemies).toHaveLength(1);
    expect(s.enemies[0].file).toBe(3);
    updateSpawning(s, 0.8, [], rngFile(3));
    expect(s.enemies).toHaveLength(1);
    updateSpawning(s, 0.1, [], rngFile(3));
    expect(s.enemies).toHaveLength(2);
  });
  it('웨이브 1은 총 10마리에서 멈춘다', () => {
    const s = createInitialState();
    startWave(s);
    updateSpawning(s, 60, [], rngFile(0));
    expect(s.spawnedCount).toBe(10);
    expect(s.enemies).toHaveLength(10);
  });
  it('보스 웨이브(5)는 보스 1마리 + bossSpawned 이벤트', () => {
    const s = createInitialState();
    s.wave = 5;
    startWave(s);
    const ev: GameEvent[] = [];
    updateSpawning(s, 60, ev, rngFile(6));
    expect(s.enemies).toHaveLength(1);
    expect(s.enemies[0].isBoss).toBe(true);
    expect(s.enemies[0].hp).toBe(420);
    expect(ev).toContainEqual({ kind: 'bossSpawned', file: 6 });
  });
});

describe('웨이브 종료 (스펙 3/4.4)', () => {
  function clearedWave(wave: number) {
    const s = createInitialState();
    s.wave = wave;
    startWave(s);
    updateSpawning(s, 60, [], rngFile(0));
    s.enemies = []; // 전부 처치된 상황
    return s;
  }

  it('스폰이 남았거나 생존자가 있으면 종료되지 않는다', () => {
    const s = createInitialState();
    startWave(s);
    updateSpawning(s, 0.1, [], rngFile(0)); // 1/10 스폰
    checkWaveEnd(s, []);
    expect(s.phase).toBe('wave');
    updateSpawning(s, 60, [], rngFile(0));  // 전부 스폰, 생존 중
    checkWaveEnd(s, []);
    expect(s.phase).toBe('wave');
  });
  it('클리어: +300골드, 다음 웨이브 준비 10초, 이벤트 2종', () => {
    const s = clearedWave(1);
    const gold = s.gold;
    const ev: GameEvent[] = [];
    checkWaveEnd(s, ev);
    expect(s.gold).toBe(gold + 300);
    expect(s.stats.totalGoldEarned).toBe(300);
    expect(s.wave).toBe(2);
    expect(s.phase).toBe('prepare');
    expect(s.prepareTimer).toBe(10);
    expect(ev).toContainEqual({ kind: 'waveCleared', wave: 1 });
    expect(ev).toContainEqual({ kind: 'prepareStarted', wave: 2, isBossWave: false });
  });
  it('웨이브 4 클리어 → 웨이브 5는 보스 웨이브 예고', () => {
    const s = clearedWave(4);
    const ev: GameEvent[] = [];
    checkWaveEnd(s, ev);
    expect(ev).toContainEqual({ kind: 'prepareStarted', wave: 5, isBossWave: true });
  });
  it('웨이브 20 클리어 → victory (+300은 지급)', () => {
    const s = clearedWave(20);
    const gold = s.gold;
    checkWaveEnd(s, []);
    expect(s.phase).toBe('victory');
    expect(s.gold).toBe(gold + 300);
    expect(s.wave).toBe(20);
  });
});

describe('remainingEnemies (HUD)', () => {
  it('wave 중: 미스폰 + 생존', () => {
    const s = createInitialState();
    startWave(s);
    updateSpawning(s, 2.5, [], rngFile(0)); // 3마리 스폰
    s.enemies.pop();                        // 1마리 처치됨
    expect(remainingEnemies(s)).toBe(10 - 3 + 2);
  });
  it('prepare 중: 다음 웨이브 총원', () => {
    const s = createInitialState();
    expect(remainingEnemies(s)).toBe(10);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/wave.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: src/core/wave.ts 구현**

```ts
import { CONFIG, enemyCount } from '../config';
import type { GameEvent, GameState } from '../types';
import { createEnemy } from './enemy';

export function updatePrepare(state: GameState, dt: number): void {
  if (state.phase !== 'prepare') return;
  state.prepareTimer -= dt;
  if (state.prepareTimer <= 0) startWave(state);
}

/** 준비 중 수동/자동 시작 (스펙 4.4 — 조기 시작 보너스 없음) */
export function startWave(state: GameState): void {
  if (state.phase !== 'prepare') return;
  state.phase = 'wave';
  state.prepareTimer = 0;
  state.spawnTimer = 0;      // 첫 스폰은 즉시
  state.spawnedCount = 0;
}

export function updateSpawning(
  state: GameState, dt: number, events: GameEvent[], rng: () => number,
): void {
  if (state.phase !== 'wave') return;
  const total = enemyCount(state.wave);
  if (state.spawnedCount >= total) return;
  state.spawnTimer -= dt;
  while (state.spawnTimer <= 0 && state.spawnedCount < total) {
    const file = Math.min(CONFIG.board.files - 1, Math.floor(rng() * CONFIG.board.files));
    const isBoss = state.wave % CONFIG.wave.bossEvery === 0;
    state.enemies.push(createEnemy(state.wave, file, isBoss, `e-${state.wave}-${state.spawnedCount}`));
    state.spawnedCount++;
    if (isBoss) events.push({ kind: 'bossSpawned', file });
    state.spawnTimer += CONFIG.wave.spawnInterval;
  }
}

/** 모든 적이 사망 또는 통과 → 클리어 보너스, 다음 웨이브 또는 승리 (스펙 3/4.4) */
export function checkWaveEnd(state: GameState, events: GameEvent[]): void {
  if (state.phase !== 'wave') return;
  if (state.spawnedCount < enemyCount(state.wave) || state.enemies.length > 0) return;
  state.gold += CONFIG.wave.clearBonus;
  state.stats.totalGoldEarned += CONFIG.wave.clearBonus;
  events.push({ kind: 'waveCleared', wave: state.wave });
  if (state.wave >= CONFIG.wave.total) {
    state.phase = 'victory';
    return;
  }
  state.wave++;
  state.phase = 'prepare';
  state.prepareTimer = CONFIG.wave.prepareSeconds;
  events.push({
    kind: 'prepareStarted',
    wave: state.wave,
    isBossWave: state.wave % CONFIG.wave.bossEvery === 0,
  });
}

/** HUD "남은 적": 아직 스폰 안 된 수 + 보드 위 생존 수 */
export function remainingEnemies(state: GameState): number {
  const total = enemyCount(state.wave);
  return state.phase === 'wave'
    ? total - state.spawnedCount + state.enemies.length
    : total;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/wave.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/wave.ts tests/wave.test.ts
git commit -m "feat: 웨이브 준비/스폰/클리어/승리 흐름"
```

---

### Task 6: stepGame 오케스트레이션 + 고정 타임스텝

**Files:**
- Create: `src/core/step.ts`, `src/core/ticker.ts`
- Test: `tests/step.test.ts`, `tests/ticker.test.ts`

**Interfaces:**
- Consumes: Task 4~5의 모든 함수
- Produces:
  - `stepGame(state: GameState, dt: number, events: GameEvent[], rng?: () => number): void` — 스펙 10.2 순서의 1틱. `dt`에는 호출자가 `speedMultiplier`를 이미 곱해서 넘긴다
  - `createTicker(fixedDt?: number, maxFrame?: number): (realDt: number, step: (dt: number) => void) => void`
  - Task 13에서 `stepGame` 내부에 `updateCombat` 호출 1줄이 추가된다 (이 태스크 시점에는 전투 없음)

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/ticker.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { createTicker } from '../src/core/ticker';

describe('createTicker (고정 타임스텝, 스펙 10.2)', () => {
  it('누적된 실시간을 1/60초 단위 스텝으로 분해한다', () => {
    const tick = createTicker(1 / 60);
    let calls = 0;
    tick(0.05, () => calls++);          // 0.05s → 3스텝 (나머지 누적)
    expect(calls).toBe(3);
    tick(0.0001, () => calls++);        // 누적 부족 → 0스텝
    expect(calls).toBe(3);
  });
  it('프레임 드랍 시 maxFrame으로 클램프 (나선형 지연 방지)', () => {
    const tick = createTicker(1 / 60, 0.25);
    let calls = 0;
    tick(10, () => calls++);
    expect(calls).toBe(15);             // 0.25s / (1/60) = 15
  });
});
```

- [ ] **Step 2: 실패하는 테스트 작성** — `tests/step.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/core/state';
import { stepGame } from '../src/core/step';
import type { GameEvent } from '../src/types';

const rng0 = () => 0; // 항상 a파일

function run(state: ReturnType<typeof createInitialState>, seconds: number, events: GameEvent[] = []) {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) stepGame(state, dt, events, rng0);
}

describe('stepGame (스펙 10.2)', () => {
  it('준비 10초 → 웨이브 시작 → 스폰 진행', () => {
    const s = createInitialState();
    run(s, 10.1);
    expect(s.phase).toBe('wave');
    expect(s.spawnedCount).toBeGreaterThanOrEqual(1);
  });
  it('기물이 없으면 적 10마리 전부 통과 → 체력 20, 웨이브 2 준비', () => {
    const s = createInitialState();
    run(s, 10 + 10 + 24 + 1); // 준비 + 스폰 + 종주 + 여유
    expect(s.hp).toBe(20);
    expect(s.wave).toBe(2);
    expect(s.phase).toBe('prepare');
  });
  it('paused면 아무것도 진행되지 않는다', () => {
    const s = createInitialState();
    s.paused = true;
    run(s, 5);
    expect(s.prepareTimer).toBe(10);
  });
  it('defeat/victory에서는 진행되지 않는다', () => {
    const s = createInitialState();
    s.phase = 'defeat';
    run(s, 5);
    expect(s.wave).toBe(1);
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx vitest run tests/ticker.test.ts tests/step.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 4: src/core/ticker.ts 구현**

```ts
/** rAF의 가변 프레임 시간을 고정 스텝으로 분해한다. 렌더는 호출자가 매 프레임 수행. */
export function createTicker(fixedDt = 1 / 60, maxFrame = 0.25) {
  let acc = 0;
  return function advance(realDt: number, step: (dt: number) => void): void {
    acc += Math.min(realDt, maxFrame);
    while (acc >= fixedDt) {
      step(fixedDt);
      acc -= fixedDt;
    }
  };
}
```

- [ ] **Step 5: src/core/step.ts 구현**

```ts
import type { GameEvent, GameState } from '../types';
import { moveEnemies, processLeaks } from './enemy';
import { checkWaveEnd, updatePrepare, updateSpawning } from './wave';

/**
 * 1틱 업데이트 — 스펙 10.2의 순서 그대로.
 * dt에는 speedMultiplier가 이미 곱해져 들어온다 (배속은 준비 시간·이동·쿨다운 모두 적용).
 */
export function stepGame(
  state: GameState, dt: number, events: GameEvent[], rng: () => number = Math.random,
): void {
  if (state.paused || state.phase === 'victory' || state.phase === 'defeat') return;
  updatePrepare(state, dt);                 // 준비 시간 카운트다운
  updateSpawning(state, dt, events, rng);   // 적 스폰 타이머
  moveEnemies(state, dt);                   // 적 위치 갱신
  // (Task 13) 여기에 updateCombat(state, dt, events) 호출이 추가된다
  processLeaks(state, events);              // 1랭크 통과 → 체력 감소
  if (state.phase === 'defeat') return;     // 즉시 정지 (스펙 10.5)
  checkWaveEnd(state, events);              // 웨이브 종료/승리 판정
}
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `npx vitest run tests/ticker.test.ts tests/step.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/core/step.ts src/core/ticker.ts tests/step.test.ts tests/ticker.test.ts
git commit -m "feat: 고정 타임스텝 게임 루프 코어 (스펙 10.2 순서)"
```

---

### Task 7: 캔버스 렌더러 + 부트스트랩 (첫 실행 데모)

**Files:**
- Create: `src/render/renderer.ts`
- Modify: `src/main.ts`, `src/style.css`

**Interfaces:**
- Consumes: `GameState`, `grid.ts`, `CONFIG`
- Produces:
  - `render(ctx: CanvasRenderingContext2D, state: GameState, view?: ViewState): void`
  - `interface ViewState { highlights: { square: Square; color: string }[]; lines: { from: Square; to: Square; color: string }[]; shake: { x: number; y: number } }`
  - `EMPTY_VIEW: ViewState`
  - `ALLY_GLYPH: Record<PieceType, string>` — `{ pawn:'♟', knight:'♞', bishop:'♝', rook:'♜', queen:'♛' }` (UI 슬롯/상점에서 재사용, 화이트는 채색으로 구분)
  - 이 시점의 `main.ts`는 캔버스 + 임시 디버그 HUD(div)로 게임을 구동한다. Task 14에서 정식 UI로 교체

- [ ] **Step 1: src/render/renderer.ts 구현**

진영 구분(스펙 8.1): 아군 = 흰 채움 + 진회색 외곽선 + 푸른 그림자, 적 = 검정 채움 + 밝은 외곽선 + 붉은 그림자. 적 체력바 상시 표시. 그리기 순서는 y 오름차순(1랭크에 가까운 적이 위에). 8랭크 행은 스폰 구역임을 옅은 붉은 톤으로 표시.

```ts
import { CONFIG } from '../config';
import { BOARD_H, BOARD_W, fileCenterX, rankToTopY } from '../core/grid';
import type { Enemy, GameState, Piece, PieceType, Square } from '../types';

const SQ = CONFIG.board.squarePx;

export interface ViewState {
  highlights: { square: Square; color: string }[];
  lines: { from: Square; to: Square; color: string }[];
  shake: { x: number; y: number };
}
export const EMPTY_VIEW: ViewState = { highlights: [], lines: [], shake: { x: 0, y: 0 } };

export const ALLY_GLYPH: Record<PieceType, string> = {
  pawn: '♟', knight: '♞', bishop: '♝', rook: '♜', queen: '♛',
};

const COLOR = {
  light: '#e8e6e0', dark: '#77756e',
  spawnTint: 'rgba(200, 60, 50, 0.10)',
  allyFill: '#ffffff', allyStroke: '#2b2b2b', allyShadow: 'rgba(70, 120, 220, 0.35)',
  enemyFill: '#141414', enemyStroke: '#f2f2f2', enemyShadow: 'rgba(220, 60, 50, 0.35)',
  hpBack: '#3a3a3a', hpFill: '#e04b3a',
};

export function render(ctx: CanvasRenderingContext2D, state: GameState, view: ViewState = EMPTY_VIEW): void {
  ctx.save();
  ctx.translate(view.shake.x, view.shake.y);
  drawBoard(ctx);
  for (const h of view.highlights) {
    ctx.fillStyle = h.color;
    ctx.fillRect(h.square.file * SQ, rankToTopY(h.square.rank), SQ, SQ);
  }
  for (const l of view.lines) {
    ctx.strokeStyle = l.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(fileCenterX(l.from.file), rankToTopY(l.from.rank) + SQ / 2);
    ctx.lineTo(fileCenterX(l.to.file), rankToTopY(l.to.rank) + SQ / 2);
    ctx.stroke();
  }
  for (const p of state.pieces) if (p.square) drawPiece(ctx, p);
  const sorted = [...state.enemies].sort((a, b) => a.y - b.y);
  for (const e of sorted) drawEnemy(ctx, e);
  drawBossVignette(ctx, state);
  ctx.restore();
}

function drawBoard(ctx: CanvasRenderingContext2D): void {
  for (let row = 0; row < CONFIG.board.ranks; row++) {
    for (let col = 0; col < CONFIG.board.files; col++) {
      ctx.fillStyle = (row + col) % 2 === 0 ? COLOR.light : COLOR.dark;
      ctx.fillRect(col * SQ, row * SQ, SQ, SQ);
    }
  }
  ctx.fillStyle = COLOR.spawnTint;               // 8랭크 = 배치 불가 스폰 구역
  ctx.fillRect(0, 0, BOARD_W, SQ);
}

function drawGlyph(
  ctx: CanvasRenderingContext2D, glyph: string, x: number, y: number,
  sizePx: number, fill: string, stroke: string, shadow: string,
): void {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = shadow;                        // 바닥 그림자 (진영 색 구분, 스펙 8.1)
  ctx.beginPath();
  ctx.ellipse(x, y + sizePx * 0.42, sizePx * 0.38, sizePx * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = `${sizePx}px "Segoe UI Symbol", "Noto Sans Symbols 2", serif`;
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = stroke;
  ctx.strokeText(glyph, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(glyph, x, y);
  ctx.restore();
}

function drawPiece(ctx: CanvasRenderingContext2D, p: Piece): void {
  const x = fileCenterX(p.square!.file);
  const y = rankToTopY(p.square!.rank) + SQ / 2;
  drawGlyph(ctx, ALLY_GLYPH[p.type], x, y, 52, COLOR.allyFill, COLOR.allyStroke, COLOR.allyShadow);
  if (p.queenBuffCount > 0) {                    // 버프 뱃지 (스펙 7.7 — 상시 표식)
    ctx.font = 'bold 14px system-ui';
    ctx.fillStyle = '#ffd54a';
    ctx.textAlign = 'left';
    ctx.fillText(`×${1 + p.queenBuffCount}`, x + 12, y - 20);
  }
}

function drawEnemy(ctx: CanvasRenderingContext2D, e: Enemy): void {
  const x = fileCenterX(e.file) + e.jitterX;     // 지터는 렌더 전용 (스펙 7.8)
  const size = CONFIG.enemy.spritePx;
  drawGlyph(ctx, e.isBoss ? '♚' : '♟', x, e.y, size, COLOR.enemyFill, COLOR.enemyStroke, COLOR.enemyShadow);
  const w = 40, h = 4;                           // 체력바 상시 표시 (스펙 4.1/7.8)
  const top = e.y - size / 2 - 8;
  ctx.fillStyle = COLOR.hpBack;
  ctx.fillRect(x - w / 2, top, w, h);
  ctx.fillStyle = COLOR.hpFill;
  ctx.fillRect(x - w / 2, top, w * Math.max(0, e.hp / e.maxHp), h);
}

/** 보스가 2랭크 진입 시 화면 가장자리 붉은 비네트 (스펙 7.9) */
function drawBossVignette(ctx: CanvasRenderingContext2D, state: GameState): void {
  const near = state.enemies.some(e => e.isBoss && e.y >= rankToTopY(2));
  if (!near) return;
  const g = ctx.createRadialGradient(
    BOARD_W / 2, BOARD_H / 2, BOARD_H * 0.45,
    BOARD_W / 2, BOARD_H / 2, BOARD_H * 0.72,
  );
  g.addColorStop(0, 'rgba(200, 30, 30, 0)');
  g.addColorStop(1, 'rgba(200, 30, 30, 0.35)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, BOARD_W, BOARD_H);
}
```

- [ ] **Step 2: src/main.ts를 데모 부트스트랩으로 교체**

```ts
import './style.css';
import { CONFIG } from './config';
import { BOARD_H, BOARD_W } from './core/grid';
import { createInitialState } from './core/state';
import { stepGame } from './core/step';
import { createTicker } from './core/ticker';
import { remainingEnemies } from './core/wave';
import { render } from './render/renderer';
import type { GameEvent } from './types';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <div id="debug-hud" style="color:#eee;font:14px monospace;padding:6px"></div>
  <canvas id="board" width="${BOARD_W}" height="${BOARD_H}"></canvas>
`;
const canvas = document.querySelector<HTMLCanvasElement>('#board')!;
const ctx = canvas.getContext('2d')!;
const debugHud = document.querySelector<HTMLDivElement>('#debug-hud')!;

const state = createInitialState();
const events: GameEvent[] = [];
const tick = createTicker();

if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__game = state; // 콘솔 디버그용
}

let last = performance.now();
function frame(now: number): void {
  tick((now - last) / 1000, dt => stepGame(state, dt * state.speedMultiplier, events));
  last = now;
  render(ctx, state);
  debugHud.textContent =
    `♥${state.hp} 💰${state.gold} 웨이브 ${state.wave}/${CONFIG.wave.total} ` +
    `남은 적 ${remainingEnemies(state)} ⏱${Math.max(0, state.prepareTimer).toFixed(1)}s ${state.phase}`;
  events.length = 0; // 소비자는 Task 17/19에서 연결
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

`src/style.css`:
```css
body {
  margin: 0;
  background: #23221f;
  display: flex;
  flex-direction: column;
  align-items: center;
  font-family: system-ui, sans-serif;
  user-select: none;
}
```

- [ ] **Step 3: 수동 검증**

Run: `npm run dev`
Expected:
1. 8×8 흑백 격자 보드, 최상단 행(8랭크)에 옅은 붉은 톤
2. 10초 카운트다운 후 검은 폰이 상단에서 스폰되어 아래로 연속 이동 (1칸당 3초, 종주 24초)
3. 적마다 머리 위 체력바, 가로 위치가 약간씩 어긋남(지터)
4. 적이 바닥을 통과하면 디버그 HUD의 ♥ 감소, 10마리 모두 통과하면 웨이브 2 준비로 전환
5. 전체 테스트 회귀 없음: `npm test` PASS

- [ ] **Step 4: Commit**

```bash
git add src/render/renderer.ts src/main.ts src/style.css
git commit -m "feat: 캔버스 렌더러와 부트스트랩 — 적 스폰/이동 데모"
```

---

### Task 8: 공격 패턴 patterns.ts

**Files:**
- Create: `src/core/patterns.ts`
- Test: `tests/patterns.test.ts`

**Interfaces:**
- Consumes: `inBoard`, `Square`
- Produces:
  - `pawnTargets(sq: Square): Square[]` — 전방(8랭크 방향) 대각선 각 1칸 (스펙 5.2)
  - `knightBlastTargets(sq: Square): Square[]` — 자신 칸 + 주변 8방향 = 최대 9칸 (스펙 5.3)
  - `bishopTargets(sq: Square): Square[]` — 자신 칸 + 대각선 4방향 전체, 관통 (스펙 5.4)
  - `rookTargets(sq: Square): Square[]` — 자신 칸 + 상하좌우 직선 전체, 관통 (스펙 5.5)
  - `queenLines(sq: Square): Square[]` — 자신 칸 + 8방향 직선 전체 (버프 범위, 스펙 5.6)
  - `attackTargets(type: PieceType, sq: Square): Square[]` — 퀸은 `[]`
  - `knightMoves(sq: Square): Square[]` — L자 도달 칸 중 1~7랭크만 (8랭크 이동 불가, 스펙 5.3)

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/patterns.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import {
  attackTargets, bishopTargets, knightBlastTargets, knightMoves,
  pawnTargets, queenLines, rookTargets,
} from '../src/core/patterns';

// d4 = {file:3, rank:4}
describe('patterns', () => {
  it('폰: 전방 대각선 2칸, 가장자리에서는 1칸 (스펙 5.2)', () => {
    expect(pawnTargets({ file: 3, rank: 4 })).toEqual(
      expect.arrayContaining([{ file: 2, rank: 5 }, { file: 4, rank: 5 }]),
    );
    expect(pawnTargets({ file: 3, rank: 4 })).toHaveLength(2);
    expect(pawnTargets({ file: 0, rank: 4 })).toEqual([{ file: 1, rank: 5 }]); // a파일
    expect(pawnTargets({ file: 3, rank: 8 })).toHaveLength(0);                 // 9랭크 없음
  });
  it('나이트 폭발: 중앙 9칸, 구석(a1) 4칸 (스펙 5.3)', () => {
    expect(knightBlastTargets({ file: 3, rank: 4 })).toHaveLength(9);
    expect(knightBlastTargets({ file: 0, rank: 1 })).toHaveLength(4);
  });
  it('비숍: d4에서 자신 포함 14칸, 관통 (스펙 5.4)', () => {
    const t = bishopTargets({ file: 3, rank: 4 });
    expect(t).toHaveLength(14);
    expect(t).toContainEqual({ file: 3, rank: 4 });  // 자신 칸
    expect(t).toContainEqual({ file: 7, rank: 8 });  // h8까지
    expect(t).toContainEqual({ file: 0, rank: 1 });  // a1까지
  });
  it('룩: 자신 포함 15칸 (7+7+1)', () => {
    const t = rookTargets({ file: 3, rank: 4 });
    expect(t).toHaveLength(15);
    expect(t).toContainEqual({ file: 3, rank: 8 });
    expect(t).toContainEqual({ file: 0, rank: 4 });
  });
  it('퀸 라인: d4에서 자신 포함 28칸 (14+13+1)', () => {
    expect(queenLines({ file: 3, rank: 4 })).toHaveLength(28);
  });
  it('attackTargets: 퀸은 빈 배열, 나머지는 각 패턴 위임', () => {
    expect(attackTargets('queen', { file: 3, rank: 4 })).toEqual([]);
    expect(attackTargets('pawn', { file: 3, rank: 4 })).toHaveLength(2);
    expect(attackTargets('knight', { file: 3, rank: 4 })).toHaveLength(9);
  });
  it('나이트 행마: d4에서 8칸, 8랭크 도착지는 제외 (스펙 5.3)', () => {
    expect(knightMoves({ file: 3, rank: 4 })).toHaveLength(8);
    const fromD7 = knightMoves({ file: 3, rank: 7 });
    expect(fromD7).toHaveLength(4);  // (5,8)(1,8)(4,9)(2,9) 등 제외 후 {f6,b6,e5,c5}
    for (const m of fromD7) expect(m.rank).toBeLessThanOrEqual(7);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/patterns.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: src/core/patterns.ts 구현**

```ts
import { CONFIG } from '../config';
import type { PieceType, Square } from '../types';
import { inBoard } from './grid';

const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** 한 방향으로 보드 끝까지. 기물/적 차단 없음 = 완전 관통 (스펙 5.4/5.5) */
function ray(sq: Square, df: number, dr: number): Square[] {
  const out: Square[] = [];
  let f = sq.file + df, r = sq.rank + dr;
  while (inBoard(f, r)) {
    out.push({ file: f, rank: r });
    f += df;
    r += dr;
  }
  return out;
}

export function pawnTargets(sq: Square): Square[] {
  return [
    { file: sq.file - 1, rank: sq.rank + 1 },
    { file: sq.file + 1, rank: sq.rank + 1 },
  ].filter(s => inBoard(s.file, s.rank));
}

export function knightBlastTargets(sq: Square): Square[] {
  const out: Square[] = [];
  for (let df = -1; df <= 1; df++)
    for (let dr = -1; dr <= 1; dr++)
      if (inBoard(sq.file + df, sq.rank + dr)) out.push({ file: sq.file + df, rank: sq.rank + dr });
  return out;
}

export function bishopTargets(sq: Square): Square[] {
  return [{ ...sq }, ...DIAG.flatMap(([df, dr]) => ray(sq, df, dr))];
}

export function rookTargets(sq: Square): Square[] {
  return [{ ...sq }, ...ORTHO.flatMap(([df, dr]) => ray(sq, df, dr))];
}

export function queenLines(sq: Square): Square[] {
  return [{ ...sq }, ...[...DIAG, ...ORTHO].flatMap(([df, dr]) => ray(sq, df, dr))];
}

export function attackTargets(type: PieceType, sq: Square): Square[] {
  switch (type) {
    case 'pawn': return pawnTargets(sq);
    case 'knight': return knightBlastTargets(sq);
    case 'bishop': return bishopTargets(sq);
    case 'rook': return rookTargets(sq);
    case 'queen': return [];
  }
}

const L_OFFSETS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]] as const;

/** 나이트 행마 도착 후보. 8랭크 금지 (스펙 5.3). 점유 검사는 pieces.ts 담당 */
export function knightMoves(sq: Square): Square[] {
  return L_OFFSETS
    .map(([df, dr]) => ({ file: sq.file + df, rank: sq.rank + dr }))
    .filter(s => inBoard(s.file, s.rank) && s.rank <= CONFIG.board.ranks - 1);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/patterns.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/patterns.ts tests/patterns.test.ts
git commit -m "feat: 기물별 공격 패턴·나이트 행마 (관통 포함)"
```

---

### Task 9: 퀸 버프 buff.ts

**Files:**
- Create: `src/core/buff.ts`
- Test: `tests/buff.test.ts`

**Interfaces:**
- Consumes: `queenLines`, `sameSquare`
- Produces: `recalcQueenBuffs(state: GameState): void` — 전체 재계산. **호출 시점: 배치/이동/회수/판매/나이트 이동 직후 (매 프레임 금지, 스펙 10.5)**
- 최종 공격력 계산은 Task 11의 `pieceDamage`가 `1 + queenBuffCount`로 처리 (스펙 5.6)

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/buff.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { recalcQueenBuffs } from '../src/core/buff';
import { createInitialState } from '../src/core/state';
import type { Piece, PieceType, Square } from '../src/types';

let seq = 0;
function piece(type: PieceType, square: Square | null, slotIndex: number | null = null): Piece {
  return { id: `p${seq++}`, type, square, slotIndex, cooldown: 0, queenBuffCount: 0 };
}

describe('recalcQueenBuffs (스펙 5.6)', () => {
  it('퀸의 8방향 직선 위 기물이 버프를 받는다', () => {
    const s = createInitialState();
    const rook = piece('rook', { file: 3, rank: 5 });    // 퀸 d1과 같은 파일
    const bishop = piece('bishop', { file: 4, rank: 2 }); // 퀸 d1의 대각선
    const knight = piece('knight', { file: 0, rank: 3 }); // 라인 밖
    s.pieces.push(piece('queen', { file: 3, rank: 1 }), rook, bishop, knight);
    recalcQueenBuffs(s);
    expect(rook.queenBuffCount).toBe(1);
    expect(bishop.queenBuffCount).toBe(1);
    expect(knight.queenBuffCount).toBe(0);
  });
  it('퀸 2개가 겹치면 +2 (×3 배율)', () => {
    const s = createInitialState();
    const rook = piece('rook', { file: 3, rank: 4 });
    s.pieces.push(
      piece('queen', { file: 3, rank: 1 }),  // 같은 파일
      piece('queen', { file: 0, rank: 4 }),  // 같은 랭크
      rook,
    );
    recalcQueenBuffs(s);
    expect(rook.queenBuffCount).toBe(2);
  });
  it('다른 기물이 사이에 있어도 차단되지 않는다 (스펙 5.6)', () => {
    const s = createInitialState();
    const far = piece('rook', { file: 3, rank: 7 });
    s.pieces.push(
      piece('queen', { file: 3, rank: 1 }),
      piece('pawn', { file: 3, rank: 4 }),   // 경로 중간
      far,
    );
    recalcQueenBuffs(s);
    expect(far.queenBuffCount).toBe(1);
  });
  it('재계산 시 이전 값은 리셋되고, 슬롯 기물은 항상 0', () => {
    const s = createInitialState();
    const rook = piece('rook', { file: 3, rank: 4 });
    const slotted = piece('bishop', null, 0);
    slotted.queenBuffCount = 3; // 이전 쓰레기값
    const queen = piece('queen', { file: 3, rank: 1 });
    s.pieces.push(queen, rook, slotted);
    recalcQueenBuffs(s);
    expect(rook.queenBuffCount).toBe(1);
    expect(slotted.queenBuffCount).toBe(0);
    queen.square = null; queen.slotIndex = 1;  // 퀸 회수
    recalcQueenBuffs(s);
    expect(rook.queenBuffCount).toBe(0);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/buff.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: src/core/buff.ts 구현**

```ts
import type { GameState } from '../types';
import { sameSquare } from './grid';
import { queenLines } from './patterns';

/**
 * 퀸 버프 전체 재계산.
 * 트리거: 배치/이동/회수/판매/나이트 이동 직후 (스펙 10.5 — 매 프레임 금지).
 * 경로 차단 없음. 퀸 자신 칸 포함이지만 자기 자신은 공격이 없어 실효 없음 (스펙 5.6).
 */
export function recalcQueenBuffs(state: GameState): void {
  for (const p of state.pieces) p.queenBuffCount = 0;
  const onBoard = state.pieces.filter(p => p.square !== null);
  for (const q of onBoard) {
    if (q.type !== 'queen') continue;
    const covered = queenLines(q.square!);
    for (const p of onBoard) {
      if (p === q) continue;
      if (covered.some(sq => sameSquare(sq, p.square!))) p.queenBuffCount++;
    }
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/buff.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/buff.ts tests/buff.test.ts
git commit -m "feat: 퀸 버프 재계산 (중첩·비차단, 스펙 5.6)"
```

---

### Task 10: 경제 economy.ts

**Files:**
- Create: `src/core/economy.ts`
- Test: `tests/economy.test.ts`

**Interfaces:**
- Consumes: `CONFIG.pieces`, `CONFIG.economy`, `CONFIG.slots`, `recalcQueenBuffs`
- Produces:
  - `SLOT_CAPACITY: number` (16)
  - `freeSlotIndex(state: GameState): number | null` — 가장 낮은 빈 슬롯
  - `canBuy(state: GameState, type: PieceType): boolean` — 골드/슬롯/일시정지/종료 phase 검사 (스펙 7.4)
  - `buyPiece(state: GameState, type: PieceType): Piece | null`
  - `sellPrice(type: PieceType): number` — 구매가의 50%
  - `sellPiece(state: GameState, pieceId: string): boolean` — 보드/슬롯 모두 대상, 버프 재계산 포함
  - `resetPieceSeq(): void` — 테스트 격리용

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/economy.test.ts`

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { recalcQueenBuffs } from '../src/core/buff';
import {
  buyPiece, canBuy, freeSlotIndex, resetPieceSeq, sellPiece, sellPrice, SLOT_CAPACITY,
} from '../src/core/economy';
import { createInitialState } from '../src/core/state';

beforeEach(() => resetPieceSeq());

describe('구매 (스펙 6/7.2/7.4)', () => {
  it('폰 구매: 골드 300→200, 빈 슬롯 0번에 들어간다', () => {
    const s = createInitialState();
    const p = buyPiece(s, 'pawn')!;
    expect(s.gold).toBe(200);
    expect(p.type).toBe('pawn');
    expect(p.square).toBeNull();
    expect(p.slotIndex).toBe(0);
    expect(p.cooldown).toBe(0);
    expect(s.pieces).toHaveLength(1);
  });
  it('골드 부족 시 구매 불가', () => {
    const s = createInitialState();
    expect(canBuy(s, 'queen')).toBe(false);   // 900 > 300
    expect(buyPiece(s, 'queen')).toBeNull();
    expect(s.gold).toBe(300);
  });
  it('슬롯 16칸 만석이면 구매 불가 (스펙 7.2)', () => {
    const s = createInitialState();
    s.gold = 100000;
    for (let i = 0; i < SLOT_CAPACITY; i++) expect(buyPiece(s, 'pawn')).not.toBeNull();
    expect(canBuy(s, 'pawn')).toBe(false);
    expect(buyPiece(s, 'pawn')).toBeNull();
  });
  it('일시정지·게임 종료 중 구매 불가 (스펙 7.4)', () => {
    const s = createInitialState();
    s.paused = true;
    expect(canBuy(s, 'pawn')).toBe(false);
    s.paused = false;
    s.phase = 'defeat';
    expect(canBuy(s, 'pawn')).toBe(false);
  });
  it('빈 슬롯은 낮은 번호부터 재사용', () => {
    const s = createInitialState();
    s.gold = 10000;
    const a = buyPiece(s, 'pawn')!;
    buyPiece(s, 'pawn');
    sellPiece(s, a.id);                        // 0번 비움
    expect(freeSlotIndex(s)).toBe(0);
  });
});

describe('판매 (스펙 6/7.3)', () => {
  it('환급 50%: 룩 500 → 250', () => {
    expect(sellPrice('rook')).toBe(250);
    const s = createInitialState();
    s.gold = 500;
    const r = buyPiece(s, 'rook')!;
    expect(s.gold).toBe(0);
    expect(sellPiece(s, r.id)).toBe(true);
    expect(s.gold).toBe(250);
    expect(s.pieces).toHaveLength(0);
  });
  it('보드 위 기물도 판매 가능, 퀸 판매 시 버프 즉시 소멸', () => {
    const s = createInitialState();
    s.gold = 2000;
    const q = buyPiece(s, 'queen')!;
    const r = buyPiece(s, 'rook')!;
    q.square = { file: 3, rank: 1 }; q.slotIndex = null;
    r.square = { file: 3, rank: 5 }; r.slotIndex = null;
    recalcQueenBuffs(s);
    expect(r.queenBuffCount).toBe(1);
    sellPiece(s, q.id);
    expect(r.queenBuffCount).toBe(0);
  });
  it('일시정지 중 판매 불가 (스펙 7.7)', () => {
    const s = createInitialState();
    const p = buyPiece(s, 'pawn')!;
    s.paused = true;
    expect(sellPiece(s, p.id)).toBe(false);
    expect(s.pieces).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/economy.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: src/core/economy.ts 구현**

```ts
import { CONFIG } from '../config';
import type { GameState, Piece, PieceType } from '../types';
import { recalcQueenBuffs } from './buff';

export const SLOT_CAPACITY = CONFIG.slots.rows * CONFIG.slots.cols;

let pieceSeq = 0;
export function resetPieceSeq(): void { pieceSeq = 0; }

export function freeSlotIndex(state: GameState): number | null {
  const used = new Set(
    state.pieces.filter(p => p.slotIndex !== null).map(p => p.slotIndex as number),
  );
  for (let i = 0; i < SLOT_CAPACITY; i++) if (!used.has(i)) return i;
  return null;
}

export function canBuy(state: GameState, type: PieceType): boolean {
  return !state.paused
    && (state.phase === 'prepare' || state.phase === 'wave')
    && state.gold >= CONFIG.pieces[type].cost
    && freeSlotIndex(state) !== null;
}

export function buyPiece(state: GameState, type: PieceType): Piece | null {
  if (!canBuy(state, type)) return null;
  const slot = freeSlotIndex(state)!;
  state.gold -= CONFIG.pieces[type].cost;
  const piece: Piece = {
    id: `p-${pieceSeq++}`, type, square: null, slotIndex: slot,
    cooldown: 0, queenBuffCount: 0,
  };
  state.pieces.push(piece);
  return piece;
}

export function sellPrice(type: PieceType): number {
  return CONFIG.pieces[type].cost * CONFIG.economy.sellRatio;
}

/** 보드/슬롯 어디의 기물이든 판매. 확인창 없음 (스펙 7.3) */
export function sellPiece(state: GameState, pieceId: string): boolean {
  if (state.paused || state.phase === 'victory' || state.phase === 'defeat') return false;
  const i = state.pieces.findIndex(p => p.id === pieceId);
  if (i < 0) return false;
  state.gold += sellPrice(state.pieces[i].type);
  state.pieces.splice(i, 1);
  recalcQueenBuffs(state);   // 퀸/버프 대상 판매 대응 (스펙 10.5)
  return true;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/economy.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/economy.ts tests/economy.test.ts
git commit -m "feat: 골드 경제 — 구매/판매/슬롯 배정 (환급 50%)"
```

---

### Task 11: 전투 combat.ts (주기 공격·처치·골드)

**Files:**
- Create: `src/core/combat.ts`, `tests/helpers.ts`
- Test: `tests/combat.test.ts`

**Interfaces:**
- Consumes: `attackTargets`, `enemySquare`, `sameSquare`, `CONFIG.pieces`
- Produces:
  - `pieceDamage(p: Piece): number` — `기본 공격력 × (1 + queenBuffCount)` (스펙 5.6)
  - `applyAttack(state: GameState, targets: Square[], damage: number, events: GameEvent[]): void` — 대상 칸의 **모든** 적 타격(다중 타격, 스펙 5.1), 처치 시 골드 = maxHp·통계·`enemyDied` 이벤트
  - `updateCombat(state: GameState, dt: number, events: GameEvent[]): void` — 모든 기물 쿨다운 감소(슬롯 포함, ID 종속) + 폰/비숍/룩 발사. 나이트(단발)와 퀸(공격 없음)은 발사 제외
  - 발사 규칙: 쿨다운 0 && 사거리 내 적 존재 시 발사 후 `cooldown = interval` (검토 노트 5)
  - `tests/helpers.ts`: `enemyAt(wave, file, rank, isBoss?, id?)`, `boardPiece(type, file, rank)`, `waveState()`

- [ ] **Step 1: 테스트 헬퍼 작성** — `tests/helpers.ts`

```ts
import { CONFIG } from '../src/config';
import { createEnemy } from '../src/core/enemy';
import { rankToTopY } from '../src/core/grid';
import { createInitialState } from '../src/core/state';
import type { Enemy, GameState, Piece, PieceType } from '../src/types';

let seq = 0;

/** 특정 칸 중앙에 정지해 있는 적 (테스트에서는 moveEnemies를 호출하지 않는 한 안 움직임) */
export function enemyAt(wave: number, file: number, rank: number, isBoss = false, id?: string): Enemy {
  const e = createEnemy(wave, file, isBoss, id ?? `t-${seq++}`);
  e.y = rankToTopY(rank) + CONFIG.board.squarePx / 2;
  return e;
}

export function boardPiece(type: PieceType, file: number, rank: number): Piece {
  return {
    id: `bp-${seq++}`, type, square: { file, rank }, slotIndex: null,
    cooldown: 0, queenBuffCount: 0,
  };
}

export function waveState(): GameState {
  const s = createInitialState();
  s.phase = 'wave';
  return s;
}
```

- [ ] **Step 2: 실패하는 테스트 작성** — `tests/combat.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { applyAttack, pieceDamage, updateCombat } from '../src/core/combat';
import type { GameEvent } from '../src/types';
import { boardPiece, enemyAt, waveState } from './helpers';

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
    expect(e.hp).toBe(7);
    expect(b.cooldown).toBeCloseTo(3.0);
  });
  it('슬롯 기물: 쿨다운은 흐르지만 발사하지 않는다 (스펙 5.1 ID 유지)', () => {
    const s = waveState();
    const p = boardPiece('pawn', 3, 4);
    p.cooldown = 2.0;
    p.square = null; p.slotIndex = 0;      // 회수된 상태
    s.pieces.push(p);
    s.enemies.push(enemyAt(1, 2, 5));
    updateCombat(s, 1.5, []);
    expect(p.cooldown).toBeCloseTo(0.5);   // 계속 감소
    expect(s.enemies[0].hp).toBe(10);      // 발사는 없음
    updateCombat(s, 1.0, []);
    expect(p.cooldown).toBe(0);            // 0에서 멈춤 (음수 금지)
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
  it('나이트·퀸은 주기 발사가 없다', () => {
    const s = waveState();
    const n = boardPiece('knight', 3, 4);
    const q = boardPiece('queen', 3, 5);
    n.cooldown = 3.0;
    s.pieces.push(n, q);
    const e = enemyAt(1, 3, 4);            // 나이트 자신 칸
    s.enemies.push(e);
    updateCombat(s, 2.0, []);
    expect(e.hp).toBe(10);                 // 아무도 안 때림
    expect(n.cooldown).toBeCloseTo(1.0);   // 이동 쿨다운은 감소
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx vitest run tests/combat.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 4: src/core/combat.ts 구현**

```ts
import { CONFIG } from '../config';
import type { GameEvent, GameState, Piece, Square } from '../types';
import { enemySquare, sameSquare } from './grid';
import { attackTargets } from './patterns';

export function pieceDamage(p: Piece): number {
  return CONFIG.pieces[p.type].damage * (1 + p.queenBuffCount);
}

function anyEnemyIn(state: GameState, targets: Square[]): boolean {
  return state.enemies.some(e => targets.some(t => sameSquare(t, enemySquare(e))));
}

/** 대상 칸들의 모든 적에게 데미지. 처치 시 골드 = maxHp (스펙 4.1/5.1/6) */
export function applyAttack(
  state: GameState, targets: Square[], damage: number, events: GameEvent[],
): void {
  const killed: typeof state.enemies = [];
  for (const e of state.enemies) {
    if (!targets.some(t => sameSquare(t, enemySquare(e)))) continue;
    e.hp -= damage;
    if (e.hp <= 0) killed.push(e);
  }
  for (const e of killed) {
    state.enemies.splice(state.enemies.indexOf(e), 1);
    state.gold += e.maxHp;
    state.stats.totalKills++;
    state.stats.totalGoldEarned += e.maxHp;
    events.push({
      kind: 'enemyDied', enemyId: e.id, square: enemySquare(e), isBoss: e.isBoss, reward: e.maxHp,
    });
  }
}

/**
 * 쿨다운 진행 + 폰/비숍/룩 주기 발사.
 * - 쿨다운은 슬롯에 있어도 계속 흐른다 (기물 ID 종속, 스펙 5.1/10.5)
 * - 사거리 내 적이 없으면 쿨 0에서 대기, 적 진입 즉시 발사 (계획서 검토 노트 5)
 * - 나이트는 이동 쿨다운만 감소 (폭발은 pieces.ts), 퀸은 공격 없음
 */
export function updateCombat(state: GameState, dt: number, events: GameEvent[]): void {
  for (const p of state.pieces) {
    p.cooldown = Math.max(0, p.cooldown - dt);
    const def = CONFIG.pieces[p.type];
    if (def.damage === 0 || p.type === 'knight') continue;
    if (p.square === null || p.cooldown > 0) continue;
    const targets = attackTargets(p.type, p.square);
    if (!anyEnemyIn(state, targets)) continue;
    applyAttack(state, targets, pieceDamage(p), events);
    events.push({ kind: 'attack', pieceType: p.type, from: { ...p.square }, targets });
    p.cooldown = def.interval;
  }
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run tests/combat.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/combat.ts tests/combat.test.ts tests/helpers.ts
git commit -m "feat: 전투 엔진 — 주기 공격·다중 타격·처치 보상"
```

---

### Task 12: 기물 배치/이동/회수 + 나이트 특수 규칙

**Files:**
- Create: `src/core/pieces.ts`
- Test: `tests/pieces.test.ts`

**Interfaces:**
- Consumes: `applyAttack`, `pieceDamage`, `knightBlastTargets`, `knightMoves`, `recalcQueenBuffs`, `freeSlotIndex`
- Produces:
  - `findPiece(state: GameState, pieceId: string): Piece | undefined`
  - `pieceAt(state: GameState, file: number, rank: number): Piece | undefined`
  - `canPlaceAt(state: GameState, file: number, rank: number): boolean` — 1~7랭크·빈 칸 (스펙 2.1)
  - `placeFromSlot(state, pieceId, file, rank, events): boolean` — 슬롯→보드. 나이트면 폭발 시도
  - `moveOnBoard(state, pieceId, file, rank, events): boolean` — 보드→보드. 웨이브 중 무제한(나이트만 L자+쿨다운 제약, 스펙 5.1/5.3)
  - `recallToSlot(state, pieceId, preferredSlot?): boolean` — 보드→슬롯
  - `reorderSlots(state, pieceId, targetIndex): boolean` — 슬롯 재정렬(빈칸 이동/맞교환)
  - `isKnightMove(a: Square, b: Square): boolean`
  - 나이트 폭발 규칙(검토 노트 3): 쿨다운 0일 때만 폭발, 폭발 시 `cooldown = 3.0` 재시작. 버프는 폭발 시점 값 사용 → **버프 재계산을 폭발보다 먼저** 수행 (스펙 5.6)

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/pieces.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { updateCombat } from '../src/core/combat';
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
  it('최초 배치: 9칸 폭발 + 쿨다운 3초 시작', () => {
    const s = waveState();
    const n = slotPiece(s, 'knight', 0);
    const e = enemyAt(1, 4, 5);
    s.enemies.push(e);
    const ev: GameEvent[] = [];
    expect(placeFromSlot(s, n.id, 3, 4, ev)).toBe(true);
    expect(e.hp).toBe(7);                       // 3 데미지
    expect(n.cooldown).toBe(3.0);
    expect(ev.some(x => x.kind === 'knightBlast')).toBe(true);
  });
  it('쿨다운 중 보드 이동 불가, L자 아니면 불가, 점유 칸 불가', () => {
    const s = waveState();
    const n = boardPiece('knight', 3, 4);
    n.cooldown = 1.0;
    s.pieces.push(n, boardPiece('pawn', 4, 6));
    expect(moveOnBoard(s, n.id, 5, 5, [])).toBe(false);  // 쿨다운 중
    n.cooldown = 0;
    expect(moveOnBoard(s, n.id, 3, 5, [])).toBe(false);  // L자 아님
    expect(moveOnBoard(s, n.id, 4, 6, [])).toBe(false);  // 점유 칸
    expect(moveOnBoard(s, n.id, 5, 5, [])).toBe(true);   // 정상 L자
    expect(n.cooldown).toBe(3.0);                        // 이동 후 재시작
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
  it('회수→재배치로 폭발 반복 불가 (쿨다운 우회 차단, 스펙 5.1)', () => {
    const s = waveState();
    const n = slotPiece(s, 'knight', 0);
    const e = enemyAt(1, 4, 5);
    s.enemies.push(e);
    placeFromSlot(s, n.id, 3, 4, []);           // 폭발 1회, 쿨 3초
    expect(e.hp).toBe(7);
    recallToSlot(s, n.id);
    placeFromSlot(s, n.id, 3, 4, []);           // 쿨다운 중 재배치 — 배치는 허용, 폭발 없음
    expect(e.hp).toBe(7);
    expect(n.square).toEqual({ file: 3, rank: 4 });
    updateCombat(s, 3.0, []);                   // 쿨다운 소진
    recallToSlot(s, n.id);
    placeFromSlot(s, n.id, 3, 4, []);           // 쿨 0 → 다시 폭발
    expect(e.hp).toBe(4);
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
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/pieces.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: src/core/pieces.ts 구현**

```ts
import { CONFIG } from '../config';
import type { GameEvent, GameState, Piece, Square } from '../types';
import { recalcQueenBuffs } from './buff';
import { applyAttack, pieceDamage } from './combat';
import { freeSlotIndex } from './economy';
import { inBoard } from './grid';
import { knightBlastTargets } from './patterns';

export function findPiece(state: GameState, pieceId: string): Piece | undefined {
  return state.pieces.find(p => p.id === pieceId);
}

export function pieceAt(state: GameState, file: number, rank: number): Piece | undefined {
  return state.pieces.find(p => p.square?.file === file && p.square?.rank === rank);
}

/** 배치 가능: 1~7랭크(8랭크 = 스폰 구역 불가) + 빈 칸 (스펙 2.1) */
export function canPlaceAt(state: GameState, file: number, rank: number): boolean {
  return inBoard(file, rank) && rank <= CONFIG.board.ranks - 1 && !pieceAt(state, file, rank);
}

export function isKnightMove(a: Square, b: Square): boolean {
  const df = Math.abs(a.file - b.file);
  const dr = Math.abs(a.rank - b.rank);
  return (df === 1 && dr === 2) || (df === 2 && dr === 1);
}

function interactable(state: GameState): boolean {
  return !state.paused && (state.phase === 'prepare' || state.phase === 'wave');
}

/**
 * 나이트 폭발 — 쿨다운 0일 때만 발동하고 쿨다운 3초 재시작 (검토 노트 3).
 * 호출 전에 recalcQueenBuffs가 끝나 있어야 한다 (폭발 시점 버프, 스펙 5.6).
 */
function tryKnightBlast(state: GameState, piece: Piece, events: GameEvent[]): void {
  if (piece.cooldown > 0) return;
  const targets = knightBlastTargets(piece.square!);
  applyAttack(state, targets, pieceDamage(piece), events);
  events.push({ kind: 'knightBlast', square: { ...piece.square! } });
  piece.cooldown = CONFIG.pieces.knight.interval;
}

/** 슬롯 → 보드. 쿨다운은 유지된다 (스펙 5.1) */
export function placeFromSlot(
  state: GameState, pieceId: string, file: number, rank: number, events: GameEvent[],
): boolean {
  const p = findPiece(state, pieceId);
  if (!p || p.square !== null || !interactable(state)) return false;
  if (!canPlaceAt(state, file, rank)) return false;
  p.square = { file, rank };
  p.slotIndex = null;
  recalcQueenBuffs(state);
  if (p.type === 'knight') tryKnightBlast(state, p, events);
  return true;
}

/** 보드 → 보드. 웨이브 중에도 무제한 (나이트만 L자 + 쿨다운, 스펙 5.1/5.3) */
export function moveOnBoard(
  state: GameState, pieceId: string, file: number, rank: number, events: GameEvent[],
): boolean {
  const p = findPiece(state, pieceId);
  if (!p || p.square === null || !interactable(state)) return false;
  if (!canPlaceAt(state, file, rank)) return false;
  if (p.type === 'knight') {
    if (p.cooldown > 0) return false;
    if (!isKnightMove(p.square, { file, rank })) return false;
  }
  p.square = { file, rank };
  recalcQueenBuffs(state);
  if (p.type === 'knight') tryKnightBlast(state, p, events);
  return true;
}

/** 보드 → 슬롯 회수. 쿨다운 유지 (스펙 5.1/7.2) */
export function recallToSlot(state: GameState, pieceId: string, preferredSlot?: number): boolean {
  const p = findPiece(state, pieceId);
  if (!p || p.square === null || !interactable(state)) return false;
  const occupied = new Set(
    state.pieces.filter(x => x.slotIndex !== null).map(x => x.slotIndex as number),
  );
  const target = preferredSlot !== undefined && !occupied.has(preferredSlot)
    ? preferredSlot
    : freeSlotIndex(state);
  if (target === null) return false;
  p.square = null;
  p.slotIndex = target;
  recalcQueenBuffs(state);
  return true;
}

/** 슬롯 내 재정렬 — 빈칸 이동 또는 점유자와 맞교환 (스펙 7.2/7.5) */
export function reorderSlots(state: GameState, pieceId: string, targetIndex: number): boolean {
  const p = findPiece(state, pieceId);
  if (!p || p.slotIndex === null || state.paused) return false;
  if (targetIndex < 0 || targetIndex >= CONFIG.slots.rows * CONFIG.slots.cols) return false;
  const occupant = state.pieces.find(x => x.slotIndex === targetIndex);
  if (occupant) occupant.slotIndex = p.slotIndex;
  p.slotIndex = targetIndex;
  return true;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/pieces.test.ts`
Expected: PASS (경제/버프 테스트 회귀 없음: `npm test`)

- [ ] **Step 5: Commit**

```bash
git add src/core/pieces.ts tests/pieces.test.ts
git commit -m "feat: 기물 배치/이동/회수와 나이트 특수 규칙 (쿨다운 ID 유지)"
```

---

### Task 13: 전투를 stepGame에 통합 (엔드투엔드 웨이브 1)

**Files:**
- Modify: `src/core/step.ts` (1줄 추가)
- Test: `tests/integration.test.ts`

**Interfaces:**
- Consumes: `updateCombat`
- Produces: 완전한 1틱 파이프라인 — 준비 → 스폰 → 이동 → 전투 → 통과 → 종료 판정 (스펙 10.2 순서)

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/integration.test.ts`

웨이브 1을 헤드리스로 완주한다. a파일에만 스폰시키고 a파일 담당 룩 1개로 방어: 룩은 3초마다 파일 전체를 관통(5 데미지)하므로 체력 10짜리 적은 2회 피격으로 죽는다. 스펙 4.5의 누적 자금(웨이브 1 종료 시 700G)과 대조한다.

```ts
import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/core/state';
import { stepGame } from '../src/core/step';
import type { GameEvent } from '../src/types';
import { boardPiece } from './helpers';

describe('웨이브 1 엔드투엔드 (스펙 4.5 대조)', () => {
  it('a파일 룩 1개로 웨이브 1 전멸 — 무피해, 종료 시 700G', () => {
    const s = createInitialState();
    s.gold = 0;                              // 골드 흐름만 따로 검증
    s.pieces.push(boardPiece('rook', 0, 1));
    const events: GameEvent[] = [];
    const dt = 1 / 60;
    const rngA = () => 0;                    // 전부 a파일 스폰
    for (let t = 0; t < 60 && s.wave === 1; t += dt) stepGame(s, dt, events, rngA);
    expect(s.wave).toBe(2);                  // 클리어
    expect(s.phase).toBe('prepare');
    expect(s.hp).toBe(30);                   // 누수 0
    expect(s.stats.totalKills).toBe(10);
    expect(s.gold).toBe(100 + 300);          // 처치 100 + 보너스 300 (시작골드 제외)
    expect(s.stats.totalGoldEarned).toBe(400);
    expect(events.some(e => e.kind === 'waveCleared')).toBe(true);
  });

  it('방어가 없으면 같은 조건에서 체력 20으로 웨이브 2 진입', () => {
    const s = createInitialState();
    const dt = 1 / 60;
    for (let t = 0; t < 60 && s.wave === 1; t += dt) stepGame(s, dt, [], () => 0);
    expect(s.wave).toBe(2);
    expect(s.hp).toBe(20);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/integration.test.ts`
Expected: FAIL — 첫 테스트에서 적이 죽지 않아 `hp`가 30이 아님 (전투 미연결)

- [ ] **Step 3: src/core/step.ts에 전투 연결**

`stepGame`의 주석 자리에 1줄 추가:

```ts
import { updateCombat } from './combat';
// ...
  moveEnemies(state, dt);                   // 적 위치 갱신
  updateCombat(state, dt, events);          // 기물 쿨다운 → 공격 판정 → 처치/골드
  processLeaks(state, events);              // 1랭크 통과 → 체력 감소
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/integration.test.ts` 후 `npm test`
Expected: 모두 PASS. `npm run dev`에서 콘솔로 `__game.pieces.push(...)` 없이도 이 시점부터는 데모에서 기물이 있으면 적이 죽는다

- [ ] **Step 5: Commit**

```bash
git add src/core/step.ts tests/integration.test.ts
git commit -m "feat: 전투를 게임 루프에 통합 — 웨이브 1 엔드투엔드 검증"
```

---

### Task 14: UI 셸 — 레이아웃/HUD/상점/슬롯/시작 버튼

**Files:**
- Create: `src/ui/layout.ts`, `src/ui/hud.ts`, `src/ui/shop.ts`, `src/ui/slots.ts`
- Modify: `src/main.ts`, `src/style.css`

**Interfaces:**
- Consumes: `canBuy`, `buyPiece`, `startWave`, `remainingEnemies`, `sellPrice`, `ALLY_GLYPH`, `SLOT_CAPACITY`
- Produces:
  - `createLayout(app: HTMLElement): Layout` — 스펙 7.1 배치의 DOM 골격 생성

    ```ts
    export interface Layout {
      canvas: HTMLCanvasElement;
      hud: { hp: HTMLElement; gold: HTMLElement; wave: HTMLElement; remaining: HTMLElement;
             timer: HTMLElement; bossIcon: HTMLElement; pauseBtn: HTMLButtonElement; speedBtn: HTMLButtonElement };
      slotGrid: HTMLElement;        // 16개 .slot-cell (data-slot-index)
      shopButtons: Map<PieceType, HTMLButtonElement>;
      sellSlot: HTMLElement;        // 판매 드롭존 (동작은 Task 15)
      startBtn: HTMLButtonElement;
      bannerRoot: HTMLElement;      // 배너/결과 오버레이 부모 (Task 17)
    }
    ```
  - `updateHud(layout: Layout, state: GameState): void` — 매 프레임 호출
  - `updateShop(layout: Layout, state: GameState): void` — canBuy로 disabled 갱신
  - `updateSlots(layout: Layout, state: GameState): void` — 슬롯 기물 글리프 렌더 (`data-piece-id` 부여)

- [ ] **Step 1: src/ui/layout.ts 구현**

```ts
import { CONFIG } from '../config';
import { BOARD_H, BOARD_W } from '../core/grid';
import { SLOT_CAPACITY } from '../core/economy';
import { ALLY_GLYPH } from '../render/renderer';
import type { PieceType } from '../types';

export interface Layout {
  canvas: HTMLCanvasElement;
  hud: {
    hp: HTMLElement; gold: HTMLElement; wave: HTMLElement; remaining: HTMLElement;
    timer: HTMLElement; bossIcon: HTMLElement;
    pauseBtn: HTMLButtonElement; speedBtn: HTMLButtonElement;
  };
  slotGrid: HTMLElement;
  shopButtons: Map<PieceType, HTMLButtonElement>;
  sellSlot: HTMLElement;
  startBtn: HTMLButtonElement;
  bannerRoot: HTMLElement;
}

const SHOP_ORDER: PieceType[] = ['pawn', 'knight', 'bishop', 'rook', 'queen'];
export const PIECE_NAME: Record<PieceType, string> = {
  pawn: '폰', knight: '나이트', bishop: '비숍', rook: '룩', queen: '퀸',
};

export function createLayout(app: HTMLElement): Layout {
  app.innerHTML = `
    <header id="hud">
      <span>♥<b id="hud-hp"></b></span>
      <span>💰<b id="hud-gold"></b></span>
      <span>웨이브 <b id="hud-wave"></b></span>
      <span>남은 적 <b id="hud-remaining"></b></span>
      <span>⏱<b id="hud-timer"></b><b id="hud-boss-icon" hidden> ♚보스!</b></span>
      <button id="hud-pause">⏸</button>
      <button id="hud-speed">▶▶1x</button>
    </header>
    <main id="main">
      <aside id="left">
        <div id="slots"></div>
        <div id="shop"></div>
      </aside>
      <div id="board-wrap">
        <canvas id="board" width="${BOARD_W}" height="${BOARD_H}"></canvas>
      </div>
      <aside id="right">
        <div id="sell-slot">🗑<br><small>드래그 = 즉시 판매 (50%)</small><div id="sell-preview"></div></div>
        <button id="start-wave">웨이브 시작</button>
      </aside>
    </main>
    <div id="banner-root"></div>
  `;

  const slotGrid = app.querySelector<HTMLElement>('#slots')!;
  for (let i = 0; i < SLOT_CAPACITY; i++) {
    const cell = document.createElement('div');
    cell.className = 'slot-cell';
    cell.dataset.slotIndex = String(i);
    slotGrid.appendChild(cell);
  }

  const shop = app.querySelector<HTMLElement>('#shop')!;
  const shopButtons = new Map<PieceType, HTMLButtonElement>();
  for (const type of SHOP_ORDER) {
    const btn = document.createElement('button');
    btn.className = 'shop-btn';
    btn.dataset.pieceType = type;
    btn.innerHTML = `<span class="glyph">${ALLY_GLYPH[type]}</span> ${PIECE_NAME[type]}<br><small>${CONFIG.pieces[type].cost}G</small>`;
    shop.appendChild(btn);
    shopButtons.set(type, btn);
  }

  const q = <T extends HTMLElement>(sel: string) => app.querySelector<T>(sel)!;
  return {
    canvas: q<HTMLCanvasElement>('#board'),
    hud: {
      hp: q('#hud-hp'), gold: q('#hud-gold'), wave: q('#hud-wave'),
      remaining: q('#hud-remaining'), timer: q('#hud-timer'), bossIcon: q('#hud-boss-icon'),
      pauseBtn: q<HTMLButtonElement>('#hud-pause'), speedBtn: q<HTMLButtonElement>('#hud-speed'),
    },
    slotGrid,
    shopButtons,
    sellSlot: q('#sell-slot'),
    startBtn: q<HTMLButtonElement>('#start-wave'),
    bannerRoot: q('#banner-root'),
  };
}
```

- [ ] **Step 2: src/ui/hud.ts / shop.ts / slots.ts 구현**

`src/ui/hud.ts`:
```ts
import { CONFIG } from '../config';
import { remainingEnemies } from '../core/wave';
import type { GameState } from '../types';
import type { Layout } from './layout';

export function updateHud(layout: Layout, state: GameState): void {
  const h = layout.hud;
  h.hp.textContent = String(state.hp);
  h.gold.textContent = String(state.gold);
  h.wave.textContent = `${state.wave}/${CONFIG.wave.total}`;
  h.remaining.textContent = String(remainingEnemies(state));
  h.timer.textContent = state.phase === 'prepare'
    ? `${Math.max(0, state.prepareTimer).toFixed(1)}s` : '—';
  // 보스 웨이브 준비 중 보스 아이콘 상시 표기 (스펙 7.9)
  h.bossIcon.hidden = !(state.phase === 'prepare' && state.wave % CONFIG.wave.bossEvery === 0);
  h.pauseBtn.textContent = state.paused ? '▶' : '⏸';
  h.speedBtn.textContent = `▶▶${state.speedMultiplier}x`;
  layout.startBtn.hidden = state.phase !== 'prepare';
  layout.startBtn.disabled = state.paused;
}
```

`src/ui/shop.ts`:
```ts
import { buyPiece, canBuy } from '../core/economy';
import type { GameState, PieceType } from '../types';
import type { Layout } from './layout';

/** 클릭 = 슬롯 빈칸에 기물 추가 (스펙 7.5). 배선은 1회만 호출 */
export function wireShop(layout: Layout, state: GameState): void {
  for (const [type, btn] of layout.shopButtons) {
    btn.addEventListener('click', () => { buyPiece(state, type); });
  }
}

/** 매 프레임: 골드 부족/만석/일시정지 → 비활성화 (스펙 7.4) */
export function updateShop(layout: Layout, state: GameState): void {
  for (const [type, btn] of layout.shopButtons) {
    btn.disabled = !canBuy(state, type as PieceType);
  }
}
```

`src/ui/slots.ts`:
```ts
import { ALLY_GLYPH } from '../render/renderer';
import type { GameState } from '../types';
import type { Layout } from './layout';

/** 매 프레임: 슬롯 칸에 기물 글리프 표시. data-piece-id는 드래그(Task 15)에서 사용 */
export function updateSlots(layout: Layout, state: GameState): void {
  const cells = layout.slotGrid.children;
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i] as HTMLElement;
    const piece = state.pieces.find(p => p.slotIndex === i);
    const html = piece ? `<span class="glyph ally">${ALLY_GLYPH[piece.type]}</span>` : '';
    if (cell.innerHTML !== html) cell.innerHTML = html;
    cell.dataset.pieceId = piece?.id ?? '';
  }
}
```

- [ ] **Step 3: style.css를 스펙 7.1 레이아웃으로 확장**

```css
:root { color-scheme: dark; }
body {
  margin: 0; background: #23221f; color: #e8e8e8;
  font-family: system-ui, sans-serif; user-select: none;
}
#hud { display: flex; gap: 20px; align-items: center; padding: 8px 16px; background: #1a1918; }
#hud button { font-size: 14px; }
#main { display: flex; gap: 12px; padding: 12px; justify-content: center; align-items: flex-start; }
#left, #right { width: 210px; display: flex; flex-direction: column; gap: 12px; }
#slots { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
.slot-cell {
  aspect-ratio: 1; background: #35332f; border-radius: 4px;
  display: flex; align-items: center; justify-content: center; font-size: 30px;
}
.slot-cell .glyph.ally { color: #fff; text-shadow: 0 0 2px #000, 0 0 2px #000; cursor: grab; }
#shop { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
.shop-btn { padding: 6px 2px; font-size: 13px; }
.shop-btn .glyph { font-size: 20px; }
.shop-btn:disabled { opacity: 0.4; }
#board-wrap { position: relative; }   /* 툴팁/고스트 기준점 */
#sell-slot {
  min-height: 110px; border: 2px dashed #a05548; border-radius: 6px;
  text-align: center; padding: 12px 4px; font-size: 26px; color: #caa;
}
#sell-slot small { font-size: 11px; }
#sell-slot.armed { background: rgba(200, 80, 60, 0.25); }
#sell-preview { font-size: 14px; color: #ffd54a; min-height: 18px; }
#start-wave { padding: 12px; font-size: 16px; }
canvas { display: block; }
```

- [ ] **Step 4: main.ts를 정식 UI로 교체**

```ts
import './style.css';
import { createInitialState } from './core/state';
import { stepGame } from './core/step';
import { createTicker } from './core/ticker';
import { startWave } from './core/wave';
import { render } from './render/renderer';
import { updateHud } from './ui/hud';
import { createLayout } from './ui/layout';
import { updateShop, wireShop } from './ui/shop';
import { updateSlots } from './ui/slots';
import type { GameEvent } from './types';

const app = document.querySelector<HTMLDivElement>('#app')!;
const layout = createLayout(app);
const ctx = layout.canvas.getContext('2d')!;

const state = createInitialState();
const events: GameEvent[] = [];
const tick = createTicker();

wireShop(layout, state);
layout.startBtn.addEventListener('click', () => { if (!state.paused) startWave(state); });

if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__game = state;
}

let last = performance.now();
function frame(now: number): void {
  tick((now - last) / 1000, dt => stepGame(state, dt * state.speedMultiplier, events));
  last = now;
  render(ctx, state);
  updateHud(layout, state);
  updateShop(layout, state);
  updateSlots(layout, state);
  events.length = 0;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

- [ ] **Step 5: 수동 검증**

Run: `npm run dev`
Expected:
1. 스펙 7.1 배치: 좌측 4×4 슬롯+상점 5종, 중앙 보드, 우측 판매 슬롯+웨이브 시작 버튼, 상단 HUD
2. 폰 100G 클릭 구매 → 골드 200, 슬롯 0번에 ♟ 표시. 3개까지 구매 가능, 4번째는 버튼 비활성
3. 퀸(900G) 버튼은 처음부터 비활성
4. "웨이브 시작" 클릭 → 즉시 스폰 시작, 버튼 숨김. HUD 남은 적 감소
5. `npm test` 회귀 없음

- [ ] **Step 6: Commit**

```bash
git add src/ui src/main.ts src/style.css
git commit -m "feat: UI 셸 — HUD/상점/슬롯/웨이브 시작 (스펙 7.1)"
```

---

### Task 15: 드래그 앤 드롭 + 클릭-투-무브

**Files:**
- Create: `src/ui/drag.ts`
- Modify: `src/main.ts`
- Test: `tests/drag.test.ts` (순수 드롭 판정만)

**Interfaces:**
- Consumes: `placeFromSlot`, `moveOnBoard`, `recallToSlot`, `reorderSlots`, `sellPiece`, `sellPrice`, `pieceAt`, `findPiece`
- Produces:
  - `pickDropTarget(x, y, zones: DropZones): DropTarget` — 순수 함수 (테스트 대상)

    ```ts
    export interface RectLike { left: number; top: number; width: number; height: number }
    export interface DropZones { board: RectLike; slots: RectLike[]; sell: RectLike }
    export type DropTarget =
      | { kind: 'square'; file: number; rank: number }
      | { kind: 'slot'; index: number }
      | { kind: 'sell' }
      | null;
    ```
  - `dropAction(state, pieceId, from: 'slot' | 'board', target: DropTarget, events): boolean` — 스펙 7.5 동작표 그대로 매핑 (순수, 테스트 대상)
  - `DragController` 클래스 — 포인터 이벤트 기반 드래그 + 클릭-투-무브. 외부에서 읽는 상태:

    ```ts
    export interface Interaction {
      dragging: { pieceId: string; from: 'slot' | 'board' } | null;
      selectedPieceId: string | null;               // 클릭-투-무브 선택
      hoverSquare: Square | null;                   // 캔버스 위 마우스 칸
    }
    ```
- 동작 규칙:
  - 상점→클릭 구매(Task 14), 나머지 7행은 드래그와 클릭-투-무브 양쪽 지원 (스펙 7.5)
  - 무효 드롭 = 아무 함수도 성공하지 못함 → 고스트 제거만 (원위치 복귀)
  - 일시정지 중 드래그/클릭 시작 자체를 차단 (스펙 7.7)
  - 나이트: 보드 기물 쿨다운 중 드래그 시작 시 시작을 거부하고 남은 쿨다운 float 라벨 표시 (스펙 5.3)
  - 판매 슬롯 hover 시 환급액 프리뷰 표시 (스펙 7.3)

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/drag.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { dropAction, pickDropTarget, type DropZones } from '../src/ui/drag';
import type { GameState, Piece, PieceType } from '../src/types';
import { boardPiece, waveState } from './helpers';

const zones: DropZones = {
  board: { left: 100, top: 0, width: 640, height: 640 },
  slots: [
    { left: 0, top: 0, width: 40, height: 40 },
    { left: 44, top: 0, width: 40, height: 40 },
  ],
  sell: { left: 800, top: 0, width: 100, height: 100 },
};

describe('pickDropTarget', () => {
  it('보드 좌표 → 칸 (좌상단 = a8)', () => {
    expect(pickDropTarget(101, 1, zones)).toEqual({ kind: 'square', file: 0, rank: 8 });
    expect(pickDropTarget(100 + 639, 639, zones)).toEqual({ kind: 'square', file: 7, rank: 1 });
    expect(pickDropTarget(100 + 250, 500, zones)).toEqual({ kind: 'square', file: 3, rank: 2 });
  });
  it('슬롯/판매/바깥 판정', () => {
    expect(pickDropTarget(50, 20, zones)).toEqual({ kind: 'slot', index: 1 });
    expect(pickDropTarget(850, 50, zones)).toEqual({ kind: 'sell' });
    expect(pickDropTarget(999, 999, zones)).toBeNull();
  });
});

describe('dropAction (스펙 7.5 동작표)', () => {
  function withSlotPiece(type: PieceType = 'pawn'): { s: GameState; p: Piece } {
    const s = waveState();
    const p: Piece = { id: 'x', type, square: null, slotIndex: 0, cooldown: 0, queenBuffCount: 0 };
    s.pieces.push(p);
    return { s, p };
  }

  it('슬롯 → 보드 빈칸 = 배치', () => {
    const { s, p } = withSlotPiece();
    expect(dropAction(s, 'x', 'slot', { kind: 'square', file: 2, rank: 3 }, [])).toBe(true);
    expect(p.square).toEqual({ file: 2, rank: 3 });
  });
  it('슬롯 → 슬롯 = 재정렬, 슬롯 → 판매 = 판매', () => {
    const { s, p } = withSlotPiece();
    expect(dropAction(s, 'x', 'slot', { kind: 'slot', index: 3 }, [])).toBe(true);
    expect(p.slotIndex).toBe(3);
    const gold = s.gold;
    expect(dropAction(s, 'x', 'slot', { kind: 'sell' }, [])).toBe(true);
    expect(s.gold).toBe(gold + 50);
  });
  it('보드 → 보드/슬롯/판매', () => {
    const s = waveState();
    const p = boardPiece('rook', 0, 1);
    s.pieces.push(p);
    expect(dropAction(s, p.id, 'board', { kind: 'square', file: 5, rank: 5 }, [])).toBe(true);
    expect(dropAction(s, p.id, 'board', { kind: 'slot', index: 2 }, [])).toBe(true);
    expect(p.slotIndex).toBe(2);
    p.square = { file: 0, rank: 1 }; p.slotIndex = null;
    const gold = s.gold;
    expect(dropAction(s, p.id, 'board', { kind: 'sell' }, [])).toBe(true);
    expect(s.gold).toBe(gold + 250);
  });
  it('무효 드롭(8랭크/점유/null)은 false — 원위치 복귀 의미', () => {
    const { s } = withSlotPiece();
    expect(dropAction(s, 'x', 'slot', { kind: 'square', file: 0, rank: 8 }, [])).toBe(false);
    expect(dropAction(s, 'x', 'slot', null, [])).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/drag.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: src/ui/drag.ts 구현**

```ts
import { CONFIG } from '../config';
import { moveOnBoard, pieceAt, placeFromSlot, recallToSlot, reorderSlots, findPiece } from '../core/pieces';
import { sellPiece, sellPrice } from '../core/economy';
import type { GameEvent, GameState, Square } from '../types';
import type { Layout } from './layout';
import { ALLY_GLYPH } from '../render/renderer';

export interface RectLike { left: number; top: number; width: number; height: number }
export interface DropZones { board: RectLike; slots: RectLike[]; sell: RectLike }
export type DropTarget =
  | { kind: 'square'; file: number; rank: number }
  | { kind: 'slot'; index: number }
  | { kind: 'sell' }
  | null;

export interface Interaction {
  dragging: { pieceId: string; from: 'slot' | 'board' } | null;
  selectedPieceId: string | null;
  hoverSquare: Square | null;
}

function contains(r: RectLike, x: number, y: number): boolean {
  return x >= r.left && x < r.left + r.width && y >= r.top && y < r.top + r.height;
}

/** 화면 좌표 → 드롭 대상 (순수) */
export function pickDropTarget(x: number, y: number, zones: DropZones): DropTarget {
  if (contains(zones.sell, x, y)) return { kind: 'sell' };
  for (let i = 0; i < zones.slots.length; i++) {
    if (contains(zones.slots[i], x, y)) return { kind: 'slot', index: i };
  }
  if (contains(zones.board, x, y)) {
    const files = CONFIG.board.files, ranks = CONFIG.board.ranks;
    const file = Math.floor((x - zones.board.left) / (zones.board.width / files));
    const row = Math.floor((y - zones.board.top) / (zones.board.height / ranks));
    return { kind: 'square', file, rank: ranks - row };
  }
  return null;
}

/** 스펙 7.5 동작표 매핑 (순수). 실패 = 원위치 복귀 */
export function dropAction(
  state: GameState, pieceId: string, from: 'slot' | 'board',
  target: DropTarget, events: GameEvent[],
): boolean {
  if (!target) return false;
  if (target.kind === 'sell') return sellPiece(state, pieceId);
  if (from === 'slot') {
    if (target.kind === 'square') return placeFromSlot(state, pieceId, target.file, target.rank, events);
    return reorderSlots(state, pieceId, target.index);
  }
  if (target.kind === 'square') return moveOnBoard(state, pieceId, target.file, target.rank, events);
  return recallToSlot(state, pieceId, target.index);
}

const CLICK_DIST = 6;      // px 미만 이동이면 클릭으로 간주

export class DragController {
  readonly interaction: Interaction = { dragging: null, selectedPieceId: null, hoverSquare: null };
  private ghost: HTMLDivElement;
  private downAt: { x: number; y: number } | null = null;
  private cooldownLabel: HTMLDivElement;

  constructor(
    private state: GameState,
    private layout: Layout,
    private events: GameEvent[],
  ) {
    this.ghost = document.createElement('div');
    this.ghost.style.cssText =
      'position:fixed;pointer-events:none;font-size:44px;z-index:10;display:none;' +
      'color:#fff;text-shadow:0 0 3px #000;transform:translate(-50%,-50%)';
    document.body.appendChild(this.ghost);
    this.cooldownLabel = document.createElement('div');
    this.cooldownLabel.style.cssText =
      'position:fixed;pointer-events:none;font:12px system-ui;color:#ffd54a;' +
      'background:#000a;padding:2px 6px;border-radius:4px;z-index:11;display:none';
    document.body.appendChild(this.cooldownLabel);

    document.addEventListener('pointerdown', this.onDown);
    document.addEventListener('pointermove', this.onMove);
    document.addEventListener('pointerup', this.onUp);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') this.interaction.selectedPieceId = null;
    });
  }

  private zones(): DropZones {
    return {
      board: this.layout.canvas.getBoundingClientRect(),
      slots: [...this.layout.slotGrid.children].map(c => c.getBoundingClientRect()),
      sell: this.layout.sellSlot.getBoundingClientRect(),
    };
  }

  /** 좌표 아래의 (기물, 출발지) — 슬롯 칸 또는 보드 칸 */
  private pieceUnder(x: number, y: number): { pieceId: string; from: 'slot' | 'board' } | null {
    const t = pickDropTarget(x, y, this.zones());
    if (t?.kind === 'slot') {
      const p = this.state.pieces.find(pc => pc.slotIndex === t.index);
      return p ? { pieceId: p.id, from: 'slot' } : null;
    }
    if (t?.kind === 'square') {
      const p = pieceAt(this.state, t.file, t.rank);
      return p ? { pieceId: p.id, from: 'board' } : null;
    }
    return null;
  }

  private onDown = (e: PointerEvent): void => {
    if (this.state.paused || e.button !== 0) return;   // 일시정지 중 조작 불가 (스펙 7.7)
    this.downAt = { x: e.clientX, y: e.clientY };
    const hit = this.pieceUnder(e.clientX, e.clientY);
    if (!hit) return;
    const piece = findPiece(this.state, hit.pieceId)!;
    if (piece.type === 'knight' && hit.from === 'board' && piece.cooldown > 0) {
      this.showCooldown(e, piece.cooldown);            // 쿨다운 중: 시작 거부 + 표시 (스펙 5.3)
      return;
    }
    this.interaction.dragging = hit;
    this.ghost.textContent = ALLY_GLYPH[piece.type];
    this.moveGhost(e);
  };

  private onMove = (e: PointerEvent): void => {
    const t = pickDropTarget(e.clientX, e.clientY, this.zones());
    this.interaction.hoverSquare = t?.kind === 'square' ? { file: t.file, rank: t.rank } : null;
    const d = this.interaction.dragging;
    if (!d) return;
    this.moveGhost(e);
    const piece = findPiece(this.state, d.pieceId);
    const overSell = t?.kind === 'sell';
    this.layout.sellSlot.classList.toggle('armed', overSell);
    this.layout.sellSlot.querySelector('#sell-preview')!.textContent =
      overSell && piece ? `+${sellPrice(piece.type)}G` : '';   // 환급 프리뷰 (스펙 7.3)
  };

  private onUp = (e: PointerEvent): void => {
    const wasClick = this.downAt
      && Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) < CLICK_DIST;
    this.downAt = null;
    const d = this.interaction.dragging;
    this.interaction.dragging = null;
    this.ghost.style.display = 'none';
    this.layout.sellSlot.classList.remove('armed');
    this.layout.sellSlot.querySelector('#sell-preview')!.textContent = '';
    if (this.state.paused) return;

    if (d && !wasClick) {                               // 드래그 드롭
      dropAction(this.state, d.pieceId, d.from, pickDropTarget(e.clientX, e.clientY, this.zones()), this.events);
      return;
    }
    if (!wasClick) return;
    // 클릭-투-무브 (스펙 7.5 권장)
    const sel = this.interaction.selectedPieceId;
    const hit = this.pieceUnder(e.clientX, e.clientY);
    if (sel && (!hit || hit.pieceId !== sel)) {
      const piece = findPiece(this.state, sel);
      if (piece) {
        const from: 'slot' | 'board' = piece.square ? 'board' : 'slot';
        dropAction(this.state, sel, from, pickDropTarget(e.clientX, e.clientY, this.zones()), this.events);
      }
      this.interaction.selectedPieceId = null;
      return;
    }
    this.interaction.selectedPieceId = hit && hit.pieceId !== sel ? hit.pieceId : null;
  };

  private moveGhost(e: PointerEvent): void {
    this.ghost.style.display = 'block';
    this.ghost.style.left = `${e.clientX}px`;
    this.ghost.style.top = `${e.clientY}px`;
  }

  private showCooldown(e: PointerEvent, remain: number): void {
    this.cooldownLabel.textContent = `이동 쿨다운 ${remain.toFixed(1)}s`;
    this.cooldownLabel.style.left = `${e.clientX + 12}px`;
    this.cooldownLabel.style.top = `${e.clientY - 8}px`;
    this.cooldownLabel.style.display = 'block';
    setTimeout(() => { this.cooldownLabel.style.display = 'none'; }, 800);
  }
}
```

- [ ] **Step 4: main.ts에 컨트롤러 연결**

`main.ts`에 추가:
```ts
import { DragController } from './ui/drag';
// createLayout(...) 이후:
const drag = new DragController(state, layout, events);
```
(`drag.interaction`은 Task 18의 하이라이트/툴팁에서 사용한다.)

- [ ] **Step 5: 테스트 + 수동 검증**

Run: `npx vitest run tests/drag.test.ts` → PASS, `npm test` 회귀 없음

Run: `npm run dev` — 스펙 7.5 동작표 전 행 확인:
1. 슬롯 → 보드 빈칸: 배치됨. 8랭크·점유 칸에 놓으면 원위치
2. 슬롯 → 슬롯: 재정렬(맞교환 포함)
3. 슬롯/보드 → 판매 슬롯: hover 시 `+50G` 프리뷰, 드롭 즉시 환급(확인창 없음)
4. 보드 → 보드 빈칸: 웨이브 진행 중에도 자유 이동
5. 보드 → 슬롯: 회수
6. 클릭-투-무브: 기물 클릭 → 목적지 클릭으로 동일 동작, Esc로 선택 해제
7. 나이트: 배치 직후 드래그 시도 → "이동 쿨다운 n.ns" 라벨, 3초 후 L자 칸으로만 이동(폭발 발생), 직선 칸은 원위치
8. 일시정지(코어에는 있으므로 콘솔에서 `__game.paused = true`) 후 모든 조작 무시 확인

- [ ] **Step 6: Commit**

```bash
git add src/ui/drag.ts src/main.ts tests/drag.test.ts
git commit -m "feat: 드래그 앤 드롭 + 클릭-투-무브 (스펙 7.5 동작표)"
```

---

### Task 16: 일시정지 / 배속 / 자동 일시정지

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `state.paused`, `state.speedMultiplier` (코어는 이미 지원 — stepGame이 paused 스킵, dt에 배속 곱)
- Produces: HUD 버튼 배선 + `visibilitychange` 자동 일시정지 (스펙 7.7)

- [ ] **Step 1: main.ts에 배선 추가**

```ts
layout.hud.pauseBtn.addEventListener('click', () => {
  if (state.phase === 'victory' || state.phase === 'defeat') return;
  state.paused = !state.paused;
});
layout.hud.speedBtn.addEventListener('click', () => {
  state.speedMultiplier = state.speedMultiplier === 1 ? 2 : 1;   // 이동·쿨다운·준비 시간 모두 적용
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && (state.phase === 'prepare' || state.phase === 'wave')) {
    state.paused = true;    // 자동 일시정지 (수동 해제만 가능, 스펙 7.7)
  }
});
```

- [ ] **Step 2: 수동 검증**

Run: `npm run dev`
Expected:
1. ⏸ 클릭: 적·타이머 정지, 렌더는 유지. 상점 버튼 전부 비활성, 드래그/클릭 무시. ▶ 재클릭으로 재개
2. ▶▶2x: 적 이동·준비 카운트다운이 2배 속도 (폰 공격 간격도 체감 단축)
3. 다른 탭 전환 후 복귀 → 일시정지 상태
4. `npm test` 회귀 없음

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat: 일시정지·배속 2x·탭 이탈 자동 일시정지 (스펙 7.7)"
```

---

### Task 17: 보스 경고 연출 + 결과 화면

**Files:**
- Create: `src/ui/banners.ts`
- Modify: `src/main.ts`, `src/style.css`

**Interfaces:**
- Consumes: `GameEvent`(`prepareStarted`/`bossSpawned`), `GameState`, `fileLabel`
- Produces:
  - `Banners` 클래스: `onEvent(ev: GameEvent): void`, `update(state: GameState, dt: number): void`(매 프레임 — bossFlash 타이머·결과 화면 표시 판단)
  - `bossFlash: { file: number; t: number } | null` — 보스 스폰 파일 강조(1초). `main.ts`가 읽어 `ViewState.highlights`로 렌더러에 전달
  - 비네트(2랭크 접근)는 Task 7의 렌더러가 이미 처리

- [ ] **Step 1: src/ui/banners.ts 구현**

```ts
import { CONFIG } from '../config';
import { fileLabel } from '../core/grid';
import type { GameEvent, GameState } from '../types';
import type { Layout } from './layout';

export class Banners {
  /** 보스 스폰 파일 강조 (1초). main이 렌더 하이라이트로 변환 (스펙 7.9) */
  bossFlash: { file: number; t: number } | null = null;
  private resultShown = false;

  constructor(private layout: Layout) {}

  onEvent(ev: GameEvent): void {
    if (ev.kind === 'prepareStarted' && ev.isBossWave) {
      this.showBanner('⚠ BOSS WAVE');                    // 2초 표시 후 페이드
    }
    if (ev.kind === 'bossSpawned') {
      this.bossFlash = { file: ev.file, t: 1.0 };
      this.showBanner(`♚ 보스 등장 — ${fileLabel(ev.file)}파일!`);
    }
  }

  update(state: GameState, dt: number): void {
    if (this.bossFlash) {
      this.bossFlash.t -= dt;
      if (this.bossFlash.t <= 0) this.bossFlash = null;
    }
    if (!this.resultShown && (state.phase === 'victory' || state.phase === 'defeat')) {
      this.resultShown = true;
      this.showResult(state);
    }
  }

  private showBanner(text: string): void {
    const el = document.createElement('div');
    el.className = 'banner';
    el.textContent = text;
    this.layout.bannerRoot.appendChild(el);
    setTimeout(() => el.remove(), 2600);                 // 2s 표시 + 0.6s 페이드(CSS)
  }

  /** 결과 화면 (스펙 3.2): 도달 웨이브 / 처치 수 / 획득 골드 */
  private showResult(state: GameState): void {
    const el = document.createElement('div');
    el.className = 'result-overlay';
    el.innerHTML = `
      <div class="result-box">
        <h1>${state.phase === 'victory' ? '🏆 승리!' : '💀 패배'}</h1>
        <p>도달 웨이브 <b>${state.wave} / ${CONFIG.wave.total}</b></p>
        <p>처치 수 <b>${state.stats.totalKills}</b></p>
        <p>획득 골드 <b>${state.stats.totalGoldEarned}G</b></p>
        <button id="restart">다시 시작</button>
      </div>`;
    this.layout.bannerRoot.appendChild(el);
    el.querySelector('#restart')!.addEventListener('click', () => location.reload());
  }
}
```

`style.css`에 추가:
```css
#banner-root { position: fixed; inset: 0; pointer-events: none; z-index: 20; }
.banner {
  position: absolute; top: 30%; left: 50%; transform: translateX(-50%);
  font-size: 42px; font-weight: 800; color: #ff5240;
  text-shadow: 0 2px 8px #000;
  animation: banner-fade 2.6s forwards;
}
@keyframes banner-fade {
  0% { opacity: 0; } 8% { opacity: 1; } 77% { opacity: 1; } 100% { opacity: 0; }
}
.result-overlay {
  position: absolute; inset: 0; pointer-events: auto;
  background: rgba(0, 0, 0, 0.65);
  display: flex; align-items: center; justify-content: center;
}
.result-box {
  background: #2b2a27; padding: 32px 56px; border-radius: 12px;
  text-align: center; font-size: 18px;
}
.result-box button { margin-top: 16px; padding: 10px 28px; font-size: 16px; }
```

- [ ] **Step 2: main.ts 배선**

```ts
import { Banners } from './ui/banners';
import { EMPTY_VIEW, type ViewState } from './render/renderer';
// createLayout 이후:
const banners = new Banners(layout);

// frame() 내부를 다음 순서로:
//   tick(...stepGame...) → 이벤트 소비 → 렌더 → HUD/슬롯/상점 → events 비우기
function frame(now: number): void {
  const realDt = (now - last) / 1000;
  tick(realDt, dt => stepGame(state, dt * state.speedMultiplier, events));
  last = now;
  for (const ev of events) banners.onEvent(ev);
  banners.update(state, realDt);

  const view: ViewState = { ...EMPTY_VIEW, highlights: [] };
  if (banners.bossFlash) {                          // 파일 전체 붉은 강조 1초 (스펙 7.9)
    for (let rank = 1; rank <= 8; rank++) {
      view.highlights.push({ square: { file: banners.bossFlash.file, rank }, color: 'rgba(220,50,40,0.28)' });
    }
  }
  render(ctx, state, view);
  updateHud(layout, state);
  updateShop(layout, state);
  updateSlots(layout, state);
  events.length = 0;
  requestAnimationFrame(frame);
}
```

- [ ] **Step 3: 수동 검증**

Run: `npm run dev` — 개발 콘솔에서 `__game.wave = 4; __game.enemies = []` 등으로 빠르게 진행:
1. 웨이브 4 클리어 → "⚠ BOSS WAVE" 배너 2초 + HUD 타이머 옆 ♚보스! 아이콘
2. 웨이브 5 시작 → 보스 스폰 파일 전체가 1초간 붉게, 파일명 배너
3. 보스가 2랭크 진입 → 화면 가장자리 붉은 비네트
4. 보스 통과(체력 −5) 또는 처치 후 웨이브 6 진행 확인
5. `__game.hp = 1`로 두고 적 통과 → 그 자리에서 정지 + 패배 결과 화면(도달 웨이브/처치/골드)
6. 20웨이브 클리어 상황(콘솔로 `__game.wave = 20` 설정 후 클리어) → 승리 화면
7. `npm test` 회귀 없음

- [ ] **Step 4: Commit**

```bash
git add src/ui/banners.ts src/main.ts src/style.css
git commit -m "feat: 보스 경고 3단 연출과 결과 화면 (스펙 7.9/3.2)"
```

---

### Task 18: 사거리 미리보기 / 퀸 시각화 / 툴팁 / 판매 프리뷰

**Files:**
- Create: `src/render/highlights.ts`, `src/ui/tooltip.ts`
- Modify: `src/main.ts`, `src/style.css`

**Interfaces:**
- Consumes: `Interaction`(Task 15), `attackTargets`, `knightMoves`, `queenLines`, `pieceDamage`, `sellPrice`, `findPiece`, `pieceAt`
- Produces:
  - `buildHighlights(state: GameState, interaction: Interaction): Pick<ViewState, 'highlights' | 'lines'>` — 순수 함수:
    - 드래그/선택 중 기물이 폰·비숍·룩·나이트(슬롯 출발)면: hover 칸 기준 `attackTargets` 하이라이트 (스펙 7.7 사거리 미리보기)
    - 보드 위 나이트 드래그/선택: `knightMoves` 초록 하이라이트 + hover가 그중 하나면 폭발 9칸 표시
    - 퀸 드래그/선택: hover(또는 현재) 칸 기준 8방향 라인 표시 (스펙 7.7)
  - `updateTooltip(el: HTMLElement, state: GameState, interaction: Interaction, mouse: {x,y} | null): void` — 기물명/기본 공격력/버프 배율/최종 공격력/공격 주기/남은 쿨다운/판매가 (스펙 7.7)
  - 버프 뱃지(`×2` 등)는 Task 7 렌더러가 이미 그림. 판매 프리뷰는 Task 15가 이미 처리

- [ ] **Step 1: src/render/highlights.ts 구현**

```ts
import { findPiece, pieceAt } from '../core/pieces';
import { attackTargets, knightMoves, queenLines } from '../core/patterns';
import { sameSquare } from '../core/grid';
import type { GameState, Piece, Square } from '../types';
import type { Interaction } from '../ui/drag';
import type { ViewState } from './renderer';

const C = {
  range: 'rgba(80, 160, 255, 0.35)',     // 공격 범위
  move: 'rgba(90, 200, 90, 0.40)',       // 나이트 이동 가능 칸
  queenLine: 'rgba(255, 213, 74, 0.55)', // 퀸 8방향 라인
  origin: 'rgba(255, 255, 255, 0.25)',   // 기준 칸
};

/** 활성 기물: 드래그 중 우선, 없으면 클릭 선택 */
function activePiece(state: GameState, it: Interaction): Piece | null {
  const id = it.dragging?.pieceId ?? it.selectedPieceId;
  return id ? findPiece(state, id) ?? null : null;
}

export function buildHighlights(
  state: GameState, it: Interaction,
): Pick<ViewState, 'highlights' | 'lines'> {
  const highlights: ViewState['highlights'] = [];
  const lines: ViewState['lines'] = [];
  const piece = activePiece(state, it);
  if (!piece) return { highlights, lines };

  const onBoard = piece.square !== null;
  const anchor: Square | null = it.hoverSquare ?? piece.square;   // 미리보기 기준 칸
  if (!anchor) return { highlights, lines };

  if (piece.type === 'queen') {
    for (const sq of queenLines(anchor)) highlights.push({ square: sq, color: C.queenLine });
    return { highlights, lines };
  }
  if (piece.type === 'knight' && onBoard) {
    const moves = knightMoves(piece.square!);
    for (const m of moves) if (!pieceAt(state, m.file, m.rank)) highlights.push({ square: m, color: C.move });
    if (it.hoverSquare && moves.some(m => sameSquare(m, it.hoverSquare!))) {
      for (const sq of attackTargets('knight', it.hoverSquare)) highlights.push({ square: sq, color: C.range });
    }
    return { highlights, lines };
  }
  highlights.push({ square: anchor, color: C.origin });
  for (const sq of attackTargets(piece.type, anchor)) highlights.push({ square: sq, color: C.range });
  return { highlights, lines };
}
```

- [ ] **Step 2: src/ui/tooltip.ts 구현**

```ts
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
```

`style.css`에 추가:
```css
#tooltip {
  position: fixed; z-index: 15; pointer-events: none;
  background: #111c; color: #eee; font-size: 12px; line-height: 1.5;
  padding: 6px 10px; border-radius: 6px; border: 1px solid #555;
}
```

- [ ] **Step 3: main.ts 배선**

```ts
import { buildHighlights } from './render/highlights';
import { updateTooltip } from './ui/tooltip';

// createLayout 이후:
const tooltip = document.createElement('div');
tooltip.id = 'tooltip';
tooltip.hidden = true;
document.body.appendChild(tooltip);
let mousePos: { x: number; y: number } | null = null;
document.addEventListener('pointermove', e => { mousePos = { x: e.clientX, y: e.clientY }; });

// frame()에서 view 구성 시:
const hl = buildHighlights(state, drag.interaction);
view.highlights.push(...hl.highlights);
view.lines.push(...hl.lines);
// render 후:
updateTooltip(tooltip, state, drag.interaction, mousePos);
```

- [ ] **Step 4: 수동 검증**

Run: `npm run dev`
Expected:
1. 폰 드래그 중 hover 칸의 ↖↗ 대각선 2칸이 파랗게 표시
2. 비숍/룩 드래그: 대각선/십자 전체 라인 하이라이트
3. 보드 위 나이트 선택: 이동 가능 L자 칸 초록, 그 칸 hover 시 폭발 9칸 표시
4. 퀸 드래그/선택: 8방향 전체 하이라이트, 배치 후 라인 위 기물에 ×2 뱃지 상시 표시
5. 기물 hover: 이름/공격력/배율/최종/주기/남은 쿨/판매가 툴팁
6. `npm test` 회귀 없음

- [ ] **Step 5: Commit**

```bash
git add src/render/highlights.ts src/ui/tooltip.ts src/main.ts src/style.css
git commit -m "feat: 사거리 미리보기·퀸 라인·나이트 이동 칸·툴팁 (스펙 7.7)"
```

---

### Task 19: 공격 이펙트 (노말/땅/빛/불/오라)

**Files:**
- Create: `src/render/effects.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `GameEvent`(`attack`/`knightBlast`/`enemyDied`), `grid.ts`
- Produces:
  - `Effects` 클래스: `onEvent(ev: GameEvent): void`, `update(dt: number): void`, `draw(ctx: CanvasRenderingContext2D): void`, `shakeOffset(): { x: number; y: number }`
  - `main.ts`는 `view.shake = fx.shakeOffset()`로 화면 진동을 렌더러에 전달
  - 이펙트는 전부 렌더 전용 — 게임 상태에 영향 없음. 스펙 8.2의 속성 연출:
    - 폰(노말): 대상 칸에 회백색 원형 충격파, 0.1초 이내로 짧게
    - 룩(땅): 십자 라인을 따라 갈색 균열 선 + 돌조각 점 + 화면 진동 소폭
    - 비숍(빛): 대각선을 관통하는 흰-금색 광선, 0.3초 페이드
    - 나이트(불): 착지점 방사형 폭발 + 주황 잔불 파티클 9칸 확산 + 진동
    - 퀸(오라): 상시 오라는 Task 18의 라인/뱃지로 대체 표현 (선택/드래그 시 표시 — 스펙 7.7 기준)
    - 각 이펙트에 반대 톤 외곽선(스펙 8.2 주의사항): 광선·충격파에 어두운 테두리, 균열에 밝은 테두리

- [ ] **Step 1: src/render/effects.ts 구현**

```ts
import { CONFIG } from '../config';
import { fileCenterX, rankToTopY } from '../core/grid';
import type { GameEvent, Square } from '../types';

const SQ = CONFIG.board.squarePx;
const center = (sq: Square) => ({ x: fileCenterX(sq.file), y: rankToTopY(sq.rank) + SQ / 2 });

interface Fx {
  kind: 'shock' | 'crack' | 'beam' | 'explosion' | 'ember' | 'puff';
  x: number; y: number;
  x2?: number; y2?: number;      // 라인형(crack/beam)의 끝점
  vx?: number; vy?: number;      // 파티클 속도
  t: number; ttl: number;
}

export class Effects {
  private list: Fx[] = [];
  private shake = 0;

  onEvent(ev: GameEvent): void {
    if (ev.kind === 'attack') {
      if (ev.pieceType === 'pawn') {
        for (const sq of ev.targets) {
          const c = center(sq);
          this.list.push({ kind: 'shock', ...c, t: 0, ttl: 0.1 });
        }
      } else if (ev.pieceType === 'rook' || ev.pieceType === 'bishop') {
        const kind = ev.pieceType === 'rook' ? 'crack' : 'beam';
        const from = center(ev.from);
        // 방향별 가장 먼 대상 칸까지 라인 (관통 연출)
        const dirs = new Map<string, Square>();
        for (const sq of ev.targets) {
          const df = Math.sign(sq.file - ev.from.file), dr = Math.sign(sq.rank - ev.from.rank);
          if (df === 0 && dr === 0) continue;
          const key = `${df},${dr}`;
          const prev = dirs.get(key);
          const dist = Math.abs(sq.file - ev.from.file) + Math.abs(sq.rank - ev.from.rank);
          if (!prev || dist > Math.abs(prev.file - ev.from.file) + Math.abs(prev.rank - ev.from.rank)) {
            dirs.set(key, sq);
          }
        }
        for (const far of dirs.values()) {
          const c = center(far);
          this.list.push({ kind, x: from.x, y: from.y, x2: c.x, y2: c.y, t: 0, ttl: kind === 'beam' ? 0.3 : 0.25 });
        }
        if (kind === 'crack') this.shake = Math.max(this.shake, 0.15);
      }
    }
    if (ev.kind === 'knightBlast') {
      const c = center(ev.square);
      this.list.push({ kind: 'explosion', ...c, t: 0, ttl: 0.35 });
      for (let i = 0; i < 14; i++) {
        const ang = (i / 14) * Math.PI * 2;
        this.list.push({
          kind: 'ember', ...c,
          vx: Math.cos(ang) * (60 + (i % 3) * 40), vy: Math.sin(ang) * (60 + (i % 3) * 40),
          t: 0, ttl: 0.5,
        });
      }
      this.shake = Math.max(this.shake, 0.25);
    }
    if (ev.kind === 'enemyDied') {
      const c = center(ev.square);
      this.list.push({ kind: 'puff', ...c, t: 0, ttl: 0.25 });
    }
  }

  update(dt: number): void {
    for (const f of this.list) {
      f.t += dt;
      if (f.kind === 'ember') { f.x += f.vx! * dt; f.y += f.vy! * dt; }
    }
    this.list = this.list.filter(f => f.t < f.ttl);
    this.shake = Math.max(0, this.shake - dt);
  }

  shakeOffset(): { x: number; y: number } {
    if (this.shake <= 0) return { x: 0, y: 0 };
    const a = this.shake * 14;
    return { x: (Math.random() - 0.5) * a, y: (Math.random() - 0.5) * a };
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const f of this.list) {
      const k = 1 - f.t / f.ttl;   // 1 → 0
      ctx.save();
      ctx.globalAlpha = k;
      switch (f.kind) {
        case 'shock': {            // 폰 — 노말: 회백색 충격파 + 어두운 테두리
          ctx.beginPath();
          ctx.arc(f.x, f.y, 8 + (1 - k) * 16, 0, Math.PI * 2);
          ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 4; ctx.stroke();
          ctx.strokeStyle = '#d8d8d0'; ctx.lineWidth = 2; ctx.stroke();
          break;
        }
        case 'crack': {            // 룩 — 땅: 갈색 균열 + 밝은 테두리
          ctx.lineWidth = 6; ctx.strokeStyle = '#f0e0c0';
          line(ctx, f); 
          ctx.lineWidth = 3.5; ctx.strokeStyle = '#7a5230';
          line(ctx, f);
          break;
        }
        case 'beam': {             // 비숍 — 빛: 흰-금 광선 + 어두운 테두리
          ctx.lineWidth = 5; ctx.strokeStyle = '#4a4020';
          line(ctx, f);
          ctx.lineWidth = 2; ctx.strokeStyle = '#fff6cf';
          line(ctx, f);
          break;
        }
        case 'explosion': {        // 나이트 — 불: 방사형 폭발
          const r = 10 + (1 - k) * SQ * 1.4;
          const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
          g.addColorStop(0, 'rgba(255,200,80,0.9)');
          g.addColorStop(0.6, 'rgba(240,90,30,0.6)');
          g.addColorStop(1, 'rgba(240,90,30,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'ember': {            // 잔불 파티클
          ctx.fillStyle = '#ff8c3a';
          ctx.fillRect(f.x - 2, f.y - 2, 4, 4);
          break;
        }
        case 'puff': {             // 처치 연출
          ctx.fillStyle = '#999';
          ctx.beginPath(); ctx.arc(f.x, f.y, (1 - k) * 14, 0, Math.PI * 2); ctx.fill();
          break;
        }
      }
      ctx.restore();
    }
  }
}

function line(ctx: CanvasRenderingContext2D, f: { x: number; y: number; x2?: number; y2?: number }): void {
  ctx.beginPath();
  ctx.moveTo(f.x, f.y);
  ctx.lineTo(f.x2!, f.y2!);
  ctx.stroke();
}
```

- [ ] **Step 2: main.ts 배선**

```ts
import { Effects } from './render/effects';
const fx = new Effects();

// frame() 내부, 이벤트 소비부에 추가:
for (const ev of events) { banners.onEvent(ev); fx.onEvent(ev); }
fx.update(realDt);
view.shake = fx.shakeOffset();
render(ctx, state, view);
fx.draw(ctx);          // 보드 위 오버레이로 그린다
```

- [ ] **Step 3: 수동 검증**

Run: `npm run dev`
Expected:
1. 폰: 대각선 대상 칸에 짧은 회백색 링 (다수 배치해도 화면이 지저분하지 않음)
2. 룩: 발사 시 십자 방향 갈색 균열 선 + 미세한 화면 진동
3. 비숍: 대각선 흰-금 광선이 0.3초 페이드
4. 나이트 이동/배치 폭발: 방사형 화염 + 잔불 확산 + 진동 (가장 화려함)
5. 어두운 칸/밝은 칸 위에서도 이펙트가 묻히지 않음 (반대 톤 테두리)
6. `npm test` 회귀 없음

- [ ] **Step 4: Commit**

```bash
git add src/render/effects.ts src/main.ts
git commit -m "feat: 속성별 공격 이펙트와 화면 진동 (스펙 8.2)"
```

---

### Task 20: 통합 시뮬레이션 + 밸런스 리포트

**Files:**
- Test: `tests/simulation.test.ts`

**Interfaces:**
- Consumes: 코어 전체
- Produces: 전 게임 헤드리스 완주 검증 + 스펙 9.4 폰 추격 실측 리포트(콘솔 로그)

- [ ] **Step 1: 시뮬레이션 테스트 작성** — `tests/simulation.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { enemyCount, enemyHp } from '../src/config';
import { moveOnBoard } from '../src/core/pieces';
import { createInitialState } from '../src/core/state';
import { stepGame } from '../src/core/step';
import { enemySquare } from '../src/core/grid';
import type { GameEvent, GameState } from '../src/types';
import { boardPiece } from './helpers';

const DT = 1 / 60;
const cycleRng = () => { let i = 0; return () => (i++ % 8) / 8; };   // a~h 순환 스폰

function run(s: GameState, seconds: number, rng: () => number, onTick?: () => void): void {
  const ev: GameEvent[] = [];
  for (let t = 0; t < seconds; t += DT) {
    if (s.phase === 'victory' || s.phase === 'defeat') return;
    stepGame(s, DT, ev, rng);
    ev.length = 0;
    onTick?.();
  }
}

describe('전 게임 시뮬레이션', () => {
  it('웨이브 1: 폰 4개(b4/c4/f4/g4)가 8파일 전부 커버 — 무누수 클리어 (스펙 9.3)', () => {
    const s = createInitialState();
    // 폰 (f,r)은 (f±1, r+1) 공격 → b,c,f,g 배치로 a~h 전 파일 커버
    for (const file of [1, 2, 5, 6]) s.pieces.push(boardPiece('pawn', file, 4));
    run(s, 60, cycleRng());
    expect(s.wave).toBe(2);
    expect(s.hp).toBe(30);
    expect(s.stats.totalKills).toBe(10);
  });

  it('풀런: 파일당 룩 2개면 일반 웨이브 전멸·보스 4회 누수로 승리 (엔진 무결성)', () => {
    const s = createInitialState();
    for (let f = 0; f < 8; f++) {
      s.pieces.push(boardPiece('rook', f, 1), boardPiece('rook', f, 2));
    }
    // 룩 2개/파일 = 종주당 80 ≥ 최대 일반 체력 49 → 일반 적 전멸.
    // 보스(420~1470)는 160으로 못 잡음 → 4회 누수 = 체력 -20.
    run(s, 60 * 60, cycleRng());
    expect(s.phase).toBe('victory');
    expect(s.hp).toBe(30 - 4 * 5);
    const bossHp = [5, 10, 15, 20].map(w => enemyHp(w) * 30).reduce((a, b) => a + b, 0);
    let killGold = 0;
    for (let w = 1; w <= 20; w++) killGold += enemyCount(w) * enemyHp(w) * (w % 5 === 0 ? 30 : 1);
    killGold -= bossHp;                                  // 보스 4마리는 놓침
    expect(s.stats.totalKills).toBe(452 - 4);
    expect(s.stats.totalGoldEarned).toBe(killGold + 300 * 20);  // 처치 + 클리어 보너스 (스펙 3.2)
  });

  it('20웨이브 보스 누수: 체력 6 이상이면 승리, 5 이하면 패배 우선 (스펙 3.1/10.5)', () => {
    for (const [hp, expected] of [[6, 'victory'], [5, 'defeat']] as const) {
      const s = createInitialState();
      s.wave = 20;
      s.hp = hp;
      s.phase = 'wave';
      s.spawnedCount = 1;                                // 보스 이미 스폰됨
      const boss = { 
        id: 'b', file: 3, y: 639.9, hp: 1470, maxHp: 1470, isBoss: true,
        speed: 80 / 6, jitterX: 0,
      };
      s.enemies.push(boss);
      run(s, 2, () => 0);
      expect(s.phase).toBe(expected);
    }
  });

  it('[리포트] 웨이브 5 보스 vs 완벽 폰 추격 — 스펙 9.4 실측 (검토 노트 1)', () => {
    const s = createInitialState();
    s.wave = 5;
    const bossFile = 3;
    // 추격 폰 2개(보스 파일 양옆) + 보스 파일 룩 + 보스 경로 대각선의 비숍
    const left = boardPiece('pawn', bossFile - 1, 7);
    const right = boardPiece('pawn', bossFile + 1, 7);
    s.pieces.push(left, right, boardPiece('rook', bossFile, 1), boardPiece('bishop', 4, 4));
    s.phase = 'prepare';
    s.prepareTimer = 0.01;

    let bossMinHp = enemyHp(5) * 30;                     // 420
    const ev: GameEvent[] = [];
    // 웨이브 5가 끝나는 순간(웨이브 6 준비 진입) 루프 종료 — 다음 웨이브로 오염 방지
    for (let t = 0; t < 120 && s.wave === 5 && s.phase !== 'defeat'; t += DT) {
      stepGame(s, DT, ev, () => bossFile / 8);
      ev.length = 0;
      const boss = s.enemies.find(e => e.isBoss);
      if (boss) {
        bossMinHp = Math.min(bossMinHp, boss.hp);
        const wantRank = enemySquare(boss).rank - 1;     // 보스 바로 아랫랭크로 폰 유지 (완벽 추격)
        for (const p of [left, right]) {
          if (p.square && p.square.rank !== wantRank && wantRank >= 1) {
            moveOnBoard(s, p.id, p.square.file, wantRank, []);
          }
        }
      }
    }

    const killed = s.stats.totalKills === 1;
    const dealt = killed ? 420 : 420 - bossMinHp;
    // 완벽 추격 상한 추정: 폰 2×168 + 룩 80 + 비숍 12 = 428 vs 보스 420 → 아슬아슬한 처치권
    console.log(`[밸런스 리포트] 웨이브5 보스(420): ${killed ? '처치 성공' : `누수 — 총 피해 ${dealt}`}`);
    console.log('  → 스펙 9.4의 "폰 3개로 처치"는 기하학상 불가(한 칸 동시 타격 폰 최대 2개). 9.5 플레이테스트 항목으로 이관.');
    // 엔진 검증 목적의 단언 (밸런스 수치 자체는 단언하지 않음)
    expect(s.wave).toBe(6);                              // 처치든 누수든 웨이브는 종료된다 (스펙 4.2)
    expect(s.hp).toBe(killed ? 30 : 25);                 // 누수 시 보스 -5
    expect(dealt).toBeGreaterThan(300);                  // 추격 메커니즘이 실제로 동작했는지 하한 확인
  });
});
```

- [ ] **Step 2: 실행 및 리포트 확인**

Run: `npx vitest run tests/simulation.test.ts`
Expected: PASS + 콘솔에 웨이브 5 보스 실측 리포트 출력. `npm test` 전체 PASS, `npm run build` 성공

- [ ] **Step 3: 수동 플레이테스트 체크리스트 (스펙 9.5)**

`npm run dev`로 실제 1회 플레이하며 확인 (결과는 커밋 메시지나 이슈로 기록):
1. 보스전 폰 추격이 "긴장감 있는 미세 조작"인지 (클릭-투-무브 응답성 포함)
2. 재배치 활용 시 일반 웨이브 난이도 체감
3. 후반(16~19웨이브) 체력 스케일링 체감
4. 웨이브 5 첫 보스의 관문 역할 (검토 노트 1의 밸런스 이슈 확인 — 필요시 `config.ts`의 `bossHpMultiplier` 하향 제안)

- [ ] **Step 4: Commit**

```bash
git add tests/simulation.test.ts
git commit -m "test: 전 게임 시뮬레이션과 보스 추격 밸런스 리포트"
```

---

## 완료 기준

- `npm test` 전체 PASS (단위 + 통합 + 시뮬레이션)
- `npm run build` 성공 (tsc strict 포함)
- 수동 검증: Task 7/14/15/16/17/18/19의 체크리스트 전부 확인
- 스펙 §1~§10의 모든 확정 수치·규칙이 구현에 반영됨 (밸런스 수치는 전부 `config.ts` 경유)

## 실행 방법

이 계획은 태스크 단위로 독립 실행 가능하다. 두 가지 방식 중 선택:

1. **Subagent-Driven (권장)** — `superpowers:subagent-driven-development` 스킬로 태스크마다 새 서브에이전트를 파견하고 사이사이 리뷰
2. **Inline 실행** — `superpowers:executing-plans` 스킬로 현재 세션에서 배치 실행 + 체크포인트 리뷰

---

## 실행 중 변경 사항 (계획 대비 편차)

최종 전수 리뷰 시점 기준으로, 실제 구현이 아래 계획 대비 편차를 포함한다. 실행 담당자(controller)가
그때그때 승인한 추가 사항이며, 다음 사람이 저장소와 계획서를 비교할 때 헷갈리지 않도록 여기 기록한다.
계획 본문(파일 구조 §, 각 태스크)은 원안 그대로 두고 고치지 않는다.

- **`happy-dom` devDependency 추가.** 계획에는 없던 항목. 브라우저 시각적 검증(수동 클릭/드래그
  확인)은 자율 구현자(headless) 환경에서 원천적으로 불가능하므로, DOM을 요구하는 UI 동작(드래그
  컨트롤러, 배너/결과 화면, 컨트롤 배선, 툴팁 등)을 헤드리스로 자동 검증하기 위해 도입했다. 필요한
  테스트 파일에만 `// @vitest-environment happy-dom` 주석으로 개별 적용한다.
- **`src/ui/controls.ts` 추출.** 계획의 파일 구조에는 없던 파일. 일시정지/배속 2x/탭 이탈 자동
  일시정지 배선(Task 16)을 `main.ts`에서 분리해 `wireControls(layout, state)` 형태의 순수 배선
  함수로 뽑아, 다른 `ui/wireX` 모듈들과 동일한 패턴으로 헤드리스 테스트가 가능하게 했다.
- **`createFrameView`(renderer.ts) / `canvasStub.ts`(tests/) 추출.** 둘 다 계획에 없던 테스트
  인프라. `createFrameView`는 매 프레임 `EMPTY_VIEW`와 참조를 공유하지 않는 새 `ViewState`를
  만드는 헬퍼(Task 17 리뷰에서 참조 공유 버그를 고치며 도입). `canvasStub.ts`는
  `CanvasRenderingContext2D`의 기록용 스텁을 `renderer.test.ts`와 `effects.test.ts`가 공유하도록
  뽑아낸 공용 테스트 헬퍼다.
- **실제 테스트 파일 목록.** 계획의 파일 구조 §는 14개 테스트 파일만 나열하지만, 실행 중 다음
  9개가 추가로 생겼다: `banners.test.ts`, `controls.test.ts`, `effects.test.ts`,
  `highlights.test.ts`, `renderer.test.ts`, `smoke.test.ts`, `tooltip.test.ts`, `ui.test.ts`,
  `canvasStub.ts`(테스트 헬퍼). 최종 테스트 디렉터리는 `helpers.ts`/`canvasStub.ts` 2개 헬퍼 +
  22개 `*.test.ts` 파일이다.
- **계획 결함 1 — 부동소수점 쿨다운 버그.** `updateCombat`이 매 틱 `p.cooldown -= dt`로 감산하는
  구조는 계획대로 구현했으나, 반복 감산 시 `~1e-16` 수준의 잔차가 남아 쿨다운이 정확히 0에
  도달하지 못해 발사가 한 틱 밀리는 결함이 실측으로 드러났다 (`src/core/combat.ts`의
  `COOLDOWN_EPS`로 수정, 커밋 `7b7e145`). 계획서 자체는 이 부동소수점 오차를 예상하지 못했다.
- **계획 결함 2 — `buff.ts` 문서 주석 오류.** "퀸 자신의 칸도 커버리지에 포함되지만 자기 자신에
  대한 공격이 없어 실효가 없다"는 서술이 계획과 구현 문서 주석 양쪽에 있었으나, 실제 코드
  (`recalcQueenBuffs`의 `if (p === q) continue`)는 퀸 자신을 애초에 순회 대상에서 제외한다 —
  "포함되지만 무해함"이 아니라 "제외됨"이다. 최종 리뷰(Item 5)에서 발견해 `src/core/buff.ts`의
  docstring만 수정했다.

