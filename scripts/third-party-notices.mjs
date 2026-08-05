#!/usr/bin/env node
// Generates a THIRD-PARTY-NOTICES.md for an esbuild bundle, from that bundle's own metafile
// (M92a, review `B6-06`/`B6-16`).
//
// Both shipped artifacts inline third-party code: `tflw`'s npm tarball bundles 12 packages into
// `dist/cli.cjs`, and the `.vsix` bundles 9 into `dist/extension.cjs`. Every one of them is
// permissive (MIT, ISC, BSD-3-Clause, BlueOak-1.0.0) and every one of those licenses conditions
// that permission on redistributing the notice — MIT's wording being "The above copyright notice
// *and this permission notice* shall be included in all copies or substantial portions of the
// Software". Bundling is redistribution. Before this file, `grep -c -i copyright` was 0 in both
// artifacts, each shipping one LICENSE naming one person who wrote none of it.
//
// Why generated rather than hand-written (`D-M92-0`): the set is a property of the *bundle*, not of
// any package.json. `undici` arrives through a path nobody declared, and `minimatch`, `semver`,
// `brace-expansion` and `balanced-match` are all transitive through `vscode-languageclient`. A
// hand-maintained list is the same defect one release later — this file exists because a list
// drifted, so it must not be a list.
//
// Lives at the monorepo root, not in either package, for the reason `bundle.mjs` already copies the
// root LICENSE instead of keeping a second copy: one rule, one place.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** The package a bundled input path belongs to, or null for first-party source.
 *
 * `lastIndexOf` rather than `indexOf` — a nested `node_modules/` (npm's fallback when two
 * dependents want incompatible versions of the same transitive dep) must attribute to the *inner*
 * package, which is the copy actually inlined. */
function packageOf(inputPath) {
  const marker = 'node_modules/';
  const at = inputPath.lastIndexOf(marker);
  if (at === -1) return null;
  const segments = inputPath.slice(at + marker.length).split('/');
  return segments[0].startsWith('@') ? `${segments[0]}/${segments[1]}` : segments[0];
}

/** The directory of the copy that was actually bundled — resolved back from one of its own input
 * paths rather than from `require.resolve`, so the notice always describes the bytes that shipped
 * even when several versions of a package exist in the tree. */
function packageDirOf(inputPath, name) {
  const marker = 'node_modules/';
  const at = inputPath.lastIndexOf(marker);
  return join(inputPath.slice(0, at + marker.length), name);
}

/** Every root-level license file, concatenated.
 *
 * All of `LICENSE`, `LICENSE.md` and `License.txt` occur among the current 21 packages, hence the
 * case-insensitive prefix match. Concatenated rather than first-match because dual notices are
 * real: `pngjs` carries both its original and its derived-work copyrights, and dropping one would
 * be the exact omission this file exists to prevent.
 *
 * The match is deliberately loose at the *end* (`LICENSE-MIT`, `LICENSE.APACHE` are both real npm
 * conventions), which has a cost worth stating: it also matches anything else starting with those
 * letters. That is the right trade here — over-including license-adjacent text is a cosmetic wrong,
 * omitting a license is the wrong this file exists to prevent. Found the hard way: the first
 * attempt at this milestone's negative control renamed a `LICENSE` to `LICENSE.bak` and the build
 * happily kept going, because the control had defeated itself rather than the guard. */
function licenseTextsOf(pkgDir) {
  const files = readdirSync(pkgDir).filter((f) => /^licen[cs]e/i.test(f)).sort();
  return files.map((f) => ({ file: f, text: readFileSync(join(pkgDir, f), 'utf8').trim() }));
}

/**
 * Reads an esbuild metafile and returns one entry per inlined third-party package.
 *
 * `D-M92-2` — a package with no resolvable license file throws rather than being emitted as
 * "UNKNOWN". A generator that can silently omit an entry has the defect it was written to fix: the
 * output's whole value is that it is complete, and a partial one *looks* complete. If a future
 * dependency arrives without a license file, the build stops and a human decides.
 */
export function collectNotices(metafile) {
  const seen = new Map(); // name -> one input path, enough to locate the copy on disk
  for (const inputPath of Object.keys(metafile.inputs)) {
    const name = packageOf(inputPath);
    if (name && !seen.has(name)) seen.set(name, inputPath);
  }

  const notices = [];
  for (const [name, inputPath] of seen) {
    const pkgDir = packageDirOf(inputPath, name);
    const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
    const licenses = licenseTextsOf(pkgDir);
    if (licenses.length === 0) {
      throw new Error(
        `third-party-notices: \`${name}\` is inlined into the bundle but has no license file.\n` +
          `  Looked in ${pkgDir} (relative to the package being bundled) for a root entry matching /^licen[cs]e/i.\n` +
          `  Every bundled package's license must be redistributable text — see ` +
          `PLAN_M92_SHIP_SURFACE.md D-M92-2. Resolve it by hand before shipping.`,
      );
    }
    notices.push({ name, version: manifest.version, spdx: manifest.license ?? '(see text)', licenses });
  }
  return notices.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Renders the notice file.
 *
 * `D-M92-1` — the **full license text** is embedded, not a scraped copyright line. Two reasons, and
 * the second is why the shortcut was rejected outright:
 *
 *  1. MIT/ISC/BSD-3 require the copyright notice *and the permission notice*. A table of copyright
 *     lines discharges half the condition.
 *  2. It does not survive contact with the files. `minimatch`'s LICENSE.md opens its copyright as a
 *     markdown heading (`## Copyright`), so a `grep -i -m1 copyright` yields the literal string
 *     `## Copyright`. A scraper that is silently wrong on 1 of 21 packages is worse than none — it
 *     produces a notice file that reads as complete.
 */
export function renderNotices(productName, notices) {
  const families = [...new Set(notices.map((n) => n.spdx))].sort();
  const lines = [
    `# Third-party notices — ${productName}`,
    '',
    `\`${productName}\` is distributed as a single bundled artifact. The following ${notices.length} packages`,
    'are compiled into that artifact and redistributed with it. Their licenses are reproduced in',
    'full below, as those licenses require.',
    '',
    `License families present: ${families.map((f) => `\`${f}\``).join(', ')}.`,
    '',
    'This file is generated from the bundle\'s own esbuild metafile at build time',
    '(`scripts/third-party-notices.mjs`) — it describes what actually shipped, not what was declared.',
    '',
    '| package | version | license |',
    '|---|---|---|',
    ...notices.map((n) => `| \`${n.name}\` | ${n.version} | ${n.spdx} |`),
    '',
    '---',
    '',
  ];
  for (const n of notices) {
    lines.push(`## ${n.name}@${n.version}`, '');
    for (const l of n.licenses) {
      if (n.licenses.length > 1) lines.push(`### ${l.file}`, '');
      lines.push('```', l.text, '```', '');
    }
  }
  return lines.join('\n');
}
