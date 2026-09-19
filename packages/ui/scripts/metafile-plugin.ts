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
//
// `M213-11` — **ASSETS ARE REDISTRIBUTION TOO, AND THIS FILE COULD NOT SEE THEM.** `S0` vendored
// five typefaces, and 275 KB of OFL-licensed `.woff2` landed in `cli/dist/ui/assets/` — twelve
// files, five packages, every one of them requiring its notice to travel with the bytes. The
// metafile named **none** of them, so `third-party-notices.mjs` would have emitted a file that
// read as complete and listed no font at all: a `.woff2` referenced from CSS is an `asset` output
// with no chunk and no modules, and this function walked chunks only. The blind spot was silent by
// construction — the generator throws when a package it *sees* has no license, and never asks
// about one it cannot see, which is the same failure `D-M92-2` forbids one layer down.
//
// Assets carry `originalFileNames`, the source paths rolldown copied from, so they attribute
// through the very same `lastIndexOf('node_modules/')` the chunk ids do. They are **resolved
// against `root` first**: rolldown reports them relative to the project root while module ids are
// absolute, and the notices generator reads each package's `LICENSE` off the path it is handed.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Plugin } from 'vite';

export const METAFILE = 'metafile.json';

/** `{ inputs: { <module id>: {} } }` over every rendered chunk's modules AND every emitted asset's
 * source file. Module ids are the absolute paths rolldown resolved, which
 * `third-party-notices.mjs`'s `lastIndexOf('node_modules/')` attributes exactly as it does
 * esbuild's relative ones. Virtual modules (`\0…`) are not files and are skipped; nothing
 * third-party arrives that way. */
export interface Metafile { inputs: Record<string, Record<string, never>> }

/** The fields this reads off a rendered output; rolldown's own type is wider and not needed. */
export type OutputLike = { type: string; modules?: Record<string, unknown>; originalFileNames?: readonly string[] };

export function inputsOf(bundle: Record<string, OutputLike>, root = ''): Metafile {
  const inputs: Metafile['inputs'] = {};
  for (const output of Object.values(bundle)) {
    if (output.type === 'chunk') {
      for (const id of Object.keys(output.modules ?? {})) {
        if (id.startsWith('\0')) continue;
        inputs[id] = {};
      }
      continue;
    }
    // An asset that came from a file — a vendored `.woff2`, an image — is that file's package
    // redistributed. One with no source (the extracted stylesheet, anything `emitFile`d from a
    // string) reports no original and contributes nothing, which is correct: it is ours.
    for (const from of output.originalFileNames ?? []) {
      inputs[resolve(root, from)] = {};
    }
  }
  return { inputs };
}

export function metafilePlugin(): Plugin {
  let outDir = '';
  let root = '';
  return {
    name: 'tflw:metafile',
    configResolved(config) {
      root = config.root;
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
      writeFileSync(join(outDir, METAFILE), JSON.stringify(inputsOf(bundle as unknown as Record<string, OutputLike>, root), null, 2));
    },
  };
}
