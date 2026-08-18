import { hasClearedWaves, waveClearLabel } from '../progress';
import { readStored, writeStored } from '../storage';
import type { PieceType } from '../types';

import allyPawnUrl from '../assets/pieces/ally-pawn.svg';
import allyKnightUrl from '../assets/pieces/ally-knight.svg';
import allyBishopUrl from '../assets/pieces/ally-bishop.svg';
import allyArchbishopUrl from '../assets/pieces/ally-archbishop.svg';
import allyChancellorUrl from '../assets/pieces/ally-chancellor.svg';
import allyAmazonUrl from '../assets/pieces/ally-amazon.svg';
import allyRookUrl from '../assets/pieces/ally-rook.svg';
import allyQueenUrl from '../assets/pieces/ally-queen.svg';
import pawnSkin1Url from '../assets/pieces/pawn-skin-1.png';

/**
 * 아군 기물 스킨 — "이 기물을 무엇으로 그릴 것인가"의 단일 출처 (v1.19).
 *
 * 예전에는 sprites.ts의 `ALLY_SPRITE_URL` 상수 하나가 기물 → 이미지 대응을 고정하고 있었다.
 * 스킨은 그 대응을 **런타임에 바꾸는** 기능이므로, 상수를 함수(`allySpriteUrl`)로 바꾸고
 * 그 뒤에 선택 상태를 둔다. 그림을 쓰는 쪽(시작 화면 아이콘 · 뽑기 확률표 · 드래그 고스트 ·
 * 보드 캔버스)은 전부 이 함수 하나만 보므로, 선택이 바뀌면 네 곳이 저절로 같이 따라온다.
 *
 * 이 모듈은 순수하게 "URL과 선택"만 다룬다 — 캔버스에 구울 스프라이트는 sprites.ts가
 * 이 모듈의 `onSkinChange`를 구독해 다시 굽는다. DOM에 의존하지 않는다(localStorage만 쓰고,
 * 그것도 없으면 없는 대로 동작한다).
 */

/**
 * 해금 조건. 종류를 늘릴 때는 `isSkinUnlocked`의 switch가 전수성으로 빠짐을 짚어 준다
 * (§10.10의 "술어를 타입 수준에서 닫는다").
 *
 * ★ **v1.20에서 `'clearFinalWave'` 문자열이 `clearWaves(n)`으로 바뀌었다** (사용자 결정:
 * "20웨이브 이상 클리어 시 해금, 모드 상관없이"). 조건이 "그 판의 마지막 웨이브"였을 때는
 * 인자가 필요 없었지만, 마지막 웨이브가 난이도마다 다른 지금 그 조건은 **하드로 20웨이브를
 * 넘긴 사람에게 아무것도 주지 않는다.** 조건을 절대 웨이브 수로 바꾸면서 그 수를 타입 안에
 * 넣었다 — 나중에 "30웨이브 스킨"을 넣을 때 새 union 항목도, 새 판정 분기도 필요 없다.
 */
export type SkinUnlock =
  | { kind: 'always' }
  | { kind: 'clearWaves'; waves: number };

/** 언제나 열려 있는 조건. 표에서 여덟 번 반복되므로 값을 하나만 만들어 공유한다. */
const ALWAYS: SkinUnlock = { kind: 'always' };

/** `waves` 웨이브 **이상**을 클리어하면 열린다 — 난이도는 묻지 않는다. */
const clearWaves = (waves: number): SkinUnlock => ({ kind: 'clearWaves', waves });

export interface Skin {
  /** 영속화 키. **파일명이 아니라 이 id가 저장된다** — 에셋 경로를 바꿔도 선택이 살아남는다. */
  id: string;
  /** 화면에 보이는 이름 (버튼 aria-label·툴팁) */
  name: string;
  url: string;
  unlock: SkinUnlock;
}

/** 모든 기물이 반드시 갖는 기본 스킨의 id. 저장된 값이 깨졌거나 스킨이 사라졌을 때 돌아갈 자리. */
export const DEFAULT_SKIN_ID = 'default';

/**
 * 기물별 스킨 목록. **각 배열의 첫 항목은 반드시 기본 스킨**이다 — 알 수 없는 id가 저장돼
 * 있을 때 폴백으로 쓰이고, 선택 UI에서도 맨 앞에 놓인다(tests/skins.test.ts가 단언한다).
 *
 * 스킨을 추가할 때 손댈 곳은 여기 한 곳뿐이다: 에셋을 import하고 해당 기물 배열에 한 줄
 * 넣으면 시작 화면의 선택 UI·영속화·스프라이트 재굽기가 전부 따라온다.
 */
export const SKINS: Record<PieceType, Skin[]> = {
  pawn: [
    { id: DEFAULT_SKIN_ID, name: '기본', url: allyPawnUrl, unlock: ALWAYS },
    // ★ 해금 문턱 20은 **이지의 길이(20웨이브)와 같은 수이지만 같은 값이 아니다.** 난이도와
    // 무관한 절대 기준이라(사용자 결정) 이지를 25웨이브로 바꿔도 이 조건은 20에 머문다.
    { id: 'heart-princess', name: '하트 프린세스', url: pawnSkin1Url, unlock: clearWaves(20) },
  ],
  knight: [{ id: DEFAULT_SKIN_ID, name: '기본', url: allyKnightUrl, unlock: ALWAYS }],
  bishop: [{ id: DEFAULT_SKIN_ID, name: '기본', url: allyBishopUrl, unlock: ALWAYS }],
  archbishop: [{ id: DEFAULT_SKIN_ID, name: '기본', url: allyArchbishopUrl, unlock: ALWAYS }],
  chancellor: [{ id: DEFAULT_SKIN_ID, name: '기본', url: allyChancellorUrl, unlock: ALWAYS }],
  amazon: [{ id: DEFAULT_SKIN_ID, name: '기본', url: allyAmazonUrl, unlock: ALWAYS }],
  rook: [{ id: DEFAULT_SKIN_ID, name: '기본', url: allyRookUrl, unlock: ALWAYS }],
  queen: [{ id: DEFAULT_SKIN_ID, name: '기본', url: allyQueenUrl, unlock: ALWAYS }],
};

/** 지금 이 스킨을 쓸 수 있는가. 기본 스킨은 **언제나** 열려 있다 — 잠글 수 있게 만들면
 *  모든 스킨이 잠긴 상태가 표현 가능해지고, 그때 그릴 그림이 없다. */
export function isSkinUnlocked(skin: Skin): boolean {
  switch (skin.unlock.kind) {
    case 'always': return true;
    case 'clearWaves': return hasClearedWaves(skin.unlock.waves);
  }
}

/** 잠긴 스킨의 해금 조건 문구. 열려 있으면 null — 보여줄 조건이 없다. */
export function unlockLabel(skin: Skin): string | null {
  if (isSkinUnlocked(skin)) return null;
  switch (skin.unlock.kind) {
    case 'always': return null;
    case 'clearWaves': return `${waveClearLabel(skin.unlock.waves)} 시 해금`;
  }
}

/**
 * ★ 판을 넘어 남는 둘 중 하나다(다른 하나는 `progress.ts`의 승리 기록). 음소거
 * (ui/controls.ts)는 "세이브 시스템이 없으니 메모리로 충분하다"고 판단했는데 스킨은 사정이
 * 다르다: 결과 화면의 "다시 시작"이 `location.reload()`라서(ui/banners.ts) 한 판이 끝날 때마다
 * 모듈 상태가 통째로 날아간다 — 메모리에만 두면 **매 판마다 스킨이 기본으로 되돌아간다.**
 * 진행도가 아니라 표시 설정이므로 저장돼도 게임 밸런스에 영향이 없다.
 */
const STORAGE_KEY = 'chess-defense.skins.v1';

const selected = new Map<PieceType, string>();

type Listener = (type: PieceType) => void;
const listeners = new Set<Listener>();

function findSkin(type: PieceType, id: string): Skin | undefined {
  return SKINS[type].find(s => s.id === id);
}

/**
 * 저장된 선택을 읽어 들인다. 저장값은 **전적으로 신뢰할 수 없는 입력**이다 — 사용자가 직접
 * 고칠 수도 있고, 이 코드가 스킨을 지우거나 이름을 바꾼 뒤의 옛 값일 수도 있다. 그래서 항목
 * 단위로 검증하고, 모르는 기물·모르는 스킨은 조용히 버린다(전체를 버리지 않는다 — 폰 스킨
 * 하나가 사라졌다고 룩 스킨 선택까지 날릴 이유가 없다).
 */
function loadSelection(): void {
  const parsed = readStored(STORAGE_KEY);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
  for (const [key, id] of Object.entries(parsed as Record<string, unknown>)) {
    if (!(key in SKINS)) continue;                          // 사라진 기물
    const type = key as PieceType;
    if (typeof id !== 'string' || !findSkin(type, id)) continue;      // 사라진 스킨
    selected.set(type, id);
  }
  // ⚠️ 잠긴 스킨을 여기서 버리지 **않는다** — 해금 여부는 읽을 때마다 다시 본다
  // (selectedSkinId). 저장값을 버리면 "해금 전에 골랐던 것"이 아니라 "해금하면 되돌아올 선택"이
  // 사라진다. 실제로 이 순서가 생기는 경로가 있다: 저장값을 손으로 고친 뒤 승리하는 경우다.
}

function save(): void {
  // 기본 스킨은 적지 않는다 — 저장값이 "기본과 다른 것"만 담으므로, 나중에 기본 아트워크가
  // 바뀌어도 옛 저장값이 예전 기본을 되살리는 일이 없다.
  const payload: Record<string, string> = {};
  for (const [type, id] of selected) if (id !== DEFAULT_SKIN_ID) payload[type] = id;
  writeStored(STORAGE_KEY, payload);
}

loadSelection();

/** 이 기물이 고를 수 있는 스킨들 (기본이 항상 첫 항목). */
export function skinsFor(type: PieceType): readonly Skin[] {
  return SKINS[type];
}

/**
 * 지금 **실제로 적용 중인** 스킨 id. 고른 적이 없거나, 골라 둔 스킨이 아직 잠겨 있으면 기본.
 *
 * ★ 해금 여부를 저장 시점이 아니라 **읽는 시점에** 본다. 그래서 저장값이 손으로 고쳐져 잠긴
 * 스킨을 가리키더라도 화면·보드·드래그 고스트가 전부 한 몸으로 기본을 그린다 — 어느 한 곳만
 * 잠긴 그림을 쓰는 어긋남이 구조적으로 생기지 않는다.
 */
export function selectedSkinId(type: PieceType): string {
  const id = selected.get(type) ?? DEFAULT_SKIN_ID;
  const skin = findSkin(type, id);
  return skin && isSkinUnlocked(skin) ? id : DEFAULT_SKIN_ID;
}

/**
 * 지금 이 기물을 그릴 이미지 URL. UI(<img src>)와 sprites.ts(캔버스 굽기)가 공유하는
 * 단일 진입점 — 예전 `ALLY_SPRITE_URL[type]`을 그대로 대체한다.
 */
export function allySpriteUrl(type: PieceType): string {
  const list = SKINS[type];
  const id = selectedSkinId(type);
  return (list.find(s => s.id === id) ?? list[0]).url;
}

/**
 * 스킨을 고른다. 실제로 바뀌었을 때만 true를 돌려주고 구독자에게 알린다 — 같은 스킨을 다시
 * 눌렀다고 스프라이트를 다시 굽거나 아이콘을 갈아 끼울 이유가 없다.
 * 모르는 id와 **잠긴 스킨**은 무시한다(false).
 */
export function setSkin(type: PieceType, id: string): boolean {
  const skin = findSkin(type, id);
  if (!skin || !isSkinUnlocked(skin)) return false;      // 모르는 스킨이거나 아직 잠겨 있다
  if (selectedSkinId(type) === id) return false;
  selected.set(type, id);
  save();
  // 구독 중 해지되는 리스너가 있어도 순회가 깨지지 않도록 사본을 돈다.
  for (const listener of [...listeners]) listener(type);
  return true;
}

/** 스킨 변경 구독. 해지 함수를 돌려준다(sprites.ts는 모듈 수명 내내 구독하므로 쓰지 않는다). */
export function onSkinChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * 테스트 전용 seam — sprites.ts의 setSpriteForTest, economy.ts의 resetPieceSeq와 같은 성격.
 * 스킨 선택은 모듈 전역이라 한 테스트가 바꾼 값이 같은 파일의 다음 테스트로 새어 나간다.
 * 프로덕션 코드 경로는 절대 호출하지 않는다.
 */
export function resetSkinsForTest(): void {
  const touched = [...selected.keys()];
  selected.clear();
  save();
  for (const type of touched) for (const listener of [...listeners]) listener(type);
}
