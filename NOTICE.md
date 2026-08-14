# 서드파티 에셋 고지 (Third-party asset notice)

## 체스 기물 SVG — `src/assets/pieces/`

이 저장소의 체스 기물 이미지는 직접 제작한 것이 아니라 위키미디어 공용(Wikimedia Commons)의
표준 체스 기물 세트(통칭 **Cburnett 세트**)를 가져온 것이다. `react-chessboard` 패키지가
기본 기물로 쓰는 것과 같은 아트워크다.

| 항목 | 내용 |
|---|---|
| 저작자 | Colin M.L. Burnett (Wikimedia 사용자 [Cburnett](https://commons.wikimedia.org/wiki/User:Cburnett)) |
| 출처 | [Wikimedia Commons — Category:SVG chess pieces](https://commons.wikimedia.org/wiki/Category:SVG_chess_pieces) |
| 라이선스 | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) (원본은 GFDL·BSD로도 다중 라이선스됨) |
| 변경 여부 | **있음** — 아래 "변경 내역" 참조 |

### 파일 대응표

저장소에서는 게임 내 역할이 드러나는 이름으로 바꿔 두었다. 원본 파일명은 다음과 같다.

| 저장소 경로 | 위키미디어 원본 파일 | 게임 내 역할 |
|---|---|---|
| `src/assets/pieces/ally-pawn.svg` | `Chess_plt45.svg` | 플레이어 폰 (화이트) |
| `src/assets/pieces/ally-knight.svg` | `Chess_nlt45.svg` | 플레이어 나이트 (화이트) |
| `src/assets/pieces/ally-bishop.svg` | `Chess_blt45.svg` | 플레이어 비숍 (화이트) |
| `src/assets/pieces/ally-rook.svg` | `Chess_rlt45.svg` | 플레이어 룩 (화이트) |
| `src/assets/pieces/ally-queen.svg` | `Chess_qlt45.svg` | 플레이어 퀸 (화이트) |
| `src/assets/pieces/enemy-pawn.svg` | `Chess_pdt45.svg` | 일반 적 (블랙) |
| `src/assets/pieces/enemy-king.svg` | `Chess_kdt45.svg` | 보스 (블랙) |

각 원본은 `https://commons.wikimedia.org/wiki/File:<원본 파일명>` 에서 확인할 수 있다.

### 변경 내역

원본 대비 다음 두 가지만 달라졌으며, **경로 데이터·색상·형태는 전혀 손대지 않았다.**

1. **`viewBox="0 0 45 45"` 속성 추가.** 원본은 `width="45" height="45"`만 있고 `viewBox`가 없어
   임의 크기로 확대할 때 브라우저마다 래스터화 결과가 달라진다. 게임은 캔버스에 44~72px로 그리므로
   좌표계를 명시할 필요가 있었다.
2. **줄바꿈 문자 정규화 (CRLF → LF).** 내려받을 때 일부 파일이 CRLF로 전송되어 저장소 규약에 맞춰
   LF로 통일했다. 바이트 단위 비교로 이 두 가지 외에는 원본과 동일함을 확인했다.

### CC BY-SA 3.0 이행 사항

- **저작자 표시(BY)**: 위 표의 저작자·출처·라이선스 링크가 그 이행이다. 게임 화면에도
  `#main`(보드·HUD·상점) 바로 아래 상시 노출되는 `<footer id="credit">`(`src/ui/layout.ts`)로
  같은 크레딧을 노출한다 — 결과 화면에만 잠깐 뜨는 배너가 아니라 플레이 내내(준비/웨이브/결과
  어느 단계든) 항상 DOM에 있는 요소다. 이 크레딧 줄은 저작자·출처 링크, 라이선스 링크에 더해
  이 문서(`NOTICE.md`)로 가는 링크도 포함한다 — `NOTICE.md`는 `dist/`에 포함되지 않으므로
  배포된 사이트 방문자가 변경 내역까지 확인하려면 저장소 상의 이 파일로 가는 경로가 필요하다.
- **동일조건변경허락(SA)**: 위 "변경 내역"의 수정본 역시 CC BY-SA 3.0으로 배포한다.
  이 조항은 **기물 이미지 에셋에만 적용되며**, 이 저장소의 소스 코드에는 미치지 않는다.

## 보드 색상

밝은 칸 `#F0D9B5` / 어두운 칸 `#B58863`. `react-chessboard`의 기본값
(`customLightSquareStyle` / `customDarkSquareStyle`)과 같은 값으로, 리체스·chess.com 계열에서
널리 쓰이는 관용적인 색 조합이다. 색상값 자체는 저작물이 아니므로 별도 라이선스 의무는 없다.

## 그 밖의 에셋

`assets/` 디렉터리의 PNG 이미지는 저장소 소유자가 별도로 제공한 것으로, 현재 게임에서 사용하지
않으며 git에도 포함되어 있지 않다.
