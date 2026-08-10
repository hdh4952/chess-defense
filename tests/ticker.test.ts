import { describe, expect, it } from 'vitest';
import { createTicker } from '../src/core/ticker';

describe('createTicker (고정 타임스텝, 스펙 10.2)', () => {
  it('누적된 실시간을 1/60초 단위 스텝으로 분해한다', () => {
    const tick = createTicker(1 / 60);
    let calls = 0;
    tick(0.05, () => calls++);          // 0.05s → 3스텝 (나머지 누적)
    expect(calls).toBe(3);
    tick(0.0001, () => calls++);        // 누적 부족 → 0스텝
    expect(calls).toBe(3);
  });
  it('프레임 드랍 시 maxFrame으로 클램프 (나선형 지연 방지)', () => {
    const tick = createTicker(1 / 60, 0.25);
    let calls = 0;
    tick(10, () => calls++);
    expect(calls).toBe(15);             // 0.25s / (1/60) = 15
  });
});
