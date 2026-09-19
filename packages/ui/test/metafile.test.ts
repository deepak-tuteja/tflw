import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { inputsOf, metafilePlugin, METAFILE } from '../scripts/metafile-plugin.ts';

const chunk = (modules: Record<string, unknown>) => ({ type: 'chunk', modules });

test('inputsOf lists every chunk module by id and skips virtual modules', () => {
  const bundle = {
    'assets/index-abc.js': chunk({
      '/repo/node_modules/react/index.js': {},
      '/repo/node_modules/uplot/dist/uPlot.esm.js': {},
      '\0vite/preload-helper.js': {},
      '/repo/packages/ui/src/main.tsx': {},
    }),
    'assets/index-abc.css': { type: 'asset', source: '' },
  };
  const { inputs } = inputsOf(bundle);
  assert.deepEqual(Object.keys(inputs).sort(), [
    '/repo/node_modules/react/index.js',
    '/repo/node_modules/uplot/dist/uPlot.esm.js',
    '/repo/packages/ui/src/main.tsx',
  ]);
});

// `M213-11`. The claim is not *assets are included* — it is **an asset that came from a package is
// that package redistributed, and the notice generator has to be told**. So the case that carries
// it is a vendored font beside the extracted stylesheet: one has an origin on disk, the other was
// built from a string, and only the first is somebody else's work. The relative-path half is the
// half that would have failed silently: rolldown reports an asset's origin relative to `root`
// while a module id is absolute, so without the resolve the generator is handed
// `../../node_modules/…` and reads a `LICENSE` off whatever the cwd happens to be.
test('inputsOf attributes an asset to the package it was copied from, resolved against root', () => {
  const bundle = {
    'assets/plex-xyz.woff2': {
      type: 'asset',
      originalFileNames: ['../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2'],
    },
    // Two names, one asset: rolldown coalesces byte-identical sources, and a notice is owed to
    // every package that contributed one.
    'assets/shared-xyz.woff2': {
      type: 'asset',
      originalFileNames: ['../../node_modules/a/f.woff2', '../../node_modules/b/f.woff2'],
    },
    // Ours: extracted from the page's own CSS, no file behind it.
    'assets/index-abc.css': { type: 'asset', source: '' },
  };
  const { inputs } = inputsOf(bundle, '/repo/packages/ui');
  assert.deepEqual(Object.keys(inputs).sort(), [
    '/repo/node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2',
    '/repo/node_modules/a/f.woff2',
    '/repo/node_modules/b/f.woff2',
  ]);
});

test('control: a bundle with no chunks yields no inputs; the plugin resolves outDir against root and creates it', () => {
  assert.deepEqual(inputsOf({}), { inputs: {} });
  const dir = mkdtempSync(join(tmpdir(), 'tflw-ui-metafile-'));
  try {
    // The hooks are called directly, as functions, with the two fields each one reads.
    const plugin = metafilePlugin() as unknown as {
      configResolved: (c: { root: string; build: { outDir: string } }) => void;
      writeBundle: (o: object, b: Record<string, unknown>) => void;
    };
    plugin.configResolved({ root: dir, build: { outDir: 'out' } });
    plugin.writeBundle({}, { 'a.js': chunk({ '/x/node_modules/react/index.js': {} }) });
    const written = JSON.parse(readFileSync(join(dir, 'out', METAFILE), 'utf8'));
    assert.deepEqual(written, { inputs: { '/x/node_modules/react/index.js': {} } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
