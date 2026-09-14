import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { inputsOf, metafilePlugin, METAFILE } from '../scripts/metafile-plugin.ts';

const chunk = (modules: Record<string, unknown>) => ({ type: 'chunk', modules });

test('inputsOf lists every chunk module by id, skips assets and virtual modules', () => {
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
