import type { EnemyTrait, PieceType } from './types';

export const CONFIG = {
  board: { files: 8, ranks: 8, squarePx: 80 },

  /**
   * startPawns — 판을 시작할 때 보드에 놓여 있는 폰의 수 (v1.16, 사용자 결정).
   *
   * 가챠만으로 기물을 얻게 되면서 **빈손으로 시작할 수 없게 됐다.** 예전에는 startGold로
   * 원하는 기물을 골라 살 수 있었지만, 이제 첫 뽑기가 무엇이 나올지 모르므로 최소한의
   * 방어선이 미리 있어야 w1을 넘길 수 있다.
   */
  player: { startHp: 10, startGold: 300, startPawns: 3, hpLossNormal: 1, hpLossBoss: 5 },

  wave: {
    total: 20,
    prepareSeconds: 10,
    // 클리어 보너스는 정액이 아니라 **역방향 곡선**이다. 이 게임은 골드의 83%가 후반에
    // 들어오는데 최소 승리 비용은 초반부터 필요해서, 정액 보너스는 초반을 조이고 후반에
    // 남아돌게 만든다. 곡선으로 바꾸면 w5 예산이 2,108 → 2,788G(+32%)가 되고 후반 잉여는
    // 줄어든다. 총액은 6,000 → 6,200G로 거의 그대로다.
    clearBonusBase: 500,
    clearBonusDecay: 20,
    // 처치율 연동의 하한. 0으로 두면 무너진 판의 수입이 더 줄어 사망 나선이 생기고,
    // 1로 두면(=연동 없음) "체력만 버틸 수 있다면 누수 방치가 이득"이라는 기존 구멍이
    // 곡선 때문에 오히려 커진다(무조건 수입이 w1 기준 300 → 500G로 1.67배).
    clearBonusFloor: 0.5,
    spawnInterval: 1.0,
    countBase: 10,
    countPerWave: 2,        // 10 + 2*(w-1)
    bossEvery: 5,
  },

  enemy: {
    hpBase: 10,
    hpPerWaveEarly: 1,      // w <= 10
    hpPerWaveLate: 4,       // w >= 11
    hpScalingBreakpoint: 10,
    secondsPerSquare: 3.0,
    bossHpMultiplier: 30,
    bossSpeedMultiplier: 0.5,
    spritePx: 44,
    jitterPx: 8,
  },

  /**
   * goldPerAttack — 공격 1회당 얻는 골드. "1회"는 combat.ts가 실제로 발사한 횟수이지, 명중한
   * 적의 수도 처치한 수도 아니다(정액). 사거리에 적이 없으면 발사 자체가 없으므로 골드도 없다.
   * 퀸 버프는 공격력에만 곱해진다 — 골드에는 적용하지 않는다 (사용자 결정).
   *
   * 비숍만 0이 아니다: 딜러(공격력 3)에서 경제 기물(공격력 1 + 골드)로 역할을 바꿨다. 헤드리스
   * 실측(2026-08-15, 이 수치로 20웨이브 완주 ≈970초)으로 비숍 한 기의 총 공격 횟수는 배치에 따라
   * 112~185회 — 공격당 10G면 한 판에 1,120~1,850G로 비용 200G의 5.6~9.3배를 회수한다. 수입은
   * 웨이브당 20~60G(초반) → 160~190G(후반)로 커지지만 후반 처치 골드가 웨이브당 2,000G를 넘으므로
   * 비중은 오히려 줄어든다 — 즉 초반 투자 기물이다. 보스 웨이브만 예외적으로 낮다(20~50G): 보스
   * 한 마리는 대각선을 잠깐 스칠 뿐이라 48초짜리 웨이브에서도 2~5회밖에 못 쏜다.
   * 적이 사거리에 살아 있어야만 벌리는 구조라 방어가 무너지면 수입도 함께 끊긴다(스노우볼 방지).
   *
   * 비용은 300 → 200이다: 공격력을 버린 대신 초반 회수(초반 수입 기준 웨이브 4~5개)를 앞당겨,
   * "초반에 지르고 굴린다"는 이 기물의 결정 자체가 성립하게 만든다. 총 수익이 아니라 비용을
   * 건드린 이유는 goldPerAttack을 올리면 이미 골드가 남아도는 후반 수입까지 같이 부풀기 때문이다.
   */
  pieces: {
    pawn:   { cost: 100, damage: 2, interval: 0.5, goldPerAttack: 0  },
    // ★ v1.10: 나이트는 **공격 수단이 하나도 없다.** 폭발(3×3, 배치·이동마다)을 잃고 감속
    // 오라를 받았다(사용자 결정). damage 0은 밸런스 조정이 아니라 그 사실의 기록이다 —
    // 3을 남겨 두면 어디에서도 읽지 않는 값이 "나이트는 3딜"이라고 거짓말한다.
    // interval도 이제 아무 의미가 없다: 주기 공격이 없고(pattern 'none') 이동 쿨다운 게이트도
    // 함께 사라졌다. 0으로 두는 것은 "이 기물에 시간 축이 없다"는 뜻이고, 퀸(0)과 같은 이유다.
    knight: { cost: 300, damage: 0, interval: 0,   goldPerAttack: 0  },
    bishop: { cost: 200, damage: 1, interval: 3.0, goldPerAttack: 10 },
    rook:   { cost: 500, damage: 5, interval: 3.0, goldPerAttack: 0  },
    queen:  { cost: 900, damage: 0, interval: 0,   goldPerAttack: 0  },

    // ── 융합 기물 (v1.9) — 상점에 없고 뽑기에도 안 나온다. 같은 티어 재료 둘을 겹쳐야 나온다.
    //
    // 능력치는 **재료 합**이다. 그래야 §5.4의 골드 중립성과 판매가 불변식(원가 × 2^(t−1) × 0.5)이
    // 그대로 성립한다 — cost도 재료 원가의 합으로 둔 이유가 그것이다. 융합은 "더 세지는" 것이
    // 아니라 **역할을 겸업시키는** 것이다: 나이트는 자동 공격이 없어 칸값을 못 하는데, 융합물은
    // 재료의 주기 공격 + 나이트의 **감속**을 한 칸에서 겸한다 (v1.10 — 예전에는 이동 폭발이었다).
    //
    // interval은 나이트 것(0)을 물려받지 않고 **주기 공격을 담당하는 재료의 것**을 쓴다.
    //
    // ★ v1.10에서 damage가 4 → 1, 8 → 5로 내려갔다. **밸런스 조정이 아니라 재료 합 규칙을
    // 지킨 결과다**: 나이트의 damage가 3 → 0이 됐으므로 비숍 1 + 나이트 0 = 1, 룩 5 + 0 = 5다.
    // 예전 값(4·8)을 그대로 두면 500G짜리가 200G 비숍의 4배 화력을 내게 되어, 이 표 바로 위가
    // 말하는 골드 중립성이 무너진다 — 그리고 그 중립성은 core/pieces.ts와 core/fusion.ts가
    // 융합의 존재 근거로 인용하는 바로 그 규칙이다.
    //
    // 나이트가 내놓는 300G의 몫이 화력에서 **감속**으로 바뀐 것이지 사라진 것이 아니다:
    // 챈슬러는 이제 "룩과 같은 화력 + 감속"이고, 값은 룩(500) + 나이트(300)로 정확히 맞다.
    archbishop: { cost: 500,  damage: 1, interval: 3.0, goldPerAttack: 10 },  // 비숍(200)+나이트(300)
    chancellor: { cost: 800,  damage: 5, interval: 3.0, goldPerAttack: 0  },  // 룩(500)+나이트(300)
    // 아마존도 같은 규칙이다: 퀸(0) + 나이트(0) = 0. 순수 지원 기물이 됐다(버프 절반 + 감속).
    amazon:     { cost: 1200, damage: 0, interval: 0,   goldPerAttack: 0  },  // 퀸(900)+나이트(300)
  },

  /**
   * 감속 오라 — 나이트 계열이 **L자 행마 8칸**에 있는 적의 이동속도를 깎는다 (v1.10).
   *
   * 폭발을 대체한 능력이다(사용자 결정). 성질이 정반대라 코드 구조도 반대가 된다: 폭발은
   * 배치·이동 **순간**의 사건이라 GameEvent 하나로 끝났지만, 감속은 적이 그 칸에 있는 동안
   * 계속 걸리는 **상태**라 매 틱 재계산해야 한다(core/slow.ts).
   *
   * ★ **v1.13에서 티어에 따라 선형으로 커진다**(사용자 결정): T1 30% · T2 35% · T3 40% …
   * 단계마다 +5%p이고 상한 티어(6)에서 55%다. v1.10~v1.12의 "티어 무관"이 뒤집힌 것이라,
   * 그 규칙을 구조로 강제하던 장치도 함께 바뀌었다 — Enemy가 들고 있던 boolean이 **감속을
   * 거는 기물의 티어**(Enemy.slowTier)로 바뀌었다.
   *
   * ★ **중첩은 여전히 없다.** 여러 기물이 같은 칸을 덮으면 **가장 높은 티어 하나만** 적용된다
   * (합이 아니다). 그 보장이 자료구조에서 나오는 것도 그대로다 — 칸마다 최댓값 하나만
   * 담기므로 곱하거나 더할 값이 애초에 없고, Enemy가 배수가 아니라 **티어**를 들고 있어
   * 두 값을 곱하는 코드가 의미조차 갖지 못한다.
   *
   * ★ **왜 백분율 정수로 저장하는가.** 사용자가 규칙을 "30%에서 5%씩"으로 정의했고, 배수로
   * 저장하면 그 선형성이 0.70 / 0.65 / 0.60처럼 **뺄셈으로만** 드러나 읽는 사람이 규칙을
   * 역산해야 한다. 정수라 부동소수 누적도 없다 — 배수는 slowMultiplier()가 쓰는 시점에 한 번만
   * 유도한다.
   *
   * ⚠️ 이 값을 바꾸면 나이트 합성의 의미가 통째로 바뀐다. perTierPercent가 0이면 v1.12의
   * "나이트는 합성이 손해인 유일한 기물"로 정확히 되돌아간다(덮는 칸만 줄고 감속량은 그대로).
   */
  slowAura: { basePercent: 30, perTierPercent: 5 },

  /**
   * 동일 기물 합성 — **같은 종류 · 같은 티어**끼리만 합쳐지고 티어가 한 단계 오른다
   * (흰+흰=녹, 녹+녹=파, 파+파=보, 보+보=노, 노+노=빨). 능력치는 정확히 "합"이다: 공격력 5짜리
   * 룩 둘을 합치면 10이고, 판매가도 두 기물 판매가의 합과 같다.
   *
   * 같은 티어끼리만 합쳐지므로 배수는 단계마다 정확히 2배가 된다 — T2가 T1 둘의 합(×2)이고
   * T3는 그 T2 둘의 합(×4)이다. 그래서 tier는 "흡수한 개수"가 아니라 레벨이고, 실제 배수는
   * tierMultiplier()가 유도한다.
   *
   * 배수와 비용이 같은 속도로 커지므로(둘 다 2의 거듭제곱) 골드당 화력은 티어와 무관하게
   * 일정하다 — 이 기능은 골드 축에서 정확히 중립이다. 헤드리스 통제 실측(골드·파일 커버리지를
   * 동시에 고정)에서도 8,000G 룩 16×T1과 8×T2가 w16~w19 누수 0으로 완전히 동률이었고, 20웨이브
   * 최소 승리 비용도 18,800G로 합성 유무가 같았다. 다른 것은 그 방어선이 차지하는 칸뿐이다
   * (28칸 → 8칸). 즉 합성은 증폭이 아니라 압축이다.
   *
   * 플레이 상의 의미는 "문턱"에서 나온다. 룩 2기가 적 한 마리에게 넣는 총딜은 45(자기 파일 8발
   * + 상대 랭크 1발)라 w16의 43은 넘지만 w17의 47은 못 넘는데, 못 넘으면 그 피해는 전량 폐기된다
   * (실측: 같은 1,000G로 w17에서 룩 2×T1은 처치 0, 1×T2는 처치 6). 화력이 남으면 흩어놓는 쪽이,
   * 문턱에 걸리면 합치는 쪽이 옳다.
   *
   * maxTier는 5종 모두 6이다 — 테두리 색 6단계와 같은 수. 다만 퀸만은 성질이 다르다는 것을
   * 알고 열어 둔 것이라 근거를 남긴다(사용자 결정): 퀸의 버프는 다른 모든 기물의 공격력에
   * 곱해지는 유일한 값이라, 퀸의 티어 상한은 그대로 게임 전체 화력의 지수가 된다.
   * T3 퀸 두 기의 라인이 겹치는 칸은 이미 ×9이고, T6 두 기가 겹치면 ×65다 — 그 칸의 T6 룩은
   * 공격력 160 × 65 = 10,400이 된다(w20 보스 HP 1,770의 5.9배를 한 발에). 밸런스가 무너지면
   * 여기 queen만 3으로 되돌리는 것이 가장 국소적인 처방이고, 그러면 T3가 상한이 된다.
   */
  merge: {
    maxTier: {
      pawn: 6, knight: 6, bishop: 6, rook: 6, queen: 6,
      // 융합물도 같은 상한을 쓴다 — 같은 종류·같은 티어끼리 다시 합칠 수 있다.
      archbishop: 6, chancellor: 6, amazon: 6,
    },
  },

  /**
   * 적 유형 — 웨이브가 진행되며 섞여 들어오는 다섯 가지 정체성 (v1.14에서 3종 → 5종 재정의).
   *
   * **이것은 난이도 노브가 아니다.** 헤드리스 실측으로 룩 2기/파일 이상에서는 감산을 0.5까지
   * 내려도 w16~w19 누수가 전부 0이었다(포화). 난이도는 보스가 담당하고(bossDamageMultiplier),
   * 유형이 하는 일은 **구성 편중을 깨는 것**이다 — 각 유형이 "무엇을 강제하는가"로 설계됐다.
   *
   * ★ **v1.14에서 세 유형이 이름을 유지한 채 규칙이 바뀌었다**(사용자 결정). 이름만 보고
   * 예전 규칙을 가정하면 안 된다:
   *
   * | 유형 | v1.9~v1.13 | ★ v1.14 | 강제하는 것 |
   * |---|---|---|---|
   * | armored  | 받는 피해 ×0.625 | **공격력이 문턱 미만이면 피해 0** | 폰 도배 무력화 → 버프·합성 강제 |
   * | swift    | 속도 ×1.5 (2.0초/칸) | **속도 ×2.0 (1.5초/칸)** | 룩의 8회 타격이 4회로 → 반응 재배치 |
   * | shielded | 흡수 풀 maxHp의 15% | **전방(낮은 랭크) 피해 무시** | 폰의 전방 대각이 안 먹힘 → 뒤에서 쏘기 |
   * | splitter | — | **사망 시 인접 파일로 2마리** | 관통형(비숍) 가치 급등 |
   * | aura     | — | **주변 적의 유효 체력 +N** | 우선 처치 판단 |
   *
   * ★ **왜 장갑형이 고정 감산(−2)이 아니라 문턱인가** (사용자 결정). 고정 감산은 티어마다 다른
   * 비율로 깎아 합성의 골드 중립성을 무너뜨린다(실측: 룩 +33% / 나이트 +100% / 비숍 −50%).
   * 회귀 신호 N4가 그 중립성을 감시하므로 −2를 넣으면 그 자리에서 깨진다. 문턱은 같은 의도
   * (약한 기물만 골라 무력화)를 달성하면서 **문턱을 넘은 뒤에는 피해가 그대로 통과**하므로
   * 중립성이 티어별로 이산적으로만 갈린다.
   *
   * ★ **문턱이 3인 근거는 퀸 버프다.** T1 폰은 2딜이라 혼자서는 0이지만, 퀸 라인 위에서는
   * 2 × (1+1) = 4로 문턱을 넘는다. 즉 "폰 도배는 죽지만 버프받은 폰은 산다" — 사용자가 적은
   * "룩/퀸 버프 강제"가 이 한 숫자에서 나온다. 판정은 **감산 전 원피해**(pieceDamage의 결과,
   * 즉 티어·버프가 이미 곱해진 값)로 한다.
   *
   * ★ **보스에게는 문턱이 아니라 비율을 쓴다.** 보스 HP는 420~1,770이라 어떤 실전 빌드도
   * 문턱 3을 넘으므로 문턱은 보스에게 완전한 no-op이 된다. 그런데 이 값(0.875)은 **일반
   * 웨이브를 건드리지 않고 보스 난이도만 조절할 수 있는 유일한 노브**이고 S2에서 5안을 재서
   * 고른 값이다 — 유형을 재정의하면서 잃으면 안 된다.
   */
  traitDefs: {
    armored:  { damageThreshold: 3, bossDamageMultiplier: 0.875 },
    swift:    { speedMultiplier: 2.0 },
    shielded: { ignoreFrontal: true },
    splitter: { splitCount: 2, splitHpRatio: 0.5 },
    aura:     { auraBonusHp: 12, auraRadius: 2 },
  } as Record<EnemyTrait, {
    /** 이 값 **미만**의 원피해는 0이 된다(장갑형). 이상이면 감산 없이 그대로 통과한다. */
    damageThreshold?: number;
    /** 보스 전용 피해 배수. 문턱은 보스에게 무의미하므로 보스 난이도 노브는 이쪽이다. */
    bossDamageMultiplier?: number;
    speedMultiplier?: number;
    /** 적보다 **낮은 랭크**에서 온 피해를 무시한다(실드형). 적은 위에서 아래로 내려오므로
     *  낮은 랭크가 곧 그 적의 진행 방향 = 전방이다. */
    ignoreFrontal?: boolean;
    /** 사망 시 생성할 분열체 수. */
    splitCount?: number;
    /** 분열체가 물려받는 체력 비율. 1이면 총 체력이 3배가 되므로 1 미만이어야 한다. */
    splitHpRatio?: number;
    /** 주변 적에게 더해 주는 유효 체력. */
    auraBonusHp?: number;
    /** 오라가 닿는 반경(칸). 체비쇼프 거리로 잰다. */
    auraRadius?: number;
  }>,

  /**
   * 각 유형이 처음 등장하는 웨이브. 다섯 종이 되면서 간격을 좁혔지만 **하한이 있다.**
   *
   * ⚠️ **armored를 6보다 앞으로 당기면 안 된다.** w5가 첫 보스이고, 보스는 해금된 유형을
   * 곧바로 받으므로(enemyTraits) armored: 4로 두면 첫 보스가 0.875 배수를 달고 나온다 —
   * 실제로 그렇게 해 봤더니 N3(w5 게이트 최소성)가 그 자리에서 깨졌다. 이 게임은 w5를
   * 900G짜리 최소 빌드로 넘을 수 있어야 하고, 그 전제가 "첫 보스는 맨몸"이다.
   *
   * 그래서 v1.9의 armored: 6을 그대로 두고 뒤쪽만 촘촘히 했다. aura가 가장 늦은 16인데
   * 일반 적이 있는 마지막 웨이브가 19라 w16~19 네 웨이브에 등장한다 — 얇지만, 앞으로 당기면
   * 유형 다섯이 한꺼번에 쏟아지는 구간이 생긴다.
   */
  traitSchedule: {
    armored: 6, swift: 8, shielded: 11, splitter: 14, aura: 16,
  } as Record<EnemyTrait, number>,
  /** 일반 적 중 유형을 갖는 비율 (결정론적 쿼터) */
  traitRatio: 0.3,
  /** 유형별 쿼터 위상. 겹치면 같은 적에게 몰려 분포가 무너지므로 서로 어긋나게 둔다. */
  traitPhase: {
    armored: 0, swift: 3, shielded: 7, splitter: 11, aura: 5,
  } as Record<EnemyTrait, number>,
  /** 일반 적이 동시에 가질 수 있는 유형 수 */
  maxTraitsNormal: 1,
  /** 보스가 유형 둘을 겸하기 시작하는 웨이브 */
  bossTraitCountFromWave: 15,
  /**
   * 보스에게 붙지 않는 유형. **넷이 금지되고 armored만 남는다.**
   *  - swift: 보스는 "딜을 넣을 시간을 주는" 설계라 가속이 그 전제를 깬다.
   *  - splitter: 보스가 분열하면 보스가 여러 마리가 된다 — 누수 −5가 배로 늘어 즉사한다.
   *  - aura: 보스는 단독 스폰이라 주변에 버프할 적이 없다(완전한 no-op이므로 붙일 이유가 없다).
   *  - shielded: ★ **실측으로 게임이 클리어 불가능해져서 금지했다.** swift와 정확히 같은 논리다 —
   *    전방 무시는 딜 창을 절반 이하로 줄여 "딜을 넣을 시간을 준다"는 보스의 전제를 깬다.
   *    실측: 최소 승리 빌드(18,800G)의 w15 보스가 8/8 → **0/8**(평균딜 891/1,170)이 되고,
   *    같은 골드를 높은 랭크(r5~r7)로 전부 올려도 6/8이 최선이며 w20은 그래도 0/8이다.
   *    보스 처치가 3/4 → 2/4로 떨어지면 보스 누수 2회 = −10 = 시작 체력 전부다.
   *
   * ⚠️ 그 결과 **`bossTraitCountFromWave`가 휴면 상태가 됐다** — 보스가 가질 수 있는 유형이
   * armored 하나뿐이라 "둘을 겸한다"가 성립하지 않는다. 값을 남겨 둔 이유는 보스에 붙일 수
   * 있는 유형이 다시 둘 이상이 되면 즉시 살아나기 때문이다(traitPhase와 같은 성격).
   *
   * ⚠️ 그리고 이것은 **보스를 v1.13보다 쉽게 만든다.** 예전 shielded(흡수 풀 15%)는 보스에게
   * 붙어서 w15의 난이도 단계를 만들고 있었다. 지금 w15·w20 보스는 armored만 단다.
   * 밸런스를 다시 잡을 때 이 자리가 첫 후보다(docs/balance-audit.md 참고).
   */
  bossForbidden: ['swift', 'splitter', 'aura', 'shielded'] as readonly EnemyTrait[],

  /**
   * 기물 뽑기 — **기물을 얻는 유일한 구매 경로** (v1.16, 사용자 결정).
   *
   * 정가제(원하는 기물을 골라 사는 것)를 없앤 이유는 사용자가 적은 그대로다: 최적 빌드가
   * 정해져 있으면 매 판이 같아진다. 밸런스 감사도 같은 결론을 냈다 — 최적 빌드는 룩+퀸이고
   * 다른 구성은 전부 열세다(docs/balance-audit.md §7).
   *
   * ★ **확률은 사용자가 정한 값이다** (폰 40 / 나이트 25 / 비숍 25 / 룩 9 / 퀸 1). 합이 정확히
   * 1이어야 하고, 그 사실을 테스트가 단언한다 — 합이 1이 아니면 pickByWeight가 조용히
   * 마지막 항목으로 치우친다.
   *
   * ★ 기대 비용으로 본 각 기물의 실질 가격이 정가와 크게 다르다. 뽑기 1회 300G 기준:
   *   폰 750G(정가 100) · 나이트 1,200G(300) · 비숍 1,200G(200) · 룩 3,333G(500) ·
   *   퀸 **30,000G**(900). 즉 퀸은 사실상 한 판에 한 번 볼 수 있는 기물이 됐다
   *   (한 판 총 골드 약 24,900G < 30,000G).
   *   ⚠️ 밸런스는 사용자 지시로 나중에 잡는다 — 이 값들은 기능 구현용 초기값이다.
   *
   * `pieces[].cost`는 **여전히 살아 있다** — 판매가(sellPrice)와 지급 가치 계산이 그 값을
   * 쓴다. 사라진 것은 "그 값을 내고 그 기물을 산다"는 경로뿐이다.
   */
  gacha: {
    cost: 300,
    /**
     * ★ **뽑기 1회당 가격 증가분** (v1.18, 사용자 결정: 자원 압박).
     *
     * 왜 수입을 줄이는 대신 **가격을 올리는가.** 실측으로 잉여가 후반에 몰려 있다 —
     * 총 24,902G 중 70%가 w11~20에 들어오고, 초반(w1~5)은 클리어 보너스 곡선으로
     * **일부러 열어 둔** 구간이다(정액 시절 2,108G → 2,788G). 처치 보상 배수를 낮추면
     * 전·후반을 균등하게 깎아 그 열어 둔 초반이 먼저 죽고, N3(w5 게이트 최소성)가 깨진다.
     *
     * 누진은 잉여가 있는 곳만 겨눈다: 첫 뽑기는 여전히 300G라 초반 게이트가 그대로이고,
     * 후반에는 한 번 뽑는 값이 1,000G를 넘어 "더 살 수 있는데 안 사는" 선택이 생긴다.
     * 그리고 **사망 나선을 만들지 않는다** — 못하는 플레이어도 초반 뽑기는 같은 값에 한다.
     *
     * 실측 총 뽑기 횟수(총 골드 24,902G 전량 투입 기준):
     *   0(정액) 83회 · +10G 46회 · **+20G 37회** · +30G 32회 · +50G 26회
     * 보드가 56칸이므로 정액 83회는 애초에 칸을 넘겼다 — 누진은 그 초과분부터 깎는다.
     */
    costStep: 20,
    weights: {
      pawn: 0.40, knight: 0.25, bishop: 0.25, rook: 0.09, queen: 0.01,
      // 융합물은 뽑기에도 나오지 않는다 — 융합으로만 얻는다(TRAITS[·].purchasable = false).
      archbishop: 0, chancellor: 0, amazon: 0,
    } as Record<PieceType, number>,
  },

  /**
   * 무작위 기물 지급 — 짝수 웨이브를 클리어할 때마다 T1 기물 하나를 **보드의 빈 칸**에 준다
   * (v1.12 — 예전에는 트레이였다).
   *
   * 목적은 **매 판을 다르게 만드는 것**이다. 이 게임의 무작위는 스폰 파일 하나뿐인데 그것도
   * 파일 커버리지를 넓히면 무의미해져서, 최적 빌드가 판마다 동일했다. 부수적으로 초반 골드를
   * 부양하고(사용가치 10 × 290G), 원치 않던 기물이 융합 재료가 되어 발견을 만든다.
   *
   * 정직한 한계: 원안이 노렸던 "슬롯 압박"은 실측상 거의 없었다. ★ v1.12에서 그 압박의
   * 무대가 트레이 16칸에서 **보드 56칸**으로 옮겨갔는데, 최소 승리 빌드가 28기이고 지급이
   * 10기라 여전히 여유가 크다 — 다만 이제는 자리가 없으면 지급이 환급으로 바뀌므로,
   * 폰처럼 싼 기물을 잔뜩 사서 보드를 메우는 빌드에서는 실제로 걸릴 수 있다.
   *
   * 총량이 10회인 이유: 20회면 무상 가치 5,700G가 적 유형이 만든 난이도 상승을 통째로
   * 상쇄해 게임이 오히려 쉬워진다. 10회면 2,850G로 보너스 곡선 +200G와 합쳐 대략 균형이다.
   *
   * 퀸이 0%인 이유: 최소 승리 빌드의 58%가 퀸이고 퀸은 **곱셈 축**이라 분산이 골드로 흡수되지
   * 않는다. 10회 추첨에서 5%면 0회가 60%, 2회 이상이 8.6%라 판마다 전력이 널뛴다.
   */
  grant: {
    /** 롤백 노브. weights를 0으로 만들어 우회하지 말 것 — 추첨 자체는 계속 돌아 draw 수가 남는다. */
    enabled: true,
    everyWaves: 2,
    weights: {
      pawn: 0.30, bishop: 0.25, rook: 0.25, knight: 0.20, queen: 0,
      archbishop: 0, chancellor: 0, amazon: 0,
    } as Record<PieceType, number>,
  },

  economy: { sellRatio: 0.5 },
  slots: { rows: 4, cols: 4 },
} as const;

/**
 * 기물의 **행동 특성** 표 — `type === 'knight'` 같은 술어가 코드 곳곳에 흩어지는 것을 막는다.
 *
 * 왜 필요한가. 지금 `type === 'knight'` 술어가 10곳, `type === 'queen'`이 8곳에 흩어져 있는데
 * **컴파일 시 전수성이 보장되는 것은 하나도 없다.** 기물이 늘면 그 술어들은 조용히 false를
 * 돌려주고, 새 기물은 "공격은 하는데 소리가 안 나고 이펙트도 안 그려지는" 상태로 배포된다.
 * TRAITS는 `Record<PieceType, …>`이라 기물이 늘면 **컴파일러가 빠짐없이 짚어 준다.**
 *
 * 이 표는 "무엇을 하는 기물인가"만 담는다. "얼마나 세게"는 CONFIG.pieces가, "어떤 칸을"은
 * patterns.ts가 담당한다 — 세 축을 섞지 않는 것이 이 표의 유일한 규칙이다.
 */
export type AttackPattern = 'pawn' | 'bishop' | 'rook' | 'none';

export interface PieceTraits {
  /** 주기 발사 패턴. 'none'이면 updateCombat의 발사 루프에서 제외된다. */
  pattern: AttackPattern;
  /**
   * L자 8칸의 적을 감속시키는가 (core/slow.ts). v1.10에서 `blast`를 대체했다.
   *
   * 개명이 아니라 **다른 축이다.** blast는 "배치·이동 직후 한 번 터진다"는 순간 사건이라
   * 이동 쿨다운 게이트와 짝을 이뤘지만, slow는 서 있기만 하면 걸리는 상태라 쿨다운과
   * 아무 관계가 없다. 그래서 hasMoveCooldown()도 함께 사라졌다.
   */
  slow: boolean;
  /*
   * ⚠️ v1.11에서 `moveL`(보드 위 이동이 L자로 제한되는가)이 사라졌다 — 나이트도 다른 기물과
   * 똑같이 아무 칸으로나 재배치된다(사용자 결정). 나이트가 이 필드를 참으로 갖는 **유일한**
   * 기물이었으므로, 남겨 두면 어떤 기물도 참이 아닌 축이 되어 아무것도 서술하지 못한다.
   *
   * 함께 사라진 것: `isKnightMove` · `knightMoves` · RejectReason `'knightPattern'` ·
   * highlights의 초록 이동 후보 표시. 되살리려면 그 넷을 함께 복원해야 한다.
   *
   * ★ **L자 자체는 사라지지 않았다** — 이제 이동이 아니라 `slow`(감속 범위)에 산다.
   * 나이트의 체스적 정체성이 행마에서 능력으로 옮겨간 것이고, patterns.ts의 L_OFFSETS는
   * 그래서 여전히 쓰인다.
   */
  /** 퀸 라인 버프 계수. 0이면 버프를 주지 않는다(buff.ts). */
  buffFactor: number;
  /** 상점에 노출되고 구매할 수 있는가. */
  purchasable: boolean;
}

export const TRAITS: Record<PieceType, PieceTraits> = {
  pawn:   { pattern: 'pawn',   slow: false, buffFactor: 0, purchasable: true },
  knight: { pattern: 'none',   slow: true,  buffFactor: 0, purchasable: true },
  bishop: { pattern: 'bishop', slow: false, buffFactor: 0, purchasable: true },
  rook:   { pattern: 'rook',   slow: false, buffFactor: 0, purchasable: true },
  queen:  { pattern: 'none',   slow: false, buffFactor: 1, purchasable: true },

  // 융합물은 재료 둘의 특성을 겸한다. 물려받는 나이트 능력은 v1.10부터 **감속**이다(폭발이
  // 아니라) — 융합물의 설계 근거가 "재료의 주기 공격 + 나이트의 능력 겸업"이므로 나이트의
  // 정체성이 바뀌면 따라간다(사용자 결정). 즉 아치비숍은 "비숍처럼 쏘면서 L자 8칸을 늦춘다"다.
  //
  // ⚠️ v1.11부터 이동 규칙에서는 융합물과 재료가 구분되지 않는다 — 나이트의 L자 제약이
  // 사라져 **모든 기물이 아무 칸으로나 재배치된다.** 예전에는 "융합물은 moveL을 물려받지
  // 않는다"가 의도적 결정이었지만, 이제 물려받을 제약 자체가 없다.
  archbishop: { pattern: 'bishop', slow: true, buffFactor: 0, purchasable: false },
  chancellor: { pattern: 'rook',   slow: true, buffFactor: 0, purchasable: false },
  // 아마존은 퀸의 버프를 물려받되 계수를 절반으로 둔다 — 퀸의 티어는 보드 전체 화력의
  // 지수라(§5.4) 버프를 겸하는 기물이 늘면 그 지수가 곱으로 겹친다.
  amazon:     { pattern: 'none',   slow: true, buffFactor: 0.5, purchasable: false },
};

/**
 * 티어 n 기물의 능력치 배수 = 2^(n-1). 같은 티어끼리만 합쳐지므로(CONFIG.merge) T2는 T1 둘의
 * 합, T3는 T2 둘의 합 …이 되어 단계마다 정확히 2배다. 배열이 아니라 식으로 두는 이유는 상한을
 * 바꿔도 표를 함께 고칠 필요가 없기 때문이다 — enemyHp/enemyCount와 같은 "CONFIG에서 유도하는
 * 함수" 선례를 따른다.
 *
 * 누적 투자액도 정확히 같은 배수를 탄다(T2 = 기본 기물 2기분 = cost × 2). 그래서 골드당 화력이
 * 티어와 무관하게 일정하고, 판매가(economy.ts)도 이 함수 하나로 "합성 전 판매액의 합"이 된다.
 */
export function tierMultiplier(tier: number): number {
  return 2 ** (tier - 1);
}

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


/**
 * 티어 n 감속 기물의 감속률(백분율 정수). T1 30 · T2 35 · T3 40 … (v1.13).
 *
 * 문구에 30을 리터럴로 쓰지 않는 이유는 이 저장소의 다른 유도 함수들과 같다: 계수를 바꾸는
 * 순간 툴팁·시작 화면·이펙트 라벨 셋이 각자 옛 숫자를 말하기 시작하는데, **그 어긋남은
 * 테스트가 아니라 플레이어가 발견한다.**
 *
 * 기본값 1은 "티어를 모르는 호출부"를 위한 것이 아니라 **기물 없이 규칙만 설명하는 자리**
 * (시작 화면의 기물 설명)를 위한 것이다 — 거기서는 T1 기준값을 보여주는 것이 맞다.
 *
 * ⚠️ 여기서 hasMoveCooldown()이 사라졌다(v1.10). 그 함수는 "폭발 기물의 interval은 공격
 * 주기가 아니라 이동 쿨다운"이라는 구분이었는데, 폭발이 없어지면서 구분할 대상 자체가
 * 없어졌다. 이제 interval은 모든 기물에서 **공격 주기 하나**만 뜻한다 — 되살리지 말 것.
 */
export function slowPercent(tier = 1): number {
  const { basePercent, perTierPercent } = CONFIG.slowAura;
  return basePercent + perTierPercent * (tier - 1);
}

/**
 * 티어 n 감속 기물이 적에게 거는 **속도 배수**. 화면 문구는 위 백분율을, 물리는 이 배수를 쓴다.
 *
 * 두 함수가 같은 값에서 유도되므로 "표시는 40%인데 실제로는 30%" 같은 어긋남이 생길 수 없다 —
 * 이 게임에서 표시와 실제가 갈라지는 사고를 막는 방식이 늘 이것이었다(tierMultiplier·clearBonus).
 */
export function slowMultiplier(tier: number): number {
  return 1 - slowPercent(tier) / 100;
}

/**
 * 스폰되는 적의 유형 — **rng를 소비하지 않는 결정론적 쿼터**다.
 *
 * 확률 추첨을 쓰지 않는 이유가 둘이다. ① 스폰 파일 추첨은 rng 호출 "순서"에만 의존하므로,
 * 여기서 draw를 한 번 더 뽑으면 파일 시퀀스가 통째로 달라져 기존 헤드리스 측정이 조용히 다른
 * 것을 재게 된다(signals.test.ts의 N8이 이 사실을 강제한다). ② n=20~46짜리 30% 이항 추첨은
 * 웨이브별 실측 혼합률이 18~50%로 흔들려 회귀 신호가 잡음에 묻힌다.
 */
export function enemyTraits(wave: number, spawnIndex: number, isBoss: boolean): EnemyTrait[] {
  const unlocked = (Object.keys(CONFIG.traitSchedule) as EnemyTrait[])
    .filter(t => wave >= CONFIG.traitSchedule[t]);

  if (isBoss) {
    const allowed = unlocked.filter(t => !CONFIG.bossForbidden.includes(t));
    const count = wave >= CONFIG.bossTraitCountFromWave ? 2 : 1;
    return allowed.slice(0, count);
  }

  if (unlocked.length === 0) return [];
  // 쿼터는 **유형별이 아니라 적별로 한 번만** 판정한다. 유형마다 독립 쿼터를 돌리면 해금이
  // 늘수록 합집합이 커져(실측 3종 해금 시 52%) 의도한 비율을 훌쩍 넘긴다.
  // 누적 개수가 정확히 ratio 비율로 늘어나는 지점에서만 붙인다 — n에 무관하게 비율이 고정된다.
  const k = spawnIndex;
  const gets = Math.floor(k * CONFIG.traitRatio) > Math.floor((k - 1) * CONFIG.traitRatio);
  if (!gets) return [];
  // 어느 유형인지는 순환으로 정한다. 위상을 더해 웨이브마다 같은 순서로 시작하지 않게 한다.
  const nth = Math.floor(k * CONFIG.traitRatio) + CONFIG.traitPhase[unlocked[0]];
  return [unlocked[nth % unlocked.length]].slice(0, CONFIG.maxTraitsNormal);
}

/**
 * 보스가 받는 피해 배수. **일반 적에게는 항상 1이다** — 일반 적의 장갑은 배수가 아니라
 * 문턱(damageThresholdFor)으로 동작하기 때문이다(v1.14).
 *
 * 이 값이 남아 있는 이유는 그것이 **일반 웨이브를 건드리지 않고 보스 난이도만 조절할 수 있는
 * 유일한 노브**이고, S2에서 5안을 실측해 고른 값이기 때문이다. 문턱은 보스에게 완전한
 * no-op이므로(보스 HP 420~1,770 앞에서 어떤 실전 빌드도 문턱 3을 넘는다) 유형을 재정의하면서
 * 이 노브를 잃으면 보스 축의 난이도가 조용히 내려간다.
 */
export function armorMultiplier(traits: readonly EnemyTrait[], isBoss: boolean): number {
  if (!isBoss) return 1;
  let m = 1;
  for (const t of traits) {
    const v = CONFIG.traitDefs[t].bossDamageMultiplier;
    if (v !== undefined) m *= v;
  }
  return m;
}

/**
 * 이 적을 때리려면 넘어야 하는 **최소 원피해**. 없으면 0.
 *
 * ★ 문턱 **미만이면 0, 이상이면 감산 없이 전량 통과**다. 그래서 합성의 골드 중립성이
 * 티어별로 이산적으로만 갈린다 — 고정 감산(−2)이 모든 티어를 서로 다른 비율로 깎아
 * 중립성을 연속적으로 무너뜨리는 것과 다르다(N4가 그 차이를 감시한다).
 *
 * 보스에게는 적용하지 않는다 — 위 armorMultiplier 주석 참조.
 */
export function damageThresholdFor(traits: readonly EnemyTrait[], isBoss: boolean): number {
  if (isBoss) return 0;
  let th = 0;
  for (const t of traits) {
    const v = CONFIG.traitDefs[t].damageThreshold;
    if (v !== undefined) th = Math.max(th, v);
  }
  return th;
}

/** 이 적이 **전방**(자기보다 낮은 랭크)에서 온 피해를 무시하는가 (실드형, v1.14). */
export function ignoresFrontalDamage(traits: readonly EnemyTrait[]): boolean {
  return traits.some(t => CONFIG.traitDefs[t].ignoreFrontal === true);
}


/**
 * 웨이브 클리어 보너스 — 웨이브 번호에 따라 줄어드는 곡선이고, 그 웨이브의 처치율에 연동된다.
 *
 * 두 축이 각각 다른 문제를 푼다.
 *  - **곡선**: 골드의 83%가 후반에 들어오는데 최소 승리 비용은 초반부터 필요하다. 정액이면
 *    초반이 숨막히고 후반이 남아돈다.
 *  - **처치율 연동**: 정액 보너스는 "체력만 버틸 수 있다면 누수 방치가 이득"이라는 선택지를
 *    만든다(클리어 보너스는 그대로 받고 처치 골드만 포기). 곡선이 그 무조건 수입을 1.67배로
 *    키우므로 연동 없이 곡선만 넣으면 결함이 오히려 커진다.
 *
 * 하한(clearBonusFloor)이 사망 나선을 막는다 — 0이면 무너진 판의 수입이 더 줄어 회복이
 * 불가능해지고, 1이면 연동이 없는 것과 같다.
 */
export function clearBonus(wave: number, killRatio = 1): number {
  const { clearBonusBase, clearBonusDecay, clearBonusFloor } = CONFIG.wave;
  const full = Math.max(0, clearBonusBase - clearBonusDecay * (wave - 1));
  const ratio = clearBonusFloor + (1 - clearBonusFloor) * Math.min(1, Math.max(0, killRatio));
  return Math.round(full * ratio);
}


/**
 * 누적합으로 roll ∈ [0,1)을 기물 종류에 매핑한다. **rng를 여기서 부르지 않는다** —
 * 난수는 호출부가 주입해야 테스트가 결정론적으로 전 구간을 훑을 수 있다.
 */
function pickByWeight(weights: Record<PieceType, number>, roll: number): PieceType {
  const entries = Object.entries(weights) as [PieceType, number][];
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let acc = 0;
  const target = Math.min(Math.max(roll, 0), 1 - Number.EPSILON) * total;
  for (const [type, w] of entries) {
    acc += w;
    if (target < acc) return type;
  }
  // 부동소수 잔차로 여기 도달할 수 있다. 가중치가 0이 아닌 마지막 종류로 떨어뜨린다.
  return entries.filter(([, w]) => w > 0).map(([t]) => t).pop()!;
}

export function pickGrantType(roll: number): PieceType {
  return pickByWeight(CONFIG.grant.weights, roll);
}

/**
 * 뽑기 결과 (v1.16). 지급과 **같은 누적합 로직**을 쓰고 표만 다르다.
 *
 * ★ 로직을 공유하는 것이 중요하다. 두 곳에 같은 누적합을 적으면 경계 처리(roll이 정확히 1,
 * 부동소수 잔차)가 한쪽에서만 고쳐진다 — 그 결함은 수만 번에 한 번 나오는 잘못된 기물이라
 * 아무도 재현하지 못한다.
 */
/**
 * 지금 뽑기 한 번의 가격 (v1.18). 뽑은 횟수에 선형으로 오른다.
 *
 * ★ **횟수에 의존하고 웨이브·시간에 의존하지 않는다.** 시간 기준으로 두면 "안 뽑고 기다리면
 * 싸진다"가 되어 플레이를 멈추는 것이 최적이 된다. 횟수 기준이면 총 뽑기 수가 총 골드로
 * 상한 지어지고, 언제 뽑든 그 상한은 같다 — 순서만 플레이어가 고른다.
 */
export function drawCost(drawsMade: number): number {
  return CONFIG.gacha.cost + CONFIG.gacha.costStep * drawsMade;
}

export function pickGachaType(roll: number): PieceType {
  return pickByWeight(CONFIG.gacha.weights, roll);
}
