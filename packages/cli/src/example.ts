// `tflw init --example` (`M259` `A`, `D1417`) — the Coffee Shelf, written into the current directory.
//
// `tflw://demo` answers `GET /health` and nothing else, which is enough for a first green run and
// for nothing after it: a newcomer could not practise a browser test, a workload or a scan against
// it. The Coffee Shelf is the example this repository already keeps true — every door, every
// statement the printer can write — so it is the one `init` hands out, rather than a second shop
// kept beside it.
//
// The files come from `dist/example/`, which `bundle.mjs` copies out of `examples/storefront/` with
// `scripts/example-files.mjs`'s rule. Nothing here chooses files: whatever the build put there is
// the example.
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

declare const __dirname: string | undefined;

/** `dist/example/` beside the running bundle. Under `tsx` (the unbundled source) it is the built
 *  package's, so a test run from source still writes what the tarball would. */
export function exampleRoot(): string {
  const here = typeof __dirname !== 'undefined' ? __dirname : dirname(fileURLToPath(import.meta.url));
  const bundled = join(here, 'example');
  return existsSync(bundled) ? bundled : join(here, '..', 'dist', 'example');
}

async function walk(root: string, rel = ''): Promise<string[]> {
  const out: string[] = [];
  for (const entry of (await readdir(join(root, rel), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = rel === '' ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await walk(root, path)));
    else out.push(path);
  }
  return out;
}

/** The script `npm run shop` runs. A constant because the next-steps text and the tests name it. */
export const SHOP_SCRIPT = 'node server.mjs';

export type ExampleOutcome =
  | { readonly kind: 'written'; readonly files: readonly string[]; readonly packageJson: 'created' | 'script-added' | 'script-kept' | 'unreadable' }
  | { readonly kind: 'collision'; readonly existing: readonly string[] }
  | { readonly kind: 'missing'; readonly root: string };

/**
 * Writes the example into `cwd`. **Refuses when any file it would write is already there**, unless
 * `force` — the same rule plain `init` keeps for `tflw.config`, widened to every file, because an
 * example written over a project's own `tests/checkout.tflw` would be a loss nobody asked for. The
 * refusal names what is in the way, so the reader can choose an empty directory or `--force`.
 *
 * `package.json` is the one file merged rather than written: `npm run shop` needs a script, and a
 * reader who ran `npm init` first has a manifest that is theirs. The script is added only when the
 * manifest has none by that name, and the file is left alone when it does not parse.
 */
export async function writeExample(cwd: string, force: boolean): Promise<ExampleOutcome> {
  const root = exampleRoot();
  if (!existsSync(root)) return { kind: 'missing', root };
  const files = await walk(root);
  const existing = files.filter((f) => existsSync(join(cwd, f)));
  if (existing.length > 0 && !force) return { kind: 'collision', existing };
  for (const f of files) {
    await mkdir(dirname(join(cwd, f)), { recursive: true });
    await copyFile(join(root, f), join(cwd, f));
  }
  return { kind: 'written', files, packageJson: await ensureShopScript(join(cwd, 'package.json')) };
}

async function ensureShopScript(path: string): Promise<'created' | 'script-added' | 'script-kept' | 'unreadable'> {
  if (!existsSync(path)) {
    // `"type": "module"` for the reason plain `init`'s manifest carries it (`FU-15`), and `private`
    // because a test suite is not a package.
    await writeFile(path, `${JSON.stringify({ private: true, type: 'module', scripts: { shop: SHOP_SCRIPT } }, null, 2)}\n`, 'utf8');
    return 'created';
  }
  const text = await readFile(path, 'utf8');
  let manifest: { scripts?: Record<string, string> } & Record<string, unknown>;
  try {
    manifest = JSON.parse(text) as typeof manifest;
  } catch {
    return 'unreadable';
  }
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) return 'unreadable';
  if (manifest.scripts?.shop !== undefined) return 'script-kept';
  manifest.scripts = { ...(manifest.scripts ?? {}), shop: SHOP_SCRIPT };
  // The indent the file already uses, so the diff is the one line this added.
  const indent = /^\{\r?\n([ \t]+)"/.exec(text)?.[1] ?? '  ';
  await writeFile(path, `${JSON.stringify(manifest, null, indent)}\n`, 'utf8');
  return 'script-added';
}
