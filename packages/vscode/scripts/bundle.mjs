#!/usr/bin/env node
// Bundles src/extension.ts into one dist/extension.cjs. Forced to CommonJS (`.cjs` extension,
// `format: 'cjs'`) regardless of this package's own `"type": "module"` (used for tsx-run tests) —
// VS Code's classic extension-host loader expects `require()`-able CJS, and `.cjs` guarantees that
// no matter the package's module type. `vscode` is external (supplied by the extension host at
// runtime, not a real npm dependency to bundle).

import { copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { collectNotices, renderNotices } from '../../../scripts/third-party-notices.mjs';

const pkgRoot = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

rmSync(new URL('../dist', import.meta.url), { recursive: true, force: true });

const extensionBuild = await build({
  absWorkingDir: pkgRoot,
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  // M92a (review `B6-16`) — see below.
  metafile: true,
  format: 'cjs',
  target: 'node18',
  outfile: 'dist/extension.cjs',
  external: ['vscode'],
});

// M92a (review `B6-16`, found while probing `B6-06`) — the `.vsix` has the same attribution
// obligation as the npm tarball, and it was filed against neither. `dist/extension.cjs` is 952 KB,
// nine tenths of it third-party: `vscode-languageclient` and the LSP wire packages, plus
// `minimatch`, `semver`, `brace-expansion` and `balanced-match` reaching in transitively. It ships
// beside one `LICENSE.txt` naming one person. `minimatch` is BlueOak-1.0.0, a license family the
// npm bundle doesn't even contain — which is the argument for generating this per-artifact instead
// of writing one notice file for the repo.
const notices = collectNotices(extensionBuild.metafile);
writeFileSync(new URL('../THIRD-PARTY-NOTICES.md', import.meta.url), renderNotices(pkg.name, notices), 'utf8');
writeFileSync(
  new URL('../.bundle-meta.json', import.meta.url),
  JSON.stringify({ inputs: extensionBuild.metafile.inputs }),
  'utf8',
);

// LICENSE is copied from the monorepo root rather than hand-duplicated, so there is exactly one
// copy to keep correct — the same source-of-truth rule as packages/cli/scripts/bundle.mjs
// (decision 74e). It lives *here*, in the build, rather than in a separate script wired only to
// `vscode:prepublish`: this file is gitignored, so a fresh checkout has it only if a build makes
// it. Deferring the copy to publish time meant `npm run build && npm test` passed on a machine
// that had once run `npm run package` and failed on any that had not — which is exactly what CI
// caught when M92a's `files`-list test first ran there.
copyFileSync(new URL('../../../LICENSE', import.meta.url), new URL('../LICENSE', import.meta.url));
