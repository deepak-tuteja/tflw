// Which tflw is speaking — `M154a`'s build stamp, moved out of `cli.ts` by `M240` `F` (`M239-10`)
// so the page's server can put it on the wire. `tflw spec` printed it; the page said nothing about
// its own version, and a stranger comparing a report to a docs page had no way to know which tflw
// wrote it (review U16).

import { readFile } from 'node:fs/promises';

// Set via esbuild `--define` at bundle time (packages/cli/scripts/bundle.mjs, decision 74b) to the
// real package.json version. Undefined under `npm run dev` (unbundled `tsx`), where `getVersion()`
// falls back to reading package.json directly.
declare const __TFLW_VERSION__: string | undefined;

// M154a — the rest of the build stamp `tflw spec` prints, injected by the same `define` mechanism
// and undefined for the same reason under `npm run dev`. `__TFLW_COMMIT__` is the empty string when
// the bundle was built somewhere with no git to ask (a published tarball); `buildStamp()` maps that
// to `null` rather than letting an empty sha look like an answer.
declare const __TFLW_COMMIT__: string | undefined;
declare const __TFLW_DIRTY__: boolean | null | undefined;
declare const __TFLW_BUILD_TIME__: string | undefined;

export async function getVersion(): Promise<string> {
  if (typeof __TFLW_VERSION__ === 'string') return __TFLW_VERSION__;
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  return pkg.version;
}

export interface BuildStamp {
  readonly version: string;
  /** `bundle` — built by `packages/cli/scripts/bundle.mjs`, which is what the npm tarball ships and
   *  what a consumer vendors. `dev` — run unbundled through `tsx`, where the `define`s do not
   *  exist. A consumer grading a build should refuse `dev`: it has no provenance to check. */
  readonly source: 'bundle' | 'dev';
  readonly commit: string | null;
  /** Whether the working tree had uncommitted changes at bundle time. Its own field rather than a
   *  `-dirty` suffix on `commit`, so a consumer comparing shas does not have to strip it first. */
  readonly dirty: boolean | null;
  readonly builtAt: string | null;
}

export async function buildStamp(): Promise<BuildStamp> {
  const version = await getVersion();
  if (typeof __TFLW_BUILD_TIME__ !== 'string') {
    return { version, source: 'dev', commit: null, dirty: null, builtAt: null };
  }
  const commit = typeof __TFLW_COMMIT__ === 'string' && __TFLW_COMMIT__ !== '' ? __TFLW_COMMIT__ : null;
  return {
    version,
    source: 'bundle',
    commit,
    // Restated here rather than trusted from the `define`, because the two can only be got wrong
    // together: with no commit there is nothing for `dirty` to be relative to, and a `false` would
    // read as "the tree was clean" when in fact nobody looked.
    dirty: commit === null ? null : typeof __TFLW_DIRTY__ === 'boolean' ? __TFLW_DIRTY__ : null,
    builtAt: __TFLW_BUILD_TIME__,
  };
}
