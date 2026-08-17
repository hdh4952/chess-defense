import { CONFIG, TRAITS, slowPercent, tierMultiplier } from '../config';
import { sellPrice } from '../core/economy';
import { attackTargets, queenLines, slowTargets } from '../core/patterns';
import { ALLY_SPRITE_URL } from '../render/sprites';
import { tierRingColor } from '../render/tiers';
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

/** 설명 탭 순서. 상점과 달리 **융합물도 보여준다** — 이 화면이 그 기물들을 배울 유일한
 *  자리이고, 만들 수 없는 기물을 숨기면 존재 자체를 모르게 된다. */
const TAB_ORDER: PieceType[] = Object.keys(TRAITS) as PieceType[];

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
    element: '얼음', role: '감속 · 시간 벌기',
    detail: '공격하지 않는다. 대신 L자 행마로 닿는 8칸에 들어온 적을 30% 느리게 만든다. '
      + '적이 그 칸에 있는 동안 계속 걸리고, 벗어나면 풀린다. 8랭크(적이 나오는 줄)에도 걸리므로 '
      + '판에 들어오는 순간부터 늦출 수 있다. 여러 기가 같은 칸을 덮어도 30%는 그대로이고 '
      + '합성해도 늘지 않는다 — 나이트는 강화하는 기물이 아니라 넓게 까는 기물이다.',
  },
  bishop: {
    element: '빛', role: '골드 생산 · 전역 광역',
    detail: '대각선 4방향을 보드 끝까지 관통 공격한다. 기물도 적도 광선을 막지 못한다. '
      + '공격력은 가장 낮은 대신 광선을 쏠 때마다 골드를 번다 — 몇 마리를 맞히든 잡든 액수는 '
      + '같고, 사거리에 적이 없으면 쏘지 않으니 벌지도 못한다. 적이 오래 머무는 자리에 둘수록 '
      + '많이 번다.',
  },
  rook: {
    element: '땅', role: '단일 파일 전담 킬러',
    detail: '가로·세로 4방향을 보드 끝까지 관통 공격한다. 자신이 선 파일로 내려오는 적을 도맡는다.',
  },
  // ── 융합 기물. 여기 산문이 이 기물들의 **가치 명제**를 전달하는 유일한 자리다.
  // 수치만 보면(공격력 8 / 주기 3.0) 플레이어는 챈슬러를 룩과 같다고 읽고 만들지 않는다.
  // 동종 합성이 화력을 "압축"한다면 이종 융합은 역할을 "겸업"시킨다는 것이 핵심이다.
  archbishop: {
    element: '빛+얼음', role: '경제 + 감속',
    detail: '비숍과 나이트를 합친 기물. 대각선을 관통하며 골드를 벌고, 동시에 L자 8칸의 적을 '
      + '30% 늦춘다. 느려진 적은 대각선 위에 더 오래 머무르므로 비숍의 수입도 함께 늘어난다 — '
      + '두 능력이 서로를 돕는 유일한 조합이다.',
  },
  chancellor: {
    element: '땅+얼음', role: '주력 딜러 + 감속',
    detail: '룩과 나이트를 합친 기물. 가로·세로를 관통하는 자동 공격과 L자 8칸 감속을 한 몸에 '
      + '가진다. 공격력만 보면 룩 둘과 같지만, 룩 둘은 적을 늦추지 못한다 — 느려진 적은 자기 '
      + '파일 안에 더 오래 머물러 같은 화력으로 더 많이 맞는다.',
  },
  amazon: {
    element: '오라+얼음', role: '버퍼 + 감속',
    detail: '퀸과 나이트를 합친 기물. 8방향 라인 버프를 유지하면서 L자 8칸의 적을 30% 늦춘다 — '
      + '아군의 화력을 올리는 동시에 적이 그 화력 안에 머무는 시간을 늘린다. 다만 버프 계수는 '
      + '퀸의 절반이다: 퀸의 강화는 보드 전체의 화력에 곱해지므로, 버프를 겸하는 기물이 늘면 '
      + '그 배율이 곱으로 겹친다.',
  },
  queen: {
    element: '오라', role: '공격력 배율 버퍼',
    detail: '스스로는 공격하지 않는다. 8방향 직선 위의 아군 기물의 공격력을 두 배로 올리며, '
      + '여러 퀸의 라인이 겹치면 그만큼 더 쌓인다. 합성하면 올려 주는 양 자체가 두 배가 된다 — '
      + '퀸의 강화는 자기 화력이 아니라 보드 전체의 화력에 곱해진다.',
  },
};

/** 공격 주기 표기. v1.10부터 interval의 뜻이 하나뿐이라(주기 공격) 규칙이 단순해졌다 —
 * 주기 공격이 없으면 표시할 주기도 없다. 감속은 주기가 아니라 지속이므로 여기 오지 않는다. */
function intervalLabel(type: PieceType): string {
  if (TRAITS[type].pattern === 'none') return '—';
  return `${CONFIG.pieces[type].interval}초`;
}

/** 감속 줄. 능력이 있는 기물에만 만든다 — 나머지에 "감속 없음"을 적어 봐야 정보가 없다. */
function slowRow(type: PieceType): string {
  return TRAITS[type].slow
    ? `<dt>감속</dt><dd>L자 8칸 −${slowPercent()}% (지속 · 중첩·강화 없음)</dd>`
    : '';
}

function damageLabel(type: PieceType): string {
  return CONFIG.pieces[type].damage === 0 ? '— (공격하지 않음)' : String(CONFIG.pieces[type].damage);
}

/** 골드 수입 줄. 버는 기물에만 줄을 만든다 — 나머지에 "공격당 +0G"를 적어 봐야 정보가 없다
 * (tooltip.ts와 같은 규칙). config에서 다른 기물에 값을 주면 그 탭에도 자동으로 나타난다. */
function goldRow(type: PieceType): string {
  const { goldPerAttack } = CONFIG.pieces[type];
  return goldPerAttack > 0 ? `<dt>골드</dt><dd>공격 1회당 +${goldPerAttack}G</dd>` : '';
}

/** 사거리 그림의 범례. 칠해진 칸이 무엇을 뜻하는지는 기물마다 다르다 — 주황은 공격,
 * 파랑은 버프, **얼음색은 감속**이다.
 * ⚠️ v1.11에서 "점선 = L자 이동" 표시가 사라졌다. 모든 기물이 아무 칸으로나 재배치되므로
 * 기물별로 알려줄 이동 규칙이 없다 — 나이트의 L자는 이제 감속 범위에만 남아 있다. */
const RANGE_LEGEND: Record<PieceType, string> = {
  pawn: '칠해진 칸 = 공격 범위',
  knight: '얼음 칸 = 감속 범위 (8랭크 포함) · 공격은 하지 않는다',
  bishop: '칠해진 칸 = 공격 범위 (보드 끝까지)',
  rook: '칠해진 칸 = 공격 범위 (보드 끝까지)',
  queen: '칠해진 칸 = 버프 범위 (보드 끝까지)',
  archbishop: '주황 = 공격 범위 · 얼음 = 감속 범위',
  chancellor: '주황 = 공격 범위 · 얼음 = 감속 범위',
  amazon: '파랑 = 버프 범위 · 얼음 = 감속 범위',
};

const squareKey = (s: Square): string => `${s.file},${s.rank}`;

/** 사거리 미리보기 — 실제 공격 패턴 함수를 그대로 호출한다 (설명과 게임 규칙의 단일 출처).
 * 퀸은 attackTargets가 빈 배열이므로(공격이 없다) 버프 라인인 queenLines를 보여준다. */
function rangeSquares(type: PieceType): { targets: Set<string>; slows: Set<string> } {
  const t = TRAITS[type];
  // ★ 감속을 공격 사거리와 **합치지 않는다.** 예전에는 폭발 범위를 사거리에 합집합으로 얹었는데,
  // 그때는 둘 다 "여기 있으면 맞는다"라 같은 색이 맞았다. 감속은 피해를 주지 않으므로 같은
  // 색으로 칠하면 거짓말이 된다 — 특히 나이트는 이제 공격력이 0이다.
  const attack = t.buffFactor > 0 ? queenLines(RANGE_CENTER) : attackTargets(type, RANGE_CENTER);
  return {
    targets: new Set(attack.map(squareKey)),
    slows: new Set(slowTargets(type, RANGE_CENTER).map(squareKey)),
  };
}

function buildRangeBoard(type: PieceType): HTMLElement {
  const { targets, slows } = rangeSquares(type);
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
      if (slows.has(key)) cell.classList.add('is-slow');
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

/**
 * 합성 설명 — 이 기물이 몇 단계까지 강화되는지와 그 의미. maxTier와 색 표는 전부 CONFIG/
 * render/tiers.ts에서 유도하므로, 상한이나 팔레트를 바꾸면 이 문구도 함께 따라온다.
 */
function mergeRow(type: PieceType): string {
  const max = CONFIG.merge.maxTier[type];
  const swatches = Array.from({ length: max }, (_, i) => {
    const color = tierRingColor(i + 1);
    const style = color
      ? `background:${color}`
      : 'background:transparent;border:1px dashed currentColor';
    return `<i class="tier-dot" style="${style}"></i>`;
  }).join('');
  const top = tierMultiplier(max);
  return `<dt>합성</dt><dd>같은 단계끼리 · 최대 ${max}단계(×${top})`
    + `<span class="tier-dots">${swatches}</span></dd>`;
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
          ${slowRow(type)}
          ${goldRow(type)}
          ${mergeRow(type)}
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
        <p id="title-hint">기물을 사서 보드로 드래그하면 자동으로 싸운다. 웨이브 중에도 자유롭게 옮길 수 있다.<br>
        <b>같은 종류·같은 단계</b> 기물 위로 드래그해 겹치면 <b>합성</b>된다 — 능력치가 두 기물의 합이 되고 테두리 색이 한 단계 오른다.</p>
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
