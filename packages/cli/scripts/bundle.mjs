#!/usr/bin/env node
// Bundles src/cli.ts into one self-contained dist/cli.cjs (decision 43), injecting the real
// package.json version as `__TFLW_VERSION__` (decision 74b) so `tflw --version` needs no runtime
// package.json read in the published artifact. A plain JS script (not a shell one-liner) so the
// dist removal is portable across OSes (decision 79) and the version doesn't need shell quoting.

import { copyFileSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

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

rmSync(new URL('../dist', import.meta.url), { recursive: true, force: true });

// LICENSE is copied from the monorepo root rather than hand-duplicated, so there is exactly one
// source of truth (the same drift this project's own decision 71 fixed for a duplicated function).
copyFileSync(new URL('../../../LICENSE', import.meta.url), new URL('../LICENSE', import.meta.url));

await build({
  absWorkingDir: pkgRoot,
  entryPoints: ['src/cli.ts'],
  bundle: true,
  platform: 'node',
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
});

// M35c — a genuinely separate bundle for the mTLS worker (`mtlsWorkerEntry.ts`, in
// `@tflw/runtime`, not this package's own `src/`), forked as its own child process specifically so
// the `undici` npm package it needs (for its client-cert-carrying `Agent`) is never imported by
// `dist/cli.cjs` itself — M35b found that merely importing `undici`, even unused, cripples Node's
// separate built-in global `fetch()` by ~20x. `mtlsWorker.ts`'s `getChild()` resolves this file by
// path at runtime (sibling of `dist/cli.cjs`), falling back to the `.ts` source sibling when this
// bundled file doesn't exist (`@tflw/runtime`'s own unit tests, run unbundled via `tsx`).
await build({
  absWorkingDir: pkgRoot,
  entryPoints: ['../runtime/src/mtlsWorkerEntry.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: 'dist/mtls-worker.cjs',
  sourcemap,
});
