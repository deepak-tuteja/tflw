// M35b investigation — chain-depth-bench.mjs ruled out async-hop-count as the driver of the
// idle-share gap (depth 0..24 moved throughput ~4%, not the ~40% gap tflw shows vs raw fetch on
// the same ramp). This isolates the other candidate structural differences between raw fetch and
// `sendRequest` (http.ts) one at a time:
//   --body=json|arraybuffer   res.json() (raw/chain-depth baseline) vs the real sendRequest path:
//                              await res.arrayBuffer() -> Buffer.from -> toString('utf8') ->
//                              JSON.parse (http.ts:131-137).
//   --timer=on|off             wrap every request in a fresh AbortController + setTimeout/
//                              clearTimeout, like sendRequest does unconditionally (http.ts:98-99,
//                              146) — raw fetch has neither.
//   --headers=on|off           run every response's headers through buildHeaderMap's
//                              `Headers.forEach` loop (http.ts:39-50) after every request.
//
// Usage: node sendrequest-shape-bench.mjs [port] [users] [durationMs]
//   Reads TFLW_BODY / TFLW_TIMER / TFLW_HEADERS env vars (default: json/off/off, i.e. the raw
//   baseline shape) so a sweep script can toggle each dimension independently.

const port = Number(process.argv[2] ?? 4099);
const users = Number(process.argv[3] ?? 30);
const durationMs = Number(process.argv[4] ?? 8000);
const base = `http://127.0.0.1:${port}`;

const bodyMode = process.env.TFLW_BODY ?? 'json';
const timerMode = process.env.TFLW_TIMER ?? 'off';
const headersMode = process.env.TFLW_HEADERS ?? 'off';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildHeaderMap(resHeaders) {
  const headers = {};
  resHeaders.forEach((value, key) => {
    headers[key] = value;
  });
  const getSetCookie = resHeaders.getSetCookie;
  if (getSetCookie) {
    const cookies = getSetCookie.call(resHeaders);
    if (cookies.length > 0) headers['set-cookie'] = cookies.join('\n');
  }
  return headers;
}

async function readBody(res) {
  if (bodyMode === 'json') return res.json();
  const bodyBytes = Buffer.from(await res.arrayBuffer());
  const bodyText = bodyBytes.toString('utf8');
  try {
    return bodyText.length > 0 ? JSON.parse(bodyText) : undefined;
  } catch {
    return undefined;
  }
}

async function doFetch(url, init) {
  if (timerMode === 'off') {
    const res = await fetch(url, init);
    if (headersMode === 'on') buildHeaderMap(res.headers);
    return readBody(res);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (headersMode === 'on') buildHeaderMap(res.headers);
    return await readBody(res);
  } finally {
    clearTimeout(timer);
  }
}

async function worker(spawnAt, runEnd) {
  const waitMs = spawnAt - Date.now();
  if (waitMs > 0) await sleep(waitMs);
  let iterations = 0;
  while (Date.now() < runEnd) {
    const products = await doFetch(`${base}/products`);
    const productId = products[0].id;
    await doFetch(`${base}/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [{ productId, quantity: 1 }] }),
    });
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

console.log(JSON.stringify({ label: 'shape', bodyMode, timerMode, headersMode, users, wallMs, iterations, iterPerSec: (iterations / wallMs) * 1000 }, null, 2));
