#!/usr/bin/env node
// Bundles src/extension.ts into one dist/extension.cjs. Forced to CommonJS (`.cjs` extension,
// `format: 'cjs'`) regardless of this package's own `"type": "module"` (used for tsx-run tests) —
// VS Code's classic extension-host loader expects `require()`-able CJS, and `.cjs` guarantees that
// no matter the package's module type. `vscode` is external (supplied by the extension host at
// runtime, not a real npm dependency to bundle).

import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const pkgRoot = fileURLToPath(new URL('..', import.meta.url));

rmSync(new URL('../dist', import.meta.url), { recursive: true, force: true });

await build({
  absWorkingDir: pkgRoot,
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  outfile: 'dist/extension.cjs',
  external: ['vscode'],
});
