// M35b investigation — last-mile check: does passing a full options object to fetch() for a GET
// (method, headers: {}, body: undefined, signal, redirect: 'follow' — execApi's exact shape) cost
// meaningfully more than a bare `fetch(url)` (raw-fetch-bench's GET shape), independent of
// everything already ruled out (chain depth, body-read mode, timer, header-parsing)?
// Usage: node fetch-shape-bench.mjs <mode> [port] [users] [durationMs]
//   mode: bare | full

const mode = process.argv[2] ?? 'bare';
const port = Number(process.argv[3] ?? 4099);
const users = Number(process.argv[4] ?? 1);
const durationMs = Number(process.argv[5] ?? 4000);
const base = `http://127.0.0.1:${port}`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function doGetBare() {
  const res = await fetch(`${base}/products`);
  return res.json();
}

async function doGetFull() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(`${base}/products`, {
      method: 'GET',
      headers: {},
      body: undefined,
      signal: controller.signal,
      redirect: 'follow',
    });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const doGet = mode === 'full' ? doGetFull : doGetBare;

async function worker(spawnAt, runEnd) {
  const waitMs = spawnAt - Date.now();
  if (waitMs > 0) await sleep(waitMs);
  let iterations = 0;
  while (Date.now() < runEnd) {
    await doGet();
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

console.log(JSON.stringify({ label: 'fetch-shape', mode, users, wallMs, iterations, iterPerSec: (iterations / wallMs) * 1000 }, null, 2));
