/** rAF의 가변 프레임 시간을 고정 스텝으로 분해한다. 렌더는 호출자가 매 프레임 수행. */
export function createTicker(fixedDt = 1 / 60, maxFrame = 0.25) {
  let acc = 0;
  return function advance(realDt: number, step: (dt: number) => void): void {
    acc += Math.min(realDt, maxFrame);
    while (acc >= fixedDt) {
      step(fixedDt);
      acc -= fixedDt;
    }
  };
}
