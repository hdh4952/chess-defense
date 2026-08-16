# 체스 디펜스 개선 시리즈 — 최종 구현 계획

**기준** 커밋 `283485b`(v1.8) + 퀸 상한 3→6(미커밋) · **문서 기준** `docs/game-design.md` · **작성일** 2026-08-16 · **개정** 적대적 검증 2건 반영 후 재작성

> **작업 트리 상태 (실측, 지금 이 순간)** — `src/config.ts` · `src/ui/titleScreen.ts` · `src/ui/tooltip.ts` · `tests/merge.test.ts` · `tests/tooltip.test.ts` 수정 + `docs/game-design.md` · `.DS_Store` · **`tests/tmp-balance.test.ts` · `tests/tmp-balance2.test.ts`** 미추적.
> **테스트 기준선 실측**: 전체 `npx vitest run` = **30파일 399통과**, tmp 2파일 제외 = **28파일 388통과**. 이 계획 전체의 합격선 "388"은 **tmp 파일을 지운 뒤의 값**이다. 초안의 "테스트 트리 원상 복구 확인 완료"는 사실이 아니었고, 여기서 정정한다.
> 이번 조사의 모든 측정은 **스크래치패드 저장소 사본**에서 수행했고 사본은 삭제했다. `src/`·`tests/` 어느 것도 건드리지 않았다.

---

## −1. 확정 결정 (사용자 승인 완료 · 이 절이 §3·§8에 우선한다)

개선안 제안자와의 상호 검토를 거쳐 아래로 확정했다. **§8의 갈림길 4건은 전부 답이 나왔고, §3의 단계 순서는 한 곳이 바뀐다.**

### −1.1 갈림길 4건의 답

| 갈림길 | 확정 | 근거 |
|---|---|---|
| **1. 보스 배수** | **0.75** | w15가 5~7/8 — "약간 더 사면 되는" 압력. 0.625는 0/8로 벽 |
| **2. 적 유형 비율** | **유형당 10%로 착수** | 난이도는 보스가 담당하므로 유형은 텍스처 축이다(§−1.2 참조) |
| **3. 클리어 보너스** | **곡선 + 처치율 연동을 함께** | 곡선만 넣으면 §6.4의 "누수 방치" 결함을 1.67배로 증폭한다 |
| **4. 무작위 지급** | **트레이 지급(B) 유지. 보드 무작위 배치(C)는 기각** | 재배치가 무료·무제한·즉시라 무작위 착지가 첫 드래그에 지워진다. 게다가 보드 지급은 즉시 싸우므로 B보다 관대해 진단 ②를 더 얇게 친다 |

### −1.2 목적 재정의 — 세 처방의 역할이 실측에 맞게 바뀌었다

| 처방 | 폐기된 목적 | 확정된 목적 |
|---|---|---|
| **적 유형** | 지배 전략을 깬다 | **폰 일변도를 깬다 + 텍스처.** 난이도 노브 아님 |
| **무작위 지급** | 슬롯 압박 | **빌드 다양성 보조.** 기대치를 낮게 잡고 N5로 측정 |
| **이종 융합** | (미정의였음) | **역할 겸업** — 아래 −1.3 |

> **적 유형이 "난이도 노브가 아니다"는 말이 "쓸모없다"는 뜻은 아니다.** §1.2의 포화 실측은 전부 **룩 빌드**에 대한 것인데, 실제 최적해는 룩이 아니라 **폰 스팸**이었다(자동 플레이어 실측: 폰 222.9기 / 나이트 16.1 / 비숍 0 / **룩 0**). T1 폰은 2딜이라 장갑 감산에 정면으로 취약하고(0.75면 1.5딜), 문턱 효과와 겹치면 무력화된다. 유형은 난이도를 못 올리지만 **구성 편중은 실제로 깬다.**
>
> **traitRatio를 올려서 난이도를 잡으려는 시도는 잘못된 노브다.** §1.2가 그 이유를 이미 실측으로 남겼다 — 룩2/파일 이상에서는 감산 0.5도, 패턴 종속도 누수를 만들지 못한다. 난이도가 필요하면 `bossDamageMultiplier`를 건드려라.

### −1.3 융합의 가치 명제 — S4c에서 반드시 UI에 노출한다

D18이 "스탯 = 재료 합"으로 골드 중립을 보장하므로, 플레이어 입장에서 **"왜 합치는가"에 대한 답이 없으면 아무도 만들지 않는다.** 공격력 8 / 주기 3.0만 띄우면 룩과 같다고 읽힌다.

> **동종 합성은 화력을 압축하고, 이종 융합은 역할을 겸업시킨다.**

| 융합물 | 재료 합 대비 진짜 이득 |
|---|---|
| 아치비숍 | 비숍 골드를 유지하면서 나이트 폭발을 얹는다. 2칸 → 1칸 |
| **챈슬러** | **나이트는 자동 공격이 없어 칸값을 못 하는데, 챈슬러는 룩의 자동 관통 + 드래그 폭발을 한 칸에서 겸한다** |
| 아마존 | 퀸이 처음으로 자기 몫의 딜과 폭발을 갖는다 |

> ⚠️ **"챈슬러는 보스 파일로 걸어갈 수 있는 유일한 딜러"라는 서술은 사실이 아니다.** `resolveLanding`(`src/core/pieces.ts:77-81`)이 보드 위 이동에 패턴 제약을 거는 것은 **나이트뿐**이다 — 룩은 이미 웨이브 중에 아무 칸으로나 횟수 제한 없이 순간이동한다. 오히려 융합물이 나이트의 L자 제약을 상속하면 **셋 다 룩보다 기동성이 낮아진다**(D16 관련). 가치 명제를 기동성에 걸지 말 것.

### −1.4 표시 3종 — 수치 변경만으로는 절반이다

플레이어가 보스 축을 **학습할 수 있어야** 한다. S3에 함께 넣는다.

| 항목 | 규격 |
|---|---|
| **HUD "보스 여유 N회"** | `Math.ceil(hp / 5) − 1`로 **유도**. 고정 표기 금지 |
| **w15 배너 차별화** | 실제로 승패가 갈리는 유일한 보스인데 배너가 네 번 다 같다 |
| **융합 가치 명제** | 툴팁 + 시작 화면 (§−1.3) |

> **왜 유도값인가** — 일반 누수가 보스 여유를 갉아먹는다. hp 10·6이면 여유 1회지만 **hp 5면 0회**다. 고정 표기하면 거짓이 되고, 유도하면 두 패배 축이 화면에서 하나로 연결된다.
>
> 같은 이유로 **「보스 2회 누수 = 즉시 패배」를 규칙으로 승격하지 않는다.** hp 5 이하에서는 보스 1회로도 죽으므로 규칙이 오히려 부정확해진다. 산술은 그대로 두고 표시만 바꾼다.

### −1.5 단계 순서 변경 — S2와 S3를 맞바꾼다

**§3의 순서에서 `S2 클리어 보너스`와 `S3 적 유형`의 자리를 바꾼다.** 갈림길 3에서 처치율 연동을 채택했기 때문이다.

처치율 연동이 들어가면 예산이 **점이 아니라 구간**이 된다(전량 처치 vs 80% 처치). 이 시리즈에서 가장 중요한 노브인 보스 배수(§0.1)를 그 흔들리는 바닥 위에서 정할 수는 없다. **보스를 먼저 확정하고 경제를 얹는다.**

> 부수 작업: 처치율 연동에는 **웨이브별 처치 수 카운터가 새로 필요하다.** `stats.totalKills`는 게임 전체 누적이고(`src/core/combat.ts:48`), 웨이브별 누수 카운터도 없다. `startWave`에서 리셋하는 필드 하나를 추가한다 — "둘 다 이미 있다"는 검토 의견은 `spawnedCount`에 대해서만 참이다.

### −1.6 진단 4개에 대한 정직한 최종 성적

| 진단 | 이 시리즈의 답 | 상태 |
|---|---|---|
| ① 패배 조건이 하나뿐 | 보스 축 명시화 + 배수 0.75 + 표시 3종 | ✅ 해결 (요새 없이) |
| ② 매 판이 똑같다 | 이종 융합 + 보스 파일 추첨 + 지급 10회 | ⚠️ 부분 — 지급은 기대치 낮음 |
| ③ 합성에 발견이 없다 | 이종 융합 3종 + 가치 명제 UI | ✅ 해결 |
| ④ 되돌릴 수 없는 선택 | 융합 자체가 비가역(D26) | ⚠️ 약하게 |

②와 ④를 제대로 치려면 **재배치에 비용을 두거나 보드 칸을 희소하게** 만들어야 하는데, 그건 `CONFIG.enemy` 재조정을 동반하는 별도 시리즈다. 이 시리즈의 범위 밖임을 명시해 둔다.

---

## 0. 이 개정에서 무엇이 바뀌었나 — 3분 요약

적대적 검증 두 렌즈가 초안의 실측 주장 여러 개를 반증했다. 나는 그중 **승패 축에 직결되는 다섯 가지를 저장소 사본에서 직접 재측정**했고, 결과는 아래와 같다.

| # | 초안이 세운 전제 | 재측정 결과 | 계획 변경 |
|---|---|---|---|
| **M1** | 장갑은 일반 적 난이도 노브다 | **보스에 ×0.6을 걸면 w15 보스 처치가 8/8 → 0/8**. 18,800G 최소 승리 빌드가 산술적으로 패배 | **D6 전면 개정** — 보스 배수를 별도 노브로 분리 |
| **M2** | §9.5 룩1/파일이 처방 4의 성공 판정 | **룩2/파일은 감산 0.5까지 내려도 w16~19 누수 0**. 룩1..4/파일 전수 측정으로 확인 | **처방 4의 성공 판정 폐기·교체** |
| **M3** | N6 풀런이 rng 오염을 잡는다 | `cycleRng` / `()=>0` / 3칸 시프트 / **`Math.random`** 네 경우 모두 `{victory, hp 80, kills 448, gold 20772, earned 20472}`로 **완전 동일** | **N6에서 rng 감시 역할 박탈**, 카운팅 신호 N8 신설 |
| **M4** | 보호막 "피격 3회"가 중립이다 | w19 종주: 룩 T1×2 **65** vs T2×1 **50**(−23%), 폰 18 vs 12(−33%). **피해 풀(maxHp×30%=17)이면 63 vs 63으로 정확히 0.0%** | **D8 개정** — 보호막을 피해 풀로 |
| **M5** | 패턴 종속 장갑이면 지배 전략이 깨진다 | **깨지지 않는다.** 직선 감산 ×0.5·30%에서도 룩2/파일 w17·w19 누수 0. 같은 골드의 룩1/파일+폰40도 0 | **처방 4의 목표 자체를 재정의** |

그리고 구현 렌즈가 지적한 `src/core/pieces.ts:161`을 코드에서 직접 확인했다.

```ts
// src/core/pieces.ts:161  (tryKnightBlast 마지막 줄)
piece.cooldown = CONFIG.pieces.knight.interval;   // ← piece.type이 아니라 'knight' 하드코딩
```

**이 한 줄이 D16("융합물은 interval 0을 상속하지 않는다")을 코드 차원에서 무효화한다.** 어떤 신호도 잡지 못한다(융합물이 없는 빌드에서는 값이 같으므로). S1 술어 교체표에 편입했다.

### 0.1 가장 큰 발견 — 이 게임의 난이도 축은 일반 웨이브가 아니라 보스다

M2·M5를 합치면 이렇게 읽힌다.

- **일반 웨이브 누수는 룩2/파일 이상에서 포화 신호다.** 감산 0.5·패턴 종속·혼합 빌드 — 무엇을 해도 0이다. 룩의 랭크 관통 시너지가 그만큼 크다.
- **보스는 감산에 선형으로 반응한다.** 같은 18,800G 빌드가 배수 1.0에서 w15를 8/8 처치, 0.75에서 5~7/8, 0.625 이하에서 **0/8**이다.
- 그런데 `startHp 10` · 보스 누수 −5이므로 **보스 4마리 중 3마리는 반드시 잡아야 한다**(허용 누수 1회). 이것이 이미 존재하는 **사실상의 두 번째 패배 조건**이다.

초안은 정확히 거꾸로 정해 두었다 — 보스에서 신속만 빼고(D11), 성공 판정을 일반 웨이브에 걸었다. **처방 4의 목표를 "지배 전략을 깨는 것"에서 "지배 전략의 가격을 올리고 보스 축을 실제 승패 축으로 드러내는 것"으로 재정의한다.** 지배 전략의 *형태*는 스칼라 난이도로 바뀌지 않는다 — 그건 룩의 랭크 관통 규칙에서 나오는 구조적 성질이고, 이 시리즈의 범위 밖이다.

### 0.2 두 번째로 큰 결정 — S3에서 틱 순서를 건드리지 않는다

초안의 S3는 `updateEnemyStatus`를 틱 2.5단계로 신설했다. 그 단계가 필요했던 이유는 **재생(초당 HP)과 비숍 감속(잔여 시간)** 둘뿐이다. 그리고 둘 다 실측상 값이 없다.

- **재생**: 유효 HP 배수라는 점에서 장갑과 수학적으로 동일한 축이다. 축이 겹치는 유형을 두 개 넣는 것은 노브만 늘린다.
- **비숍 감속**: 밸런스 렌즈 실측으로 파일당 가동률 8%대, 8파일 실전에서 웨이브당 누수 **1마리** 차이. `Enemy.slowTimer` 필수 필드 + 틱 단계 + `AttackOptions` 5번째 인자를 그 대가로 치른다.

**둘 다 이번 시리즈에서 뺀다.** 그러면 남은 3종(장갑·신속·보호막)은 전부 **`createEnemy` 시점 확정 + `resolveDamage` 안에서만 소비**되므로 **틱 순서에 새 단계가 하나도 생기지 않는다.** 초안의 R9(`updateCombat`에 phase 게이트가 없다)가 통째로 소멸한다.

### 0.3 최종 판정표

| 처방 | 판정 | 근거 |
|---|---|---|
| **1 — 8랭크 요새** | ❌ **뺀다** | §7.1. 단 초안의 근거 (b)는 반증되었으므로 근거를 교체했다 |
| **2 — 보너스 곡선** | ✅ **넣는다** | 가장 싸고 이후 모든 예산 논의의 기준선 |
| **2' — 무작위 지급** | ⚠️ **총량을 반으로 줄여 넣는다** | 곡선과 합치면 w5 예산 +86%. 게임이 지금보다 쉬워진다 |
| **3 — 이종 합성** | ✅ **넣는다 (스탯 = 재료 합, 폰×3 제외)** | 진단 ③의 유일한 답 |
| **4 — 적 유형** | ✅ **넣는다 (3종, 보스 배수 분리, 보호막=피해 풀)** | 목표를 재정의한 뒤 |
| **5 — 오프닝** | ❌ **뺀다** | §7.2 |

---

## 1. 착수 전 실측 — 이 계획이 서 있는 숫자

### 1.1 M1 — 보스 × 장갑 (실제 엔진, 8파일 전수)

18,800G 최소 승리 빌드 3종(룩16 + 퀸12, 퀸 배치만 다름)을 실제 `updateCombat`/`moveEnemies`로 보스 종주 전 구간 돌렸다.

| 웨이브 | 보스 HP | 배수 1.0 | 배수 0.75 | 배수 0.625 | 배수 0.6 |
|---:|---:|---|---|---|---|
| 5 | 420 | **8/8** | 8/8 | 8/8 | 8/8 |
| 10 | 570 | **8/8** | 8/8 | 8/8 | 8/8 |
| 15 | 1,170 | **8/8** | **5~7/8** | **0/8** | **0/8** |
| 20 | 1,770 | **0~4/8** | 0/8 | 0/8 | 0/8 |

**읽는 법.** w20은 원래 놓쳐도 이기는 보스다(§2.5 — hp 10 → −5 → 5 > 0 → victory). 그러므로 승리 조건은 **w5·w10·w15 처치**이고, 배수 0.625 이하를 보스에 걸면 w15에서 −5가 추가로 들어가 **hp 0 = 패배**다. 배수 0.75가 정확히 경계선이다(빌드에 따라 5~7/8 — 즉 "약간 더 사면 되는" 압력).

> ⚠️ **부수 발견 — 배수 1.0에서도 w20 보스 처치가 파일 추첨에 좌우된다**(0/8 ~ 4/8, 빌드 의존). 보스 스폰 파일 1회 추첨이 승패에 관여하는 구조는 이미 존재하며, 이 시리즈가 만든 것이 아니다.

### 1.2 M2 / M5 — 일반 웨이브는 포화 신호다

결정론적 쿼터 30%에 감산을 걸고 룩 n/파일(n=1..4)의 웨이브 누수를 실측했다.

| 배수 | w16 | w17 | w18 | w19 |
|---|---|---|---|---|
| 1.0 | 0,0,0,0 | 0,0,0,0 | 0,0,0,0 | 0,0,0,0 |
| 0.75 | 0,0,0,0 | 0,0,0,0 | 0,0,0,0 | **4**,0,0,0 |
| 0.625 | 0,0,0,0 | **12**,0,0,0 | **13**,0,0,0 | **14**,0,0,0 |
| 0.5 | **12**,0,0,0 | **13**,0,0,0 | **13**,0,0,0 | **14**,0,0,0 |

(각 칸 = 룩1/파일, 룩2/파일, 룩3/파일, 룩4/파일의 누수 횟수)

패턴 종속 장갑(직선 광선만 ×0.5)으로 바꿔 같은 골드의 혼합 빌드와 비교한 M5:

| 빌드 | 골드 | 무속성 w17/w19 | 패턴종속 ×0.5 w17/w19 |
|---|---:|---|---|
| 룩2/파일 | 8,000G | 0 / 0 | **0 / 0** |
| 룩1/파일 + 폰40 | 8,000G | 0 / 0 | **0 / 0** |
| 룩3/파일 | 12,000G | 0 / 0 | 0 / 0 |
| 룩2/파일 + 폰32 | 11,200G | 0 / 0 | 0 / 0 |

**결론 두 개.** ① 룩1/파일은 유형 도입만으로 무너지지만, 그 빌드는 `startHp 10`에서 이미 w10에 패배하므로(보스 누수 2회) **애초에 지배 전략이 아니다.** ② 룩2/파일 이상에서는 **스칼라도 패턴 종속도 신호를 만들지 못한다.** 처방 4의 성공 판정을 일반 웨이브에 거는 계획은 실측상 불가능하다.

### 1.3 M3 — N6은 rng를 보지 못한다

풀런 빌드(8파일 × 룩2)는 스폰 파일에 완전 대칭이다.

| rng | phase | hp | kills | gold | earned |
|---|---|---|---|---|---|
| `cycleRng()` | victory | 80 | 448 | 20,772 | 20,472 |
| `() => 0` (전부 파일 0) | victory | 80 | 448 | 20,772 | 20,472 |
| 시퀀스 3칸 시프트 | victory | 80 | 448 | 20,772 | 20,472 |
| **`Math.random`** | victory | 80 | 448 | 20,772 | 20,472 |
| `Math.random` 재시행 | victory | 80 | 448 | 20,772 | 20,472 |

초안은 판별력 0인 신호(§9.5 대조군)를 폐기하고 **구조가 같은 판별력 0 신호를 이름만 바꿔 그 자리에 넣었다.** 반면 카운팅 프록시는 즉시 작동한다 — 실측 `rng draw 총 횟수 = 452 = Σ enemyCount(1..20)`.

### 1.4 M4 — 보호막 방식이 골드 중립성을 가른다 (w19, 종주 24s)

| 방식 | 룩 T1×2 | 룩 T2×1 | 편차 | 폰 T1×2 | 폰 T2×1 | 편차 |
|---|---:|---:|---:|---:|---:|---:|
| **피격 3회 무효** | 65 | 50 | **−23.1%** | 18 | 12 | **−33.3%** |
| **피해 풀 (maxHp×0.3 = 17)** | 63 | 63 | **0.0%** | — | — | 0.0% |

보호막이 소모하는 단위가 '피해량'이 아니라 '피격 횟수'인데, 합성은 정확히 피격 횟수를 절반으로 줄인다. `config.ts:29-43`이 비숍 골드에 대해 이미 문서화한 함정과 **완전히 같은 구조**다.

### 1.5 부동소수 — `damageMultiplier`는 이진 정확값으로만 고른다

```
3 * 0.6   = 1.7999999999999998     ← 나이트(3), 아마존(3)
6 * 0.6   = 3.5999999999999996     ← T2 나이트
5 * 0.6   = 3                      ← 룩만 우연히 정확
3 * 0.625 = 1.875     5 * 0.625 = 3.125     3 * 0.75 = 2.25   ← 전부 정확
```

`e.hp -= damage`가 누산이므로 0.6은 N2의 정수 `toBe` 단언을 **밸런스와 무관하게** 깨뜨린다. **탐색 범위를 0.5 / 0.625 / 0.75로 못박고 기준값을 0.75로 둔다**(보스는 M1이 그 값을 경계로 지목했다).

### 1.6 예산 산술 (전부 CONFIG 유도, 교차검증 완료)

```
clearBonus(w) = max(0, 500 − 20(w−1))
Σ clearBonus(1..4)  = 500+480+460+440       = 1,880
Σ clearBonus(1..10) = 10×500 − 20×45        = 4,100
Σ clearBonus(1..20) = 20×500 − 20×190       = 6,200   (현행 6,000, +200)

w5  시작 전 = 300 + 608   + 1,880 = 2,788   (현행 2,108, +32.3%)
w11 시작 전 = 300 + 3,126 + 4,100 = 7,526   (현행 6,426, +17.1%)
총액        = 300 + 18,402 + 6,200 = 24,902 (현행 24,702, +0.8%)

지급 1회 기댓값 = .30×100 + .20×300 + .25×200 + .20×500 + .05×900 = 285G
20회 지급 = 5,700G   →  w5 시작 전 실질 구매력 3,928G (현행 대비 +86.3%)
```

**세 처방의 순효과를 산술로 확인해 두는 것이 이 시리즈의 전제다.** 처방 4가 올리는 요구(최소 승리 +3,600G 규모)보다 처방 2+2'가 주는 무상 가치(+5,900G)가 크면, 셋을 다 넣은 게임이 지금보다 **쉬워진다.** 아래 D3에서 이 균형을 명시적으로 맞춘다.

---

## 2. 확정 규칙 결정

### 2.1 경제

| # | 결정 | 근거 |
|---|---|---|
| **D1** | 클리어 보너스 = `max(0, 500 − 20(w−1))` **곡선**. 100G 정액안 폐기 | 진단은 "초반이 숨막힌다"인데 100G 정액은 w3 누적을 1,132 → 732G(−35%)로 더 조인다. 곡선은 1,512G(+34%). `Math.max(0, ·)` 클램프는 필수 — w26에서 음수가 되어 골드를 빼앗는다 |
| **D2** | 지급 총량 = **10회** (짝수 웨이브 클리어 시에만). 20회가 아니다 | §1.6. 20회면 무상 가치 5,700G가 처방 4의 난이도 상승을 통째로 상쇄한다. 10회면 2,850G — 곡선 +200G와 합쳐 총 +3,050G(+12.3%)로 처방 4의 요구 증가분과 대략 균형 |
| **D3** | 지급 가중치 = 폰 .30 / 비숍 .25 / **룩 .25** / 나이트 .20 / **퀸 0** | 퀸 5%는 10회 추첨에서 0회 60% · 2회 이상 8.6%. 최소 승리 빌드의 58%가 퀸이고 퀸은 **곱셈 축**이라 분산이 골드로 흡수되지 않는다. 5%를 룩에 얹어 기댓값 285 → **290G** 유지 |
| **D4** | 트레이 만석이면 **판매가 환급 + `grantDiscarded` 이벤트 + 배너** | ① 조용한 폐기는 §12.3 무음 실패 경로를 늘린다 ② 이월은 새 상태 + 불투명한 지급 시점 ③ 환급은 `sellPrice(type,1)` 재사용이라 새 규칙이 0개. ⚠️ 판매와 같은 취급이므로 `stats.totalGoldEarned`에 **넣지 않는다** |
| **D5** | 추첨은 **조건 없이** 10회 (w20 포함), 지급 실패는 D4 경로로 | 추첨을 조건부로 만들면 draw 수가 상태 의존이 되어 재현성이 사라진다 |
| **D6** | 지급 기물 초기 상태 = `buyPiece`와 동일 (tier 1, cooldown 0) | 다르게 두면 `grantPiece`가 `buyPiece`의 파생이 아니게 되고 §5.8 안티파밍과 충돌 |

### 2.2 적 유형 — 3종, 틱 단계 신설 없음

| # | 결정 | 근거 |
|---|---|---|
| **D7** | 유형은 **장갑 · 신속 · 보호막 3종.** 재생 제외, 비숍 감속 제외 | §0.2. 재생은 장갑과 같은 축이고, 비숍 감속은 실측 웨이브당 1마리. 둘을 빼면 `updateEnemyStatus` 틱 단계 · `Enemy.slowTimer` · `AttackOptions`가 전부 사라져 **S3의 계약 변경이 1건**(`applyAttack`의 damage 의미)으로 줄어든다 |
| **D8** | 장갑 = **비율 감산**, 값은 **이진 정확값에서만** 선택. 기본 `0.75` | 고정 −2는 §5.4 골드 중립성을 티어별로 제각각 깬다(룩 +33% / 나이트 +100% / **비숍 −50%**). 0.6은 §1.5의 부동소수 문제 |
| **D9** | **장갑에 보스 전용 배수를 별도로 둔다** — `armored.damageMultiplier` / `armored.bossDamageMultiplier` | §1.1. 두 값을 하나로 묶으면 일반 웨이브(포화)와 보스(선형)라는 **감도가 100배 다른 두 축**을 한 노브가 지배한다. 보스 기본값 0.75, 일반 기본값 0.625 |
| **D10** | **최소 피해 보장(MIN_DAMAGE)을 도입하지 않는다** | D8의 부수 이득. 비율이면 0을 만들 수 없어(T1 비숍 1 × 0.625 = 0.625) 무피드백 상태도 "비숍이 적을 회복시키며 10G를 버는" 버그도 원천 발생하지 않는다. **규칙이 하나 준다** |
| **D11** | 보호막 = **피해 풀** `absorbPool: 0.3` → `pool = round(maxHp × 0.3)` | §1.4. 피격 횟수 방식은 §5.4 골드 중립성을 룩 −23% / 폰 −33%로 깬다. 풀 방식이면 63 vs 63으로 **구성적으로** 중립 |
| **D12** | 보호막은 **피해만** 흡수한다. 처치 판정·처치 골드는 건드리지 않는다 | 풀이 남아 있어도 `hp`는 정상적으로 관측되므로 체력바가 거짓말하지 않는다. 풀은 별도 게이지로 표시(§S3 렌더) |
| **D13** | D11의 부수 결정 — **D16(융합물 interval 상속 금지)의 근거가 사라진다** | 초안의 D16 근거는 "챈슬러가 무제한 보호막 제거기가 된다"였다. 피해 풀은 횟수가 아니라 피해량을 소모하므로 나이트 폭발도 정직하게 지불한다. 그래도 **D16은 다른 근거로 유지**한다(§2.3) |
| **D14** | 신속을 **보스에서 제외** | §3.1이 "보스가 느린 이유 = 딜 넣을 시간"이라 못박았는데 ×0.5×1.5 = ×0.75면 종주 48s → 32s로 그 근거를 훼손한다. 그리고 M1이 보여주듯 보스 종주 시간은 승패에 직결된다 |
| **D15** | 유형 배정 = **결정론적 쿼터 + 유형별 위상 상수.** rng draw 0회 | `TRAIT_PHASE: Record<EnemyTrait, number>`를 두고 `(i*7 + w*3 + TRAIT_PHASE[t]) % 10 < round(traitRatio*10)`. 초안의 단일 식은 유형 인자를 받지 않아 **4종이 전부 같은 30%에게 얹힌다** — 렌즈 실측으로 w19 룩2/파일 누수가 0 vs 14로 갈린다 |
| **D16** | **일반 적은 최대 1속성. 보스는 w15부터 2속성** | 독립 30%×3이면 w12+ 에서 ≥1속성 65.7% · ≥2속성 18.9%로 난이도가 통제 불가능하게 튄다. 단일 속성이 밸런스 렌즈 실측상 가장 완만하다. **⚠️ 이 항목은 §8 갈림길 2번으로 사용자 확인 대상** |
| **D17** | 신속 적의 누수 피해 −1 유지, 처치 골드(maxHp) 유지 | 노출 시간 −33%가 곧 페널티다. '골드당 소요 화력'만 나빠진다 |

### 2.3 이종 합성

| # | 결정 | 근거 |
|---|---|---|
| **D18** | **융합 결과 스탯 = 재료 스탯의 합** (초안의 임의 수치 폐기) | 밸런스 렌즈 실측: 초안 수치는 1,000G당 웨이브 피해가 아치비숍 **162 vs 재료합 486(−67%)**, 챈슬러 **550 vs 753(−27%)**, 아마존은 퀸 대비 골드당 2.67배 나쁘다. 그런데 §6.3 판매가 불변식은 성립하므로 **손실이 판매가에도 툴팁에도 드러나지 않는다** — `config.ts:29-43`이 이미 문서화한 함정과 같은 구조. 스탯도 cost도 '합'이면 골드 중립이 **구성적으로** 성립하고 N4가 자동 통과한다 |
| **D19** | 구체 수치 — 아래 표 | cost는 재료 합(§D20). `interval`은 D21 |
| **D20** | 융합 cost = **재료 합 고정** (500 / 800 / 1,200) | 수수료 해석이면 `resolveLanding`이 처음으로 `state.gold`를 읽어야 하고 §7.3 미리보기 계약이 골드 축까지 확장된다. 재료 합이면 §5.3/§6.3 판매가 불변식이 **자동으로** 유지된다 |
| **D21** | 융합 3종 `interval: 3.0`. **`interval: 0`을 상속하지 않는다** | D13으로 원래 근거는 사라졌지만 남는 근거가 둘: ① 3.0이면 (a) 주기 발사 (b) L자 이동 쿨다운 (c) 배치 직후 폭발 후 재무장이 **한 값으로 일관**된다 ② `interval: 0`이면 §12.4의 휴면 코드가 계속 죽은 채 남는다. **그리고 이 결정은 `pieces.ts:161` 수정 없이는 코드 차원에서 무효다**(§0) |
| **D22** | 겸업 기물은 발사와 폭발이 **쿨다운을 공유**한다 | 분리하려면 `Piece`에 두 번째 쿨다운 필드가 필요하고 §4.2의 "쿨다운은 기물 ID에 묶여 있다" 불변식이 둘로 갈라진다 |
| **D23** | **⚠️ D22의 대가로 집기 게이트에 판매 예외를 명시적으로 판다** | `drag.ts:175`를 S1이 `TRAITS[·].blast`로 일반화하면 융합물은 웨이브의 **87.5% 동안 집을 수도 팔 수도 없다**(렌즈 실측: w19 24초 중 `cooldown === 0`인 틱 90/720). 판매는 이동이 아니므로 L자·쿨다운 제약의 근거가 적용되지 않는다 |
| **D24** | 이종 융합 쿨다운 = **타입이 바뀔 때만 `max(생존자, 흡수자)`. 동종 무변경** | §5.8 안티파밍이 이종에서 방향만 바꿔 되살아난다 — 쿨 2.9초 룩 위에 갓 산 나이트를 얹으면 2.9초 유지지만 반대로 얹으면 0이 되어 즉시 발사. `max`면 드래그 방향과 무관해진다. 동종을 안 건드리는 이유는 기존 `merge.test.ts` 쿨다운 승계 테스트 유지 |
| **D25** | **폰 ×3 승격 제외** | 4번째 드롭 존 + 선택 오버레이 + `slotIndex 16..18` 인코딩으로 융합 본체와 맞먹는 규모. 300G 폰 → 900G 퀸의 3배 차익도 생긴다 |
| **D26** | 융합물은 레시피 재료가 되지 않는다. 동종(아치비숍+아치비숍)은 기존 6a 분기가 그대로 받아 T2 | 일관성. 레시피 밖 조합은 전부 기존 경로(swap / typeMismatch)로 흐른다 |
| **D27** | 지급 가중치 표는 `Record<PieceType, number>` 유지, 융합 3종은 0 | `Partial<Record<·>>`로 바꾸면 앞으로 기물이 늘 때 컴파일러가 누락을 못 잡는다(`ATTACK_CUE_BY_PIECE`가 이미 그렇게 침묵하는 선례). 풀 판정은 `TRAITS[type].purchasable`로 교차검증 |

**D18/D19 확정 수치 — 재료 스탯의 합**

| 융합물 | 재료 | cost | damage | goldPerAttack | interval | buffFactor | pattern | blast | moveL |
|---|---|---:|---:|---:|---:|---:|---|---|---|
| **아치비숍** | 나이트 + 비숍 | 500 | **4** (=3+1) | **10** | 3.0 | 0 | `bishop` | ✔ | ✔ |
| **챈슬러** | 나이트 + 룩 | 800 | **8** (=3+5) | 0 | 3.0 | 0 | `rook` | ✔ | ✔ |
| **아마존** | 나이트 + 퀸 | 1,200 | **3** (=3+0) | 0 | 3.0 | **1.0** (=0+1) | `none` | ✔ | ✔ |

렌즈 실측 대조: 챈슬러 damage 8 = 1,000G당 웨이브 피해 **880 = 룩과 정확히 동률**. 아치비숍 damage 4 = 648(재료합 486 대비 +33%, 룩의 74% — 골드 생산까지 겸하므로 타당). 아마존 `buffFactor 1.0`은 퀸과 같은 계수이므로 §5.4의 퀸 예외 서술이 그대로 적용된다(1,200G에 damage 3 + 폭발이 붙는 만큼만 퀸보다 비싸다).

> **D18의 부수 효과 — 초안의 R7(반정수 데미지)이 소멸한다.** `buffFactor 0.5`가 없어지므로 `pieceDamage`가 정수를 벗어나지 않는다. 표시 전용 포맷터도 불필요하다.

### 2.4 검증

| # | 결정 | 근거 |
|---|---|---|
| **D28** | **N6에서 rng 감시 역할을 박탈한다.** 엔진 무결성 신호로만 쓴다 | §1.3. `Math.random`으로 돌려도 4값이 완전히 동일하다 |
| **D29** | **N8 신설 — 카운팅 rng 프록시.** `총 draw 수 === Σ enemyCount(1..20) === 452` | 밸런스와 완전히 무관하고 draw가 한 번만 더 일어나도 즉시 깨진다. D15(유형 rng 0회)와 S5의 스레드 분리를 **처음으로 실제로 강제**한다 |
| **D30** | **N7 신설 — 보스 3/4 처치 가능성.** 최소 승리 빌드로 w5·w10·w15·w20을 실제 엔진에 태워 kill/fail 단언 | §1.1. 현행 N1·N3·N6 어느 것도 이 축을 보지 않는다. N6는 `hp = 100` 고정이라 보스 누수가 패배가 되지 않는다(§9.5 ⚠️가 이미 경고한 관측 장치) |
| **D31** | **N1을 둘로 쪼갠다** — N1a(이론 상한, 골드) / N1b(실측 구매력 = `gold + Σ 지급 기물 원가`) | 초안의 N1은 정의상 지급 가치를 볼 수 없고, D4 환급은 N1a를 상한이 아니게 만든다. 두 신호로 쪼개면 "환급이 몇 골드를 만들었는가"가 처음으로 관측된다 |
| **D32** | `stepGame`의 `grantRng` 기본값 = **`Math.random`** (`= rng`가 아니다) | 초안의 기본값은 스폰 스레드를 공유해 시퀀스를 20회 민다. 그리고 N6가 그걸 못 잡는다(D28) |
| **D33** | 엔진 무결성 풀런은 `CONFIG.grant.enabled = false`로 돌린다. N5는 지급을 켠 **별도 런**에서 잰다 | 두 런을 섞으면 "엔진이 깨졌는가"와 "지급이 몇 번 폐기됐는가"가 한 숫자에 섞인다 |

---

## 3. 순서

```
S-1a 임시 파일 정리 + .gitignore                      [tests 2삭제 + .gitignore]
S-1b 작업 트리 커밋 (퀸 상한 6 + 기획안)               [src 3 + tests 2 + docs 1]
 ───────────────────────────────────────────────────────────────
 S0  회귀 신호 재구축 — 테스트만, src 0줄               [tests 3파일]
 S1  TRAITS 도입 — 동작 무변경 리팩터                   [src 13파일]
 S2  적 유형 3종 + 보스 배수 0.75 + 표시 3종            [src 8 + tests 6]   ← §−1.5로 앞당김
 S3  클리어 보너스 곡선 + 처치율 연동                   [src 3 + tests 3]   ← §−1.5로 미룸
 S4a 융합 기물 3종 정의 (레시피 없음, 등장 안 함)        [src 10 + tests 4 + 에셋 3]
 S4b 융합 레시피 + commitMerge 확장                     [src 3 + tests 2]
 S4c 겸업 기물 미리보기·설명 (highlights + tooltip)      [src 4 + tests 3]
 S5  무작위 지급 (10회)                                 [src 7 + tests 5]
 S6  문서 갱신 (v1.9)                                   [docs 1 + NOTICE 1]

모든 단계:  npm run build  AND  npx vitest run   ← 둘 다. vitest만으로는 안 보인다.
```

| 항목 | 값 |
|---|---|
| 커밋 수 | **11** (S-1a ~ S6) |
| `src/` 수정 파일(중복 제외) | 21개 중 **19개** + 신규 1(`core/fusion.ts`) |
| `tests/` 수정·신규 | **13** (신규 3: `signals.test.ts` · `traits.test.ts` · `fusion.test.ts`) |
| 신규 에셋 | SVG **3**, 효과음 **0** |
| 예상 기간 | S0~S2 1일 · S3 **1.5일**(재생·감속 제외로 단축) · S4a~c 3일 · S5 1일 · S6 0.5일 = **7일** |

---

## 4. 단계별 계획

각 단계 = 한 커밋. **공통 게이트는 `npm run build`(tsc --noEmit) + `npx vitest run` 둘 다 초록**이다. `tsconfig.json`의 `include`가 `["src","tests"]`인데 vitest는 타입체크를 하지 않으므로, `npx vitest run`만 돌리면 S3·S4a의 실패가 전부 보이지 않는다.

---

### S-1a — 임시 파일 정리 (착수 전제)

```bash
rm tests/tmp-balance.test.ts tests/tmp-balance2.test.ts
# .gitignore 에 추가:  .DS_Store  /  tests/tmp-*
```

두 파일은 착수 전 조사의 잔재이며 `Trait`·`E`·`Cfg` 같은 S3 프로토타입 타입을 들고 있다. 남겨 두면 이후 모든 단계의 "388개 그대로"라는 합격선이 임시 하네스를 포함한 채 고정된다.

**게이트**: `npx vitest run` = **28파일 388통과**(실측 확인 완료) · `npm run build` 초록.
**앞으로 모든 측정용 임시 파일은 저장소가 아니라 스크래치패드 사본에서 돌린다.**

---

### S-1b — 작업 트리 커밋

퀸 상한 3→6 변경분(`src/config.ts` · `src/ui/titleScreen.ts` · `src/ui/tooltip.ts` · `tests/merge.test.ts` · `tests/tooltip.test.ts`) + `docs/game-design.md`를 커밋한다. 이후 모든 단계의 합격선이 기준선을 가져야 한다.

**게이트**: 388/388 · `npm run build` 초록 · `git status --short`가 **비어 있음**.

---

### S0 — 회귀 신호 재구축 (src 0줄)

§1에서 확인한 대로 현행 두 신호(§9.5 대조군 · w5 게이트)로는 5단계 중 하나도 제대로 감시되지 않는다. **코드를 한 줄도 바꾸기 전에** 감시망을 세운다.

#### 만드는 것

```ts
// tests/helpers.ts
/** 단일 적 1마리 종주 중 build가 실제로 넣은 총피해 — 연속량이라 해상도가 높다 */
export function transitDamage(wave: number, pieces: Piece[], spawnFile: number): number;

/** simulation.test.ts의 module-private 함수를 이관 + export (본문 무변경) */
export function chaseWave5Boss(chasePieces: Piece[], staticPieces?: Piece[]): {
  dealt: number; killed: boolean; hp: number; wave: number;
  bossHp: number; bossSpawnT: number; bossKillT: number;
};

/** ★ N7 — 보스 1마리를 지정 파일에 스폰해 종주 전 구간을 실제 엔진으로 돌린다 */
export function bossTransit(wave: number, spawnFile: number, pieces: Piece[]): {
  dealt: number; killed: boolean; killT: number;
};

/** ★ N7 — CONFIG에서 유도한 최소 승리 빌드 (룩16 + 퀸12) */
export function minWinBuild(): Piece[];

/** ★ N8 — draw 수를 세는 rng 프록시 */
export function countingRng(inner: () => number): (() => number) & { count(): number };

/** 20웨이브 완주 풀런 (S5에서 grant 집계 확장) */
export function fullRun(pieces: Piece[], rng: () => number): RunReport;
```

`tests/signals.test.ts`(신규)에 아래 8개 신호를 세운다.

#### 신호 8종과 기준선 (전부 CONFIG 유도, §10.2 준수)

| # | 신호 | 현재 값 | 감시 단계 |
|---|---|---|---|
| **N1a** | 이론 예산 상한 `startGold + grossKillGold(w) + Σ clearBonus(1..w−1)` | w5 **2,108** / w11 **6,426** / 총 **24,702** | S2 |
| **N1b** | 실측 구매력 `max(state.gold) + Σ(지급 기물 원가)` | (S5에서 기준선) | S5 |
| **N2** | 단일 적 종주 총피해 (**연속량**) | 아래 표 | S3, S4 |
| **N3** | w5 게이트 **최소성** | 아래 표 | 전 단계 |
| **N4** | 합성 골드 중립성 — **장갑·보호막 전 유형** | 모든 k에 성립 | S3, S4 |
| **N5** | 지급 폐기 횟수 | (S5에서 기준선) | S5 |
| **N6** | 엔진 무결성 풀런 (**rng 감시 역할 없음**, D28) | victory · hp 80 · 448킬 · earned 20,472 | 전 단계 |
| **N7** | **보스 3/4 처치 가능성** ★신설 | 아래 표 | S3 (핵심) |
| **N8** | **rng draw 총수** ★신설 | **452** | S5 (핵심) |

**N2 기준선** (측정 완료, 전부 CONFIG 유도 가능)

| 빌드 | 유도식 | w17 (HP 47) | w19 (HP 55) |
|---|---|---|---|
| T1 룩 1기, 자기 파일 | `floor(24 / 3.0) × 5` | **40** | **40** |
| T1 룩 2기, 같은 파일 | 문턱 초과 → 처치 | 47 | 55 |
| T2 룩 1기 | 문턱 초과 → 처치 | 47 | 55 |
| T1 폰 2기 (b4·d4), 파일 2 스폰 | `floor(3.0 / 0.5) × 2 × 2` | **24** | **24** |
| T1 비숍 1기 (d4), 파일 3 스폰 | `floor(3.0 / 3.0) × 1` | **1** | **1** |

> **T1 룩 1기의 40이 이 게임에서 가장 값진 회귀 신호다.** w17의 47·w19의 55라는 문턱과 정확히 맞물려 있고, 화력·감산·속도 어느 축을 건드려도 **선형으로 반응**한다. `누수 0`이라는 포화 신호(§1.2)와 달리 해상도가 있다.

**N3 기준선** (원본 하네스로 측정 완료)

```ts
expect(pawnsOnly.dealt).toBe(336);            // 폰 2기 완벽 추격
expect(rookOnly.dealt).toBe(80);              // 룩 1기 (보스 파일)
expect(bishopOnly.dealt).toBe(4);             // 비숍 1기 (d4 고정)
expect(withoutRook.killed).toBe(false);       // 룩을 빼면 실패 — 하향 감지
expect(withoutOnePawn.killed).toBe(false);    // 폰 1기를 빼면 실패 — 하향 감지
expect(withoutBishop.killed).toBe(true);      // ⚠️ 비숍 없이도 처치된다 (실측)
expect(withoutBishop.bossKillT).toBeCloseTo(descentSeconds, 1);  // 48.0s = 마지막 틱
```

마지막 줄이 **상향 방향의 유일한 감지기**다. 문서의 "가산 추정 합 420 = 마진 0"은 개별 측정치의 합이고 실제 결합 화력은 그보다 크다(§2.3의 "보드를 막 벗어난 적도 그 틱의 공격 대상" 규칙 때문). 현행 `killed === true` 하나는 **200G짜리 기물이 통째로 빠져도 초록이다.**

**N7 기준선** ★ (실측 완료 — 이 시리즈에서 가장 중요한 신호)

```ts
const build = minWinBuild();                         // 룩16 + 퀸12 = 18,800G, CONFIG 유도
for (const w of [5, 10, 15]) {
  for (let f = 0; f < CONFIG.board.files; f++) {
    // 보스 3마리는 어느 파일에 나와도 반드시 잡혀야 한다 — 못 잡으면 hp 10이 0이 된다
    expect(bossTransit(w, f, build).killed).toBe(true);
  }
}
// w20은 놓쳐도 이긴다(§2.5: hp 10 → −5 → 5 > 0). 여기는 처치를 요구하지 않는다.
const w20 = range(8).map(f => bossTransit(20, f, build));
expect(w20.filter(r => r.killed).length).toBeLessThan(CONFIG.board.files);  // 여유 없음을 고정
```

| 웨이브 | 배수 1.0 | 배수 0.75 | 배수 0.625 |
|---:|---|---|---|
| 5 · 10 | 8/8 · 8/8 | 8/8 · 8/8 | 8/8 · 8/8 |
| **15** | **8/8** | **5~7/8** | **0/8** |
| 20 | 0~4/8 | 0/8 | 0/8 |

**N4 — 합성 중립성 단위 테스트 (유형 전수로 확장)**

```ts
// 티어 k 기물 1기의 "유효 피해"(감산·흡수 통과 후) ÷ 2^(k−1) 는 티어와 무관하게 일정해야 한다.
// 장갑(비율)이면 성립, 보호막(피해 풀)이면 성립. 고정 감산·피격 횟수 방식이면 깨진다.
for (const trait of ALL_TRAITS) {          // ← 초안은 armored 하나만 봤다
  for (const type of PURCHASABLE) {
    for (let k = 1; k <= CONFIG.merge.maxTier[type]; k++) {
      const perGold = transitEffectiveDamage(piece(type, k), enemyWith(trait)) / tierMultiplier(k);
      expect(perGold).toBeCloseTo(base[type][trait], 9);
    }
  }
}
```

**N8 — rng 감시**

```ts
const rng = countingRng(cycleRng());
fullRun(rooksTwoPerFile(), rng);
let expected = 0;
for (let w = 1; w <= CONFIG.wave.total; w++) expected += enemyCount(w);
expect(rng.count()).toBe(expected);   // 실측 452 — draw가 한 번만 더 일어나도 깨진다
```

#### 파일별 변경

| 파일 | 변경 |
|---|---|
| `tests/helpers.ts` | `transitDamage` · `chaseWave5Boss` · `bossTransit` · `minWinBuild` · `countingRng` · `fullRun` |
| `tests/simulation.test.ts` | private `chaseWave5Boss` 삭제 → helpers import (동작 무변경) |
| `tests/signals.test.ts` | **신규** — N1a·N2·N3·N4·N6·N7·N8 기준선 |

#### 검증 게이트

- `npx vitest run` **388 + 신규 초록** · `npm run build` 초록
- 신호 로그가 위 기준선과 **정확히** 일치 (불일치 = 헬퍼 이관에서 하네스가 달라진 것)
- **N7이 w5·w10·w15 전부 8/8이어야 한다** — 여기가 이후 S3의 유일한 난이도 판정 기준이다
- **N8이 정확히 452**

#### 롤백

이 커밋만 `git revert`. `src/` 무변경이라 위험 0.

---

### S1 — TRAITS 도입 (동작 무변경 리팩터)

**시리즈 전체에서 가장 값싸고 가장 많이 갚는 커밋이다.** 지금 `type === 'knight'` 술어가 10곳, `type === 'queen'`이 8곳에 흩어져 있고 **컴파일 시 전수성이 보장되는 것은 하나도 없다**(실측 grep). 융합 3종을 여기 얹으면 침묵 지점이 그대로 늘어난다.

#### 만드는 것

```ts
// src/config.ts — 처방 3·4가 전부 이 표에서 파생된다
export type AttackPattern = 'pawn' | 'bishop' | 'rook' | 'none';

export interface PieceTraits {
  pattern: AttackPattern;   // 주기 발사 패턴. 'none' = updateCombat 루프에서 제외
  blast: boolean;           // 배치·이동·합성 직후 3×3 폭발 (tryKnightBlast)
  moveL: boolean;           // 보드 위 이동이 L자로 제한 (게이트 3, drag 집기 거부)
  buffFactor: number;       // 퀸 라인 버프 계수 (buff.ts) — queen 1, 나머지 0
  purchasable: boolean;     // 상점 노출 + canBuy 가드 + (S5) 지급 풀
}

export const TRAITS: Record<PieceType, PieceTraits> = {
  pawn:   { pattern: 'pawn',   blast: false, moveL: false, buffFactor: 0, purchasable: true },
  knight: { pattern: 'none',   blast: true,  moveL: true,  buffFactor: 0, purchasable: true },
  bishop: { pattern: 'bishop', blast: false, moveL: false, buffFactor: 0, purchasable: true },
  rook:   { pattern: 'rook',   blast: false, moveL: false, buffFactor: 0, purchasable: true },
  queen:  { pattern: 'none',   blast: false, moveL: false, buffFactor: 1, purchasable: true },
};
```

> **초안에 있던 `slowSeconds` 필드를 뺐다** — D7로 비숍 감속을 시리즈에서 제외했으므로 항상 0인 필드를 미리 만들지 않는다.

```ts
// src/core/patterns.ts — 폭발 범위를 사거리에서 분리한다
export function attackTargets(type: PieceType, sq: Square): Square[] {
  switch (TRAITS[type].pattern) {
    case 'pawn':   return pawnTargets(sq);
    case 'bishop': return bishopTargets(sq);
    case 'rook':   return rookTargets(sq);
    // 'none': 나이트는 폭발 범위를 사거리 그림 폴백으로 계속 돌려준다 —
    // tests/patterns.test.ts:40(길이 9)과 highlights.test.ts:268이 이 값을 못박고 있다.
    // S4c의 하이라이트 게이트도 이 폴백에 의존한다.
    case 'none':   return TRAITS[type].blast ? knightBlastTargets(sq) : [];
  }
}
/** 폭발 범위 — 겸업 기물(S4)에서 attackTargets와 갈라진다 */
export function blastTargets(type: PieceType, sq: Square): Square[] {
  return TRAITS[type].blast ? knightBlastTargets(sq) : [];
}
```

#### 술어 교체표 (전부 현행과 동치)

| 파일:행 | 현행 | 교체 |
|---|---|---|
| `core/combat.ts:74` | `def.damage === 0 \|\| p.type === 'knight'` | `TRAITS[p.type].pattern === 'none' \|\| def.damage === 0` |
| **`core/pieces.ts:161`** ★ | **`piece.cooldown = CONFIG.pieces.knight.interval`** | **`CONFIG.pieces[piece.type].interval`** — 순수 나이트에는 **완전한 no-op**(knight.interval을 그대로 읽는다). 이 줄이 없으면 D21이 코드 차원에서 무효가 되고 어떤 신호도 못 본다 |
| `core/pieces.ts:158` | `knightBlastTargets(piece.square!)` | `blastTargets(piece.type, piece.square!)` — blast 범위 단일 출처 확보 |
| `core/pieces.ts:78` | `fromBoard && piece.type === 'knight'` (한 블록) | **두 술어로 분리** — 쿨다운은 `TRAITS[·].blast`, L자는 `TRAITS[·].moveL`. 근거가 다르다(전자는 폭발 삼킴 방지, 후자는 행마 규칙) |
| `core/pieces.ts:100` | `occupant.type === 'knight' && cooldown > 0` | `TRAITS[occupant.type].blast && ...` |
| `core/pieces.ts:177,183,213,221` | `.type === 'knight'` → `tryKnightBlast` | `TRAITS[·].blast` |
| `core/buff.ts:16` | `q.type !== 'queen'` | `const f = TRAITS[q.type].buffFactor; if (f === 0) continue;` + 누산 `+= tierMultiplier(q.tier) * f` |
| `core/patterns.ts:47-55` | `switch(type)` | `switch(TRAITS[type].pattern)` + `blastTargets` 신설 |
| `core/economy.ts:18` | — | `canBuy`에 `TRAITS[type].purchasable` 가드 추가 |
| `render/highlights.ts:96` | `piece.type === 'queen'` | `TRAITS[piece.type].buffFactor > 0` |
| `render/highlights.ts:114` | `piece.type === 'knight' && onBoard` | `TRAITS[piece.type].moveL && onBoard` |
| `render/highlights.ts:126` | `attackTargets('knight', hover)` | `blastTargets(piece.type, hover)` |
| `render/effects.ts:36-42` | `pieceType === 'pawn'` / `'rook' \|\| 'bishop'` | `TRAITS[pieceType].pattern` 분기 + **`else` 추가**(현행은 knight/queen에 침묵) |
| `audio/cues.ts:120` | `Partial<Record<PieceType, CueKind>>` | **`Record<PieceType, CueKind \| null>`로 승격** — 두 번째 침묵 지점 제거. 신규 에셋 0개 |
| `ui/tooltip.ts:21,22,40` | knight / queen 특례 | `blast` / `moveL` / `buffFactor` — **⚠️ 단순 치환 금지, S4c의 가산 재작성과 함께 본다**(아래) |
| `ui/drag.ts:175` | `piece.type === 'knight'` 집기 거부 | `TRAITS[piece.type].blast` + **D23의 판매 예외를 같은 패스에서 판다** |
| `ui/titleScreen.ts:64,65,70,95,96` | knight / queen 분기 | `buffFactor` / `blast` / `moveL`, `rangeSquares`는 `attackTargets ∪ blastTargets` |

**같은 패스에서 함께 고칠 것**

1. `ui/drag.ts:205`의 `sellPrice(piece!.type)` → `sellPrice(piece!.type, piece!.tier)`. §12.1-A의 현존 버그이고, 융합 기물(원가 1,200G)이 들어오면 두 배로 아파진다.
2. **`ui/tooltip.ts:22`의 배타 삼항을 손대지 않는다.** 실측 확인: 현행은 `p.type === 'queen' ? [버퍼 3행] : [데미지 4행]`이다. 이걸 `buffFactor > 0`으로 **문자 그대로 치환하면 S4c에서 아마존이 버퍼 분기로 들어가 공격력·주기·쿨다운 행이 통째로 사라진다.** S1에서는 `p.type === 'queen'`을 그대로 두고, S4c에서 가산 구조로 한 번에 재작성한다. 이 결정을 주석에 남긴다.

#### 깨질 기존 테스트

**하나도 깨지지 않아야 한다.** `attackTargets('knight')`가 계속 3×3을 돌려주도록 `pattern: 'none' && blast` 폴백을 둔 것이 `patterns.test.ts:40`과 `highlights.test.ts:268`을 지키는 장치다. `pieces.ts:161` 교체도 순수 나이트에는 no-op이다.

#### 검증 게이트

- **`npx vitest run` 388/388 그대로 통과가 유일한 합격선.** 하나라도 깨지면 동치 교체 실패이므로 되돌린다
- `npm run build` 초록
- N1a·N2·N3·N4·N6·N7·N8 전부 **기준선 불변**
- 신규 `tests/traits.test.ts`: `TRAITS`의 모든 키가 `PieceType` 전수인가 · `pattern === 'none' && !blast`인 기물은 `attackTargets`가 `[]`인가 · **`tryKnightBlast` 후 `cooldown === CONFIG.pieces[type].interval`인가**(161행 회귀 방지)

#### 롤백

순수 리팩터라 revert 안전. **이 커밋이 초록이 아니면 S3·S4에 절대 들어가지 말 것** — 이후 두 단계가 전부 이 표 위에 선다.

---

### S2 — 클리어 보너스 곡선

#### 만드는 것

```ts
// src/config.ts — enemyHp/enemyCount와 같은 층 (§10.1 "파생값은 배열이 아니라 함수")
wave: { total: 20, prepareSeconds: 10, clearBonusBase: 500, clearBonusDecay: 20, ... }

export function clearBonus(wave: number): number {
  const { clearBonusBase, clearBonusDecay } = CONFIG.wave;
  return Math.max(0, clearBonusBase - clearBonusDecay * (wave - 1));
}
```

#### 파일별 변경

| 파일 | 변경 |
|---|---|
| `src/config.ts` | `wave.clearBonus: 300` 삭제 → `clearBonusBase/Decay` + `clearBonus()` |
| `src/core/wave.ts:41-42` | `CONFIG.wave.clearBonus` 2회 → `const bonus = clearBonus(state.wave)` 한 번 계산해 재사용. ⚠️ 보너스 지급이 `state.wave++`보다 **앞**이므로 인자는 **방금 끝난 웨이브 번호**가 맞다 |

#### 깨질 기존 테스트와 대응

| 위치 | 대응 |
|---|---|
| `tests/wave.test.ts:80,82,105` (`+300` 3곳) | `clearBonus(1)` / `clearBonus(20)`에서 **유도** (§10.2 — 새 숫자 하드코딩 금지) |
| `tests/simulation.test.ts:129` | `CONFIG.wave.clearBonus * CONFIG.wave.total` → `Σ clearBonus(1..20)` |
| `tests/simulation.test.ts:271` `goldCeilingBeforeWave` | `clearBonus * (wave−1)` → `Σ clearBonus(1..wave−1)` |
| `tests/signals.test.ts` N1a | 2,108/6,426/24,702 → **2,788/7,526/24,902**로 갱신하되 **유도식으로**. 이 커밋에서 값이 바뀌는 것이 정상이고, 그 값을 기록에 남기는 것이 이 신호의 목적 |

#### 검증 게이트

- `npx vitest run` 전부 초록 · `npm run build` 초록
- **N1a가 정확히 2,788 / 7,526 / 24,902** (§1.6에서 산술 교차검증 완료)
- N2·N3·N4·N6·N7·N8 **불변** — 골드는 화력에 영향을 주지 않으므로 하나라도 움직이면 뭔가 잘못된 것
- `simulation.test.ts:320` `buildCost < ceiling`, `:418` `twoEach.cost < ceiling` — 여유폭이 커지므로 통과. 로그로 새 여유폭 기록

#### 롤백

`config.ts` 2줄 + `wave.ts` 2줄. 완전 국소적.

---

### S3 — 적 유형 3종 (장갑 · 신속 · 보호막)

**초안 대비 규모가 절반이다.** 재생·비숍 감속을 뺐으므로(D7) `updateEnemyStatus` 틱 단계도, `Enemy.slowTimer`도, `AttackOptions` 5번째 인자도 없다. 남은 계약 변경은 **하나뿐**: `applyAttack`의 `damage` 인자가 '실제 피해'에서 '감산 전 원피해'로 바뀌고, 그 함수를 나이트 폭발이 공유한다.

#### 만드는 것

```ts
// src/types.ts — 정체성(traits)과 런타임 상태(shieldPool)를 분리
export type EnemyTrait = 'armored' | 'swift' | 'shielded';
export interface Enemy {
  /* 기존 ... */
  traits: readonly EnemyTrait[];  // 스폰 시 확정, 이후 불변
  shieldPool: number;             // 남은 흡수 피해량 (D11 — 횟수가 아니다)
}
```

```ts
// src/config.ts — traitDefs는 Record<EnemyTrait, ·>라 컴파일러가 누락을 잡아준다
traitDefs: {
  // ★ D8/D9 — 비율 감산, 이진 정확값, 보스는 별도 배수
  armored:  { damageMultiplier: 0.625, bossDamageMultiplier: 0.75 },
  swift:    { speedMultiplier: 1.5 },
  shielded: { absorbPool: 0.3 },      // ★ D11 — pool = round(maxHp × 0.3)
} as Record<EnemyTrait, TraitDef>,

traitSchedule:  { armored: 6, swift: 9, shielded: 12 },
traitRatio:     0.3,
TRAIT_PHASE:    { armored: 0, swift: 3, shielded: 7 } as Record<EnemyTrait, number>,  // ★ D15
maxTraitsNormal: 1,        // ★ D16
bossTraitCountFromWave: 15,
bossForbidden: ['swift'] as const,    // ★ D14

/** 결정론적 쿼터 — rng를 소비하지 않는다 (D15). N8이 이 사실을 강제한다 */
export function enemyTraits(wave: number, spawnIndex: number, isBoss: boolean): EnemyTrait[];
```

```ts
// src/core/combat.ts — 장갑·보호막의 유일한 근거지 (§10.6)
/** raw = 감산 전 원피해. 보호막 → 장갑 순서로 소비한다 */
export function resolveDamage(e: Enemy, raw: number): number {
  let d = raw * armorMultiplierOf(e);        // (1) 비율 감산. 바닥 불필요 (D10)
  if (e.shieldPool > 0) {                    // (2) 남은 풀에서 차감 — 관측 가능해야 한다
    const absorbed = Math.min(e.shieldPool, d);
    e.shieldPool -= absorbed;
    d -= absorbed;
  }
  return d;
}
export function applyAttack(state, targets, damage, events): void;   // damage는 이제 '원피해'
```

> **순서가 규칙이다** — 장갑을 먼저 걸고 그 뒤 풀에서 뺀다. 반대로 하면 장갑 적이 풀을 더 오래 유지해 두 유형이 곱셈으로 겹친다. 이 순서를 `resolveDamage` 주석과 §10.6 표에 등재한다.

```ts
// src/core/enemy.ts
export function createEnemy(wave, file, isBoss, id, traits?: readonly EnemyTrait[]): Enemy;
// speed = base × (보스 0.5) × (신속 1.5)  — 영구 배수만 speed에 굽는다
//   (enemy.test.ts:26-37이 e.speed를 직접 단언하므로 이 성질을 보존한다)
// shieldPool = traits.includes('shielded') ? Math.round(maxHp * absorbPool) : 0
```

#### 파일별 변경 (초안 8파일 → **6파일**)

| 파일 | 변경 |
|---|---|
| `src/types.ts` | `EnemyTrait` 유니온 + `Enemy` 2필드. ⚠️ 같은 파일을 여는 김에 `Piece.tier:13-18` 주석의 **옛 가산 모델 서술**(§12.2)을 함께 고친다 |
| `src/config.ts` | `traitDefs`(전수 Record) · `traitSchedule` · `TRAIT_PHASE` · `traitRatio` · `enemyTraits()` |
| `src/core/wave.ts:28-31` | `createEnemy(..., enemyTraits(state.wave, state.spawnedCount, isBoss))`. ⚠️ **여기서 `rng()`를 추가로 뽑지 말 것 — N8이 잡는다** |
| `src/core/enemy.ts` | `createEnemy` traits 인자 + speed 배수 + `shieldPool` 초기화 |
| `src/core/combat.ts` | `resolveDamage` 신설 + `applyAttack` 루프에서 적별 감산 |
| `src/render/renderer.ts` | ① 체력바 `w * max(0, hp/maxHp)`에 **상한 클램프 추가**(`min(1, ·)`) ② 유형 표식과 보호막 게이지는 **`arc`/`stroke`로만**(반지름 ≤ 30) — `fillRect`·`fillText`는 절대 쓰지 말 것 |
| `src/ui/titleScreen.ts` | (권장) '적 유형' 탭 신설. 현재 플레이어가 장갑·보호막을 배울 화면이 **어디에도 없다**(적 툴팁 자체가 없다). 수치는 `traitDefs`에서 파생 |

**`src/core/step.ts`는 변경 없다** — D7의 직접 귀결이며, 이것이 이 개정의 핵심 구조적 이득이다.

#### 깨질 기존 테스트와 대응

| 위치 | 증상 | 대응 |
|---|---|---|
| `tests/renderer.test.ts:13` | **TS 에러** (`makeEnemy` 리터럴) | 신규 2필드 추가 |
| `tests/rendererSprites.test.ts:31` | **TS 에러** | 동일 |
| `tests/simulation.test.ts:146` | **TS 에러** (보스 리터럴) | 동일 |
| `tests/combat.test.ts` (5곳) | 무속성이면 통과 | `damage` 인자 의미가 '원피해'로 바뀐 사실을 주석으로 못박고 `resolveDamage` 전용 describe 신설 |
| `tests/enemy.test.ts:26-37` | 속도 단언 | 신속 케이스 추가(base×1.5). 보스×신속은 **금지 조합**이므로 테스트하지 않고 **금지 자체를 단언** |
| `tests/renderer.test.ts:31/48/81/95` | 카운트 단언 4종 | 표식을 `arc`로만 그리면 전부 무사. **그 사실을 검증하는 테스트를 함께 추가** |

> ⚠️ **위 세 개의 TS 에러는 `npx vitest run`에서 전부 보이지 않는다.** `npm run build`를 게이트에 넣지 않으면 이 단계는 조용히 깨진 채로 통과한다.

#### 검증 게이트

- `npm run build` 초록 (**이 단계에서 가장 중요한 게이트**)
- `npx vitest run` 전부 초록
- **N4가 장갑·보호막 양쪽에 대해 성립해야 한다** — 깨지면 장갑을 고정 감산으로, 또는 보호막을 피격 횟수로 구현한 것이다. **이 신호가 D8·D11을 강제하는 장치다**
- **N7이 w5·w10·w15에서 여전히 8/8이어야 한다** ★ — 이것이 이 단계의 **난이도 합격선**이다. 실패하면 `bossDamageMultiplier`를 올려 튜닝한다(§1.1의 표가 탐색 지도)
- **N2가 움직여야 한다** — 안 움직이면 유형이 실제로 적용되지 않은 것
- **N8이 여전히 452** — 움직이면 D15를 어기고 rng를 뽑은 것
- **N3 최소성 재측정: w5는 유형 도입 전(w6부터 장갑)이라 불변이어야 한다.** 움직이면 감산이 스케줄을 무시하고 적용된 것
- N1a·N6 불변
- **유형 혼합률을 `Record<EnemyTrait, number>` 단위로 웨이브별 전수 검사** — 총량만 재면 유형별 편중을 못 잡는다(D15의 결정론성을 확인하는 유일한 방법)

#### 헤드리스로 재야 할 밸런스 지표

```
① N7 — 보스 3/4 처치 가능성 (armorMul · bossArmorMul 격자 탐색)  ← 처방 4의 성패 판정
② N2 전 항목 (도입 전/후, 유형별로 분리)
③ 웨이브별 유형별 혼합률 (Record 전수, 30%±1)
④ 룩n/파일(n=1..4)의 w16~19 누수 표 — 포화 확인용 (§1.2 재현)
⑤ 풀런 총 처치·총 골드 (경제 너프 폭)
⑥ 나이트 조작 빈도 f=1/3(손익분기) 과 f=2(빠른 조작) 두 벌  ← 유형이 손목 속도에 유리한지
```

#### 롤백

`config.traitRatio = 0`으로 두면 **코드 변경 없이** 유형이 전부 사라진다(§10.9 선례). 완전 롤백 전에 이 노브부터 돌린다. 보스만 되돌리려면 `bossDamageMultiplier = 1`.

---

### S4a — 융합 기물 3종 정의 (레시피 없음 — 게임에 등장하지 않는다)

**실측**: 저장소 사본에 `PieceType` 3종만 추가하고 `tsc --noEmit`을 돌리면 **12개 파일 25곳**이 에러다(TS2739 Record 누락 5곳 · TS7053 인덱싱 19곳 · TS2366 switch 1곳). 최소 정의를 채우면 런타임 실패는 **1개뿐**이다. **이 낮은 실패 수가 곧 위험 신호다** — 기존 스위트가 새 축을 사실상 전혀 커버하지 않는다는 뜻이다.

이 단계에서는 **레시피를 만들지 않는다.** 3종은 정의되고 컴파일되고 렌더될 수 있지만 게임 중 생성되는 경로가 없다.

#### 만드는 것

```ts
// src/types.ts
export type PieceType = 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen'
                      | 'archbishop' | 'chancellor' | 'amazon';
```

```ts
// src/config.ts — 스탯·cost 모두 재료 합 (D18/D20). interval 3.0 (D21)
archbishop: { cost:  500, damage: 4, interval: 3.0, goldPerAttack: 10 },  // 나이트+비숍
chancellor: { cost:  800, damage: 8, interval: 3.0, goldPerAttack: 0  },  // 나이트+룩
amazon:     { cost: 1200, damage: 3, interval: 3.0, goldPerAttack: 0  },  // 나이트+퀸

merge: { maxTier: { ..., archbishop: 6, chancellor: 6, amazon: 6 } },     // 반드시 6

TRAITS: {
  archbishop: { pattern: 'bishop', blast: true, moveL: true, buffFactor: 0,   purchasable: false },
  chancellor: { pattern: 'rook',   blast: true, moveL: true, buffFactor: 0,   purchasable: false },
  amazon:     { pattern: 'none',   blast: true, moveL: true, buffFactor: 1.0, purchasable: false },
}
```

> **아마존이 `pattern: 'none'`인 이유** — `queenLines` 공격 패턴을 갖는 기물이 존재하지 않으므로 `AttackPattern`에 죽은 분기가 생기지 않고, §12.5의 "damage 0 / pattern none이면 주기 발사 제외" 가드가 그대로 작동하며, 아마존의 화력은 폭발(damage 3 × blast)로 전달된다. **damage 3 + buffFactor 1.0이 정확히 나이트 + 퀸의 합이다.**

#### 파일별 변경

| 파일 | 변경 | 에러 종류 |
|---|---|---|
| `src/types.ts:1` | 3종 추가 | (발원지) |
| `src/config.ts:45,83` | `pieces` 3항 + `maxTier` 3항(**반드시 6**) + `TRAITS` 3항 | — |
| `src/core/patterns.ts` | **S1에서 이미 TRAITS 기반**이라 무변경 | TS2366 회피 |
| `src/core/combat.ts:15,28,73` · `economy.ts:21,28,44` · `pieces.ts:102,161` | 인덱싱 — `PieceType`이 늘면 자동 해소 | TS7053 |
| `src/render/sprites.ts:34-40` | `ALLY_SPRITE_URL` 3항 — **SVG 3종 신규 제작 필수** | TS2739 |
| `src/render/renderer.ts:42-44` | `ALLY_GLYPH` 폴백 3종 — 유니코드에 널리 렌더되는 페어리 글리프가 없다(U+1FA00 블록 커버리지 빈약). `♝`/`♜`/`♛` 재사용 + **폴백이 모호해진다는 사실을 주석에** | TS2739 |
| `src/render/effects.ts` | S1의 `else` 분기가 `pattern` 기반이라 자동 처리 | — |
| `src/audio/cues.ts:120` | S1에서 `Record<·, CueKind\|null>`로 승격했으므로 **컴파일러가 3종 누락을 잡는다**. `archbishop:'bishop', chancellor:'rook', amazon:null`. **신규 .ogg 0개** | TS2739 |
| `src/ui/layout.ts:22,85` | `PIECE_NAME` 3항. `SHOP_ORDER`는 리터럴 배열이라 **3종이 상점에 안 뜨는 것이 기본값이며 의도한 동작** | TS2739/7053 |
| `src/ui/titleScreen.ts:30,82` | `BLURB` · `RANGE_LEGEND` 3항 | TS2739 |
| `NOTICE.md` | 파일 대응표 3행 + **'경로 데이터·색상·형태는 전혀 손대지 않았다'는 문장 회수** | 라이선스 |

#### 깨질 기존 테스트와 대응 ★ 초안의 진단을 정정

실측 확인: 실패하는 것은 `tests/ui.test.ts:46`의 **`expect(PIECE_TYPES).toHaveLength(5)`**이고, `PIECE_TYPES`는 **`:25`에서 `Object.keys(CONFIG.pieces)`로 유도된다** — CONFIG에 3종을 넣는 순간 8이 된다. 초안이 처방한 `shopButtons.size` 교체는 **바로 윗줄 `:45`**를 겨냥한 것인데, 그 줄은 `SHOP_ORDER`가 리터럴 5개라 애초에 통과한다. **초안의 처방을 그대로 적용하면 실패가 그대로 남는다.**

```ts
// tests/ui.test.ts:25 — 이 줄이 진짜 수정 대상이다
const PIECE_TYPES = Object.keys(CONFIG.pieces) as PieceType[];
const PURCHASABLE = PIECE_TYPES.filter(t => TRAITS[t].purchasable);   // ★ 신설

// :46
expect(PURCHASABLE).toHaveLength(layout.shopButtons.size);   // 리터럴 5를 남기지 않는다 (§10.2)
// :47, :76 루프도 PURCHASABLE을 돈다
```

| 위치 | 증상 | 대응 |
|---|---|---|
| `tests/ui.test.ts:25,46,47,76` | **유일한 런타임 실패** | 위 `PURCHASABLE` 도입 |
| `tests/merge.test.ts:263-268` | 전수 순회 — 3종이 6이면 **그대로 통과**(실측) | 무변경. **이 단언을 절대 약화시키지 말 것**(§12.8이 일부러 세운 방어선) |
| `tests/merge.test.ts:266` · `titleScreen.test.ts:69,79` | TS7053 4곳 | 인덱싱 해소 |

#### 검증 게이트

- `npm run build` 초록 (**25개 에러가 전부 해소되었는가가 이 단계의 정의**)
- `npx vitest run` 전부 초록
- **N1a·N2·N3·N4·N6·N7·N8 전부 불변** — 3종이 게임에 등장하지 않으므로 어떤 신호도 움직이면 안 된다. **이것이 이 단계의 합격선이다**
- 신규 `tests/fusion.test.ts`:
  - `TRAITS[융합3종].purchasable === false`
  - `canBuy(state, 'amazon') === false` (SHOP_ORDER 우회 차단)
  - **`expect(PIECE_TYPES.length - PURCHASABLE.length).toBe(3)`** — 역방향 단언. 앞으로 융합물이 실수로 `purchasable: true`가 되면 상점 테스트가 아니라 이 테스트가 먼저 깨진다
  - 스프라이트 URL 3개가 실제로 존재
  - **스탯 합 불변식**: `CONFIG.pieces.archbishop.damage === knight.damage + bishop.damage` 등 3종 전수 (D18을 코드가 강제)

#### 롤백

`types.ts` 한 줄을 되돌리면 25곳이 함께 에러가 되므로 **커밋 단위 revert만 가능**. 부분 롤백 불가 — 그래서 레시피와 분리했다.

---

### S4b — 융합 레시피 + `commitMerge` 확장

#### 만드는 것

```ts
// src/core/fusion.ts (신규) — 레시피는 순수 함수. 드래그 방향이 양쪽이므로 교환법칙 필수
const RECIPES: ReadonlyArray<readonly [PieceType, PieceType, PieceType]> = [
  ['knight', 'bishop', 'archbishop'],
  ['knight', 'rook',   'chancellor'],
  ['knight', 'queen',  'amazon'],
];
export function fusionResult(a: PieceType, b: PieceType): PieceType | null;
// 동종 키를 넣지 말 것 — resolveLanding의 6a(동종) 분기가 항상 6b(이종)보다 먼저 이긴다
```

```ts
// src/core/pieces.ts — Landing.merge만 넓힌다. 새 kind('fuse')를 만들지 말 것
| { kind: 'merge'; occupant: Piece; resultTier: number; resultType: PieceType }
// 동종 합성은 resultType = piece.type을 넣는다 →
// 하류(moveOnBoard/placeFromSlot/highlights)가 이종/동종을 구분할 필요가 아예 없어진다

function commitMerge(
  state, absorbed, survivor, resultTier: number, resultType: PieceType, events,
): void {
  if (resultType !== survivor.type) {                    // D24 — 이종만
    survivor.cooldown = Math.max(survivor.cooldown, absorbed.cooldown);
  }
  survivor.tier = resultTier;      // ← `+= 1`에서 교체 (아래 함정 1)
  survivor.type = resultType;      // ← 신규. Piece.type이 처음으로 가변이 되는 지점
  state.pieces.splice(state.pieces.indexOf(absorbed), 1);
  recalcQueenBuffs(state);         // ⚠️ 아마존은 buffFactor 1.0이므로 필수
  events.push({ kind: 'merged', square: {...survivor.square!},
                pieceType: survivor.type, tier: survivor.tier });
}
```

#### 게이트 순서 — §5.6을 깨지 않고 얹는 방법

합성 분기(6) **안에** 이종 분기를 넣는다. **6 전체를 (1)(2)(3) 앞으로 당기지 말 것.**

```
(6a) occupant.type === piece.type        → 기존 로직 그대로 (resultTier = tier + 1)
(6b) fusionResult(piece.type, occupant.type) !== null
     → 티어 불일치면 fromBoard ? swap : tierMismatch
     → TRAITS[occupant.type].blast && occupant.cooldown > 0 → knightCooldown
     → { kind:'merge', resultTier: piece.tier, resultType: fused }   // 등급 상승 없음
```

#### 두 개의 조용한 함정

1. **`survivor.tier += 1`을 반드시 `= resultTier`로 바꿔야 한다.** 안 바꾸면 이종 융합이 정체성 변경 *과 동시에* 티어를 올려, 나이트 T1 + 비숍 T1이 **T2 아치비숍**이 된다 — 500G 재료로 1,000G 기물. §5.4 골드 중립성이 이 한 줄에서 붕괴한다. 동종 경로에서 `resultTier === survivor.tier + 1`임을 테스트로 못박는다.
2. **합성 후 폭발 판정을 반드시 `commitMerge` 호출 *뒤*에 평가할 것.** `commitMerge`가 `occupant.type`을 제자리 변경한다.
   ```ts
   commitMerge(state, p, landing.occupant, landing.resultTier, landing.resultType, events);
   if (TRAITS[landing.occupant.type].blast) tryKnightBlast(state, landing.occupant, events);
   //     └ 이 시점의 .type은 *결과* 타입이다
   ```
   커밋 **전** 판정이면 knight→bishop 융합으로 태어난 아치비숍이 §5.8이 보장하는 "커밋 직후 폭발 1회"를 **조용히 잃고**, 반대로 knight 위에 queen을 얹으면 결과가 아마존(blast)인데도 폭발하지 않는다. **컴파일도 테스트도 안 깨진다.**

#### 검증 게이트

- `npm run build` + `npx vitest run` 초록. **동종 결과가 한 글자도 달라지지 않는 것이 합격선**(`resultTier === tier+1`, 쿨다운 승계 무변경)
- **N4 성립** — 융합 cost와 스탯이 둘 다 재료 합이면 자동. 깨지면 D18/D20을 어긴 것
- **N2 불변** (융합 기물이 없는 빌드의 화력은 안 바뀐다)
- **N7 재측정** — 아마존은 `buffFactor 1.0`이라 퀸의 대체재다. 최소 승리 빌드의 퀸 12기를 아마존으로 바꿨을 때 N7이 어떻게 움직이는지 기록(단언은 하지 않는다 — 아마존은 더 비싸므로 열등한 것이 정상)
- 신규 `fusion.test.ts`:
  - 교환법칙(양방향 드래그 동일 결과)
  - `resultTier === piece.tier` (**등급 상승 없음** — R4)
  - 판매가 불변식: `sellPrice('archbishop',1) === sellPrice('knight',1) + sellPrice('bishop',1)`
  - 이종 쿨다운 `max` / 동종 무변경
  - **커밋 후 폭발 정확히 1건** (R5)
  - **`융합 직후 archbishop.cooldown === CONFIG.pieces.archbishop.interval`** + **연속 드래그 2회째에는 `knightBlast` 이벤트 0건** ← `pieces.ts:161` 회귀 방지
  - **D23 — 쿨다운 중인 아치비숍도 sell 존에는 드롭할 수 있다** (`drag.test.ts`에 신설)

#### 롤백

`RECIPES`를 빈 배열로 두면 3종이 즉시 도달 불가가 된다(S4a 상태로 복귀). 노브 롤백 가능.

---

### S4c — 겸업 기물 미리보기·설명

#### `highlights.ts` — 조기반환 사슬을 가산 구조로 (실측 기반으로 정정)

현재는 `merge → queen → knight → default`의 **상호배타 조기반환**이라 아치비숍(초록 L자칸 + 주황 사거리를 **둘 다** 그려야 한다)을 표현할 수 없다.

**초안은 이 재작성이 `highlights.test.ts` 2개를 깬다고 예고했으나, 실측상 3개이고 원인 진단도 틀렸다.** 코드를 직접 읽어 확인한 사실 두 가지:

**(a) `canLandAt` 조기반환은 '유지'가 아니다.** 현행 코드에서 이 가드는 **퀸 분기(`:96` 블록)와 기본 분기(`:145` 블록) 안에만 있고 나이트 분기에는 의도적으로 없다.** 공유 단계로 끌어올리면 보드 위 나이트가 비-L자 칸에 hover할 때 초록 이동칸이 통째로 사라져 `:173`(단언 `:182`)과 `:206`(단언 `:226`)이 깨진다.

**(b) `pattern !== 'none'` 게이트는 트레이의 순수 나이트를 죽인다.** 트레이 나이트는 `onBoard`가 false라 (3)을 건너뛰고 `pattern: 'none'`이라 (4)도 건너뛰어 하이라이트가 0개가 된다 → **`:259`가 깨진다**(초안 어디에도 없다). 같은 구멍이 트레이의 아치비숍·챈슬러·아마존에도 그대로 적용된다.

```
(1) 합성 미리보기 조기반환                                          ← 유지
(2) 착지불가 hover 조기반환 — 단 `!(moveL && onBoard)` 조건을 붙여
    현행 분기별 범위를 그대로 보존한다                              ← ★ (a)
(3) moveL && onBoard  → 초록 legalMoves + hover 시 blastTargets 주황
(4) attackTargets(piece.type, anchor).length > 0  → origin + 주황    ← ★ (b)
      · S1이 남긴 `case 'none': blast ? knightBlastTargets : []` 폴백 덕분에
        트레이 나이트와 융합 3종이 3×3을 되찾고, 퀸(진짜 빈 배열)만 건너뛴다
(5) buffFactor > 0 → 파랑 queenLines + 선분                         ← 아마존도 여기 들어온다
(6) pushSelected 마지막 1회
```

#### `tooltip.ts` — 같은 배타→가산 문제, 규모만 작다

실측 확인한 현행 구조는 `p.type === 'queen' ? [버퍼 3행] : [데미지 4행]`이다. `buffFactor > 0`으로 단순 치환하면 **아마존이 버퍼 분기로 들어가 공격력·주기·골드·쿨다운 행이 통째로 사라진다** — D18에서 damage 3 / blast로 확정한 겸업 기물이 "공격하지 않는다"고 말하게 된다. 덤으로 버퍼 분기의 `+${tierMultiplier(p.tier) * 100}%`가 계수를 반영하지 않는다.

```ts
const rows = [
  ...(TRAITS[p.type].pattern !== 'none' || TRAITS[p.type].blast ? [데미지·주기·골드·쿨다운 행] : []),
  ...(TRAITS[p.type].buffFactor > 0
      ? [`버프 효과: +${tierMultiplier(p.tier) * TRAITS[p.type].buffFactor * 100}% (8방향 직선)`,
         '여러 버퍼의 라인이 겹치면 그만큼 더 쌓인다']
      : []),
];
// 둘 다 참인 아마존은 양쪽을 다 갖는다
```

> **D18 덕분에 표시 전용 포맷터가 불필요하다** — `buffFactor`가 정수 1.0이므로 반정수 데미지(`최종 7.5`)가 발생하지 않는다. 초안의 R7이 소멸했다. **그래도 `pieceDamage` 안에 반올림을 넣지 말 것**은 유효하다(`merge.test.ts:196-216`의 능력치 합 불변식).

#### 파일별 변경

| 파일 | 변경 |
|---|---|
| `src/render/highlights.ts:88-159` | 위 가산 구조로 재작성 |
| `src/ui/tooltip.ts:22-47` | 위 가산 구조로 재작성 |
| `src/ui/titleScreen.ts` | **탭을 8개로 늘리지 말고 '합성' 탭 1개를 추가**(탭바가 `max-880px` 한 줄, `#title-panels`에 `min-height`, §8.1). `panel-price`가 `${def.cost}G`를 찍으므로 살 수 없는 기물에는 가격 대신 **레시피**를 넣는다. ⚠️ 아마존의 5×5 그림: `pattern:'none'`이라 3×3 폭발 + L자 8칸 = 그림이 성립한다. **챈슬러는 rook 17 + L자 8 = 25칸이라 5×5에서 정보를 잃으므로 두 그림을 위아래로 분리** |
| `src/render/highlights.ts` (덤) | R13 — `interactable`을 읽게 하는 **1줄 수정**. `victory`/`defeat`에서 미리보기가 거짓말하는 §7.3의 현존 구멍이 겸업 기물의 화려한 미리보기 때문에 더 눈에 띄게 된다 |

#### 검증 게이트

- `npm run build` + `npx vitest run` 초록 — **특히 `highlights.test.ts` `:182` · `:226` · `:259` 세 개**(초안은 둘만, 그것도 틀린 원인으로 예고했다)
- N2·N4·N7 불변
- 신규: 아치비숍 hover 시 **초록 L자칸과 주황 사거리가 둘 다** 있는가 / 순수 나이트는 주황이 3×3뿐인가 / **트레이 융합 3종이 폭발 범위를 보여주는가**
- 신규: 아마존 툴팁에 **공격력 행과 버프 행이 둘 다** 있는가
- §12.7의 구멍 메우기: **`tier ≥ 2` 기물의 DOM 표시를 검증하는 테스트**를 여기서 신설(`#sell-preview` T3 룩 = 1,000G · 툴팁 T2 아마존 버프 = +200%)

---

### S5 — 무작위 지급 (10회)

#### 정직한 전제 — 이 처방의 "슬롯 압박"은 실측상 0에 수렴한다

트레이 16칸 + 보드 56칸이고 **트레이가 차면 `canBuy`가 막혀 구매 자체가 불가능**하므로(§6.2) 플레이어는 트레이를 비워 두는 것이 강제된다. 지급 10기의 가중치 기댓값은 폰 3 · 비숍 2.5 · 룩 2.5 · 나이트 2이고, 동종 합성만으로 5칸 이하로 압축되며 이종 합성이 더 줄인다. 이 처방의 목표를 다시 정의한다.

| 원안의 목표 | 실제로 남는 효과 |
|---|---|
| ~~슬롯 압박~~ | **거의 없다.** D4 환급 규칙이 남기는 만큼만 |
| **무작위성 도입 (진단 ②)** | ✅ 유지 — 매 판이 달라지는 유일한 축 |
| **초반 골드 부양** | ✅ 유지 — 사용가치 10×290 = 2,900G가 짝수 웨이브마다 |
| **발견 (진단 ③)** | ✅ 강화 — 원치 않던 기물이 융합 재료가 된다 |

**S5 착수 전에 N5를 먼저 측정한다.** 0이면 '슬롯 압박' 목표를 문서에서 폐기하고 D4를 유지 여부까지 재검토한다(§8 갈림길 4번).

#### 만드는 것

```ts
// src/config.ts
grant: {
  enabled: true,                        // ★ 롤백 노브 (weights 0 우회 금지)
  everyWaves: 2,                        // ★ D2 — 짝수 웨이브 클리어 시. 총 10회
  weights: {                            // Record<PieceType, number> — 전수성 유지 (D27)
    pawn: 0.30, bishop: 0.25, rook: 0.25, knight: 0.20, queen: 0,   // ★ D3
    archbishop: 0, chancellor: 0, amazon: 0,
  },
}
/** roll ∈ [0,1) 누적합 매핑. rng를 여기서 부르지 않는다 — 호출부 주입 원칙 */
export function pickGrantType(roll: number): PieceType;
```

```ts
// src/core/economy.ts — 구매가 아닌 '지급'. pieceSeq가 모듈 private이라 반드시 이 파일에
export function grantPiece(state: GameState, type: PieceType): Piece | null;
// buyPiece와 공유: pieceSeq · freeSlotIndex · tier 1 · cooldown 0
// 공유하지 않음: canBuy 게이트(페이즈·골드) 전부, gold 차감
```

```ts
// src/core/wave.ts + step.ts — rng를 2갈래로 분리
export function checkWaveEnd(state, events, grantRng: () => number = Math.random): void;
export function stepGame(
  state, dt, events,
  rng: () => number = Math.random,       // 스폰 스레드 — 소비량 절대 불변 (N8이 강제)
  grantRng: () => number = Math.random,  // ★ D32 — `= rng`가 아니다
): void;
```

#### 추첨 위치 — 한 줄이 재현성을 가른다

```ts
// wave.ts — 클리어 보너스 지급 뒤, victory 판정 **앞**
if (CONFIG.grant.enabled && state.wave % CONFIG.grant.everyWaves === 0) {
  const roll = grantRng();                                   // ← 무조건 1회 (D5)
  const granted = grantPiece(state, pickGrantType(roll));
  if (granted === null) { /* D4 환급 경로 + grantDiscarded */ }
}
```

`if (state.wave >= total) { victory; return; }` **뒤**에 두면 draw 횟수가 9/10으로 갈려 **재현성이 상태 의존**이 된다.

#### 파일별 변경

| 파일 | 변경 |
|---|---|
| `src/config.ts` | `grant` 블록 + `pickGrantType` |
| `src/types.ts` | `GameEvent`에 `pieceGranted{pieceType, slotIndex}` · `grantDiscarded{pieceType, refund}` |
| `src/core/economy.ts` | `grantPiece` 신설 |
| `src/core/wave.ts` | `checkWaveEnd`에 `grantRng` 인자 + 추첨 |
| `src/core/step.ts` | `grantRng` 전달 (기본값 `Math.random`) |
| `src/ui/banners.ts` | `pieceGranted` → `🎁 {기물} 획득` · `grantDiscarded` → `⚠ 트레이 만석 — {기물} +{n}G 환급` (배너 2종 → 4종) |
| `src/audio/cues.ts` | 무음 유지 권장 — 신규 에셋 0개 |

#### 깨질 기존 테스트와 대응

| 위치 | 대응 |
|---|---|
| `tests/wave.test.ts:74,77,84,96,102` (`checkWaveEnd` 5곳) | 기본 인자 덕에 컴파일은 통과하지만 골드 단언이 흔들릴 수 있다 → **결정론적 `grantRng` 주입** |
| `tests/simulation.test.ts` 풀런 | **D33 — `CONFIG.grant.enabled = false`로 고정해 돌린다.** 이 설정 없이는 지급 10기가 트레이를 채우고 D4 환급이 `state.gold`를 바꾼다(풀런 빌드는 `boardPiece`만 써서 트레이가 내내 비어 있다) |
| `tests/signals.test.ts` N1a | 지급이 골드가 아니므로 불변 |

#### 검증 게이트

- `npm run build` + `npx vitest run` 초록
- **N8이 정확히 452 ★** — 하나라도 움직이면 `grantRng`가 스폰 스레드를 오염시킨 것. **이것이 D32를 강제하는 유일한 신호다**(N6는 못 잡는다 — §1.3)
- **N6(`grant.enabled = false`)가 phase/hp/kills/earned 전부 불변**
- **N1a 불변 / N1b 신규 기준선** — 증가폭이 `N5 × 평균 판매가`와 일치하는지 교차검증
- **N5 신규 기준선**: 20웨이브 완주 시 `grantDiscarded` 횟수. 목표 대역 **0~3회**. 0이면 갈림길 4번으로 판단을 올린다
- **N7 재측정** — 지급으로 얻은 룩·비숍이 보스 축에 얼마나 기여하는지 기록
- N2·N3·N4 불변
- 신규 측정: 지급 10기의 실제 슬롯 점유 곡선(합성 없이 / 동종만 / 이종 포함)

#### 롤백

`CONFIG.grant.enabled = false` 한 줄. `weights`를 전부 0으로 두는 방식은 `pickGrantType`의 구현 세부에 걸리므로 쓰지 않는다.

---

### S6 — 문서 갱신 (v1.9)

`docs/game-design.md`에서 손대야 할 절:

| 절 | 변경 |
|---|---|
| §2.3 | **틱 순서 무변경**을 명시 — 유형 3종이 `resolveDamage` 안에서만 소비된다는 사실이 이 시리즈의 구조적 성과다 |
| §2.4 | 클리어 보너스 "300G 정액" → 곡선 + 격주 지급 |
| §2.5 | **"보스 4마리 중 3마리 처치가 사실상의 두 번째 패배 조건"**을 명문화 (§7.1 참조) |
| §3 | **§3.8 적 유형** 신설 (3종 · 스케줄 · 유형별 위상 · 일반 최대 1속성 · 보스 금지·전용 배수) |
| §4.1 | 기물 표 8행 + `TRAITS` 표 신설 |
| §4.2 | 최종 공격력 식에 `resolveDamage` 항 추가 |
| §5 | **§5.11 이종 합성** 신설 (레시피 · 스탯=재료 합 · 겸업 쿨다운 공유 · 판매 예외 · 이종 쿨다운 max) |
| §6.1 · §6.4 | 골드 경로표 · 총골드 24,702 → **24,902G** · 지급 항 |
| §9.1 | 웨이브 표 20행 '시작 전 누적 골드' 열을 **'구매력' 열로 교체**(D31) |
| §9.3 | **w5 게이트에 최소성 실측 추가** (비숍 없이도 처치, killT 48.0s) |
| §9.5 | **대조군 판별력 0 실측을 기록** + §1.2 포화 표 + 신호 8종으로 교체 |
| **§9.7 신설** | **보스 축 실측표** (§1.1) — 이 문서에 없던 가장 중요한 밸런스 데이터 |
| §10.1 | 예외표에 `TRAITS` 소유 관계 |
| §10.6 | 불변식 표에 `resolveDamage`(감산 순서 포함) · `fusionResult` · `TRAITS` 추가 |
| §11 | v1.9~v1.13 행 |
| §12.2 | `types.ts:13-18` 항목 **해소됨**으로 |
| §12.4 | **나이트 쿨다운 게이트가 융합 3종에서 실전화됨** — 휴면 코드 항목 갱신 |
| §12.5 | 확장 주의 — "겸업 기물은 발사와 폭발이 쿨다운을 공유하며, 판매만 예외다" |

`NOTICE.md` — SVG 3종의 CC BY-SA 3.0 이행 (S4a에서 이미 처리, 여기서 최종 확인).

---

## 5. 새로 필요한 에셋

| 단계 | 종류 | 개수 | 상세 |
|---|---|---|---|
| S3 | 스프라이트 | **0** | 유형 표식·보호막 게이지는 `arc`/`stroke` 캔버스 드로잉. 신규 적 SVG를 만들면 `sprites.ts`의 normal/boss 2키가 **다속성 조합 폭발**을 일으키고 NOTICE 이행까지 따라온다 |
| S3 | 효과음 | **0** | 흡수를 `GameEvent`로 내면 §8.4의 3단 방어를 갉아먹는다(후반 40마리 × 흡수는 `enemyDied`보다 잦다). 표식은 `renderer`가 state를 직접 읽는 쪽으로 |
| **S4a** | **스프라이트 SVG** | **3** | `archbishop.svg` · `chancellor.svg` · `amazon.svg`. Cburnett 세트에 **없다** → 비숍/룩/퀸에 나이트 요소를 합성한 **파생물**. ⚠️ CC BY-SA 3.0 동일조건변경허락이 그대로 걸리고, `NOTICE.md`의 "경로 데이터·색상·형태는 전혀 손대지 않았다"는 **문장이 거짓이 된다** |
| S4a | 효과음 | **0** | `AttackCueKind`가 `PieceType`과 별개 유니온이라 `CUE_URL`은 손댈 필요가 없다. 아치비숍→`bishop`, 챈슬러→`rook`, 아마존→`knightBlast`(기존) |
| S4a | 글리프 폴백 | 3 | `♝`/`♜`/`♛` 재사용 + 모호성을 주석에 |
| S5 | — | **0** | 배너는 텍스트 |

**총계: SVG 3개. 효과음 0개.**

---

## 6. 밸런스 미지수 표

| 미지수 | 기준값 | 탐색 범위 | 결정 방법 (헤드리스) | 감시 신호 |
|---|---|---|---|---|
| `clearBonusBase` / `Decay` | 500 / 20 | 400~600 / 10~30 | w3 시작 전 누적 골드 목표 **1,300~1,700G** | N1a |
| **`armored.bossDamageMultiplier`** ★ | **0.75** | **0.75 / 1.0** (0.625 이하 금지) | **N7이 w5·w10·w15에서 8/8을 유지하는 최솟값.** §1.1 표: 0.75에서 5~7/8 → 소폭 추가 투자로 복구, 0.625는 0/8로 복구 불가 | **N7** |
| **`armored.damageMultiplier`** (일반) | **0.625** | **0.5 / 0.625 / 0.75** — 이진 정확값만 | 룩1/파일이 w17~19에서 누수 > 0이고 룩2/파일은 0 유지(§1.2 표가 지도). **0.6·0.7 금지**(§1.5) | N2, N4 |
| `swift.speedMultiplier` | 1.5 | 1.25~1.5 | 종주 24s → **16~19.2s**. N2의 룩 40 → `floor(종주/3)×5` | N2 |
| **`shielded.absorbPool`** | **0.3** | 0.2~0.4 | maxHp 55의 30% = 17. T1 룩(5딜)이 3.4발을 태운다 = 종주의 43% | N2, **N4** |
| `traitRatio` | 0.3 | 0.2~0.4 | **`Record<EnemyTrait, number>` 전수**로 웨이브별 혼합률이 30%±1인지 | 신규 혼합률 단언 |
| `TRAIT_PHASE` | 0 / 3 / 7 | 0~9 정수 | 유형별 노출이 균등한가 + 특정 웨이브에 몰리지 않는가 | 혼합률 단언 |
| 융합 3종 `cost` · `damage` · `buffFactor` | 재료 합 | **미지수 아님** (D18/D20) | 판매가·중립성 불변식이 강제 | N4 |
| 융합 3종 `interval` | 3.0 | **미지수 아님** (D21) | — | — |
| `grant.everyWaves` | **2** (10회) | 1~4 | **구매력 목표: w5 시작 전 ≤ 3,000G**(현행 2,108의 +42% 이내). 20회면 3,928G = +86%로 처방 4를 상쇄 | **N1b** |
| `grant.weights` | 30/25/25/20/**0** | 퀸 0 고정 | 퀸을 넣으려면 §8 갈림길 3번 | N1b, N5 |
| 나이트 조작 빈도 f | 1/3 · 2 | — | 밸런스 측정을 **두 벌로** 돌린다. 유형 도입 후 나이트의 상대 순위가 오르는지 | N2(f별) |

**모든 값은 `CONFIG`에 두고 테스트가 유도한다(§10.2). 어떤 테스트에도 새 숫자를 하드코딩하지 않는다.**

---

## 7. 위험 등록부

| # | 위험 | 징후 | 완화 | 최악의 경우 |
|---|---|---|---|---|
| **R1** | **`npm run build`를 게이트에서 빠뜨린다** | vitest는 초록인데 배포가 깨진다. S3의 `Enemy` 필수 필드 3곳과 S4a의 TS2739 5곳이 **전부 vitest에 안 보인다** | 두 명령을 **한 커밋 게이트로 묶는다**. CI에도 추가 | 타입이 깨진 채 main에 머무르고, 다음 사람이 무관한 변경에서 25개 에러를 만난다 |
| **R2** ★ | **보스 장갑을 일반 배수와 같은 노브로 둔다** | **N7이 w15에서 8/8 → 0/8.** 게임이 클리어 불가능해진다 | **N7을 S0에서 미리 만들어 두는 것이 유일한 방어.** D9를 config·주석·테스트 세 곳에 적는다 | 6단계 내내 다른 모든 신호가 초록인 채로 클리어 불가능한 게임이 나온다(§1.1) |
| **R3** | **`pieces.ts:161`을 안 고친다** | **징후가 없다.** 컴파일·테스트·전 신호가 초록이다 | S1 술어 교체표의 ★ 항목 + `traits.test.ts`의 쿨다운 단언 + `fusion.test.ts`의 "2회째 폭발 0건" | D21이 코드 차원에서 무효 → 챈슬러가 완전한 룩 + 무제한 폭발기가 된다 |
| **R4** | **rng 스레드 오염** | **N6는 징후를 못 만든다** — `Math.random`으로 돌려도 4값이 동일하다(§1.3) | ① N8(draw 수 452) ② `grantRng` 기본값 `Math.random`(D32) ③ 유형은 rng 0회(D15) | 밸런스 측정이 **통과한 채로 다른 것을 잰다** |
| **R5** | **장갑을 고정 감산, 보호막을 피격 횟수로** | N4가 깨진다 | **N4를 S0에서 유형 전수로 만들어 두는 것이 유일한 방어** | §5.4 골드 중립성 붕괴 → 융합 cost(재료 합)를 정당화할 근거가 사라지고, §11의 "v1.8이 무변경으로 통과한 이유"가 무효 |
| **R6** | **`survivor.tier += 1`을 남겨둔다** | 이종 융합이 T2로 태어난다. 500G 재료 → 1,000G 기물 | `fusion.test.ts`에 `expect(archbishop.tier).toBe(1)` 명시 | 골드 중립성 붕괴 + 무한 인플레(융합은 되돌릴 수 없다) |
| **R7** | **합성 후 폭발을 커밋 *전*에 판정** | 컴파일도 테스트도 안 깨진다. 폭발이 **조용히 사라진다** | `fusion.test.ts`에 "융합 직후 `knightBlast` 정확히 1건" | §5.8이 보장한 규칙이 새 경로에서만 조용히 거짓이 되고, 플레이어에게는 "가끔 안 터짐"으로 보인다 |
| **R8** | **`Piece.type`이 처음으로 가변이 된다** | 지금까지 `type`을 쓰는 코드는 전부 "한 번 정해지면 안 바뀐다"를 전제한다 | 매 프레임 재계산하는 곳(`slots.ts` innerHTML diff · tooltip · renderer)은 안전. **드래그 고스트(`drag.ts:185-186`)는 집는 시점에 한 번만 읽는데 드래그 도중 타입이 바뀔 수 없어 *우연히* 안전하다** — 이 우연성을 주석으로 못박는다 | 미래에 "드래그 중 자동 융합" 같은 기능이 들어오면 고스트가 옛 기물을 그린 채 남는다 |
| **R9** ★ | **D23(판매 예외)을 빠뜨린다** | 1,200G 아마존을 웨이브의 **87.5% 동안 집을 수도 팔 수도 없다**. 플레이어에게는 무반응 버그로 읽힌다 | `drag.test.ts`에 '쿨다운 중인 아치비숍도 sell 존에 드롭 가능' 신설 | 융합이 실질적으로 비가역이 되고, 진단 ④가 원한 것과 다른 종류의 비가역성이 생긴다 |
| **R10** | **`highlights.ts` 재작성이 3개를 깬다** | `:182` · `:226` · `:259` | (a) `canLandAt` 조기반환에 `!(moveL && onBoard)` 조건 (b) 단계 (4) 게이트를 `attackTargets(...).length > 0`으로 | 재작성이 되돌려지고 겸업 기물 미리보기가 영영 안 들어온다 |
| **R11** | **`tooltip.ts`를 단순 치환한다** | 아마존 툴팁에서 공격력·주기·쿨다운 행이 통째로 사라진다 | 가산 구조 재작성(S4c). S1에서는 `p.type === 'queen'`을 그대로 둔다 | 겸업 기물이 "공격하지 않는다"고 말한다 |
| **R12** | **`tierRingColor`가 예외를 던지지 않고 클램프한다** | `maxTier`를 7로 두면 T7이 조용히 T6 빨강이 되고 **아무 테스트도 안 깨진다** | `merge.test.ts:263-268`(전수 순회 `=== TIER_COLORS.length`)이 **유일한 방어선** — 절대 약화시키지 말 것 | 상한과 팔레트가 어긋난 채 배포 |
| **R13** | **`ui.test.ts` 수정 대상을 :45로 오인한다** | S4a에서 `expect(PIECE_TYPES).toHaveLength(5)`가 그대로 실패로 남는다 | :25의 `PURCHASABLE` 도입(§S4a) | "고쳤는데 왜 안 되지"로 시간을 태운다 |
| **R14** | **`NOTICE.md`의 사실 주장이 거짓이 된다** | 코드가 아니라 라이선스 문제라 테스트가 잡지 못한다 | S4a 커밋에 `NOTICE.md` 수정을 **묶는다**(별도 커밋 금지) | CC BY-SA 3.0 위반 |
| **R15** | **처방 2'의 슬롯 압박이 0이다** | N5가 0에 수렴 | S5를 **마지막**에 두어 S4 완료 후 실측하고, 그 값으로 판단(§8 갈림길 4번) | D4·`grantDiscarded`·배너 2종이 죽은 코드가 된다 |
| **R16** | **S1이 완전 동치가 아니다** | 388개 중 하나라도 깨진다 | **깨지면 즉시 되돌린다.** S1의 합격선은 "388개 그대로"이지 "고쳐서 초록"이 아니다 | 이후 S3·S4가 전부 오염된 표 위에 선다 |

---

## 8. 갈림길 (전부 확정됨 — §−1.1 참조)

> **이 절은 기록으로 남긴다. 답은 §−1.1에 있고 그쪽이 우선한다.**

### 갈림길 1 — 보스에 장갑을 거는가 (S3 착수 전 필수)

이 시리즈에서 난이도를 실제로 움직이는 유일한 노브다.

| 선택지 | N7 (w5/w10/w15 처치) | 최소 승리 비용 | 총 예산 대비 | 성격 |
|---|---|---:|---:|---|
| **A. 보스 배수 1.0** (장갑 미적용) | 8/8 · 8/8 · **8/8** | 18,800G | 75% | 난이도 변화 사실상 0. 처방 4가 일반 웨이브에서도 포화라(§1.2) **아무것도 안 한 것과 같아진다** |
| **B. 보스 배수 0.75** ← 계획 기본값 | 8/8 · 8/8 · **5~7/8** | 약 20,000~21,000G 추정 | 80~84% | 소폭 추가 투자로 복구. 처방 4가 처음으로 체감된다 |
| **C. 보스 배수 0.625** | 8/8 · 8/8 · **0/8** | 22,400G+ (렌즈 추정) | **90%** | 여유가 24% → 10%. 판이 한 번 흔들리면 복구 불가 |

**추천: B.** A는 처방 4를 넣는 의미가 없고, C는 실수 여유를 90%까지 태운다.

---

### 갈림길 2 — 일반 적이 복수 속성을 갖는가 (S3 착수 전 필수)

사용자 원안은 "각 30% 혼합"(유형별 30%)이었는데, 초안의 단일 식은 전체 30%에게 **하나씩만** 준다. 난이도가 이 해석 하나로 갈린다.

| 선택지 | w12+ 속성 분포 | 룩2/파일 w19 누수 (렌즈 실측) | 성격 |
|---|---|---|---|
| **A. 일반 적 최대 1속성** ← 계획 기본값 | 30%가 1속성, 70%가 무속성 (유형당 10%) | **0** | 가장 완만. 유형이 '가끔 나오는 변수' |
| **B. 유형별 독립 30%** (원안) | ≥1속성 65.7% · ≥2속성 18.9% | **14** (초안 문구 그대로면) | 8,000G 빌드가 그 웨이브에 즉사. 튜닝 여지가 거의 없다 |
| **C. 유형별 15%씩 독립** | ≥1속성 38.6% · ≥2속성 6.1% | (미측정) | 중간. 다속성이 '드문 사건'이 되어 기억에 남는다 |

**추천: A로 시작해 S3의 헤드리스 측정 후 C를 시도.** B는 실측상 튜닝 창이 없다.

---

### 갈림길 3 — 클리어 보너스를 방어 성과에 연동하는가

§6.1이 명시한 대로 클리어 보너스는 **적을 전부 누수시켜도 그대로 들어온다.** 곡선은 그 '무조건 수입'을 w1 기준 300 → 500G로 1.67배 키운다.

| 선택지 | w1 보너스 (전량 처치 / 전량 누수) | 성격 |
|---|---|---|
| **A. 정액 곡선** ← 계획 기본값 | 500 / **500** | 초반 예산 문제는 풀지만 "초반 몇 마리는 흘려보내고 보너스만 챙긴다"가 더 강해진다 |
| **B. 처치율 연동** `clearBonus(w) × (처치/총원)` | 500 / **0** | `checkWaveEnd`에서 `spawnedCount`와 그 웨이브 처치 수만 있으면 되고(둘 다 이미 있다) `Math.max(0,·)` 클램프도 불필요. **'누수 방치'가 처음으로 대가를 갖는다.** 다만 무너진 플레이어의 수입이 더 줄어 사망 나선이 생긴다 |
| **C. 하한 있는 연동** `clearBonus(w) × (0.5 + 0.5×처치율)` | 500 / **250** | 방치에 대가는 주되 나선은 막는다 |

**추천: A로 착수(가장 싸고 N1a 유도식이 그대로다), S6 문서화 시점에 C를 후보로 남긴다.** N1a의 상한 정의는 '전량 처치 가정'이므로 어느 쪽이든 유도식은 바뀌지 않는다.

---

### 갈림길 4 — 지급 총량과 '슬롯 압박' 목표를 유지하는가 (S5 착수 전)

| 선택지 | 무상 가치 | w5 시작 전 구매력 | 처방 4와의 순효과 |
|---|---:|---:|---|
| **A. 20회 지급** (원안) | 5,700G | 3,928G (**+86.3%**) | 처방 4가 올린 요구를 **넘어선다** → 게임이 지금보다 쉬워진다 |
| **B. 10회 지급** ← 계획 기본값 | 2,900G | 약 3,100G (+47%) | 곡선 +200G와 합쳐 +3,100G. 처방 4의 요구 증가분과 대략 균형 |
| **C. 10회 + 보드 무작위 배치** | 2,900G | 동일 | 트레이가 아니라 **공간**을 건드리므로 실제로 재배치를 강제한다(§4.2 사거리 기하학이 곧 게임이다). `recalcQueenBuffs` 호출만 추가 |
| **D. 지급 폐기** (곡선만) | 0 | 2,788G (+32%) | 진단 ②(매 판이 같다)를 이 시리즈가 전혀 해결하지 못하게 된다 |

**추천: B로 착수하고, S5 착수 전 N5(폐기 횟수)를 먼저 잰다.** N5가 0이면 '슬롯 압박' 목표를 문서에서 폐기하고 **C**로 전환한다 — 무작위성은 유지하면서 압박을 실제로 만드는 유일한 안이다.

---

## 9. 이 계획에서 뺀 것과 이유

### 9.1 처방 1 — 8랭크 요새 (전면 제외)

**결정은 유지하되, 초안의 근거 (b)는 실측으로 반증되었으므로 삭제하고 교체한다.**

**(a) 발사 트리거로 두면 세 기물이 동시에 무너진다** (유효)

| 기물 | 실측 |
|---|---|
| 룩 | 파일 광선이 **어디에 서 있든 8랭크에 닿는다**(§4.6 "항상 15칸"). T1 룩 1기가 w11까지 131발 × 5 = **655 > 600 HP**. 지배 전략 `룩1/파일`이 **아무 대가 없이** 3요새를 전부 연다 |
| 비숍 | 3.0초 주기 100% 가동 → 131발 = **1,310G**. 요새 총 HP 1,800 ÷ (damage 1 : gold 10) = 이론 추출 **18,000G = 한 판 총 골드의 73%** |
| 나이트 | `interval: 0`이라 **게임 시간도 골드도 안 쓴다**. 400회 폭발(왕복 800제스처)이면 1,800 HP가 사라진다. 밸런스 축이 '손목 속도'라 **수치 조정으로 봉합 불가** |

**(b) ~~부수 피해 전용으로 막으면 아무도 못 부순다~~ → 반증됨. 교체 근거:**

> 밸런스 렌즈 재현: 같은 규칙·같은 요새(600×3)로 w1~w11을 돌리면 **b·d·g 파일에 룩 3기씩만 둔 4,500G 철거 특화 빌드가 600/600/600 = 3/3을 부수면서 일반 웨이브 누수 0을 유지한다.** 초안의 '9,000G를 써도 1/3'은 *방어 빌드에 철거를 얹은* 조합만 잰 값이고, 철거 특화 배치 자체를 재지 않았다.
>
> **교체 근거는 이것이다** — 요새 진행량을 지배하는 것은 골드가 아니라 '요새 파일에 룩이 몇 기 서 있는가 × 적이 살아 있는 시간'이다. 그런데 **랭크 관통 덕분에 철거 최적 배치(요새 파일에 룩 쌓기)가 방어 최적 배치이기도 하다.** 즉 데드라인은 통과 가능하지만 **트레이드오프가 존재하지 않는다** — 사용자가 원한 "방어를 포기하고 레이스에 투자하는 카드"는 카드가 아니라 그냥 더 좋은 배치다. 그리고 화력을 흩으면 진행이 빨라지고 모으면 느려지는(9,000G가 4,500G보다 나쁜) **역인센티브**가 §4.5의 "방어가 무너지면 수입도 끊긴다"를 정면으로 뒤집는다.

**(c) 'w5 보스 게이트와의 정면충돌'은 성립하지 않는다** (유효) — 게이트 빌드(900G) + 철거 폰 5기(500G) = 1,400G가 w5 예산 2,108G 안에 들어오고 **칸이 겹치지 않는다**(추격 폰은 랭크 6→1, 철거 폰은 랭크 7 고정). 실측 `dealt=420 / killed=true`가 전혀 변하지 않는다.

**(d) 부수 이득** — 요새를 빼면 `renderer.test.ts`의 트립와이어 3개, `풀런` 테스트의 w10 절단, `state.forts` 분리, 요새 스프라이트·툴팁이 **전부 발생하지 않는다.**

> **두 번째 패배 조건은 이미 존재한다 — 다만 아무도 그것을 보지 못한다.**
> §1.1이 실측으로 보여주듯 `startHp 10` · 보스 누수 −5 때문에 **"보스 4마리 중 3마리 처치"**가 사실상의 두 번째 패배 조건이다(허용 누수 1회). 이걸 **「보스 2회 누수 = 즉시 패배」로 명시적 규칙으로 승격**하면 새 상태·새 렌더·새 에셋 **0**으로 규칙이 하나 드러나고, HUD에 '보스 처치 3/4'를 띄우면 플레이어가 처음으로 그 축을 인지한다. 처방 4의 난이도도 hp가 아니라 여기에 건다(D9).
> 초안이 후보로 남긴 '웨이브별 누수 상한 3'은 실측상 발동하지 않는다 — 룩2/파일의 웨이브별 누수는 `0,0,0,0,1,0,...`로 **보스 웨이브만 1**이다. 누수는 방어가 붕괴한 뒤에만 나오는 결과 지표라 hp가 이미 재고 있는 것을 더 급하게 잴 뿐이다.

### 9.2 처방 5 — 오프닝 선택 (전면 제외)

| 오프닝 | 문제 |
|---|---|
| **하이퍼모던** | 혜택 **둘 다 무효**다. ① '티어 상한 7'은 사용자 금지 + `tierRingColor` 클램프 + `merge.test.ts:266`(§12.8이 일부러 세운 방어선)과 **3중 충돌** ② '합성 시 판매가 손실 없음'은 §6.3에서 **이미 성립하는 사실**이라 효과 0. 페널티만 남는 **자살 선택지** |
| **이탈리안** | 폰 전방칸이 §4.3/§9.4가 "재조정에도 불변인 기하학적 사실"이라 명시한 '한 칸 동시 타격 폰 최대 2기'를 3기로 만들고 `simulation.test.ts:192`를 깬다 |
| **시실리안** | 혜택(×1.3, 후반에 큼)과 페널티(트레이 12칸, **후반에 가장 아픔**)의 시점이 **정확히 어긋난다.** 게다가 축소 시점에 slotIndex 12~15를 점유한 기물이 `freeSlotIndex` 루프 밖·DOM 칸 밖에 남아 **쿨다운만 흐르는 유령**이 된다 |
| **퀸즈갬빗** | 무료 900G가 들어오는데 N3(`killed === true`)가 잡지 못한다 |
| **클래시컬** | 유일하게 문제없지만 효과가 `clearBonusDelta` 하나뿐 |

그리고 **구조적 비용이 구현 비용보다 크다.** `rook.cost`·`slotCapacity`·`maxTier`가 전부 오프닝 의존이 되므로 앞 네 처방 전부의 회귀 기준선이 5벌이 된다. 3~5일의 구현 비용보다 그 **영구적 측정 비용**이 더 크다.

`Rules`/`resolveRules` 골격은 좋은 설계이므로, 오프닝을 다시 하기로 하면 **이 계획의 S1(TRAITS)이 그 절반을 이미 만들어 둔 상태**가 된다.

### 9.3 처방 3의 폰 ×3 승격 (부분 제외)

4번째 드롭 존(`DropTarget`에 `{kind:'promote'}`) + 선택 오버레이 + `slotIndex 16..18` 인코딩으로 **융합 본체와 맞먹는 규모**다. 승격 목록에 퀸이 들어가면 300G → 900G의 **3배 차익**도 생긴다.

### 9.4 재생 · 비숍 감속 (이번 시리즈에서 제외 — S7 후보)

- **재생**: 유효 HP 배수라는 점에서 장갑과 수학적으로 같은 축이다. 그리고 `min(maxHp, ·)` 클램프 · 틱 단계 · 체력바 상한 처리를 대가로 요구한다.
- **비숍 감속**: 렌즈 실측 파일당 가동률 8%대, 8파일 실전에서 웨이브당 **1마리**. `slowSeconds = 3.0`(주기와 동일)으로 올리면 룩 종주 피해 40 → 60.7(비숍 4기)로 처음 의미가 생기지만, 그때는 **적 1마리당 감속 총량 상한**(예: 종주의 50%)이라는 새 규칙이 따라온다.

둘 다 되살리려면 `updateEnemyStatus`를 틱 2.5단계(`moveEnemies`와 `updateCombat` 사이 — 게이트가 있는 쪽)에 넣는 것이 정답이다. 그 근거를 S6 문서에 남긴다.

### 9.5 패턴 종속 장갑 (밸런스 렌즈 제안 — 채택하지 않음)

렌즈는 "유형 중 최소 하나를 패턴 종속(직선 광선만 감산)으로 만들면 룩 일변도가 처음으로 손해가 된다"고 제안했다. **직접 측정해 반증했다**(§1.2 M5): 직선 감산 ×0.5·30%에서도 룩2/파일 w17·w19 누수 **0**이고, 같은 골드의 룩1/파일+폰40도 **0**이다.

**이유** — 일반 웨이브 누수는 룩2/파일 이상에서 포화 신호이고, 그 포화는 감산 방식이 아니라 **룩의 랭크 관통 시너지**에서 나온다(§9.5 문서가 이미 "파일별 고립 dps 추정은 실제보다 항상 보수적"이라고 못박은 그 성질). 패턴 종속은 배관 비용(0)에 비해 얻는 것이 없고, `resolveDamage`의 시그니처에 `pattern` 인자를 넣어 §10.6 불변식 표를 넓히는 대가만 남는다. **지배 전략의 형태를 바꾸려면 룩의 관통 규칙 자체를 손대야 하고, 그건 이 시리즈의 범위 밖이다.**

### 9.6 §9.5 대조군을 회귀 신호로 쓰는 계획 (교체)

판별력이 0이다(초안 실측 + §1.2 재확인). 신호 8종(N1a·N1b·N2~N8)으로 교체했고 그 기준선을 S0에서 먼저 세운다.

---

## 부록 — 한 장 요약

```
전제  S-1a  tmp 파일 3개 삭제 + .gitignore(.DS_Store, tests/tmp-*)   합격선: 28파일 388
      S-1b  퀸 상한 6 + 기획안 커밋                                   합격선: git status 비어 있음
      ─────────────────────────────────────────────────────────────────────
감시  S0    신호 8종 (N7 보스축 · N8 rng 카운트 신설, src 0줄)  합격선: 388 + 기준선 일치
기반  S1    TRAITS + pieces.ts:161 수정 (동치 리팩터)          합격선: 388 그대로 ← 깨지면 되돌린다
경제  S2    클리어 보너스 곡선                                 합격선: N1a = 2,788 / 7,526 / 24,902
난이도 S3   적 유형 3종 · 틱 단계 신설 없음                    합격선: N4 유형 전수 성립 + N7 8/8 유지
발견  S4a   융합 3종 정의 (스탯 = 재료 합, 등장 안 함)         합격선: build 초록 + 전 신호 불변
      S4b   레시피 + commitMerge                              합격선: N4 성립 + 판매가 불변식 + 폭발 1건
      S4c   겸업 미리보기 · 툴팁 (둘 다 가산 재작성)           합격선: highlights 182/226/259 초록
무작위 S5   지급 10회 (rng 2갈래 분리)                         합격선: N8 = 452 + N6 불변 + N1b 대역
문서  S6    game-design.md v1.9 (§9.7 보스축 실측표 신설) + NOTICE

모든 단계:  npm run build  AND  npx vitest run   ← 둘 다. vitest만으로는 안 보인다.

이 시리즈의 세 문장:
  ① 난이도는 일반 웨이브가 아니라 보스에 있다 — 룩2/파일은 감산 0.5까지 누수 0, 보스는 8/8 → 0/8.
  ② 감시는 N7(보스 3/4)과 N8(draw 452) 둘이 진짜다 — N6는 Math.random으로 돌려도 초록이다.
  ③ pieces.ts:161 한 줄이 없으면 융합 설계 전체가 코드 차원에서 무효인데, 아무 신호도 그것을 못 본다.

뺀 것: 요새(트레이드오프가 존재하지 않는다) · 오프닝(2종이 구조적으로 막힘 + 기준선 5배)
       폰×3 승격 · 재생 · 비숍 감속(둘 다 틱 단계를 요구하는데 실측 값이 없다)
       패턴 종속 장갑(직접 측정해 반증) · §9.5를 신호로 쓰는 계획(판별력 0)
```