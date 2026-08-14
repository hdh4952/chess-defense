import { CONFIG } from '../config';
import type { PieceType } from '../types';

import allyPawnUrl from '../assets/pieces/ally-pawn.svg';
import allyKnightUrl from '../assets/pieces/ally-knight.svg';
import allyBishopUrl from '../assets/pieces/ally-bishop.svg';
import allyRookUrl from '../assets/pieces/ally-rook.svg';
import allyQueenUrl from '../assets/pieces/ally-queen.svg';
import enemyPawnUrl from '../assets/pieces/enemy-pawn.svg';
import enemyKingUrl from '../assets/pieces/enemy-king.svg';

/**
 * Cburnett 체스 기물 SVG 로더 (출처·라이선스는 NOTICE.md, CC BY-SA 3.0). DOM(Image,
 * HTMLCanvasElement, document)에 의존하므로 src/render/에 둔다 — src/core/는 DOM-free를 유지한다.
 *
 * 원본은 45×45에 viewBox가 추가돼 있어(NOTICE.md "변경 내역" 1번) 어떤 크기로든 브라우저가
 * 벡터를 다시 래스터화할 수 있다. 그렇더라도 매 프레임 drawImage로 45→72처럼 확대하면 매번
 * 리샘플링 비용이 들고 결과가 스케일링 필터에 좌우된다. 그래서 로드 시점에 목표 크기로 딱 한 번
 * 오프스크린 캔버스에 구워 두고, 이후에는 그 캔버스를 1:1로만 그린다(rasterize once, blit many).
 */

/** 80px 칸 위에 그릴 아군 기물 크기(칸 경계와 겹치지 않도록 약간의 여백을 남긴다).
 * 적 크기는 밸런스 값인 CONFIG.enemy.spritePx(44)를 그대로 따르며, 여기서 다시 상수화하지 않는다. */
export const ALLY_SPRITE_PX = 72;
const ENEMY_SPRITE_PX = CONFIG.enemy.spritePx;

export const ALLY_SPRITE_URL: Record<PieceType, string> = {
  pawn: allyPawnUrl,
  knight: allyKnightUrl,
  bishop: allyBishopUrl,
  rook: allyRookUrl,
  queen: allyQueenUrl,
};

export const ENEMY_SPRITE_URL = { normal: enemyPawnUrl, boss: enemyKingUrl } as const;

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
    ctx.drawImage(img, 0, 0, sizePx, sizePx);
    onReady(canvas);
  };
  img.onerror = () => {
    // 조용히 삼키면 프로덕션 404와 "아직 로딩 중"을 구분할 수 없다 — 실패는 최소 한 번 반드시 로그.
    console.error(`[chess-defense] 기물 스프라이트 로드 실패: ${label} (${url})`);
  };
  img.src = url;
}

if (browserAvailable) {
  (Object.entries(ALLY_SPRITE_URL) as [PieceType, string][]).forEach(([type, url]) => {
    bake(url, ALLY_SPRITE_PX, `ally-${type}`, d => allyReady.set(type, d));
  });
  bake(ENEMY_SPRITE_URL.normal, ENEMY_SPRITE_PX, 'enemy-normal', d => enemyReady.set('normal', d));
  bake(ENEMY_SPRITE_URL.boss, ENEMY_SPRITE_PX, 'enemy-boss', d => enemyReady.set('boss', d));
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
