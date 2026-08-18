import * as THREE from 'three';
import { BODY_PROFILE, ENEMY_KING, ENEMY_PAWN, type Profile } from './profiles';
import type { PieceType } from '../types';

/**
 * 프로파일 → 실제 3D 지오메트리 (v1.21).
 *
 * ★ **회전체가 아닌 부분이 곧 기물의 정체성이다.** 룩의 성벽, 퀸의 관 구슬, 킹의 십자가,
 * 나이트의 말머리 — 넷 다 선반으로는 못 깎는 부분이고, 그래서 넷 다 실루엣의 결정적 단서다.
 * 몸통(lathe)만으로는 룩과 퀸이 "굵은 원통 / 가는 원통"으로만 갈려 위에서 보면 거의 같다.
 *
 * ⚠️ **카메라가 거의 수직이라 "위에서 본 모습"이 판독의 전부다.** 그래서 부속물은 전부
 * 꼭대기에 붙는다 — 옆구리에 달면 이 카메라에서는 존재하지 않는 것과 같다. 나이트 머리를
 * 세우지 않고 뒤로 60° 눕히는 이유도 같다(KNIGHT_HEAD_PITCH 주석).
 *
 * 지오메트리는 **타입당 한 번만 만들어 공유한다**. 같은 종류 기물이 판에 여럿 서 있어도
 * 정점 버퍼는 하나이고, 개체마다 다른 것은 Mesh의 위치·크기·재질뿐이다.
 */

/** 받침 반지름 — 블롭 그림자 크기를 여기서 유도한다(render3d/blob.ts). 프로파일의 최대
 *  반지름이 곧 그 기물이 판에 차지하는 폭이다. */
function maxRadius(profile: Profile): number {
  return profile.reduce((m, [r]) => Math.max(m, r), 0);
}

/** 회전 분할 수. 24면 80px 칸 위에서 각이 보이지 않으면서 정점 수가 무의미하게 늘지 않는다. */
const LATHE_SEGMENTS = 24;

/** 한 기물을 이루는 조각 하나. 위치는 **기물 로컬 좌표**(원점 = 판에 닿는 바닥 중심)다. */
export interface Part {
  geometry: THREE.BufferGeometry;
  /** 밝은 강조색을 쓰는 조각인가 — 티어 색을 입히는 부속물(관 구슬 등)을 구분한다. */
  accent?: boolean;
}

function lathe(profile: Profile): THREE.LatheGeometry {
  const pts = profile.map(([r, h]) => new THREE.Vector2(r, h));
  return new THREE.LatheGeometry(pts, LATHE_SEGMENTS);
}

/** 프로파일의 꼭대기 높이 — 부속물을 얹을 자리와 체력바·배지의 기준점을 여기서 유도한다. */
function topOf(profile: Profile): number {
  return profile[profile.length - 1][1];
}

/**
 * 나이트 말머리 — 옆면 실루엣을 압출한 판(plaque).
 *
 * ★ **뒤로 60° 눕힌다.** 세워 두면 카메라(수직에서 22°)가 판을 거의 모서리로 보게 되어
 * 말머리가 얇은 조각으로 사라진다. 눕히면 실루엣 면의 법선이 카메라를 향해, 위에서 봤을 때
 * 말머리가 **그대로 읽힌다.** 주둥이는 −Z(8랭크 = 적이 오는 쪽)를 향한다 — 방어 기물이
 * 적을 바라보는 방향이 곧 판독 방향이 된다.
 */
const KNIGHT_HEAD_PITCH = -Math.PI / 3;      // −60°

function knightHead(scale: number): THREE.BufferGeometry {
  // 로컬 shape 좌표: +Y가 주둥이 쪽, −Y가 목 쪽. 압출은 +Z(두께).
  const s = new THREE.Shape();
  s.moveTo(-9, -14);
  s.lineTo(-11, -4);
  s.lineTo(-9, 6);
  s.lineTo(-5, 12);
  s.lineTo(-1, 15);
  s.lineTo(1, 20);        // 귀
  s.lineTo(4.5, 14);
  s.lineTo(9.5, 11);
  s.lineTo(13, 6);
  s.lineTo(11.5, 2);      // 콧등
  s.lineTo(13.5, -1);
  s.lineTo(10, -4.5);     // 주둥이 아래
  s.lineTo(3, -3.5);
  s.lineTo(0, -8);
  s.lineTo(2.5, -14);
  s.closePath();

  const g = new THREE.ExtrudeGeometry(s, {
    depth: 9, bevelEnabled: true, bevelSize: 1.4, bevelThickness: 1.2, bevelSegments: 2,
  });
  g.center();                       // 압출 원점이 shape 좌표계라, 회전 전에 무게중심을 원점으로
  g.rotateX(KNIGHT_HEAD_PITCH);
  g.scale(scale, scale, scale);
  return g;
}

/**
 * 룩·챈슬러의 성벽. 원통 테두리를 따라 여섯 개 — 위에서 보면 톱니 원으로 읽힌다.
 *
 * ⚠️ 상자를 뚜껑 **위에 얹지 않고 박는다**(높이 12 중 7이 몸통 안으로 들어간다). 얹으면
 * 상자 바닥면과 뚜껑 윗면이 동일 평면이 되어 z-fighting이 난다 — profiles.ts의 ROOK 주석 참고.
 */
const MERLON_HEIGHT = 12;
const MERLON_SINK = 7;

function merlons(radius: number, capY: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const g = new THREE.BoxGeometry(7.5, MERLON_HEIGHT, 6.5);
    g.translate(Math.cos(a) * radius, capY + MERLON_HEIGHT / 2 - MERLON_SINK, Math.sin(a) * radius);
    out.push(g);
  }
  return out;
}

/** 성벽이 뚜껑 위로 실제로 솟는 높이. */
const MERLON_RISE = MERLON_HEIGHT - MERLON_SINK;

/** 퀸·아마존의 관 구슬. 여덟 개를 둘러 위에서 봤을 때 "관"으로 읽히게 한다. */
function coronet(radius: number, y: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const g = new THREE.SphereGeometry(4.2, 10, 8);
    g.translate(Math.cos(a) * radius, y, Math.sin(a) * radius);
    out.push(g);
  }
  return out;
}

/** 보스(킹)의 십자가. 이 게임에서 킹은 적 보스뿐이라 십자가는 곧 "보스다"라는 표식이다. */
function cross(y: number): THREE.BufferGeometry[] {
  const v = new THREE.BoxGeometry(3.6, 14, 3.6);
  v.translate(0, y + 7, 0);
  const h = new THREE.BoxGeometry(11, 3.6, 3.6);
  h.translate(0, y + 9.5, 0);
  return [v, h];
}

/** 융합 기물 셋의 꼭대기에 얹는 작은 말머리 — 재료에 나이트가 들어 있음을 실루엣으로 말한다. */
function fusionHead(y: number): THREE.BufferGeometry {
  const g = knightHead(0.6);
  g.translate(0, y + 8, 0);
  return g;
}

const pieceCache = new Map<PieceType, Part[]>();
const pieceTopCache = new Map<PieceType, number>();

function buildPiece(type: PieceType): Part[] {
  const profile = BODY_PROFILE[type];
  const top = topOf(profile);
  const parts: Part[] = [{ geometry: lathe(profile) }];

  switch (type) {
    case 'knight': {
      const head = knightHead(1.18);
      head.translate(0, top + 15, 0);
      parts.push({ geometry: head });
      pieceTopCache.set(type, top + 30);
      break;
    }
    case 'rook':
      for (const g of merlons(14.5, top)) parts.push({ geometry: g });
      pieceTopCache.set(type, top + MERLON_RISE);
      break;
    case 'queen':
      for (const g of coronet(13.5, top - 8)) parts.push({ geometry: g, accent: true });
      pieceTopCache.set(type, top + 2);
      break;
    case 'chancellor':
      for (const g of merlons(14.5, top)) parts.push({ geometry: g });
      parts.push({ geometry: fusionHead(top + MERLON_RISE) });
      pieceTopCache.set(type, top + MERLON_RISE + 18);
      break;
    case 'amazon':
      for (const g of coronet(13.5, top - 8)) parts.push({ geometry: g, accent: true });
      parts.push({ geometry: fusionHead(top) });
      pieceTopCache.set(type, top + 18);
      break;
    case 'archbishop':
      parts.push({ geometry: fusionHead(top - 4) });
      pieceTopCache.set(type, top + 14);
      break;
    default:
      pieceTopCache.set(type, top);
  }
  return parts;
}

/** 아군 기물의 조각들 (타입당 1회 생성 후 공유). */
export function pieceParts(type: PieceType): Part[] {
  let parts = pieceCache.get(type);
  if (!parts) { parts = buildPiece(type); pieceCache.set(type, parts); }
  return parts;
}

/** 기물의 실제 꼭대기 높이 — 체력바·버프 배지·티어 링이 이 값에서 자리를 잡는다. */
export function pieceTop(type: PieceType): number {
  if (!pieceTopCache.has(type)) pieceParts(type);
  return pieceTopCache.get(type)!;
}

/**
 * 플레이어 킹 — 보드 바깥에 서서 플레이어 자신을 나타낸다 (v1.28).
 *
 * 적 보스와 **같은 프로파일**을 쓰되 재질이 아군 상아색이다(render3d/playerKing.ts). 형상을
 * 공유하는 것이 오히려 뜻이 맞다: 이 게임에서 킹은 "쓰러지면 끝나는 것"이고, 그 역할을
 * 양쪽이 나눠 갖는다 — 적 진영의 킹은 보스, 내 진영의 킹은 나다.
 */
let playerKingCache: Part[] | null = null;
export function playerKingParts(): Part[] {
  if (!playerKingCache) {
    const top = topOf(ENEMY_KING);
    playerKingCache = [{ geometry: lathe(ENEMY_KING) }, ...cross(top).map(g => ({ geometry: g }))];
  }
  return playerKingCache;
}
/** 플레이어 킹의 꼭대기 높이 — 체력바가 뜨는 자리. */
export function playerKingTop(): number {
  return topOf(ENEMY_KING) + 17;
}
/** 플레이어 킹의 받침 반지름 — 블롭 그림자 크기. */
export function playerKingRadius(): number {
  return maxRadius(ENEMY_KING);
}

const enemyCache = new Map<'normal' | 'boss', Part[]>();

/** 적 조각들. 일반은 폰 축소판, 보스는 킹 + 십자가. */
export function enemyParts(isBoss: boolean): Part[] {
  const key = isBoss ? 'boss' : 'normal';
  let parts = enemyCache.get(key);
  if (!parts) {
    if (isBoss) {
      const top = topOf(ENEMY_KING);
      parts = [{ geometry: lathe(ENEMY_KING) }, ...cross(top).map(g => ({ geometry: g }))];
    } else {
      parts = [{ geometry: lathe(ENEMY_PAWN) }];
    }
    enemyCache.set(key, parts);
  }
  return parts;
}

export function pieceRadius(type: PieceType): number {
  return maxRadius(BODY_PROFILE[type]);
}
export function enemyRadius(isBoss: boolean): number {
  return maxRadius(isBoss ? ENEMY_KING : ENEMY_PAWN);
}

/** 적의 꼭대기 높이 — 체력바가 뜨는 자리. */
export function enemyTop(isBoss: boolean): number {
  return isBoss ? topOf(ENEMY_KING) + 17 : topOf(ENEMY_PAWN);
}
