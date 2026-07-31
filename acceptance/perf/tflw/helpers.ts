// D19's generator self-diagnosis (SelfDiagnosis.saturated) tracks tflw's own event-loop
// lag/CPU — a real request against a fast target won't come close to saturating a single
// generator process on its own. `burnCpu` deliberately, synchronously blocks the event loop for
// ~20ms per call — the same real, non-simulated technique packages/cli/test/e2e.test.ts's own
// inconclusive-exit-code test uses — so `generator-saturation-demo.tflw` can demonstrate D19
// firing for real, on demand, rather than only ever being provable by accident.
export function burnCpu(): boolean {
  const start = Date.now();
  while (Date.now() - start < 20) {
    // deliberate synchronous busy-work
  }
  return true;
}
