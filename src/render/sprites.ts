import { CONFIG } from '../config';
import type { PieceType } from '../types';

import { onPixelScaleChange, pixelScale } from './dpr';
import { allySpriteUrl, onSkinChange, SKINS } from './skins';

import enemyPawnUrl from '../assets/pieces/enemy-pawn.svg';
import enemyKingUrl from '../assets/pieces/enemy-king.svg';

/**
 * 기물 스프라이트 로더 (출처·저작자·라이선스는 NOTICE.md — 기본 아트워크는 위키미디어 공용
 * 체스 기물로, 대부분 Cburnett의 CC BY-SA 3.0이고 아마존 한 종만 Mszulc29의 CC BY-SA 4.0이다).
 * DOM(Image, HTMLCanvasElement, document)에 의존하므로 src/render/에 둔다 — src/core/는
 * DOM-free를 유지한다.
 *
 * ★ **어떤 그림을 구울지는 이 모듈이 정하지 않는다** (v1.19). 기물 → 이미지 대응은 스킨 표
 * (render/skins.ts)가 소유하고, 여기서는 그 결과(allySpriteUrl)를 받아 굽기만 한다. 스킨이
 * 바뀌면 onSkinChange 구독으로 해당 기물만 다시 굽는다.
 *
 * 원본은 45×45에 viewBox가 추가돼 있어(NOTICE.md "변경 내역" 1번) 어떤 크기로든 브라우저가
 * 벡터를 다시 래스터화할 수 있다. 그렇더라도 매 프레임 drawImage로 45→72처럼 확대하면 매번
 * 리샘플링 비용이 들고 결과가 스케일링 필터에 좌우된다. 그래서 로드 시점에 목표 크기로 딱 한 번
 * 오프스크린 캔버스에 구워 두고, 이후에는 그 캔버스를 1:1로만 그린다(rasterize once, blit many).
 */

/** 80px 칸 위에 그릴 아군 기물 크기(칸 경계와 겹치지 않도록 약간의 여백을 남긴다).
 * 적 크기는 밸런스 값인 CONFIG.enemy.spritePx(44)를 그대로 따르며, 여기서 다시 상수화하지 않는다.
 *
 * ★ **이 값은 보드 좌표계의 크기이지 굽는 크기가 아니다** (v1.19). 실제로 굽는 픽셀 수는
 * `ALLY_SPRITE_PX × pixelScale()`이다 — 캔버스가 DPR을 인식하게 되면서(render/dpr.ts) 백킹
 * 스토어가 배율만큼 커졌고, 스프라이트만 72px로 구우면 **보드의 나머지는 선명해지는데 기물만
 * 흐린** 상태가 된다(이 주석이 예전에 예고해 둔 바로 그 결함이다). 그리는 쪽(renderer.ts)은
 * 여전히 dest 크기를 이 값으로 명시하므로 좌표 계산은 한 줄도 바뀌지 않는다. */
export const ALLY_SPRITE_PX = 72;
const ENEMY_SPRITE_PX = CONFIG.enemy.spritePx;

/** 아군 기물 전체 목록 — 스킨 표(render/skins.ts)에서 유도한다. 기물이 늘면 그쪽에 스킨
 * 목록을 한 줄 추가하는 것만으로 여기 굽기 대상에도 저절로 포함된다. */
const ALLY_TYPES = Object.keys(SKINS) as PieceType[];

// 적은 DOM에 그려지지 않는다(적 이미지는 캔버스 전용) — 이 모듈 안(bake 호출)에서만 쓰이므로
// export를 걷어냈다(재검토 Item 7).
const ENEMY_SPRITE_URL = { normal: enemyPawnUrl, boss: enemyKingUrl } as const;

export type Drawable = CanvasImageSource;

// Node(테스트 기본 환경)와 일부 DOM 스텁에는 Image/document가 없다 — 그런 환경에서는 굽기 자체를
// 건너뛰고, 아래 accessor들이 항상 null을 돌려주어 renderer.ts가 글리프 폴백으로 자연히 빠지게 한다.
const browserAvailable = typeof Image !== 'undefined' && typeof document !== 'undefined';

const allyReady = new Map<PieceType, Drawable>();
const enemyReady = new Map<'normal' | 'boss', Drawable>();

function bake(url: string, sizePx: number, label: string, onReady: (d: Drawable) => void): void {
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = sizePx;
    canvas.height = sizePx;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;               // 2D 컨텍스트를 못 얻으면(일부 DOM 스텁) 조용히 폴백에 맡긴다
    // 스킨 PNG는 원본이 1254px이라 72px까지 17배 넘게 줄어든다 — 기본값(저품질 쌍선형)으로
    // 한 번에 줄이면 가는 선이 끊겨 보인다. 굽기는 스킨당 딱 한 번이므로 품질을 최대로 둔다.
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, sizePx, sizePx);
    onReady(canvas);
  };
  img.onerror = () => {
    // 조용히 삼키면 프로덕션 404와 "아직 로딩 중"을 구분할 수 없다 — 실패는 최소 한 번 반드시 로그.
    console.error(`[chess-defense] 기물 스프라이트 로드 실패: ${label} (${url})`);
  };
  img.src = url;
}

/**
 * 굽기 세대 번호 (경합 방지). 굽기를 다시 부르는 계기가 **둘**이다 — 스킨 선택과 픽셀 밀도
 * 변경. 스킨을 A→B→A로 빠르게 누르거나 그 사이 창을 다른 모니터로 옮기면 요청 여럿이 동시에
 * 뜨는데, 이미지 디코딩 시간은 파일마다 달라 **완료 순서가 요청 순서와 다를 수 있다** —
 * 세대를 붙여 두지 않으면 뒤늦게 끝난 결과가 나중 요청을 덮어써, 화면 아이콘은 A인데 보드 위
 * 기물만 B이거나(스킨) 방금 키운 배율이 옛 해상도로 되돌아간다(DPR).
 */
const bakeSeq = new Map<string, number>();

/** 같은 label의 **최신 요청만** 반영한다. 새 그림이 준비될 때까지 옛 그림을 지우지 않는다 —
 * 지우면 로딩 몇 프레임 동안 기물이 글리프로 깜빡인다. */
function bakeLatest(label: string, url: string, sizePx: number, commit: (d: Drawable) => void): void {
  const seq = (bakeSeq.get(label) ?? 0) + 1;
  bakeSeq.set(label, seq);
  bake(url, sizePx, label, d => {
    if (bakeSeq.get(label) !== seq) return;     // 그 사이 더 새로운 요청이 있었다 — 낡은 결과는 버린다
    commit(d);
  });
}

// 굽는 픽셀 수 = 보드 좌표계 크기 × 화면 배율. 배율이 1이면 예전과 정확히 같다.
function bakeAlly(type: PieceType): void {
  bakeLatest(`ally-${type}`, allySpriteUrl(type), Math.round(ALLY_SPRITE_PX * pixelScale()),
    d => allyReady.set(type, d));
}
function bakeEnemy(kind: 'normal' | 'boss'): void {
  bakeLatest(`enemy-${kind}`, ENEMY_SPRITE_URL[kind], Math.round(ENEMY_SPRITE_PX * pixelScale()),
    d => enemyReady.set(kind, d));
}
function bakeAll(): void {
  ALLY_TYPES.forEach(bakeAlly);
  bakeEnemy('normal');
  bakeEnemy('boss');
}

if (browserAvailable) {
  bakeAll();
  // 구독 둘 다 모듈 수명 내내 유지하므로 해지 함수는 쓰지 않는다 — 이 모듈이 살아 있는 동안
  // 스프라이트도 항상 최신이어야 한다.
  onSkinChange(bakeAlly);              // 시작 화면에서 스킨을 고르면 그 기물만
  onPixelScaleChange(bakeAll);         // 밀도가 바뀌면(모니터 이동·확대) 전부 다시
}

/** 아군 기물 스프라이트. 아직 굽지 못했으면(로드 전·실패·비-브라우저 환경) null —
 * 호출부(renderer.ts)는 null이면 글리프로 폴백한다. */
export function getAllySprite(type: PieceType): Drawable | null {
  return allyReady.get(type) ?? null;
}

/** 적 스프라이트: 보스는 킹, 일반은 폰. */
export function getEnemySprite(isBoss: boolean): Drawable | null {
  return enemyReady.get(isBoss ? 'boss' : 'normal') ?? null;
}

/**
 * 테스트 전용 seam. happy-dom/node는 실제 SVG를 디코드하지 않으므로 위 bake()의 img.onload가
 * 결코 발생하지 않는다 — 렌더러의 이미지 경로(drawImage 호출)를 실제 브라우저 없이 검증하려면
 * "이미 구워진 것"을 흉내 낼 스탠드인을 직접 주입해야 한다. economy.ts의 resetPieceSeq()와 같은
 * 성격의 테스트 격리용 export이며, 프로덕션 코드 경로는 절대 호출하지 않는다.
 */
export function setSpriteForTest(kind: 'ally', type: PieceType, drawable: Drawable | null): void;
export function setSpriteForTest(kind: 'enemy', boss: boolean, drawable: Drawable | null): void;
export function setSpriteForTest(kind: 'ally' | 'enemy', key: PieceType | boolean, drawable: Drawable | null): void {
  if (kind === 'ally') {
    const type = key as PieceType;
    if (drawable) allyReady.set(type, drawable); else allyReady.delete(type);
  } else {
    const k = key ? 'boss' : 'normal';
    if (drawable) enemyReady.set(k, drawable); else enemyReady.delete(k);
  }
}
