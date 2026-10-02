// `M265` — the walkthrough's live views, cut the same way twice.
//
// Chapter 7's four views (`walk-*` in `make-screenshots.mjs`) are the only shots of a run the shoot
// starts itself: ▶ runs `tests/fulfilment.tflw` against the Coffee Shelf. Everything else on those
// pictures is fixed by its inputs, but a live run carries values that are true once: when it
// started, how long each step took, the shop's `date` header, and the seed the run drew. Until `M265` that meant the four
// pictures could never be re-cut byte-identical, and every milestone that moved the inputs kept
// the old PNGs and committed only the manifest.
//
// So the page is served the run with those values pinned, the way the runbook gate normalises an
// output fence: **what the picture shows about the run is real, its clock and seed are not.** The verdict,
// the failure, the request and response, the order id and the URL are the run's own. The port
// is pinned at its source instead, since the shop listens on 4720, the port chapter 2 gives the reader.
//
// Pure, so `test/pin-run.test.ts` can hold it without a browser.

/** The instant every pinned run starts at. The page's clock stands one second later. */
export const PINNED_START = '2026-10-01T15:36:03.000Z';
export const PINNED_HTTP_DATE = 'Thu, 01 Oct 2026 15:36:03 GMT';
/** What a leaf duration reads, in ms. A parent's is the sum of its children's, so the numbers agree. */
export const PINNED_STEP_MS = 3;
/** The seed a pinned run reports. The walk's test draws no generated value, so nothing else moves with it. */
export const PINNED_SEED = 20261001;

const ISO = /\b\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)\b/g;
const HTTP_DATE = /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d\d (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d\d:\d\d:\d\d GMT\b/g;
/** A request's timing as the runtime writes it into a step's `detail`: `… → 201 (9.6ms)`. */
const STATUS_TIMING = /(→ \d{3} )\(\d+(?:\.\d+)?ms\)/g;
/** Keys whose number is a measured duration. `timeoutMs` and friends are configuration, not measurement. */
const DURATION_KEYS = new Set(['durationMs', 'elapsedMs', 'ms']);

function pinString(s) {
  return s.replace(ISO, PINNED_START).replace(HTTP_DATE, PINNED_HTTP_DATE).replace(STATUS_TIMING, `$1(${PINNED_STEP_MS}ms)`);
}

/** The sum of the durations an object's direct child arrays carry, or `undefined` if none does. */
function childDurations(obj) {
  let sum;
  for (const v of Object.values(obj)) {
    if (!Array.isArray(v)) continue;
    for (const item of v) {
      if (item && typeof item === 'object' && typeof item.durationMs === 'number') sum = (sum ?? 0) + item.durationMs;
    }
  }
  return sum;
}

/** Returns a copy of `value` with every timestamp and measured duration pinned. */
export function pinRun(value) {
  if (typeof value === 'string') return pinString(value);
  if (Array.isArray(value)) return value.map(pinRun);
  if (value === null || typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = pinRun(v);
  for (const k of Object.keys(out)) {
    if (DURATION_KEYS.has(k) && typeof out[k] === 'number') out[k] = PINNED_STEP_MS;
    if (k === 'seed' && typeof out[k] === 'number') out[k] = PINNED_SEED;
  }
  // After the children are pinned, so a test's duration is its steps' and a run's is its tests'.
  if (typeof out.durationMs === 'number') {
    const sum = childDurations(out);
    if (sum !== undefined) out.durationMs = sum;
  }
  return out;
}

/** A JSON body pinned, or the body unchanged when it is not JSON. */
export function pinJsonBody(text) {
  try {
    return JSON.stringify(pinRun(JSON.parse(text)));
  } catch {
    return text;
  }
}

/** An event stream pinned line by line: each `data:` line that holds JSON is pinned, the rest kept. */
export function pinEventStream(text) {
  return text
    .split('\n')
    .map((line) => (line.startsWith('data: ') ? `data: ${pinJsonBody(line.slice('data: '.length))}` : line))
    .join('\n');
}
