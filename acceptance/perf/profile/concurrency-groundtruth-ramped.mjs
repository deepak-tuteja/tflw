// Ground-truth check #2 (D41, M36): ground-truth-1 showed Node's global fetch() has NO artificial
// per-origin connection cap when requests are genuinely simultaneous (30/30 concurrent, all-at-once
// fire). But that doesn't match tflw's real workload shape: (a) RampUsersWorkload staggers VU spawn
// over time (not all-at-once), and (b) the isolated echo-server harness used elsewhere in this perf
// arc responds near-instantly, so "concurrent in flight" is trivially ~1 regardless of client
// capability — not informative for a concurrency-ceiling question. This test instead uses a SLOW
// server (matching real checkout-burst contended latency, ~100s of ms) and a tight per-VU
// request-loop (exactly the shape of tflw's own load VUs and raw-fetch-bench.mjs's worker()),
// staggered over a ramp — so genuine overlap should occur if nothing artificially caps it, and a
// server-side concurrent-in-flight counter (ground truth, independent of the client) measures
// whether it actually does.
import { createServer } from 'node:http';

const PORT = 4502;
const USERS = 60;
const RAMP_MS = 8000;
const RUN_MS = 15000;
const SERVER_DELAY_MS = 200; // proxy for real checkout-burst's contended per-request latency

let inFlight = 0;
let maxInFlight = 0;
const samples = [];

const server = createServer((req, res) => {
  inFlight++;
  maxInFlight = Math.max(maxInFlight, inFlight);
  setTimeout(() => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
    inFlight--;
  }, SERVER_DELAY_MS);
});

await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
const sampler = setInterval(() => samples.push(inFlight), 20);

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Mirrors interpreter.ts's RampUsersWorkload spawn schedule exactly: VU i of N spawns at
// runStart + (i/N)*RAMP_MS, then loops issuing requests back-to-back until runEnd.
async function worker(spawnAt, runEnd) {
  const waitMs = spawnAt - Date.now();
  if (waitMs > 0) await sleep(waitMs);
  let iterations = 0;
  while (Date.now() < runEnd) {
    await fetch(`http://127.0.0.1:${PORT}/`);
    iterations++;
  }
  return iterations;
}

const runStart = Date.now();
const runEnd = runStart + RUN_MS;
const counts = await Promise.all(
  Array.from({ length: USERS }, (_, i) => worker(runStart + (i / USERS) * RAMP_MS, runEnd)),
);
clearInterval(sampler);
const wallMs = Date.now() - runStart;
const iterations = counts.reduce((a, b) => a + b, 0);
const avgInFlight = samples.reduce((a, b) => a + b, 0) / samples.length;
const p50InFlight = [...samples].sort((a, b) => a - b)[Math.floor(samples.length * 0.5)];
const p90InFlight = [...samples].sort((a, b) => a - b)[Math.floor(samples.length * 0.9)];

console.log(JSON.stringify({
  USERS, RAMP_MS, RUN_MS, SERVER_DELAY_MS,
  iterations, wallMs, throughputPerSec: iterations / (wallMs / 1000),
  maxInFlight, avgInFlight, p50InFlight, p90InFlight,
  theoreticalMaxThroughputPerSec: USERS / (SERVER_DELAY_MS / 1000),
}, null, 2));

server.close();
