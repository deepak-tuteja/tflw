// M35b investigation (PLAN_BROWSER_PERF_SECURITY.md §2.7) — isolates ONE variable: how many
// `async function` call boundaries sit between a VU's loop and the real `fetch`, with everything
// else held constant (same echo server, same RampUsersWorkload spawn schedule as
// raw-fetch-bench.mjs / bench.tflw). M35a found tflw idle at 26.7% vs raw fetch's 2.7% on an
// identical ramp, and flagged (but did NOT confirm) that execApi's own call chain — execSteps ->
// execApi -> await loadMtlsCreds(...) -> await sendRequest(...) -> await fetch(...) -> await
// res.arrayBuffer() — is ~4-5 async hops deep for a GET, ~5-6 for a POST (prepareBody adds one),
// vs raw fetch's 2 flat awaits (fetch + res.json()). This script tests whether hop count alone,
// with zero other tflw-specific work, reproduces a throughput/idle gap of comparable shape.
//
// Usage: node chain-depth-bench.mjs <depth> [port] [users] [durationMs]
//   depth: number of no-op async wrapper layers between the loop and the real fetch call.
// Depth 0 should reproduce raw-fetch-bench.mjs's numbers (sanity check on the harness itself).

const depth = Number(process.argv[2] ?? 0);
const port = Number(process.argv[3] ?? 4099);
const users = Number(process.argv[4] ?? 30);
const durationMs = Number(process.argv[5] ?? 8000);
const base = `http://127.0.0.1:${port}`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Each layer is a real `async function` (not a Promise-returning plain function) awaiting the
// next one down — matching execApi's own shape, where loadMtlsCreds/sendRequest/etc. are genuine
// `async function`s, each contributing its own microtask round trip even on a fast synchronous
// path, not just a Promise chain flattened by the engine.
function buildChain(depth, doRequest) {
  let call = doRequest;
  for (let i = 0; i < depth; i++) {
    const inner = call;
    // eslint-disable-next-line no-loop-func
    call = async function layer() {
      return await inner();
    };
  }
  return call;
}

async function doGet() {
  const res = await fetch(`${base}/products`);
  const products = await res.json();
  return products[0].id;
}

async function doPost(productId) {
  const res = await fetch(`${base}/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items: [{ productId, quantity: 1 }] }),
  });
  await res.json();
}

async function worker(spawnAt, runEnd, getChain, postChain) {
  const waitMs = spawnAt - Date.now();
  if (waitMs > 0) await sleep(waitMs);
  let iterations = 0;
  while (Date.now() < runEnd) {
    const productId = await getChain();
    await postChain(productId);
    iterations++;
  }
  return iterations;
}

const getChain = buildChain(depth, doGet);
const postChain = buildChain(depth, doPost);

const runStart = Date.now();
const runEnd = runStart + durationMs;
const counts = await Promise.all(
  Array.from({ length: users }, (_, i) => worker(runStart + (i / users) * durationMs, runEnd, getChain, postChain)),
);
const wallMs = Date.now() - runStart;
const iterations = counts.reduce((a, b) => a + b, 0);

console.log(JSON.stringify({ label: 'chain-depth', depth, users, wallMs, iterations, iterPerSec: (iterations / wallMs) * 1000 }, null, 2));
