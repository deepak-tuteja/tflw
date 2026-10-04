// `M268` `C` (`D1447`, `D1450`) — the third-party packages tflw ships, read off the bundles.
//
// The CLI declares no `dependencies`: esbuild inlines them into `dist/cli.cjs`, `dist/mtls-worker.cjs`
// and the page under `dist/ui/`, and the extension does the same into `dist/extension.cjs`. So no
// tree `npm` can read is the shipped set — `npm audit --omit=dev` was green while `fast-uri` 3.1.7,
// with a moderate advisory, sat inside `dist/cli.cjs`. The set that IS shipped is in each bundle's
// metafile, which the build already writes as `.bundle-meta.json` for the notice file and
// `pack.test.ts`. This module is the one reader of those files for everything that needs the set —
// the advisory gate and the SBOM — so the two can never describe different lists.
//
// Attribution is `third-party-notices.mjs`'s own `packageOf`/`packageDirOf`, not a second copy: one
// rule for "which package is this input", and the notice, the audit and the SBOM all follow it. One
// difference, deliberate: a package is keyed by the DIRECTORY it was inlined from, not by its name,
// because npm nests a second copy when two dependents disagree on a version — and an audit that
// kept the first copy it met would never ask about the second.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { packageDirOf, packageOf } from './third-party-notices.mjs';

/** The two artifacts a user installs, and the package whose build writes each one's metafile. */
export const ARTIFACTS = [
  { id: 'tarball', label: 'the tflw npm tarball', pkg: 'packages/cli' },
  { id: 'vsix', label: 'the .vsix', pkg: 'packages/vscode' },
];

/** One artifact's `.bundle-meta.json`, or a thrown reason it cannot be read. A missing file means
 * "not built", never "nothing ships" — the caller must not be able to read absence as clean. */
export function readBundleMeta(root, artifact) {
  const path = join(root, artifact.pkg, '.bundle-meta.json');
  if (!existsSync(path)) {
    throw new Error(`${artifact.pkg}/.bundle-meta.json does not exist — run \`npm run build\` first; ${artifact.label} has not been built.`);
  }
  const meta = JSON.parse(readFileSync(path, 'utf8'));
  if (!meta.bundles || typeof meta.bundles !== 'object') {
    throw new Error(`${artifact.pkg}/.bundle-meta.json has no \`bundles\` map — it was written by a build older than M268; run \`npm run build\` again.`);
  }
  return meta;
}

/** `pkg:npm/...` — a scoped name's `@` is percent-encoded, as the purl spec requires. */
export function purlOf(name, version) {
  return `pkg:npm/${name.replace(/^@/, '%40')}@${version}`;
}

/**
 * Every third-party package inlined into any bundle of any artifact, one entry per name@version:
 * `{ name, version, license, purl, where: [{ artifact, bundle }] }`, sorted by name then version.
 *
 * `metas` lets a caller (the self-tests) hand in metafiles directly, keyed by artifact id; each
 * input path is resolved against the artifact's package directory, which is where esbuild's
 * relative keys are rooted (`absWorkingDir: pkgRoot` in both bundle scripts). The page's keys are
 * already absolute, and `resolve` leaves those alone. `readManifest` is the same seam for the
 * package.json read.
 */
export function shippedPackages(root, { metas, readManifest = (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) } = {}) {
  const byKey = new Map();
  for (const artifact of ARTIFACTS) {
    const meta = metas ? metas[artifact.id] : readBundleMeta(root, artifact);
    if (!meta) throw new Error(`no metafile for ${artifact.label}`);
    for (const [bundle, inputs] of Object.entries(meta.bundles)) {
      const dirs = new Map();
      for (const input of inputs) {
        const name = packageOf(input);
        if (!name) continue;
        const dir = packageDirOf(resolve(root, artifact.pkg, input).split('\\').join('/'), name);
        if (!dirs.has(dir)) dirs.set(dir, name);
      }
      for (const [dir, name] of dirs) {
        const manifest = readManifest(dir);
        const key = `${name}@${manifest.version}`;
        if (!byKey.has(key)) {
          byKey.set(key, { name, version: manifest.version, license: manifest.license ?? null, purl: purlOf(name, manifest.version), where: [] });
        }
        const entry = byKey.get(key);
        if (!entry.where.some((w) => w.artifact === artifact.id && w.bundle === bundle)) {
          entry.where.push({ artifact: artifact.id, bundle: `${artifact.pkg}/${bundle}` });
        }
      }
    }
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

/** The artifacts that came out empty. Each artifact inlines third-party code today (the CLI an
 * HTTP client and a schema validator, the extension the LSP client), so an artifact with none is a
 * metafile that measured nothing — the state in which every check downstream is vacuously green. */
export function emptyArtifacts(packages) {
  return ARTIFACTS.filter((a) => !packages.some((p) => p.where.some((w) => w.artifact === a.id)));
}
