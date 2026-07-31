// M35b investigation — last lead: execApi builds a FULL RequestTrace + ResponseTrace (headers
// Record, bodyBytes Buffer, bodyText string, parsed json) for every api step, THEN a full redacted
// COPY of both (redactRequest/redactResponse), wraps it all into a StepResult via mkStep, and
// pushes it onto a `results` array — for EVERY step, not just api (expect/capture too). runLoad's
// runIteration reads back only `.ok`/`.error`/a `kind==='think'` duration filter from that array,
// then discards the whole thing. Every prior isolated test (chain-depth, sendRequest shape, TCP
// reuse, fetch-options shape) showed <10% effect; none replicated the ~2x-20x per-iteration gap.
// This is the one candidate not yet tested in isolation: the volume of retained-then-discarded
// allocation this trace/redaction/StepResult construction produces, per request, per step.
//
// Usage: node trace-alloc-bench.mjs <mode> [port] [users] [durationMs]
//   mode: off  — no trace/StepResult construction (raw-fetch-bench shape)
//         trace — build full RequestTrace/ResponseTrace + StepResult per step, no redaction
//         full  — trace + a redacted COPY of both (execApi's real, current shape)

const mode = process.argv[2] ?? 'off';
const port = Number(process.argv[3] ?? 4099);
const users = Number(process.argv[4] ?? 1);
const durationMs = Number(process.argv[5] ?? 4000);
const base = `http://127.0.0.1:${port}`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildHeaderMap(resHeaders) {
  const headers = {};
  resHeaders.forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
}

// Mirrors interpreter.ts's redact.ts/fieldRedact.ts shape closely enough for allocation purposes:
// a shallow copy of headers with per-key substring scan, plus a JSON parse/mask/stringify round
// trip on the body (fieldRedact.ts's redactFields does exactly this for any object body).
function redactTraceLike(headers, bodyText) {
  const redactedHeaders = {};
  for (const [k, v] of Object.entries(headers)) redactedHeaders[k] = v; // no secrets registered here — same no-op scan cost as an empty Redactor
  let redactedBody = bodyText;
  if (bodyText) {
    try {
      const parsed = JSON.parse(bodyText);
      redactedBody = JSON.stringify(parsed);
    } catch {
      // not JSON — trace text kept as-is, same as fieldRedact.ts's own fallback
    }
  }
  return { headers: redactedHeaders, body: redactedBody };
}

let stepStartCounter = 0;
function mkStepLike(kind, ok, request, response) {
  return {
    kind,
    source: 'src line',
    line: 1,
    ok,
    durationMs: 0,
    ...(request ? { request } : {}),
    ...(response ? { response } : {}),
  };
}

async function doApiStep(method, url, sendBody) {
  const res = await fetch(url, sendBody !== undefined ? { method, headers: { 'content-type': 'application/json' }, body: sendBody } : { method });
  const bodyBytes = Buffer.from(await res.arrayBuffer());
  const bodyText = bodyBytes.toString('utf8');
  let json;
  try {
    json = bodyText.length > 0 ? JSON.parse(bodyText) : undefined;
  } catch {
    json = undefined;
  }
  const headers = buildHeaderMap(res.headers);
  const responseTrace = { status: res.status, statusText: res.statusText, headers, bodyText, bodyBytes, json };
  const requestTrace = { method, url, headers: sendBody !== undefined ? { 'content-type': 'application/json' } : {}, ...(sendBody !== undefined ? { body: sendBody } : {}) };
  return { requestTrace, responseTrace, json };
}

async function runIterationOff() {
  const getRes = await fetch(`${base}/products`);
  const products = await getRes.json();
  const productId = products[0].id;
  const postRes = await fetch(`${base}/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: [{ productId, quantity: 1 }] }) });
  await postRes.json();
}

async function runIterationTraceOrFull(withRedaction) {
  const results = [];
  const { requestTrace: getReq, responseTrace: getRes, json: getJson } = await doApiStep('GET', `${base}/products`, undefined);
  if (withRedaction) {
    const rReq = redactTraceLike(getReq.headers, undefined);
    const rRes = redactTraceLike(getRes.headers, getRes.bodyText);
    results.push(mkStepLike('api', true, { ...getReq, headers: rReq.headers }, { ...getRes, bodyText: rRes.body }));
  } else {
    results.push(mkStepLike('api', true, getReq, getRes));
  }
  results.push(mkStepLike('expect', true)); // `expect status equals 200`
  results.push(mkStepLike('capture', true)); // `capture body[0].id as productId`
  const productId = getJson[0].id;
  const postBody = JSON.stringify({ items: [{ productId, quantity: 1 }] });
  const { requestTrace: postReq, responseTrace: postRes } = await doApiStep('POST', `${base}/orders`, postBody);
  if (withRedaction) {
    const rReq = redactTraceLike(postReq.headers, postBody);
    const rRes = redactTraceLike(postRes.headers, postRes.bodyText);
    results.push(mkStepLike('api', true, { ...postReq, headers: rReq.headers, body: rReq.body }, { ...postRes, bodyText: rRes.body }));
  } else {
    results.push(mkStepLike('api', true, postReq, postRes));
  }
  results.push(mkStepLike('expect', true)); // `expect status equals 201`
  // runLoad's own runIteration: reads back .ok / a `kind==='think'` filter, discards the rest.
  const thinkMs = results.filter((s) => s.kind === 'think').reduce((sum, s) => sum + (s.durationMs ?? 0), 0);
  return thinkMs;
}

const runIteration = mode === 'off' ? runIterationOff : () => runIterationTraceOrFull(mode === 'full');

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

console.log(JSON.stringify({ label: 'trace-alloc', mode, users, wallMs, iterations, iterPerSec: (iterations / wallMs) * 1000 }, null, 2));
