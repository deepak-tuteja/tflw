// M35a — aggregates a --cpu-prof V8 profile's self-time (hitCount) by function, so the redaction
// hypothesis (PLAN_BROWSER_PERF_SECURITY.md §2.7) can be checked against real sample data instead
// of speculation. Usage: node analyze-profile.mjs report/tflw.cpuprofile [report/raw.cpuprofile]

import { readFileSync } from 'node:fs';

function loadProfile(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function aggregate(profile) {
  const totalHits = profile.nodes.reduce((sum, n) => sum + (n.hitCount ?? 0), 0);
  const byFunction = new Map();
  for (const node of profile.nodes) {
    const hits = node.hitCount ?? 0;
    if (hits === 0) continue;
    const cf = node.callFrame;
    const url = cf.url.replace(/^.*\/(packages\/[^/]+\/(src|test)\/.+)$/, '$1');
    const key = `${cf.functionName || '(anonymous)'} — ${url}:${cf.lineNumber + 1}`;
    byFunction.set(key, (byFunction.get(key) ?? 0) + hits);
  }
  return { totalHits, byFunction };
}

function printTop(label, agg, n = 25) {
  console.log(`\n=== ${label} (total samples: ${agg.totalHits}) ===`);
  const rows = [...agg.byFunction.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  for (const [key, hits] of rows) {
    const pct = ((hits / agg.totalHits) * 100).toFixed(1);
    console.log(`${pct.padStart(5)}%  ${hits.toString().padStart(6)}  ${key}`);
  }
}

// Groups worth summing directly — the hypothesis functions plus D33e's flagged secondary
// candidates, matched by function-name substring against interpreter.ts/redact.ts/fieldRedact.ts.
const GROUPS = {
  'redaction (redactRequest/redactResponse/Redactor.redact/redactFields/maskPath)': [
    'redactRequest', 'redactResponse', 'redact', 'redactFields', 'maskPath', 'applySegment', 'register', 'addName', 'entriesLongestFirst', 'redactHeaders',
  ],
  'header building (setHeader/buildHeaderMap)': ['setHeader', 'buildHeaderMap'],
  'mkStep (per-step result object allocation)': ['mkStep'],
  'cookie jar (clone/serialize/applySetCookie)': ['clone', 'serialize', 'applySetCookie'],
  'body prep (prepareBody/JSON.stringify path)': ['prepareBody'],
};

function printGroups(label, agg) {
  console.log(`\n--- ${label}: grouped candidates vs total ---`);
  for (const [groupLabel, names] of Object.entries(GROUPS)) {
    let hits = 0;
    for (const [key, h] of agg.byFunction.entries()) {
      const fn = key.split(' — ')[0];
      if (names.includes(fn)) hits += h;
    }
    const pct = ((hits / agg.totalHits) * 100).toFixed(1);
    console.log(`${pct.padStart(5)}%  ${hits.toString().padStart(6)}  ${groupLabel}`);
  }
}

const [tflwPath, rawPath] = process.argv.slice(2);
const topN = Number(process.env.TOP_N ?? 25);
const tflwAgg = aggregate(loadProfile(tflwPath));
printTop('tflw load (bench.tflw)', tflwAgg, topN);
printGroups('tflw load', tflwAgg);

if (rawPath) {
  const rawAgg = aggregate(loadProfile(rawPath));
  printTop('raw fetch baseline', rawAgg, topN);
}
