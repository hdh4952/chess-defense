/** CanvasRenderingContext2D의 최소 기록용 스텁. render()/Effects.draw()가 사용하는 메서드만 구현한다.
 * Task 7(renderer.test.ts)에서 처음 만들어졌고, Task 19(effects.test.ts)가 arc()를 추가로 필요로 해
 * 공용 헬퍼로 뽑아냈다 — 두 테스트가 각자 스텁을 들고 있으면 메서드가 하나씩 어긋나기 쉽다. */
export interface Call { method: string; args: unknown[]; fillStyle: unknown; strokeStyle: unknown }

export function makeStubCtx() {
  const records: Call[] = [];
  const gradientStub = { addColorStop: (_offset: number, _color: string): void => {} };
  const ctxObj: any = {
    fillStyle: '', strokeStyle: '', font: '', lineWidth: 1,
    textAlign: 'start', textBaseline: 'alphabetic', globalAlpha: 1,
  };
  const record = (method: string, args: unknown[]): void => {
    records.push({ method, args, fillStyle: ctxObj.fillStyle, strokeStyle: ctxObj.strokeStyle });
  };
  ctxObj.save = (): void => record('save', []);
  ctxObj.restore = (): void => record('restore', []);
  ctxObj.translate = (x: number, y: number): void => record('translate', [x, y]);
  ctxObj.fillRect = (x: number, y: number, w: number, h: number): void => record('fillRect', [x, y, w, h]);
  ctxObj.beginPath = (): void => record('beginPath', []);
  ctxObj.moveTo = (x: number, y: number): void => record('moveTo', [x, y]);
  ctxObj.lineTo = (x: number, y: number): void => record('lineTo', [x, y]);
  ctxObj.arc = (...args: unknown[]): void => record('arc', args);
  ctxObj.stroke = (): void => record('stroke', []);
  ctxObj.ellipse = (...args: unknown[]): void => record('ellipse', args);
  ctxObj.fill = (): void => record('fill', []);
  ctxObj.strokeText = (text: string, x: number, y: number): void => record('strokeText', [text, x, y]);
  ctxObj.fillText = (text: string, x: number, y: number): void => record('fillText', [text, x, y]);
  ctxObj.createRadialGradient = (...args: unknown[]) => { record('createRadialGradient', args); return gradientStub; };
  ctxObj.createLinearGradient = (...args: unknown[]) => { record('createLinearGradient', args); return gradientStub; };
  return { ctx: ctxObj, records, gradientStub };
}
