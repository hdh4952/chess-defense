import { CONFIG, DIFFICULTIES, TRAITS, slowPercent, tierMultiplier } from '../config';
import { sellPrice } from '../core/economy';
import {
  DIFFICULTY_NAME, difficultyDetail, selectedDifficulty, setDifficulty,
} from '../difficulty';
import { attackTargets, queenLines, slowTargets } from '../core/patterns';
import {
  allySpriteUrl, isSkinUnlocked, selectedSkinId, setSkin, skinsFor, unlockLabel,
} from '../render/skins';
import { tierRingColor } from '../render/tiers';
import type { Difficulty, PieceType, Square } from '../types';
import { CREDIT_HTML, PIECE_NAME } from './layout';

/**
 * 시작 화면 — 위쪽 기물 설명 탭 + 아래쪽 BATTLE 버튼. 이 화면이 떠 있는 동안에는 게임이 아직
 * 부팅되지 않는다: 캔버스도, 프레임 루프도, AudioContext도 BATTLE을 누른 뒤에야 만들어진다
 * (main.ts의 startGame 참고).
 *
 * 설계 원칙 하나: 여기 적히는 수치와 사거리 그림은 전부 실제 게임 코드에서 파생시킨다
 * (CONFIG.pieces / sellPrice / patterns.ts). 밸런스를 바꿨을 때 설명만 옛날 값으로 남는 —
 * 튜토리얼 화면이 흔히 썩는 방식 — 일이 구조적으로 불가능해진다. 이 파일이 직접 소유하는
 * 텍스트는 코드로 표현할 수 없는 것(역할·산문 설명)뿐이다.
 */

/** 설명 탭 순서. 상점과 달리 **융합물도 보여준다** — 이 화면이 그 기물들을 배울 유일한
 *  자리이고, 만들 수 없는 기물을 숨기면 존재 자체를 모르게 된다. */
const TAB_ORDER: PieceType[] = Object.keys(TRAITS) as PieceType[];

/** 사거리 그림의 기준 칸과 창 반경. 8×8 좌표계(file 0~7, rank 1~8)의 한가운데를 골라
 * 5×5 창(file 1~5, rank 2~6)이 보드 밖으로 잘리지 않게 한다 — 잘리면 "여기서 사거리가 끝난다"는
 * 잘못된 인상을 준다. 테스트가 기대값을 직접 계산할 수 있도록 export한다. */
export const RANGE_CENTER: Square = { file: 3, rank: 4 };
export const RANGE_RADIUS = 2;

/**
 * ⚠️ **v1.34에서 `element`(속성)가 사라졌다.** 노말/얼음/빛/땅/오라 같은 이름을 공격력·주기와
 * 나란히 노출했지만 **기계적 효과가 하나도 없었다** — 전투·경제 어디에도 그 값을 읽는 코드가
 * 없다(문서도 "순수한 플레이버"라고 적어 두고 있었다). 사용자 판단으로 제거한다.
 *
 * 규칙과 무관한 이름이 규칙표 한가운데 앉아 있으면 **읽는 사람이 그것을 규칙으로 오해한다** —
 * "빛 속성이라 뭔가 다른 게 있나?"를 확인할 방법이 화면에 없다. 공격 이펙트의 색·형태
 * (룩=갈색 균열, 비숍=금빛 광선)는 그대로다: 그것은 이름 붙은 체계가 아니라 **연출의 결**이다.
 */
interface Blurb { role: string; detail: string }

const BLURB: Record<PieceType, Blurb> = {
  pawn: {
    role: '초반 주력 · 보스 추격',
    detail: '전방 대각선 1칸씩 두 곳을 동시에 때린다. 폰 하나가 두 파일을 커버하므로 '
      + '가장 싸게 방어선을 넓힐 수 있다.',
  },
  knight: {
    role: '감속 · 시간 벌기',
    detail: '공격하지 않는다. 대신 L자 행마로 닿는 8칸에 들어온 적을 느리게 만든다. '
      + '적이 그 칸에 있는 동안 계속 걸리고, 벗어나면 풀린다. 8랭크(적이 나오는 줄)에도 걸리므로 '
      + '판에 들어오는 순간부터 늦출 수 있다. 여러 기가 같은 칸을 덮어도 가장 센 하나만 적용되지만, '
      + '합성하면 감속 자체가 커진다 — 넓게 깔 것인가 깊게 세울 것인가가 이 기물의 선택이다.',
  },
  bishop: {
    role: '골드 생산 · 전역 광역',
    detail: '대각선 4방향을 보드 끝까지 관통 공격한다. 기물도 적도 광선을 막지 못한다. '
      + '공격력은 가장 낮은 대신 광선을 쏠 때마다 골드를 번다 — 몇 마리를 맞히든 잡든 액수는 '
      + '같고, 사거리에 적이 없으면 쏘지 않으니 벌지도 못한다. 적이 오래 머무는 자리에 둘수록 '
      + '많이 번다.',
  },
  rook: {
    role: '단일 파일 전담 킬러',
    detail: '가로·세로 4방향을 보드 끝까지 관통 공격한다. 자신이 선 파일로 내려오는 적을 도맡는다.',
  },
  // ── 융합 기물. 여기 산문이 이 기물들의 **가치 명제**를 전달하는 유일한 자리다.
  // 수치만 보면(공격력 8 / 주기 3.0) 플레이어는 챈슬러를 룩과 같다고 읽고 만들지 않는다.
  // 동종 합성이 화력을 "압축"한다면 이종 융합은 역할을 "겸업"시킨다는 것이 핵심이다.
  archbishop: {
    role: '경제 + 감속',
    detail: '비숍과 나이트를 합친 기물. 대각선을 관통하며 골드를 벌고, 동시에 L자 8칸의 적을 '
      + '30% 늦춘다. 느려진 적은 대각선 위에 더 오래 머무르므로 비숍의 수입도 함께 늘어난다 — '
      + '두 능력이 서로를 돕는 유일한 조합이다.',
  },
  chancellor: {
    role: '주력 딜러 + 감속',
    detail: '룩과 나이트를 합친 기물. 가로·세로를 관통하는 자동 공격과 L자 8칸 감속을 한 몸에 '
      + '가진다. 공격력만 보면 룩 둘과 같지만, 룩 둘은 적을 늦추지 못한다 — 느려진 적은 자기 '
      + '파일 안에 더 오래 머물러 같은 화력으로 더 많이 맞는다.',
  },
  amazon: {
    role: '버퍼 + 감속',
    detail: '퀸과 나이트를 합친 기물. 8방향 라인 버프를 유지하면서 L자 8칸의 적을 30% 늦춘다 — '
      + '아군의 화력을 올리는 동시에 적이 그 화력 안에 머무는 시간을 늘린다. 다만 버프 계수는 '
      + '퀸의 절반이다: 퀸의 강화는 보드 전체의 화력에 곱해지므로, 버프를 겸하는 기물이 늘면 '
      + '그 배율이 곱으로 겹친다.',
  },
  queen: {
    role: '공격력 배율 버퍼',
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
    ? `<dt>감속</dt><dd>L자 8칸 −${slowPercent()}% · 합성 1단계마다 `
      + `−${slowPercent(2) - slowPercent()}%p (최대 −${slowPercent(CONFIG.merge.maxTier[type])}%)`
      + '<br><small>겹쳐 놓아도 중첩되지 않는다</small></dd>'
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
          `<img class="piece-icon range-icon" data-piece-icon="${type}" `
          + `src="${allySpriteUrl(type)}" alt="" draggable="false">`;
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

/**
 * 스킨 선택 UI — 패널 머리(panel-head)에 놓이는 썸네일 줄 (v1.19).
 *
 * **스킨이 하나뿐인 기물에는 아무것도 그리지 않는다.** 고를 것이 없는데 버튼 한 칸을 띄우면
 * "이 기물은 스킨이 잠겨 있다"는 잘못된 인상을 주고, 패널 머리에 의미 없는 여백만 남는다.
 * 스킨을 추가하면(render/skins.ts에 한 줄) 그 기물 패널에 저절로 나타난다.
 *
 * ★ **잠긴 스킨은 숨기지 않고 잠긴 채로 보여준다** (해금 조건 도입, v1.19). 이 화면이 기물 탭을
 * 8개 두는 이유와 같다 — **만들 수 없는 기물을 숨기면 존재 자체를 모르게 된다.** 해금 조건은
 * 목표가 되어야 의미가 있고, 목표는 보여야 목표다. 그래서 조건 문구까지 함께 적는다.
 *
 * 라디오 그룹 대신 aria-pressed 토글 버튼을 쓴다 — role="radio"는 화살표 키 이동(로빙
 * tabindex)까지 갖춰야 약속을 지키는 것이고, 이 저장소의 다른 상태 버튼(음소거)도 이미
 * aria-pressed다. 선택 상태의 표현을 한 어휘로 통일한다.
 */
function skinPicker(type: PieceType): string {
  const skins = skinsFor(type);
  if (skins.length < 2) return '';
  const chosen = selectedSkinId(type);
  const buttons = skins.map(skin => {
    const locked = !isSkinUnlocked(skin);
    // 라벨은 버튼에 붙인다(이미지는 alt=""로 장식 처리) — 스크린 리더가 "폰 하트 프린세스 스킨,
    // 선택됨"으로 한 번에 읽는다. ★ 잠겨 있으면 **조건까지 그 라벨 안에** 넣는다: 자물쇠 그림만
    // 읽어 주면 "왜 못 쓰는지"를 눈으로 볼 수 없는 사용자에게는 정보가 하나도 전달되지 않는다.
    const label = locked
      ? `${PIECE_NAME[type]} ${skin.name} 스킨 — 잠김 · ${unlockLabel(skin)}`
      : `${PIECE_NAME[type]} ${skin.name} 스킨`;
    // ⚠️ disabled가 아니라 aria-disabled를 쓴다. disabled는 포커스와 title 툴팁을 함께 잃어
    // "왜 못 쓰는지"를 알려줄 두 경로가 동시에 막힌다 — 잠긴 것은 **읽을 수 있어야** 한다.
    return `<button type="button" class="skin-swatch${locked ? ' is-locked' : ''}" `
      + `data-piece-type="${type}" data-skin-id="${skin.id}" `
      + `aria-pressed="${skin.id === chosen}" aria-disabled="${locked}" `
      + `aria-label="${label}" title="${locked ? unlockLabel(skin) : skin.name}">`
      + `<img class="piece-icon" src="${skin.url}" alt="" draggable="false">`
      + (locked ? '<span class="skin-lock" aria-hidden="true">🔒</span>' : '')
      + '</button>';
  }).join('');
  // 조건 문구는 잠긴 것이 있을 때만. 다 열려 있으면 적을 말이 없다.
  const pending = skins.map(unlockLabel).find(Boolean);
  const hint = pending ? `<span class="skin-hint">🔒 ${pending}</span>` : '';
  return `<div class="panel-skins"><span class="skin-label">스킨</span>${buttons}${hint}</div>`;
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
      <img class="piece-icon panel-icon" data-piece-icon="${type}"
           src="${allySpriteUrl(type)}" alt="" draggable="false">
      <div>
        <h2>${PIECE_NAME[type]}</h2>
        <p class="panel-role">${blurb.role}</p>
      </div>
      ${skinPicker(type)}
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
        </dl>
        <p class="panel-detail">${blurb.detail}</p>
      </div>
    </div>`;
  panel.querySelector('.panel-range')!.prepend(buildRangeBoard(type));   // 범례는 그림 아래에 둔다
  return panel;
}

/**
 * 난이도 드롭다운 (v1.20) — BATTLE 버튼 **왼쪽**에 놓인다 (사용자 결정).
 *
 * ★ 목록도 문구도 전부 유도한다: 난이도는 `DIFFICULTIES`(=CONFIG.difficulty의 키)에서,
 * 배수 설명은 `difficultyDetail`에서 온다. 난이도를 하나 더 넣거나 배수를 조정해도 이 함수는
 * 그대로다 — 이 화면의 다른 모든 수치가 코드에서 유도되는 것과 같은 규칙이다.
 *
 * 탭·스킨과 달리 여기서는 버튼이 아니라 `<select>`를 쓴다. 셋 중 **하나만** 고르는 배타적
 * 선택이고 화면에 늘 펼쳐 둘 이유가 없다 — 그리고 네이티브 select는 키보드·모바일 조작을
 * 스스로 처리한다(aria-pressed 토글 줄로 흉내 내면 그 전부를 직접 구현해야 한다).
 */
function difficultySelect(): string {
  // ⚠️ 초기 선택은 여기서 `selected` 속성으로 넣지 **않는다** — 아래 배선에서 `.value`로 넣는다.
  // 이유가 둘이다: ① "지금 골라져 있는 값"을 정하는 곳이 한 군데로 모인다, ② happy-dom은
  // innerHTML로 파싱한 selected 속성을 select.value에 반영하지 않아, 마크업에 적어 두면
  // 테스트가 실제 화면과 다른 것을 보게 된다.
  const options = DIFFICULTIES.map(d =>
    `<option value="${d}">${DIFFICULTY_NAME[d]} — ${difficultyDetail(d)}</option>`).join('');
  // 라벨을 눈에 보이게 둔다 — 드롭다운만 있으면 "이 셀렉트가 무엇을 고르는 것인가"를
  // 펼쳐 봐야만 알 수 있다(선택된 항목 문구가 "이지 — 기본 밸런스"이지 "난이도"가 아니다).
  return '<div id="difficulty-pick">'
    + '<label for="difficulty">난이도</label>'
    + `<select id="difficulty" name="difficulty">${options}</select>`
    + '</div>';
}

/**
 * 시작 화면을 app에 그린다. BATTLE을 누르면 **고른 난이도와 함께** onBattle이 호출되고, 그때
 * 호출부가 app을 게임 화면으로 통째로 갈아끼운다(createLayout이 innerHTML을 덮어쓰므로 별도
 * 정리는 필요 없다).
 *
 * ★ 난이도를 인자로 넘기는 것이 요점이다. main.ts가 `selectedDifficulty()`를 스스로 다시
 * 읽게 두면 "화면에 보이는 선택"과 "실제로 시작된 판"이 갈라질 수 있는 통로가 생긴다 —
 * 누른 그 순간의 값이 그대로 판에 굳어야 한다.
 */
export function createTitleScreen(
  app: HTMLElement, onBattle: (difficulty: Difficulty) => void,
): void {
  // ★ 시작 화면은 세로로 길다(기물 설명 8탭) — 게임 화면 전용 높이 고정을 반드시 푼다.
  //   결과 화면의 "다시 시작"이 location.reload()라 실제로는 새 문서지만, 그 사실에 기대지
  //   않는다: 앞으로 리로드 없이 되돌아오는 경로가 생기면 그때는 조용히 잘린다.
  app.classList.remove('in-game');
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
        <div id="title-start">
          ${difficultySelect()}
          <button id="battle">BATTLE</button>
        </div>
        <p id="title-hint">기물을 사서 보드로 드래그하면 자동으로 싸운다. 웨이브 중에도 자유롭게 옮길 수 있다.<br>
        <b>같은 종류·같은 단계</b> 기물 위로 드래그해 겹치면 <b>합성</b>된다 — 능력치가 두 기물의 합이 되고 테두리 색이 한 단계 오른다.</p>
      </div>
      ${CREDIT_HTML}
    </div>`;

  const tabBar = app.querySelector<HTMLElement>('#title-tabs')!;
  const panelBox = app.querySelector<HTMLElement>('#title-panels')!;
  const tabs = new Map<PieceType, HTMLButtonElement>();
  const panels = new Map<PieceType, HTMLElement>();

  /**
   * 스킨을 고른 뒤 화면을 맞춘다. 한 기물의 그림은 이 화면 안에서만도 **세 곳**(탭 아이콘 ·
   * 패널 아이콘 · 사거리 미니보드 가운데 칸)에 나오므로, 참조를 따로 들고 다니는 대신
   * `data-piece-icon` 표식 하나로 전부 찾아 한꺼번에 갈아 끼운다 — 나중에 아이콘이 늘어도
   * 그 요소에 표식만 붙이면 여기 코드는 그대로다.
   *
   * 게임 화면(뽑기 확률표·드래그 고스트)과 보드 캔버스는 여기서 손대지 않는다: 확률표는
   * BATTLE 이후에 만들어지고, 고스트는 집을 때마다, 캔버스 스프라이트는 sprites.ts가
   * onSkinChange 구독으로 각각 최신 선택을 다시 읽는다.
   */
  const syncSkin = (type: PieceType): void => {
    const url = allySpriteUrl(type);
    for (const img of app.querySelectorAll<HTMLImageElement>(`img[data-piece-icon="${type}"]`)) {
      img.setAttribute('src', url);
    }
    const chosen = selectedSkinId(type);
    for (const btn of app.querySelectorAll<HTMLButtonElement>(`.skin-swatch[data-piece-type="${type}"]`)) {
      btn.setAttribute('aria-pressed', String(btn.dataset.skinId === chosen));
    }
  };

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
      `<img class="piece-icon tab-icon" data-piece-icon="${type}" `
      + `src="${allySpriteUrl(type)}" alt="" draggable="false">`
      + `<span>${PIECE_NAME[type]}</span>`;
    tab.addEventListener('click', () => select(type));
    tabBar.appendChild(tab);
    tabs.set(type, tab);

    const panel = buildPanel(type);
    for (const swatch of panel.querySelectorAll<HTMLButtonElement>('.skin-swatch')) {
      swatch.addEventListener('click', () => {
        // 잠긴 스킨은 setSkin이 false를 돌려주므로 여기서 따로 막지 않는다 — 게이트를 UI에도
        // 두면 규칙이 두 곳에 생기고, 그 둘은 언젠가 갈라진다(§10.6). 판정의 단일 출처는
        // skins.ts이고 UI는 그 결과를 보여줄 뿐이다.
        setSkin(type, swatch.dataset.skinId!);
        syncSkin(type);          // setSkin이 false를 돌려줘도(같은 스킨 재클릭) 맞춰 두면 손해가 없다
      });
    }
    panelBox.appendChild(panel);
    panels.set(type, panel);
  }

  select(TAB_ORDER[0]);

  // 고르는 즉시 저장한다(BATTLE을 누를 때가 아니라). 저장값은 다음에 이 화면을 열 때의 초기
  // 선택일 뿐이라 판을 시작하지 않고 떠나도 손해가 없고, 반대로 시작 시점에만 저장하면
  // "골라 놓고 설명을 읽다가 새로고침"한 사람의 선택이 조용히 사라진다.
  const difficultyEl = app.querySelector<HTMLSelectElement>('#difficulty')!;
  difficultyEl.value = selectedDifficulty();      // 지난번 선택을 되살린다 (없으면 기본값)
  difficultyEl.addEventListener('change', () => {
    setDifficulty(difficultyEl.value as Difficulty);
  });

  // 판에 굳는 난이도는 **누른 순간의 드롭다운 값**이다 — setDifficulty가 모르는 값을 거르므로
  // 여기서는 selectedDifficulty()를 통해 한 번 정규화해서 넘긴다.
  app.querySelector<HTMLButtonElement>('#battle')!
    .addEventListener('click', () => onBattle(selectedDifficulty()));
}
