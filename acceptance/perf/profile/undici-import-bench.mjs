// M35b test: does merely importing the standalone `undici` npm package (as http.ts does,
// unconditionally, for its mTLS Agent path) slow down Node's separate BUILT-IN global fetch(),
// even when the imported undici Agent/fetch are never called?
// Usage: node undici-import-bench.mjs <mode> [port] [users] [durationMs]
//   mode: bare (no import) | withundici (imports undici, never uses it)

const mode = process.argv[2] ?? 'bare';
const port = Number(process.argv[3] ?? 4099);
const users = Number(process.argv[4] ?? 1);
const durationMs = Number(process.argv[5] ?? 4000);
const base = `http://127.0.0.1:${port}`;

if (mode === 'withundici') {
  await import('undici');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runIteration() {
  const getRes = await fetch(`${base}/products`);
  const products = await getRes.json();
  const productId = products[0].id;
  const postRes = await fetch(`${base}/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: [{ productId, quantity: 1 }] }) });
  await postRes.json();
}

async function worker(spawnAt, runEnd) {
  const waitMs = spawnAt - Date.now();
  if (waitMs > 0) await sleep(waitMs);
  let iterations = 0;
  while (Date.now() < runEnd) {
    await runIteration();
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

console.log(JSON.stringify({ label: 'undici-import', mode, users, wallMs, iterations, iterPerSec: (iterations / wallMs) * 1000 }, null, 2));
