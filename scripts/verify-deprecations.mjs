#!/usr/bin/env node
// `M268` `D` (`D1448`) — no deprecated package in the lockfile.
//
// Neither `npm audit` nor Dependabot reads the registry's `deprecated` field, so a package its own
// author has withdrawn — out of support, superseded, "no longer maintained" — sits in a tree with
// every gate green. Measured 2026-10-04: two in this lockfile (`prebuild-install`, `whatwg-encoding`,
// both under `@vscode/vsce` 3), two in the sibling's `apiV2` (`eslint` 9, `glob` 10), found only by
// asking the registry about every locked `name@version`. This is that question, committed.
//
// It runs weekly and by hand (`.github/workflows/deps-weekly.yml`), never per pull request: about a
// thousand registry lookups, and a deprecation published upstream on a Tuesday must not turn an
// unrelated pull request red.
//
// An exception is an entry in `scripts/deprecations-allowlist.json` — `{ "package": "name@version",
// "reason": "…" }` — and the list starts empty. An entry with no reason fails, and so does an entry
// that no longer matches anything deprecated in a lockfile, so the list cannot outlive its cause.
// A lookup that fails is a failure, never a package counted clean.
//
// Usage:  node scripts/verify-deprecations.mjs [lockfile …]   (relative to the repository root;
//                                                            default: package-lock.json)
//         node scripts/verify-deprecations.mjs --self-test

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ALLOWLIST = join(ROOT, 'scripts', 'deprecations-allowlist.json');
const REGISTRY = 'https://registry.npmjs.org/';
const CONCURRENCY = 16;

/** `name -> Set(version)` for every registry package a v2/v3 lockfile locks. Workspace links and
 * packages resolved from anywhere but the registry (a `file:` tarball, a git URL) are returned
 * separately: the registry cannot say whether they are deprecated, and they are named rather than
 * silently dropped. */
export function lockedPackages(lock) {
  const want = new Map();
  const unregistered = [];
  for (const [path, meta] of Object.entries(lock.packages ?? {})) {
    if (!path.includes('node_modules/') || meta.link || !meta.version) continue;
    const name = meta.name ?? path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
    if (meta.resolved && !meta.resolved.startsWith(REGISTRY)) { unregistered.push(`${name}@${meta.version} (${meta.resolved})`); continue; }
    (want.get(name) ?? want.set(name, new Set()).get(name)).add(meta.version);
  }
  return { want, unregistered };
}

/** The abbreviated packument for one name, with one retry on a network error, a 429 or a 5xx.
 * Anything else that is not a 200 throws. */
export async function packument(name, fetchImpl = fetch) {
  const url = REGISTRY + name.replace('/', '%2f');
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchImpl(url, { headers: { accept: 'application/vnd.npm.install-v1+json' } });
      if (res.ok) return await res.json();
      last = new Error(`${res.status} for ${name}`);
      if (res.status !== 429 && res.status < 500) break;
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

/** Every locked name@version the registry marks deprecated, and every lookup that failed. */
export async function scan(want, fetchImpl = fetch) {
  const names = [...want.keys()].sort();
  const deprecated = [];
  const failed = [];
  let next = 0;
  async function worker() {
    while (next < names.length) {
      const name = names[next++];
      try {
        const doc = await packument(name, fetchImpl);
        for (const v of want.get(name)) {
          if (!doc.versions?.[v]) { failed.push(`${name}@${v}: the registry has no such version`); continue; }
          const why = doc.versions[v].deprecated;
          if (why) deprecated.push({ id: `${name}@${v}`, message: String(why).replace(/\s+/g, ' ').trim() });
        }
      } catch (e) {
        failed.push(`${name}: ${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  deprecated.sort((a, b) => a.id.localeCompare(b.id));
  return { deprecated, failed: failed.sort(), checked: names.length };
}

/** The verdict, from what the scan found and what the allowlist says. */
export function judge({ deprecated, failed }, allowlist) {
  const problems = [];
  const entries = Array.isArray(allowlist?.entries) ? allowlist.entries : null;
  if (!entries) problems.push('the allowlist has no `entries` array');
  const allowed = new Map();
  for (const e of entries ?? []) {
    if (typeof e?.package !== 'string' || !/^(@[^/]+\/)?[^@]+@.+$/.test(e.package)) { problems.push(`allowlist entry ${JSON.stringify(e)} does not name a package as name@version`); continue; }
    if (typeof e.reason !== 'string' || e.reason.trim().length < 10) { problems.push(`allowlist entry ${e.package} carries no written reason`); continue; }
    allowed.set(e.package, e.reason);
  }
  for (const f of failed) problems.push(`lookup failed — ${f}`);
  const found = new Set(deprecated.map((d) => d.id));
  for (const id of allowed.keys()) if (!found.has(id)) problems.push(`allowlist entry ${id} matches nothing deprecated in the lockfiles — remove it`);
  const offending = deprecated.filter((d) => !allowed.has(d.id));
  return { problems, offending, allowed: deprecated.filter((d) => allowed.has(d.id)) };
}

export async function run({ lockfiles, allowlist, fetchImpl = fetch, log = console.log, error = console.error }) {
  const want = new Map();
  for (const file of lockfiles) {
    const { want: w, unregistered } = lockedPackages(JSON.parse(readFileSync(resolve(ROOT, file), 'utf8')));
    for (const [n, vs] of w) for (const v of vs) (want.get(n) ?? want.set(n, new Set()).get(n)).add(v);
    for (const u of unregistered) log(`  · not from the registry, not checked: ${u}`);
  }
  if (want.size === 0) { error('✗ the lockfiles lock no registry package — nothing was checked.'); return 1; }
  const result = await scan(want, fetchImpl);
  const { problems, offending, allowed } = judge(result, allowlist);
  for (const a of allowed) log(`  · allowed: ${a.id} — ${a.message}`);
  if (offending.length > 0) {
    error(`✗ ${offending.length} deprecated package${offending.length === 1 ? '' : 's'} in ${lockfiles.join(', ')}:`);
    for (const d of offending) error(`  ${d.id} — ${d.message}`);
  }
  if (problems.length > 0) error(`✗ the scan could not be trusted:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  if (offending.length > 0 || problems.length > 0) return 1;
  log(`✓ ${result.checked} packages in ${lockfiles.join(', ')}; none deprecated${allowed.length ? ` beyond ${allowed.length} allowed` : ''}.`);
  return 0;
}

// ---------------------------------------------------------------------------------------------------

async function selfTest() {
  const lock = { packages: {
    '': { name: 'x' },
    'packages/a': { version: '1.0.0' },
    'node_modules/a': { link: true, resolved: 'packages/a' },
    'node_modules/old': { version: '1.0.0', resolved: `${REGISTRY}old/-/old-1.0.0.tgz` },
    'node_modules/@s/fine': { version: '2.0.0', resolved: `${REGISTRY}@s/fine/-/fine-2.0.0.tgz` },
    'node_modules/vendored': { version: '0.1.0', resolved: 'file:vendor/vendored-0.1.0.tgz' },
  } };
  const registry = {
    old: { versions: { '1.0.0': { deprecated: 'no longer supported' } } },
    '@s%2ffine': { versions: { '2.0.0': {} } },
  };
  const fake = (over = {}) => async (url) => {
    const key = url.slice(REGISTRY.length);
    if (key in over) return over[key]();
    return key in registry ? { ok: true, status: 200, json: async () => registry[key] } : { ok: false, status: 404 };
  };
  const { want, unregistered } = lockedPackages(lock);
  const runWith = async (allowlist, fetchImpl = fake()) => {
    const result = await scan(want, fetchImpl);
    const { problems, offending } = judge(result, allowlist);
    return problems.length === 0 && offending.length === 0 ? 0 : 1;
  };
  const cases = [
    ['links, workspace directories and file: tarballs are not looked up; the file: one is named', () =>
      JSON.stringify([...want.keys()].sort()) === JSON.stringify(['@s/fine', 'old']) && unregistered.length === 1 && unregistered[0].startsWith('vendored@0.1.0')],
    ['a deprecated version fails', async () => (await runWith({ entries: [] })) === 1],
    ['the same version allowlisted with a reason passes', async () =>
      (await runWith({ entries: [{ package: 'old@1.0.0', reason: 'held until the upstream replacement ships' }] })) === 0],
    ['an allowlist entry with no reason fails', async () => (await runWith({ entries: [{ package: 'old@1.0.0' }] })) === 1],
    ['an allowlist entry with a token reason fails', async () => (await runWith({ entries: [{ package: 'old@1.0.0', reason: 'ok' }] })) === 1],
    ['an allowlist entry matching nothing deprecated fails', async () =>
      (await runWith({ entries: [{ package: 'old@1.0.0', reason: 'held until the upstream replacement ships' }, { package: 'gone@1.0.0', reason: 'left over from an earlier lockfile' }] })) === 1],
    ['a lookup that 404s fails rather than counting clean', async () =>
      (await runWith({ entries: [{ package: 'old@1.0.0', reason: 'held until the upstream replacement ships' }] }, fake({ '@s%2ffine': () => ({ ok: false, status: 404 }) }))) === 1],
    ['a lookup that throws twice fails rather than counting clean', async () =>
      (await runWith({ entries: [{ package: 'old@1.0.0', reason: 'held until the upstream replacement ships' }] }, fake({ '@s%2ffine': () => { throw new Error('ECONNRESET'); } }))) === 1],
    ['a 503 is retried once, and a second answer counts', async () => {
      let n = 0;
      const flaky = fake({ '@s%2ffine': () => (n++ === 0 ? { ok: false, status: 503 } : { ok: true, status: 200, json: async () => registry['@s%2ffine'] }) });
      return (await runWith({ entries: [{ package: 'old@1.0.0', reason: 'held until the upstream replacement ships' }] }, flaky)) === 0 && n === 2;
    }],
    ['a locked version the registry does not have fails', async () =>
      (await runWith({ entries: [{ package: 'old@1.0.0', reason: 'held until the upstream replacement ships' }] }, fake({ '@s%2ffine': () => ({ ok: true, status: 200, json: async () => ({ versions: {} }) }) }))) === 1],
    ['an empty lockfile fails as checking nothing', async () => {
      const { want: none } = lockedPackages({ packages: { '': {} } });
      return none.size === 0;
    }],
    ['the real registry marks prebuild-install@7.1.3 deprecated and 7.1.2 not (network)', async () => {
      const doc = await packument('prebuild-install');
      return Boolean(doc.versions?.['7.1.3']?.deprecated) && doc.versions?.['7.1.2'] !== undefined;
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
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const lockfiles = args.length ? args : ['package-lock.json'];
  const allowlist = JSON.parse(readFileSync(ALLOWLIST, 'utf8'));
  process.exit(await run({ lockfiles, allowlist }));
}
