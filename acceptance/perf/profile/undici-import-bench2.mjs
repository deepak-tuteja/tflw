const mode = process.argv[2] ?? 'bare';
const port = Number(process.argv[3] ?? 4099);
const durationMs = Number(process.argv[4] ?? 3000);
const base = `http://127.0.0.1:${port}`;

if (mode === 'agent-only') {
  const { Agent } = await import('undici');
  void Agent;
} else if (mode === 'fetch-only') {
  const { fetch: undiciFetch } = await import('undici');
  void undiciFetch;
} else if (mode === 'full') {
  await import('undici');
} else if (mode === 'setGlobalDispatcher') {
  const { Agent, setGlobalDispatcher, getGlobalDispatcher } = await import('undici');
  void Agent; void setGlobalDispatcher; void getGlobalDispatcher;
}

async function runIteration() {
  const getRes = await fetch(`${base}/products`);
  await getRes.json();
}
const runStart = Date.now();
const runEnd = runStart + durationMs;
let iterations = 0;
while (Date.now() < runEnd) { await runIteration(); iterations++; }
const wallMs = Date.now() - runStart;
console.log(JSON.stringify({ mode, wallMs, iterations, iterPerSec: (iterations / wallMs) * 1000 }));
