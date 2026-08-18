/**
 * 인메모리 localStorage 스텁 — 영속화를 실제로 검증하기 위한 공용 헬퍼.
 *
 * ⚠️ **이 테스트 환경에는 localStorage가 아예 없다** — happy-dom은 제공하지 않고, Node의
 * 실험적 구현도 `--localstorage-file` 없이는 꺼져 있다. `src/storage.ts`는 그런 환경을 정상
 * 경로로 다루므로(없으면 저장하지 않고 메모리로만 동작한다) 스텁을 심지 않으면 영속화 단언들이
 * "저장이 안 됐다"가 아니라 **"저장할 곳이 없다"로 조용히 통과해 버린다.**
 *
 * `canvasStub.ts`와 같은 성격의 모듈이다: 여러 스위트가 각자 스텁을 들고 있으면 동작이 하나씩
 * 어긋나기 쉬우므로 한 곳에 둔다.
 */
export interface StorageStub {
  /** 저장된 원본 문자열 — 단언은 이 맵을 직접 본다 */
  data: Record<string, string>;
  /** setItem 호출 횟수 — "쓸데없이 다시 쓰지 않는가"를 재는 데 쓴다 */
  writes: number;
}

export function installStorage(): StorageStub {
  const data: Record<string, string> = {};
  const stub: StorageStub = { data, writes: 0 };
  const impl = {
    get length(): number { return Object.keys(data).length; },
    clear(): void { for (const k of Object.keys(data)) delete data[k]; },
    getItem(key: string): string | null { return key in data ? data[key] : null; },
    key(i: number): string | null { return Object.keys(data)[i] ?? null; },
    removeItem(key: string): void { delete data[key]; },
    setItem(key: string, value: string): void { data[key] = String(value); stub.writes++; },
  };
  (globalThis as Record<string, unknown>).localStorage = impl as unknown as Storage;
  return stub;
}

export function uninstallStorage(): void {
  delete (globalThis as Record<string, unknown>).localStorage;
}
