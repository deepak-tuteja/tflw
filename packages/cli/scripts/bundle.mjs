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
  define: { __TFLW_VERSION__: JSON.stringify(pkg.version) },
});
