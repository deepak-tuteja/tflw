// The UI bundle's input list, in the shape `scripts/third-party-notices.mjs` reads (`M192` U0).
//
// `tflw`'s tarball already inlines twelve packages into `dist/cli.cjs` and its notice file is
// generated from esbuild's metafile, because a hand-maintained list is the defect it exists to
// prevent (`M92a`, `D-M92-0`). The page's bundle lands in the same tarball (`cli/dist/ui/`) and
// inlines React, uPlot, TanStack and CodeMirror — redistribution under every one of those MIT
// notices — so it owes the same generator the same input. Vite (rolldown underneath) has no
// esbuild metafile; this plugin writes one from what the chunks say they contain, which is the
// bundle's own account rather than package.json's. `cli/scripts/bundle.mjs` reads it, unions it
// with the two esbuild metafiles, and deletes it — it is never shipped.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Plugin } from 'vite';

export const METAFILE = 'metafile.json';

/** `{ inputs: { <module id>: {} } }` over every rendered chunk's modules. Module ids are the
 * absolute paths rolldown resolved, which `third-party-notices.mjs`'s `lastIndexOf('node_modules/')`
 * attributes exactly as it does esbuild's relative ones. Virtual modules (`\0…`) are not files
 * and are skipped; nothing third-party arrives that way. */
export interface Metafile { inputs: Record<string, Record<string, never>> }

/** The two fields this reads off a rendered output; rolldown's own type is wider and not needed. */
export type OutputLike = { type: string; modules?: Record<string, unknown> };

export function inputsOf(bundle: Record<string, OutputLike>): Metafile {
  const inputs: Metafile['inputs'] = {};
  for (const output of Object.values(bundle)) {
    if (output.type !== 'chunk') continue;
    for (const id of Object.keys(output.modules ?? {})) {
      if (id.startsWith('\0')) continue;
      inputs[id] = {};
    }
  }
  return { inputs };
}

export function metafilePlugin(): Plugin {
  let outDir = '';
  return {
    name: 'tflw:metafile',
    configResolved(config) {
      // `build.outDir` is relative to `root` until resolved here; the hook below runs in an
      // unrelated cwd when the CLI's bundle script drives the build.
      outDir = resolve(config.root, config.build.outDir);
    },
    // `writeBundle`, not `generateBundle`: the output directory exists only once the bundle has
    // been written, and this file is written beside it, not through `this.emitFile`, so it is not
    // part of the bundle's own manifest and cannot be mistaken for something to serve.
    writeBundle(_options, bundle) {
      // The bundle is rolldown's `OutputBundle`; only `type` and `modules` are read.
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, METAFILE), JSON.stringify(inputsOf(bundle as unknown as Record<string, OutputLike>), null, 2));
    },
  };
}
