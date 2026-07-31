// M35a baseline: the same GET-then-POST pattern as bench.tflw's scenario, using Node's global
// `fetch` directly (the same client tflw's own http.ts uses on its non-mTLS path — decision-
// parity with M34's own isolation-table method, which also compared tflw against raw `fetch`, not
// a different HTTP library). No interpreter, no redaction, no trace-building — just the requests.
//
// Usage: node --cpu-prof --cpu-prof-dir=report --cpu-prof-name=raw.cpuprofile raw-fetch-bench.mjs
//   [port] [users] [durationMs]

const port = Number(process.argv[2] ?? 4099);
const users = Number(process.argv[3] ?? 20);
const durationMs = Number(process.argv[4] ?? 5000);
const base = `http://127.0.0.1:${port}`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Mirrors interpreter.ts's own `RampUsersWorkload` spawn loop exactly (runLoad, ~line 500-520):
// VU `i` of `users` spawns at `runStart + (i/users)*overMs`, then loops until the shared
// `runEnd = runStart + overMs` — NOT all `users` workers active from t=0. A naive all-at-once
// baseline would understate tflw's per-request cost (comparing tflw's *averaged* ramp concurrency
// against raw's *full* concurrency the whole time) as much as it'd overstate it the other way, so
// this replicates the identical ramp schedule for a fair comparison.
async function worker(spawnAt, runEnd) {
  const waitMs = spawnAt - Date.now();
  if (waitMs > 0) await sleep(waitMs);
  let iterations = 0;
  while (Date.now() < runEnd) {
    const getRes = await fetch(`${base}/products`);
    const products = await getRes.json();
    const productId = products[0].id;
    const postRes = await fetch(`${base}/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [{ productId, quantity: 1 }] }),
    });
    await postRes.json();
    iterations++;
  }
  return iterations;
}

const runStart = Date.now();
const runEnd = runStart + durationMs;
const counts = await Promise.all(
  Array.from({ length: users }, (_, i) => worker(runStart + (i / users) * durationMs, runEnd)),
);
const wallMs = Date.now() - runStart;
const iterations = counts.reduce((a, b) => a + b, 0);

console.log(JSON.stringify({ label: 'raw-fetch', users, wallMs, iterations, requestsPerIteration: 2, msPerIteration: wallMs / iterations }, null, 2));
