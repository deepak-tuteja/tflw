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
// M42 (PLAN_BROWSER_PERF_SECURITY.md §2.13, D60-D61) adds a second client mode: `pinned`, a
// per-VU `undici.Client` created once at worker spawn and reused for the VU's full lifetime —
// mirroring Artillery's and k6's own default "one persistent connection per virtual user" model
// (Node's global `fetch()`/undici's default `Pool` opens on-demand `Client`s with no such
// pinning, confirmed via undici's own docs). This script is a standalone one-off process, so
// importing `undici` here carries none of M35b's process-wide fetch()-poisoning risk — that risk
// is specific to tflw's own long-lived interpreter process, not to a script like this one.
//
// Post-M42 canonical-baseline follow-up (same day, ad hoc re-investigation, not yet a numbered
// decision): adds a `shards` mode, mirroring tflw's own real `--workers N` multi-process flag
// (`runShardInChildProcess` in packages/cli/src/cli.ts — real OS-level `fork`, not
// `worker_threads`). Motivation: M41's own `--workers N` test found "no improvement at all,"
// but that test ran entirely on the *unpinned* fetch() path, where every process still paid the
// on-demand-connection-churn tax M41/M42 identified as the dominant cost — multi-processing
// couldn't help because the per-request overhead didn't shrink, it was just duplicated N times.
// With pinning removing that tax, the remaining ~32% gap is consistent with a queueing-theory
// explanation instead: a single Node event loop is an M/M/1 queue (tail latency blows up
// superlinearly near saturation), while Go's goroutine scheduler runs VUs across `GOMAXPROCS` OS
// threads (M:N, closer to M/M/c) — the same reason autocannon (Node's own leading load tool)
// shards connections across `worker_threads` rather than relying on a faster HTTP client. This
// specific combination — pinned connections *and* multi-process sharding — has never been tested
// in this arc. When `shards > 1`, this script acts as a coordinator: it forks `shards` copies of
// itself (real child processes, matching tflw's own mechanism), assigns each an interleaved slice
// of the global VU-index range (VU `i` goes to shard `i % shards`) so the combined spawn cadence
// exactly reproduces the single-process schedule, and synchronizes all shards to the same
// absolute `runStart` epoch via an env var (mirroring the ready→start handshake
// `runShardInChildProcess` uses). Each shard prints its raw per-iteration `durations` array (not
// pre-computed percentiles — percentile-of-percentiles across shards would be statistically
// wrong); the coordinator concatenates all shards' raw durations and computes percentiles once,
// globally.
//
// Usage: node raw-fetch-bench-dogfood.mjs <uncontended|contended> [users] [durationMs] [fetch|pinned] [shards]

import { Client } from 'undici';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rung = process.argv[2] ?? 'contended';
const users = Number(process.argv[3] ?? 60);
const durationMs = Number(process.argv[4] ?? 20000);
const clientMode = process.argv[5] ?? 'fetch';
const shards = Number(process.argv[6] ?? 1);
const ORIGIN = 'http://localhost:4001';
const API_PREFIX = '/v1';
const LOAD_USER_EMAIL = process.env.LOAD_USER_EMAIL || 'load@example.com';
const LOAD_USER_PW = process.env.LOAD_USER_PW || 'load-pw-123';
const PRODUCT_ID = '9649e53f-e0ad-4413-a05e-e302728b72cc';

if (rung !== 'uncontended' && rung !== 'contended') {
  throw new Error(`unknown rung "${rung}" — expected "uncontended" or "contended"`);
}
if (clientMode !== 'fetch' && clientMode !== 'pinned') {
  throw new Error(`unknown client mode "${clientMode}" — expected "fetch" or "pinned"`);
}
if (!Number.isInteger(shards) || shards < 1) {
  throw new Error(`invalid shards "${process.argv[6]}" — expected a positive integer`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Fetch-mode login (global `fetch()`, full URL) — unchanged from M41.
async function loginViaFetch() {
  const res = await fetch(`${ORIGIN}${API_PREFIX}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: LOAD_USER_EMAIL, password: LOAD_USER_PW }),
  });
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  const body = await res.json();
  return body.accessToken;
}

// Pinned-mode login — issued over the same per-VU `undici.Client` every other request in this VU
// uses, so the login request itself also benefits from (or is bound by) the pinned connection.
async function loginViaClient(client) {
  const { statusCode, body } = await client.request({
    path: `${API_PREFIX}/auth/login`,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: LOAD_USER_EMAIL, password: LOAD_USER_PW }),
  });
  const json = await body.json();
  if (statusCode !== 200) throw new Error(`login failed: ${statusCode}`);
  return json.accessToken;
}

// Mirrors raw-fetch-bench.mjs's own worker shape exactly (spawn schedule, shared runEnd). Each
// worker owns its own token (k6-VU-equivalent isolation), re-logging in on a 401 the same way
// checkout-burst.js's authedRequest does. In `pinned` mode, each worker also owns its own
// `undici.Client`, created once here and reused (never recreated) for every request the VU makes.
async function worker(spawnAt, runEnd) {
  const waitMs = spawnAt - Date.now();
  if (waitMs > 0) await sleep(waitMs);

  const client = clientMode === 'pinned' ? new Client(ORIGIN) : null;
  let token = clientMode === 'pinned' ? await loginViaClient(client) : await loginViaFetch();
  const durations = [];
  let errors = 0;

  // Unified request helper — `path` is the `/v1/...`-relative path in both modes; `fetch` mode
  // builds the full URL itself, `pinned` mode hands the path straight to the per-VU Client.
  async function authedFetch(method, path, bodyObj) {
    const bodyStr = bodyObj ? JSON.stringify(bodyObj) : undefined;
    if (clientMode === 'pinned') {
      const doRequest = () =>
        client.request({
          path: `${API_PREFIX}${path}`,
          method,
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: bodyStr,
        });
      let { statusCode, body } = await doRequest();
      if (statusCode === 401) {
        token = await loginViaClient(client);
        ({ statusCode, body } = await doRequest());
      }
      return { status: statusCode, body };
    }
    const doFetch = () =>
      fetch(`${ORIGIN}${API_PREFIX}${path}`, {
        method,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: bodyStr,
      });
    let res = await doFetch();
    if (res.status === 401) {
      token = await loginViaFetch();
      res = await doFetch();
    }
    return { status: res.status, body: res };
  }

  while (Date.now() < runEnd) {
    const iterStart = performance.now();
    let ok = true;
    try {
      if (rung === 'uncontended') {
        const { status, body } = await authedFetch('POST', '/cart/items', { productId: PRODUCT_ID, quantity: 1 });
        await body.arrayBuffer();
        ok = status === 201;
      } else {
        const lookup = await authedFetch('GET', `/products?q=${encodeURIComponent('Load Test Widget')}`);
        const products = await lookup.body.json();
        ok = lookup.status === 200;
        const productId = products[0].id;
        const checkout = await authedFetch('POST', '/orders', { items: [{ productId, quantity: 1 }] });
        await checkout.body.arrayBuffer();
        ok = ok && checkout.status === 201;
      }
    } catch {
      ok = false;
    }
    durations.push(performance.now() - iterStart);
    if (!ok) errors++;
  }

  if (client) await client.close();
  return { durations, errors };
}

function percentile(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function printSummary(wallMs, allDurations, errors, extra) {
  const iterations = allDurations.length;
  console.log(
    JSON.stringify(
      {
        label: 'raw-fetch-dogfood',
        rung,
        clientMode,
        users,
        shards,
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
        ...extra,
      },
      null,
      2,
    ),
  );
}

// This process is a shard worker (spawned by the coordinator branch below): run only the VU
// indices assigned to it (interleaved: shardIndex, shardIndex+shardCount, ...), on the
// coordinator-provided synchronized runStart, and hand back raw per-iteration durations — no
// percentile computation here, that only happens once, globally, in the coordinator.
if (process.env.RAW_BENCH_SHARD_COUNT !== undefined) {
  const shardIndex = Number(process.env.RAW_BENCH_SHARD_INDEX);
  const shardCount = Number(process.env.RAW_BENCH_SHARD_COUNT);
  const runStart = Number(process.env.RAW_BENCH_RUN_START);
  const runEnd = runStart + durationMs;
  const assigned = [];
  for (let i = shardIndex; i < users; i += shardCount) assigned.push(i);
  const results = await Promise.all(assigned.map((i) => worker(runStart + (i / users) * durationMs, runEnd)));
  process.stdout.write(
    JSON.stringify({
      __shardResult: true,
      durations: results.flatMap((r) => r.durations),
      errors: results.reduce((a, r) => a + r.errors, 0),
    }),
  );
}
// Coordinator: fork `shards` copies of this same script, one synchronized runStart shared via
// env var (mirroring runShardInChildProcess's ready→start handshake, minus the IPC — a plain
// env-var handoff is enough for a disposable one-shot benchmark), collect each shard's raw
// durations, and compute percentiles once over the combined, correctly-ordered set.
else if (shards > 1) {
  const scriptPath = fileURLToPath(import.meta.url);
  const runStart = Date.now() + 1500; // headroom for all children to spawn, import undici, and reach their own wait-for-spawnAt loop
  const children = Array.from({ length: shards }, (_, shardIndex) => {
    const child = spawn(process.execPath, [scriptPath, rung, String(users), String(durationMs), clientMode, String(shards)], {
      env: {
        ...process.env,
        RAW_BENCH_SHARD_INDEX: String(shardIndex),
        RAW_BENCH_SHARD_COUNT: String(shards),
        RAW_BENCH_RUN_START: String(runStart),
      },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    return new Promise((resolve, reject) => {
      child.on('close', (code) => {
        if (code !== 0) return reject(new Error(`shard ${shardIndex} exited with code ${code}`));
        resolve(JSON.parse(out));
      });
      child.on('error', reject);
    });
  });
  const shardResults = await Promise.all(children);
  const wallMs = Date.now() - runStart;
  const allDurations = shardResults.flatMap((r) => r.durations).sort((a, b) => a - b);
  const errors = shardResults.reduce((a, r) => a + r.errors, 0);
  printSummary(wallMs, allDurations, errors);
}
// Single process, unchanged from M41/M42.
else {
  const runStart = Date.now();
  const runEnd = runStart + durationMs;
  const results = await Promise.all(
    Array.from({ length: users }, (_, i) => worker(runStart + (i / users) * durationMs, runEnd)),
  );
  const wallMs = Date.now() - runStart;
  const allDurations = results.flatMap((r) => r.durations).sort((a, b) => a - b);
  const errors = results.reduce((a, r) => a + r.errors, 0);
  printSummary(wallMs, allDurations, errors);
}
