#!/usr/bin/env node
// Bundles src/cli.ts into one self-contained dist/cli.cjs (decision 43), injecting the real
// package.json version as `__TFLW_VERSION__` (decision 74b) so `tflw --version` needs no runtime
// package.json read in the published artifact. A plain JS script (not a shell one-liner) so the
// dist removal is portable across OSes (decision 79) and the version doesn't need shell quoting.

import { copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build, formatMessages } from 'esbuild';
import { collectNotices, renderNotices } from '../../../scripts/third-party-notices.mjs';

const pkgRoot = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// M86 (review `B6-08`) — the coverage build, and only the coverage build, emits a source map.
//
// Every CLI test spawns this bundle as a real subprocess (`e2e.test.ts`'s whole point), so all of
// `cli.ts`, `env.ts`, `cli-summary.ts` and the three package barrels were executed *thousands* of
// times per suite and reported at **0%** — c8 saw one `dist/cli.cjs` it had been told to exclude,
// and had no map to attribute it back to source with. The number wasn't low, it was measuring
// something else. `scripts/coverage.mjs` sets this; nothing else does.
//
// Gated rather than unconditional so the published artifact stays byte-identical to what has been
// shipping, and so the tarball never carries a `//# sourceMappingURL=` line pointing at a `.map`
// that `files: ["dist"]` would have to either ship (megabytes, for nobody) or omit (a dangling
// reference — the exact overselling class this review exists for).
const sourcemap = process.env.TFLW_BUNDLE_SOURCEMAP === '1';

// M92c (review `FU-27`) — `npm pack` emitted three `empty-import-meta` warnings, from two sites
// that are both correctly guarded and both already carry a comment explaining why esbuild is wrong
// about them: `getVersion()`'s fallback (unreachable, `__TFLW_VERSION__` is a `define`) and
// `resolveWorkerEntryPath()` (prefers `__dirname`, reaching `import.meta.url` only under real ESM).
// esbuild raises this at parse time, before dead-code elimination, so it warns about code it then
// deletes — both outputs contain zero occurrences of `import.meta`.
//
// `logOverride: { 'empty-import-meta': 'silent' }` alone would be the wrong fix and the tempting
// one. The rule is per-*rule*, not per-site, so silencing it also silences a future, genuinely
// unguarded `import.meta` — a live failure hidden by a suppression that reads as "handled".
//
// The first attempt at keeping the warning's meaning was to silence the rule and assert the emitted
// file contains no `import.meta`. That check can never fail, and the negative control is what said
// so: esbuild *substitutes* `import.meta` when targeting `cjs` (that is what "will be empty" means),
// so a `cjs` output contains zero occurrences whether the source site was guarded or not. Measured
// all three ways — an unguarded, reachable, non-tree-shaken `import.meta.url` produced a warning and
// an output with no `import.meta` in it, exactly like the guarded ones.
//
// So the inspection happens on the *warnings*, which is where the information actually is:
// `logLevel: 'silent'` keeps `result.warnings` populated (unlike `logOverride`, which drops the
// message entirely), the known-guarded sites are allowed **by file and by count**, and anything else
// is re-printed and throws. Net: quieter for the three false positives, and strictly louder than
// esbuild's own warning for a real one, which was only ever advisory.
const IMPORT_META_ALLOWED = new Map([
  // `getVersion()`'s fallback — unreachable in the bundle, `__TFLW_VERSION__` is a `define`.
  ['src/cli.ts', 1],
  // `resolveWorkerEntryPath()` — prefers the real `__dirname`, reaching `import.meta.url` only under
  // real ESM. Reached through the runtime's compiled `dist` from the CLI entry and through its `src`
  // from the worker entry, so both spellings are the same guarded site.
  ['../runtime/dist/mtlsWorker.js', 1],
  ['../runtime/src/mtlsWorker.ts', 1],
]);

/** Re-implements esbuild's own log printing for everything that isn't an allowed
 * `empty-import-meta`, then throws if any of the latter turned up. Counting per file, rather than
 * only listing the file, is what stops a *second* unguarded site inside an already-listed file from
 * riding in on the first one's allowance. */
async function reportWarnings(label, result) {
  const unexpected = [];
  const other = [];
  for (const w of result.warnings) {
    if (w.id !== 'empty-import-meta') { other.push(w); continue; }
    const file = w.location?.file ?? '(unknown)';
    const budget = IMPORT_META_ALLOWED.get(file) ?? 0;
    if (budget > 0) IMPORT_META_ALLOWED.set(file, budget - 1);
    else unexpected.push(w);
  }
  for (const line of await formatMessages(other.concat(unexpected), { kind: 'warning', color: true, terminalWidth: 100 })) {
    process.stderr.write(line);
  }
  if (unexpected.length > 0) {
    throw new Error(
      `bundle (${label}): ${unexpected.length} unguarded \`import.meta\` site(s) — see above.\n` +
        `  \`import.meta\` is always empty in a \`cjs\` bundle, so this evaluates to nothing at runtime.\n` +
        `  Guard it the way \`getVersion()\` and \`resolveWorkerEntryPath()\` do, or add it to\n` +
        `  IMPORT_META_ALLOWED with a reason.`,
    );
  }
}

rmSync(new URL('../dist', import.meta.url), { recursive: true, force: true });

// LICENSE is copied from the monorepo root rather than hand-duplicated, so there is exactly one
// source of truth (the same drift this project's own decision 71 fixed for a duplicated function).
copyFileSync(new URL('../../../LICENSE', import.meta.url), new URL('../LICENSE', import.meta.url));

const cliBuild = await build({
  absWorkingDir: pkgRoot,
  entryPoints: ['src/cli.ts'],
  bundle: true,
  platform: 'node',
  // M92a (`B6-06`) — the notice file is generated from this, so it describes the packages that
  // actually got inlined rather than the ones somebody remembered to declare.
  metafile: true,
  // `.cjs` (not `.js`+ESM) since decision 13 (enterprise arc) bundles `undici` in: undici's CJS
  // source has `require()` calls inside function bodies (lazy/conditional), which esbuild can't
  // hoist into static ESM `import`s — bundled into ESM output, those become a shim that throws
  // "Dynamic require of ... is not supported" at runtime. CJS output has no such restriction
  // (`require` is native, synchronous, and already how esbuild resolves same-bundle references).
  // The package itself stays `"type": "module"` for its own dev source; `.cjs` makes Node treat
  // just this one file as CommonJS regardless, which is the standard way out of this esbuild
  // limitation.
  format: 'cjs',
  target: 'node22',
  outfile: 'dist/cli.cjs',
  sourcemap,
  define: { __TFLW_VERSION__: JSON.stringify(pkg.version) },
  // `playwright` (M3a, D5) is an optional peer of `@tflw/runtime`, dynamically imported only when
  // a test actually runs a browser step — it must NOT be inlined into this bundle: (a) it's often
  // not installed at all (an API-only consumer never needs it, and this build must still succeed
  // without it), and (b) even when it is, `playwright-core`'s own bundle references optional
  // native-transport deps (`chromium-bidi`) that esbuild can't resolve statically. `external`
  // leaves the `import('playwright')` call as a real runtime resolution against the consumer's own
  // `node_modules` — exactly the optional-peer behavior `browser.ts`'s `loadPlaywright()` expects.
  external: ['playwright'],
  logLevel: 'silent',
});
await reportWarnings('dist/cli.cjs', cliBuild);

// M35c — a genuinely separate bundle for the mTLS worker (`mtlsWorkerEntry.ts`, in
// `@tflw/runtime`, not this package's own `src/`), forked as its own child process specifically so
// the `undici` npm package it needs (for its client-cert-carrying `Agent`) is never imported by
// `dist/cli.cjs` itself — M35b found that merely importing `undici`, even unused, cripples Node's
// separate built-in global `fetch()` by ~20x. `mtlsWorker.ts`'s `getChild()` resolves this file by
// path at runtime (sibling of `dist/cli.cjs`), falling back to the `.ts` source sibling when this
// bundled file doesn't exist (`@tflw/runtime`'s own unit tests, run unbundled via `tsx`).
const workerBuild = await build({
  absWorkingDir: pkgRoot,
  entryPoints: ['../runtime/src/mtlsWorkerEntry.ts'],
  bundle: true,
  platform: 'node',
  metafile: true,
  format: 'cjs',
  target: 'node22',
  outfile: 'dist/mtls-worker.cjs',
  sourcemap,
  logLevel: 'silent',
});
await reportWarnings('dist/mtls-worker.cjs', workerBuild);

// M92a (review `B6-06`) — third-party attribution, from the union of *both* bundles' metafiles.
//
// The tarball ships `dist/cli.cjs` and `dist/mtls-worker.cjs`, so the notice must cover both; the
// union is taken rather than the CLI bundle alone because a package reaching only the worker (as
// `undici` nearly does — it is deliberately kept out of `dist/cli.cjs`, see M35c above) is still
// redistributed and still owes its notice.
const notices = collectNotices({ inputs: { ...cliBuild.metafile.inputs, ...workerBuild.metafile.inputs } });
writeFileSync(new URL('../THIRD-PARTY-NOTICES.md', import.meta.url), renderNotices(pkg.name, notices), 'utf8');

// M137a (`M136c-01`) — the cross-repo artifact contract, shipped as data rather than as code.
//
// `testFlow-tests` reads `findings.sarif`, and until now nothing joined the names tflw writes to the
// names that repo reads. `M136a` renamed one and the break surfaced as eleven failed SARIF entries
// in an acceptance phase — the slowest way it could have been found, with D351's cross-repo gate
// green throughout, because that gate is about diagnostic codes.
//
// A JSON file in `dist/` rather than a value the consumer imports: `files: ["dist"]` ships it with
// no packaging change, `dist/cli.cjs` is a CLI entry with nothing useful to import, and a consumer
// that has to spawn a process to learn a key name will not run its gate. Read from the built
// `@tflw/reporter` — the same module `sarif.ts` builds the document from — so the file and the
// emitter cannot state different things. `packages/reporter/test/sarif.test.ts` closes the other
// direction, that the contract does not promise a key the emitter stopped writing.
const { ARTIFACT_CONTRACT } = await import('@tflw/reporter');
writeFileSync(
  new URL('../dist/artifact-contract.json', import.meta.url),
  `${JSON.stringify(ARTIFACT_CONTRACT, null, 2)}\n`,
  'utf8',
);

// The metafile itself, for `test/pack.test.ts` to re-derive the same package set from — deliberately
// *outside* `dist/`, so `files: ["dist"]` cannot ship a build byproduct, and gitignored. Writing it
// is what keeps the guard from needing its own copy of the build config, which would be the drift
// this whole milestone exists to remove.
writeFileSync(
  new URL('../.bundle-meta.json', import.meta.url),
  JSON.stringify({ inputs: { ...cliBuild.metafile.inputs, ...workerBuild.metafile.inputs } }),
  'utf8',
);
