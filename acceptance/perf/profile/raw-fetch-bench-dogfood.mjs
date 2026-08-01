// M41 (PLAN_BROWSER_PERF_SECURITY.md §2.12, D58) — adapts raw-fetch-bench.mjs (M35a) to the real
// dogfood target, isolating whether the tflw-vs-k6 p95-under-contention gap (D57-D59) lives in
// Node's fetch()/undici stack itself, not in any tflw code. Same bare-fetch, zero-interpreter/
// zero-redaction/zero-session approach as raw-fetch-bench.mjs, but against testFlow-tests' real
// dogfood target with the same hand-rolled per-VU login+retry-on-401 pattern k6's
// checkout-burst.js/dogfood-post-uncontended.js already use (D31/D49) — isolating the fetch()/
// protocol layer specifically, not conflating it with a different auth strategy. Same
// RampUsersWorkload spawn schedule as raw-fetch-bench.mjs (spawnAt = runStart + (i/users)*
// durationMs, shared runEnd) and the same "combined iteration duration" measurement tflw's own
// report uses (for the contended rung this is GET-lookup + POST-checkout summed, matched against
// k6's checkout-only p95 per this arc's own established, already-acknowledged convention — see
// acceptance/README.md M38/M39).
//
// Usage: node raw-fetch-bench-dogfood.mjs <uncontended|contended> [users] [durationMs]

const rung = process.argv[2] ?? 'contended';
const users = Number(process.argv[3] ?? 60);
const durationMs = Number(process.argv[4] ?? 20000);
const BASE_URL = 'http://localhost:4001/v1';
const LOAD_USER_EMAIL = process.env.LOAD_USER_EMAIL || 'load@example.com';
const LOAD_USER_PW = process.env.LOAD_USER_PW || 'load-pw-123';
const PRODUCT_ID = '9649e53f-e0ad-4413-a05e-e302728b72cc';

if (rung !== 'uncontended' && rung !== 'contended') {
  throw new Error(`unknown rung "${rung}" — expected "uncontended" or "contended"`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function login() {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: LOAD_USER_EMAIL, password: LOAD_USER_PW }),
  });
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  const body = await res.json();
  return body.accessToken;
}

// Mirrors raw-fetch-bench.mjs's own worker shape exactly (spawn schedule, shared runEnd). Each
// worker owns its own token (k6-VU-equivalent isolation), re-logging in on a 401 the same way
// checkout-burst.js's authedRequest does.
async function worker(spawnAt, runEnd) {
  const waitMs = spawnAt - Date.now();
  if (waitMs > 0) await sleep(waitMs);

  let token = await login();
  const durations = [];
  let errors = 0;

  async function authedFetch(method, url, bodyObj) {
    const doFetch = () =>
      fetch(url, {
        method,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: bodyObj ? JSON.stringify(bodyObj) : undefined,
      });
    let res = await doFetch();
    if (res.status === 401) {
      token = await login();
      res = await doFetch();
    }
    return res;
  }

  while (Date.now() < runEnd) {
    const iterStart = performance.now();
    let ok = true;
    try {
      if (rung === 'uncontended') {
        const res = await authedFetch('POST', `${BASE_URL}/cart/items`, { productId: PRODUCT_ID, quantity: 1 });
        await res.arrayBuffer();
        ok = res.status === 201;
      } else {
        const lookup = await authedFetch('GET', `${BASE_URL}/products?q=${encodeURIComponent('Load Test Widget')}`);
        const products = await lookup.json();
        ok = lookup.status === 200;
        const productId = products[0].id;
        const checkout = await authedFetch('POST', `${BASE_URL}/orders`, { items: [{ productId, quantity: 1 }] });
        await checkout.arrayBuffer();
        ok = ok && checkout.status === 201;
      }
    } catch {
      ok = false;
    }
    durations.push(performance.now() - iterStart);
    if (!ok) errors++;
  }

  return { durations, errors };
}

function percentile(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

const runStart = Date.now();
const runEnd = runStart + durationMs;
const results = await Promise.all(
  Array.from({ length: users }, (_, i) => worker(runStart + (i / users) * durationMs, runEnd)),
);
const wallMs = Date.now() - runStart;

const allDurations = results.flatMap((r) => r.durations).sort((a, b) => a - b);
const iterations = allDurations.length;
const errors = results.reduce((a, r) => a + r.errors, 0);

console.log(
  JSON.stringify(
    {
      label: 'raw-fetch-dogfood',
      rung,
      users,
      wallMs,
      iterations,
      errors,
      errorRatePct: (100 * errors) / iterations,
      throughputPerSec: iterations / (wallMs / 1000),
      durationMs: {
        min: allDurations[0],
        avg: allDurations.reduce((a, b) => a + b, 0) / iterations,
        p50: percentile(allDurations, 50),
        p90: percentile(allDurations, 90),
        p95: percentile(allDurations, 95),
        p99: percentile(allDurations, 99),
        max: allDurations[iterations - 1],
      },
    },
    null,
    2,
  ),
);
