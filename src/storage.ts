/**
 * localStorage 얇은 래퍼 — **판을 넘어 남는 것**을 저장하는 유일한 통로 (v1.19).
 *
 * 지금 이 통로를 쓰는 것은 둘이다: 스킨 선택(`render/skins.ts`)과 플레이어 기록(`progress.ts`).
 * 둘이 각자 방어 코드를 들고 있으면 한쪽에만 예외 처리가 빠져도 그 사실을 아무도 모르므로
 * (사파리 프라이빗 모드에서만 터지는 종류의 결함이다) 한 곳에 모은다.
 *
 * ⚠️ **저장 자체가 실패해도 게임은 그대로 굴러가야 한다.** 저장은 전부 부가 기능이다 —
 * localStorage가 없는 환경(비-브라우저 테스트), 접근 자체가 던지는 환경(사파리 프라이빗 모드),
 * 용량이 찬 환경 어디서도 이 파일의 함수는 던지지 않는다. 실패하면 이번 판에서는 메모리로만
 * 동작하고, 다음에 열 때 기본값으로 시작할 뿐이다.
 */

/** localStorage 접근 자체가 던질 수 있다 — 있는지 보는 것조차 try로 감싼다. */
function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/**
 * 저장값을 JSON으로 읽는다. 없거나·못 읽거나·JSON이 아니면 null.
 *
 * ★ 돌려주는 타입이 `unknown`인 것이 중요하다. 저장값은 **전적으로 신뢰할 수 없는 입력**이다 —
 * 사용자가 직접 고칠 수도 있고, 이 코드가 형식을 바꾼 뒤의 옛 값일 수도 있다. 호출부가
 * 반드시 자기 손으로 검증하게 만든다.
 */
export function readStored(key: string): unknown {
  const store = storage();
  if (!store) return null;
  let raw: string | null;
  try {
    raw = store.getItem(key);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;                  // 손상된 값 — 기본값으로 시작한다
  }
}

/** 저장값을 JSON으로 쓴다. 실패는 조용히 삼킨다(위 ⚠️ 참조). */
export function writeStored(key: string, value: unknown): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    // 용량 초과·쓰기 금지 — 이번 판에서는 메모리 값이 그대로 살아 있다.
  }
}
