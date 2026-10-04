#!/usr/bin/env node
// `M268` `C` (`D1447`) — no known moderate-or-worse advisory in the code tflw ships.
//
// The gate this replaces was `npm audit --audit-level=high --omit=dev`, commented as "the tree a
// `tflw` install carries". It was not that tree. The CLI declares no `dependencies` — esbuild inlines
// them — so `--omit=dev` audited the workspace's runtime-declared packages and nothing a user
// actually runs. Measured 2026-10-04: green, while `fast-uri` 3.1.7 (moderate, GHSA-hrr3-gc8f-f4qj)
// was compiled into `dist/cli.cjs` through `ajv`. The package list here is the bundles' own
// (`scripts/shipped-packages.mjs`, the same metafiles the notice file is generated from), at the
// version of the copy that was inlined, and it is put to the registry's bulk advisory endpoint —
// the one `npm audit` itself posts to.
//
// MODERATE, not high, because this is code every user runs: the advisory that started this was a
// moderate. The rest of the tree is the whole-workspace audit's, the second half of `D1447`.
//
// Fails, never skips, when it cannot measure: an unbuilt artifact, an artifact whose metafile names
// no third-party package, a registry that does not answer or answers in a shape this does not
// recognise. Each of those would otherwise read as clean.

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptyArtifacts, shippedPackages } from './shipped-packages.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ENDPOINT = 'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk';
const RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const FAIL_AT = 'moderate';

/** `{ name: [versions] }`, the body the bulk endpoint takes. */
export function bulkBody(packages) {
  const body = {};
  for (const p of packages) (body[p.name] ??= []).includes(p.version) || body[p.name].push(p.version);
  return body;
}

/** POSTs the list and returns the parsed answer, or throws — a non-200 or a non-object is not "no
 * advisories". */
export async function askRegistry(body, fetchImpl = fetch) {
  const res = await fetchImpl(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`the advisory endpoint answered ${res.status} ${res.statusText ?? ''}`.trim());
  const json = await res.json();
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('the advisory endpoint answered something that is not an object of advisories');
  return json;
}

/**
 * Joins the endpoint's answer back onto the shipped list. The endpoint already filters by the
 * versions it was sent, but an advisory is only attributed to a shipped copy whose version the
 * endpoint was asked about under that name — an answer naming a package that was never sent is a
 * protocol surprise and fails rather than being ignored.
 */
export function evaluate(packages, answer) {
  const sent = new Set(packages.map((p) => p.name));
  const findings = [];
  const problems = [];
  for (const [name, advisories] of Object.entries(answer)) {
    if (!sent.has(name)) { problems.push(`the endpoint answered about \`${name}\`, which was not asked about`); continue; }
    if (!Array.isArray(advisories)) { problems.push(`the endpoint's entry for \`${name}\` is not a list`); continue; }
    for (const a of advisories) {
      if (!(a?.severity in RANK)) { problems.push(`an advisory for \`${name}\` has no recognisable severity (${JSON.stringify(a?.severity)})`); continue; }
      for (const p of packages.filter((x) => x.name === name)) findings.push({ pkg: p, advisory: a });
    }
  }
  const failing = findings.filter((f) => RANK[f.advisory.severity] >= RANK[FAIL_AT]);
  return { findings, failing, problems };
}

function describe({ pkg, advisory }) {
  const where = pkg.where.map((w) => w.bundle).join(', ');
  return `${pkg.name}@${pkg.version} — ${advisory.severity} — ${advisory.title}\n      ${advisory.url}\n      vulnerable: ${advisory.vulnerable_versions}; inlined into ${where}`;
}

/** The whole gate, with its two seams injected so the self-test can drive it. Returns an exit code. */
export async function run({ packages, fetchImpl = fetch, log = console.log, error = console.error }) {
  if (packages.length === 0) {
    error('✗ the bundles name no third-party package at all — the metafiles measured nothing, so nothing was audited.');
    return 1;
  }
  const empty = emptyArtifacts(packages);
  if (empty.length > 0) {
    error(`✗ ${empty.map((a) => a.label).join(' and ')} inlines no third-party package by its metafile — that is a metafile measuring nothing, not a clean artifact.`);
    return 1;
  }
  let answer;
  try {
    answer = await askRegistry(bulkBody(packages), fetchImpl);
  } catch (e) {
    error(`✗ could not ask the registry about the shipped packages: ${e.message}\n  Not reading that as clean.`);
    return 1;
  }
  const { findings, failing, problems } = evaluate(packages, answer);
  if (problems.length > 0) {
    error(`✗ the advisory endpoint's answer could not be read:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    return 1;
  }
  const below = findings.filter((f) => !failing.includes(f));
  for (const f of below) log(`  · below the gate: ${describe(f)}`);
  if (failing.length > 0) {
    error(`✗ ${failing.length} ${FAIL_AT}-or-worse advisor${failing.length === 1 ? 'y' : 'ies'} in code tflw ships:\n`);
    for (const f of failing) error(`  ${describe(f)}\n`);
    error('  The fix is a version without it, in the lockfile — not an override and not a dismissal (SECURITY.md).');
    return 1;
  }
  log(`✓ ${packages.length} third-party packages inlined into the tarball and the .vsix; no ${FAIL_AT}-or-worse advisory.`);
  return 0;
}

// ---------------------------------------------------------------------------------------------------

const pkg = (name, version, artifact = 'tarball', bundle = 'packages/cli/dist/cli.cjs') => ({ name, version, license: 'MIT', purl: `pkg:npm/${name}@${version}`, where: [{ artifact, bundle }] });
const answering = (json, status = 200) => async () => ({ ok: status === 200, status, statusText: '', json: async () => json });
const ADVISORY = { id: 1, url: 'https://github.com/advisories/GHSA-hrr3-gc8f-f4qj', title: 'fast-uri host case normalization', severity: 'moderate', vulnerable_versions: '>=3.0.0 <3.1.8' };

/** `D922`: the gate's failure modes, each demonstrated. All but the last are offline; the last asks
 * the real endpoint about the real advisory this gate exists because of, so a change in the
 * endpoint's shape or semantics reddens here and not as a silently green gate. */
async function selfTest() {
  const both = [pkg('fast-uri', '3.1.7'), pkg('vscode-jsonrpc', '9.0.3', 'vsix', 'packages/vscode/dist/extension.cjs')];
  const quiet = { log: () => {}, error: () => {} };
  const capture = () => { const lines = []; return { lines, io: { log: (s) => lines.push(s), error: (s) => lines.push(s) } }; };
  const cases = [
    ['a moderate advisory in a shipped package fails, naming the package and the bundle', async () => {
      const c = capture();
      const rc = await run({ packages: both, fetchImpl: answering({ 'fast-uri': [ADVISORY] }), ...c.io });
      const text = c.lines.join('\n');
      return rc === 1 && text.includes('fast-uri@3.1.7') && text.includes('packages/cli/dist/cli.cjs');
    }],
    ['a low advisory is printed and passes', async () =>
      (await run({ packages: both, fetchImpl: answering({ 'fast-uri': [{ ...ADVISORY, severity: 'low' }] }), ...quiet })) === 0],
    ['no advisory passes', async () => (await run({ packages: both, fetchImpl: answering({}), ...quiet })) === 0],
    ['an empty package list fails as measuring nothing', async () =>
      (await run({ packages: [], fetchImpl: answering({}), ...quiet })) === 1],
    ['an artifact with no third-party package fails, even when the other has some', async () =>
      (await run({ packages: [pkg('fast-uri', '3.1.8')], fetchImpl: answering({}), ...quiet })) === 1],
    ['a registry that answers 503 fails rather than counting as clean', async () =>
      (await run({ packages: both, fetchImpl: answering({}, 503), ...quiet })) === 1],
    ['a fetch that throws fails rather than counting as clean', async () =>
      (await run({ packages: both, fetchImpl: async () => { throw new Error('ENOTFOUND'); }, ...quiet })) === 1],
    ['an answer about a package never asked about fails', async () =>
      (await run({ packages: both, fetchImpl: answering({ lodash: [ADVISORY] }), ...quiet })) === 1],
    ['an advisory with no recognisable severity fails', async () =>
      (await run({ packages: both, fetchImpl: answering({ 'fast-uri': [{ ...ADVISORY, severity: 'urgent' }] }), ...quiet })) === 1],
    ['the body names each version once per package', () => {
      const b = bulkBody([pkg('a', '1.0.0'), pkg('a', '1.0.0', 'vsix'), pkg('a', '2.0.0')]);
      return JSON.stringify(b) === JSON.stringify({ a: ['1.0.0', '2.0.0'] });
    }],
    ['the real endpoint reports fast-uri 3.1.7 at moderate and 3.1.8 clean (network)', async () => {
      const bad = await askRegistry({ 'fast-uri': ['3.1.7'] });
      const good = await askRegistry({ 'fast-uri': ['3.1.8'] });
      return (bad['fast-uri'] ?? []).some((a) => a.severity === 'moderate' && /GHSA-hrr3-gc8f-f4qj/.test(a.url)) && !good['fast-uri'];
    }],
  ];
  let bad = 0;
  for (const [name, fn] of cases) {
    let ok = false;
    try { ok = await fn(); } catch (e) { console.error(`    threw: ${e.message}`); }
    console.log(`  ${ok ? '✓' : '✗'} ${name}`);
    if (!ok) bad++;
  }
  console.log(bad === 0 ? `\n✓ ${cases.length} controls pass.` : `\n✗ ${bad} of ${cases.length} controls failed.`);
  return bad === 0 ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--self-test')) process.exit(await selfTest());
  let packages;
  try {
    packages = shippedPackages(ROOT);
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }
  process.exit(await run({ packages }));
}
