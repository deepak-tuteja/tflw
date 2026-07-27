// Visual regression (M4b, D15): baseline compare/update for `expect page|<locator> matches
// snapshot "<name>"`. Pure Node — no Playwright import here at all. `browser.ts` captures the raw
// PNG bytes (with `mask` support via Playwright's own `screenshot({ mask })`); this module owns
// everything after that: where a baseline lives on disk, whether it exists, whether the platform
// that produced it matches this run, and the pixel compare itself. Kept separate so the compare
// logic is unit-testable without a real browser.
//
// Platform-key policy (D15): "comparing across a different platform key is a hard teaching error,
// not a tolerance knob" — font hinting/subpixel AA between two OSes/engines never reconciles, and
// every fuzz threshold anyone's tried ended up too loose to catch anything real. So a platform
// mismatch short-circuits straight to a clear error, before any pixel is ever compared, rather than
// silently applying a looser threshold. Within a matching platform, the compare itself is exact-ish:
// pixelmatch's own default per-pixel anti-aliasing threshold (0.1) absorbs harmless AA jitter on an
// otherwise byte-identical render; there is no exposed "% of image allowed to differ" knob — the
// whole point of D15 is that visual regression is a real regression, not a slider to tune away.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

/** Slugifies a test/file/snapshot name into a filesystem-safe directory/file segment — lowercase,
 * non-alphanumeric runs collapse to a single `-`, no leading/trailing `-`. Empty input (a blank
 * snapshot name, theoretically reachable via `{var}` interpolation) falls back to `snapshot` rather
 * than producing an empty path segment. */
export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'snapshot';
}

export interface SnapshotPaths {
  readonly dir: string;
  readonly pngPath: string;
  readonly sidecarPath: string;
}

/** `snapshots/<file>/<test>/<name>.png` (D15), resolved against the `.tflw` file's own directory —
 * the same "resolve relative to this file" convention `matches file`/`body from`/`upload` already
 * use, so a folder of test files gets one `snapshots/` tree per file rather than needing a shared
 * repo-root concept this module has no other reason to know about. `fileLabel` is the test file's
 * own basename without extension (or a fixed fallback for a caller with no file identity, e.g. a
 * unit test driving `runProgram` directly from an in-memory source string). */
export function snapshotPaths(baseDir: string, fileLabel: string, testName: string, name: string): SnapshotPaths {
  const dir = join(baseDir, 'snapshots', slugify(fileLabel), slugify(testName));
  return { dir, pngPath: join(dir, `${slugify(name)}.png`), sidecarPath: join(dir, `${slugify(name)}.platform.json`) };
}

interface Sidecar {
  readonly platformKey: string;
}

async function readBaseline(paths: SnapshotPaths): Promise<{ png: Buffer; platformKey: string } | null> {
  let png: Buffer;
  try {
    png = await readFile(paths.pngPath);
  } catch {
    return null; // no baseline yet — not an error, the normal state before the first `--update-snapshots`
  }
  let platformKey = 'unknown';
  try {
    const sidecar = JSON.parse(await readFile(paths.sidecarPath, 'utf8')) as Sidecar;
    platformKey = sidecar.platformKey;
  } catch {
    // A baseline PNG committed without its sidecar (hand-added, or from before this field existed)
    // — treated as an unconditional platform mismatch below rather than silently trusting it.
  }
  return { png, platformKey };
}

async function writeBaseline(paths: SnapshotPaths, png: Buffer, platformKey: string): Promise<void> {
  await mkdir(paths.dir, { recursive: true });
  await writeFile(paths.pngPath, png);
  const sidecar: Sidecar = { platformKey };
  await writeFile(paths.sidecarPath, JSON.stringify(sidecar, null, 2) + '\n');
}

export interface SnapshotDiffAsset {
  /** Absent only when this run just created the very first baseline (nothing to diff against). */
  readonly baseline?: string;
  readonly actual: string;
  /** Present only when a same-platform baseline existed and its dimensions matched — i.e. whenever
   * a real pixel compare actually ran. */
  readonly diff?: string;
}

export interface SnapshotOutcome {
  readonly ok: boolean;
  readonly message: string;
  /** True when `--update-snapshots` wrote or overwrote the baseline this call. */
  readonly updated: boolean;
  /** Omitted on a clean pass (D12's "screenshot-per-step by default" rejection extends here — a
   * matching snapshot adds no evidence worth keeping in the report). */
  readonly diff?: SnapshotDiffAsset;
}

function toBase64(png: Buffer): string {
  return png.toString('base64');
}

/** Compares `actualPng` against whatever baseline (if any) lives at `paths`, honoring
 * `updateSnapshots` (`tflw run --update-snapshots`). Never throws for an ordinary mismatch/missing
 * baseline — those are reported through `SnapshotOutcome.ok`, the same "a failure is data, not an
 * exception" shape every other UI matcher in this runtime uses; only a real I/O error propagates.
 *
 * `negated` (`not matches snapshot`, mirroring `matchesFile`/`matchesSchema`'s own handling)
 * applies **only** to a genuine same-platform, same-dimensions pixel compare — the one case where
 * "did it match" is actually a yes/no answer being asserted. Every other outcome here (no baseline
 * yet, a platform mismatch, a dimension mismatch, or any `--update-snapshots` write) is "we
 * couldn't compare" or "an action just ran", not a comparison result — the same reasoning
 * `execNetworkExpect`'s "no matching request observed yet" branch already applies before its own
 * `wasMade`-only negation check. */
export async function evaluateSnapshot(paths: SnapshotPaths, name: string, actualPng: Buffer, platformKey: string, updateSnapshots: boolean, negated: boolean): Promise<SnapshotOutcome> {
  const baseline = await readBaseline(paths);

  if (!baseline) {
    if (updateSnapshots) {
      await writeBaseline(paths, actualPng, platformKey);
      return { ok: true, updated: true, message: `snapshot "${name}": new baseline written`, diff: { actual: toBase64(actualPng) } };
    }
    return {
      ok: false,
      updated: false,
      message: `snapshot "${name}": no baseline exists yet — run \`tflw run --update-snapshots\` to create one`,
      diff: { actual: toBase64(actualPng) },
    };
  }

  if (baseline.platformKey !== platformKey) {
    return {
      ok: false,
      updated: false,
      message: `snapshot "${name}": baseline was captured on platform "${baseline.platformKey}", this run is "${platformKey}" — comparing across platforms is a hard error, not a tolerance knob (SPEC §9.9, D15); regenerate the baseline with \`--update-snapshots\` in a matching environment`,
      diff: { baseline: toBase64(baseline.png), actual: toBase64(actualPng) },
    };
  }

  const baselinePng = PNG.sync.read(baseline.png);
  const actualPngDecoded = PNG.sync.read(actualPng);
  if (baselinePng.width !== actualPngDecoded.width || baselinePng.height !== actualPngDecoded.height) {
    if (updateSnapshots) {
      await writeBaseline(paths, actualPng, platformKey);
      return {
        ok: true,
        updated: true,
        message: `snapshot "${name}": baseline updated (dimensions changed ${baselinePng.width}x${baselinePng.height} → ${actualPngDecoded.width}x${actualPngDecoded.height})`,
        diff: { baseline: toBase64(baseline.png), actual: toBase64(actualPng) },
      };
    }
    return {
      ok: false,
      updated: false,
      message: `snapshot "${name}": dimensions differ (baseline ${baselinePng.width}x${baselinePng.height}, actual ${actualPngDecoded.width}x${actualPngDecoded.height}) — run \`--update-snapshots\` to accept`,
      diff: { baseline: toBase64(baseline.png), actual: toBase64(actualPng) },
    };
  }

  const { width, height } = baselinePng;
  const diffPng = new PNG({ width, height });
  const diffPixels = pixelmatch(baselinePng.data, actualPngDecoded.data, diffPng.data, width, height, { threshold: 0.1 });

  if (diffPixels === 0) {
    if (negated) {
      return { ok: false, updated: false, message: `snapshot "${name}": expected to differ from baseline, but it matched exactly` };
    }
    return { ok: true, updated: false, message: `snapshot "${name}": matches baseline` };
  }

  const pct = ((diffPixels / (width * height)) * 100).toFixed(2);
  if (updateSnapshots) {
    await writeBaseline(paths, actualPng, platformKey);
    return {
      ok: true,
      updated: true,
      message: `snapshot "${name}": baseline updated (${diffPixels} px / ${pct}% differed from the previous baseline)`,
      diff: { baseline: toBase64(baseline.png), actual: toBase64(actualPng), diff: toBase64(PNG.sync.write(diffPng)) },
    };
  }
  if (negated) {
    return {
      ok: true,
      updated: false,
      message: `snapshot "${name}": differs from baseline as expected (${diffPixels} px / ${pct}%)`,
      diff: { baseline: toBase64(baseline.png), actual: toBase64(actualPng), diff: toBase64(PNG.sync.write(diffPng)) },
    };
  }
  return {
    ok: false,
    updated: false,
    message: `snapshot "${name}": does not match baseline (${diffPixels} px / ${pct}% differed) — run \`--update-snapshots\` to accept, or inspect the diff in the report`,
    diff: { baseline: toBase64(baseline.png), actual: toBase64(actualPng), diff: toBase64(PNG.sync.write(diffPng)) },
  };
}

/** `linux-chromium-131.0.6778.33` (D15): OS + engine + the actual browser build version, so a
 * baseline's sidecar records exactly what produced it. Content-hashed to a short id is deliberately
 * *not* done here — the raw string is far more useful printed straight into a platform-mismatch
 * error message than a hash would be. */
export function computePlatformKey(engine: string, browserVersion: string): string {
  return `${process.platform}-${engine}-${browserVersion}`;
}
