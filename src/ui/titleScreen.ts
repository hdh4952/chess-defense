import { CONFIG } from '../config';
import { sellPrice } from '../core/economy';
import { attackTargets, knightMoves, queenLines } from '../core/patterns';
import { ALLY_SPRITE_URL } from '../render/sprites';
import type { PieceType, Square } from '../types';
import { CREDIT_HTML, PIECE_NAME } from './layout';

/**
 * 시작 화면 — 위쪽 기물 설명 탭 + 아래쪽 BATTLE 버튼. 이 화면이 떠 있는 동안에는 게임이 아직
 * 부팅되지 않는다: 캔버스도, 프레임 루프도, AudioContext도 BATTLE을 누른 뒤에야 만들어진다
 * (main.ts의 startGame 참고).
 *
 * 설계 원칙 하나: 여기 적히는 수치와 사거리 그림은 전부 실제 게임 코드에서 파생시킨다
 * (CONFIG.pieces / sellPrice / patterns.ts). 밸런스를 바꿨을 때 설명만 옛날 값으로 남는 —
 * 튜토리얼 화면이 흔히 썩는 방식 — 일이 구조적으로 불가능해진다. 이 파일이 직접 소유하는
 * 텍스트는 코드로 표현할 수 없는 것(속성 이름·역할·산문 설명)뿐이다.
 */

const TAB_ORDER: PieceType[] = ['pawn', 'knight', 'bishop', 'rook', 'queen'];

/** 사거리 그림의 기준 칸과 창 반경. 8×8 좌표계(file 0~7, rank 1~8)의 한가운데를 골라
 * 5×5 창(file 1~5, rank 2~6)이 보드 밖으로 잘리지 않게 한다 — 잘리면 "여기서 사거리가 끝난다"는
 * 잘못된 인상을 준다. 테스트가 기대값을 직접 계산할 수 있도록 export한다. */
export const RANGE_CENTER: Square = { file: 3, rank: 4 };
export const RANGE_RADIUS = 2;

interface Blurb { element: string; role: string; detail: string }

const BLURB: Record<PieceType, Blurb> = {
  pawn: {
    element: '노말', role: '초반 주력 · 보스 추격',
    detail: '전방 대각선 1칸씩 두 곳을 동시에 때린다. 폰 하나가 두 파일을 커버하므로 '
      + '가장 싸게 방어선을 넓힐 수 있다.',
  },
  knight: {
    element: '불', role: '수동 조작 광역 버스트',
    detail: '자동 공격이 없다. 대신 배치하거나 L자로 움직일 때마다 주변 9칸이 폭발한다 — '
      + '화력이 오직 플레이어의 조작 속도로만 제한된다.',
  },
  bishop: {
    element: '빛', role: '전역 광역 딜러',
    detail: '대각선 4방향을 보드 끝까지 관통 공격한다. 기물도 적도 광선을 막지 못한다.',
  },
  rook: {
    element: '땅', role: '단일 파일 전담 킬러',
    detail: '가로·세로 4방향을 보드 끝까지 관통 공격한다. 자신이 선 파일로 내려오는 적을 도맡는다.',
  },
  queen: {
    element: '오라', role: '공격력 ×2 버퍼',
    detail: '스스로는 공격하지 않는다. 8방향 직선 위의 아군 기물의 기본 공격력을 두 배로 올리며, '
      + '여러 퀸의 라인이 겹치면 배율이 한 단계씩 더 쌓인다.',
  },
};

/** 공격 주기 표기. tooltip.ts와 같은 규칙 — 나이트의 interval이 0(현재 설정: 쿨다운 폐지)이면
 * "0초"라는 거짓 정보 대신 그 사실을 그대로 적고, config 값을 되돌리면 문구도 자동 복원된다. */
function intervalLabel(type: PieceType): string {
  const { interval } = CONFIG.pieces[type];
  if (type === 'queen') return '—';
  if (type === 'knight') return interval > 0 ? `이동 쿨다운 ${interval}초` : '이동할 때마다 (쿨다운 없음)';
  return `${interval}초`;
}

function damageLabel(type: PieceType): string {
  return type === 'queen' ? '— (공격하지 않음)' : String(CONFIG.pieces[type].damage);
}

/** 사거리 그림의 범례. 칠해진 칸이 무엇을 뜻하는지는 기물마다 다르다 — 나이트만 두 가지
 * 표시(폭발 범위 + L자 이동칸)를 겹쳐 쓰고, 퀸의 칸은 공격이 아니라 버프가 닿는 범위다. */
const RANGE_LEGEND: Record<PieceType, string> = {
  pawn: '칠해진 칸 = 공격 범위',
  knight: '칠해진 칸 = 폭발 범위 · 점선 = L자 이동',
  bishop: '칠해진 칸 = 공격 범위 (보드 끝까지)',
  rook: '칠해진 칸 = 공격 범위 (보드 끝까지)',
  queen: '칠해진 칸 = 버프 범위 (보드 끝까지)',
};

const squareKey = (s: Square): string => `${s.file},${s.rank}`;

/** 사거리 미리보기 — 실제 공격 패턴 함수를 그대로 호출한다 (설명과 게임 규칙의 단일 출처).
 * 퀸은 attackTargets가 빈 배열이므로(공격이 없다) 버프 라인인 queenLines를 보여준다. */
function rangeSquares(type: PieceType): { targets: Set<string>; moves: Set<string> } {
  const attack = type === 'queen' ? queenLines(RANGE_CENTER) : attackTargets(type, RANGE_CENTER);
  const move = type === 'knight' ? knightMoves(RANGE_CENTER) : [];
  return { targets: new Set(attack.map(squareKey)), moves: new Set(move.map(squareKey)) };
}

function buildRangeBoard(type: PieceType): HTMLElement {
  const { targets, moves } = rangeSquares(type);
  const board = document.createElement('div');
  board.className = 'range-board';
  // rank는 위로 갈수록 커진다 — 보드와 같은 방향으로 그려야 폰이 "적 쪽(위)"을 친다는 게 보인다.
  for (let rank = RANGE_CENTER.rank + RANGE_RADIUS; rank >= RANGE_CENTER.rank - RANGE_RADIUS; rank--) {
    for (let file = RANGE_CENTER.file - RANGE_RADIUS; file <= RANGE_CENTER.file + RANGE_RADIUS; file++) {
      const cell = document.createElement('div');
      cell.className = 'range-cell';
      cell.dataset.file = String(file);
      cell.dataset.rank = String(rank);
      const key = squareKey({ file, rank });
      if (targets.has(key)) cell.classList.add('is-target');
      if (moves.has(key)) cell.classList.add('is-move');
      if (file === RANGE_CENTER.file && rank === RANGE_CENTER.rank) {
        cell.classList.add('is-self');
        cell.innerHTML =
          `<img class="piece-icon range-icon" src="${ALLY_SPRITE_URL[type]}" alt="" draggable="false">`;
      }
      board.appendChild(cell);
    }
  }
  return board;
}

function buildPanel(type: PieceType): HTMLElement {
  const def = CONFIG.pieces[type];
  const blurb = BLURB[type];
  const panel = document.createElement('section');
  panel.className = 'title-panel';
  panel.dataset.pieceType = type;
  panel.setAttribute('role', 'tabpanel');
  panel.innerHTML = `
    <div class="panel-head">
      <img class="piece-icon panel-icon" src="${ALLY_SPRITE_URL[type]}" alt="" draggable="false">
      <div>
        <h2>${PIECE_NAME[type]}</h2>
        <p class="panel-role">${blurb.role}</p>
      </div>
      <p class="panel-price">${def.cost}G<br><small>판매 ${sellPrice(type)}G</small></p>
    </div>
    <div class="panel-body">
      <div class="panel-range">
        <p class="range-legend">${RANGE_LEGEND[type]}</p>
      </div>
      <div class="panel-facts">
        <dl>
          <dt>공격력</dt><dd>${damageLabel(type)}</dd>
          <dt>공격 주기</dt><dd>${intervalLabel(type)}</dd>
          <dt>속성</dt><dd>${blurb.element}</dd>
        </dl>
        <p class="panel-detail">${blurb.detail}</p>
      </div>
    </div>`;
  panel.querySelector('.panel-range')!.prepend(buildRangeBoard(type));   // 범례는 그림 아래에 둔다
  return panel;
}

/**
 * 시작 화면을 app에 그린다. BATTLE을 누르면 onBattle이 호출되고, 그때 호출부가 app을 게임
 * 화면으로 통째로 갈아끼운다(createLayout이 innerHTML을 덮어쓰므로 별도 정리는 필요 없다).
 */
export function createTitleScreen(app: HTMLElement, onBattle: () => void): void {
  app.innerHTML = `
    <div id="title">
      <header id="title-head">
        <h1>체스 디펜스</h1>
        <p>체스 기물의 행마법이 그대로 공격 패턴이 되는 실시간 디펜스</p>
      </header>
      <div id="title-guide">
        <div id="title-tabs" role="tablist" aria-label="기물 설명"></div>
        <div id="title-panels"></div>
      </div>
      <div id="title-foot">
        <button id="battle">BATTLE</button>
        <p id="title-hint">기물을 사서 보드로 드래그하면 자동으로 싸운다. 웨이브 중에도 자유롭게 옮길 수 있다.</p>
      </div>
      ${CREDIT_HTML}
    </div>`;

  const tabBar = app.querySelector<HTMLElement>('#title-tabs')!;
  const panelBox = app.querySelector<HTMLElement>('#title-panels')!;
  const tabs = new Map<PieceType, HTMLButtonElement>();
  const panels = new Map<PieceType, HTMLElement>();

  const select = (chosen: PieceType): void => {
    for (const type of TAB_ORDER) {
      const active = type === chosen;
      tabs.get(type)!.setAttribute('aria-selected', String(active));
      panels.get(type)!.hidden = !active;
    }
  };

  for (const type of TAB_ORDER) {
    const tab = document.createElement('button');
    tab.className = 'title-tab';
    tab.dataset.pieceType = type;
    tab.setAttribute('role', 'tab');
    // alt=""(장식용): 아이콘 바로 옆에 같은 이름이 텍스트로 있다 — layout.ts 상점 버튼과 같은 이유.
    tab.innerHTML =
      `<img class="piece-icon tab-icon" src="${ALLY_SPRITE_URL[type]}" alt="" draggable="false">`
      + `<span>${PIECE_NAME[type]}</span>`;
    tab.addEventListener('click', () => select(type));
    tabBar.appendChild(tab);
    tabs.set(type, tab);

    const panel = buildPanel(type);
    panelBox.appendChild(panel);
    panels.set(type, panel);
  }

  select(TAB_ORDER[0]);
  app.querySelector<HTMLButtonElement>('#battle')!.addEventListener('click', () => onBattle());
}
