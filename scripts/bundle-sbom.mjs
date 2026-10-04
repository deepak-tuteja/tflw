#!/usr/bin/env node
// `M268` `C2` (`D1450`) — the SBOM lists what ships.
//
// CI used to publish `npm sbom --omit=dev` as the `sbom` artefact, commented "the same tree the
// audit reads" — and it was, which was the problem: that tree is the workspace's runtime-declared
// packages, and the CLI declares none, because esbuild inlines them. So the published bill of
// materials left out `ajv`, `fast-uri`, `undici` and the rest — every third-party component a user
// actually runs. This writes CycloneDX from the bundles' own list (`scripts/shipped-packages.mjs`,
// the module the advisory gate reads), one component per inlined name@version with the bundle(s)
// that carry it, plus the tarball's declared peers as external, optional components.
//
// Usage:  node scripts/bundle-sbom.mjs [--out sbom.cdx.json]   — write it, then read it back and
//         hold its components equal to the bundle list; exits 1 on any difference.
//         node scripts/bundle-sbom.mjs --self-test
//
// The read-back is the gate (`D1450`'s "the two cannot drift"): it compares the FILE, not the
// object this process built, so a writer that drops or invents a component is caught by the same
// run that wrote it.

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptyArtifacts, purlOf, shippedPackages } from './shipped-packages.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BUNDLE_PROP = 'tflw:bundle';
// A peer is named with its declared range, not a version: the user installs it. CycloneDX 1.6 has no
// field for a range (`versionRange`/`isExternal` arrived in 1.7, and validating the first draft
// against the 1.6 schema is what said so), so the range rides as a property and `version` is
// omitted, which 1.6 allows.
const PEER_PROP = 'tflw:peer-range';

/** A license field as CycloneDX takes it. Every value is written as an SPDX `expression`, which the
 * schema accepts for a single identifier as well as a compound one; a package with no license field
 * points at the notice file, which carries its text. */
function licensesOf(license) {
  if (typeof license === 'string' && license.trim()) return [{ expression: license.trim() }];
  return [{ license: { name: 'see THIRD-PARTY-NOTICES.md' } }];
}

/** The document. `peers` is the tarball's `peerDependencies`; `product` its name and version. */
export function buildSbom(packages, { product, peers }) {
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    serialNumber: `urn:uuid:${randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: { components: [{ type: 'application', name: 'tflw scripts/bundle-sbom.mjs' }] },
      component: { type: 'application', 'bom-ref': purlOf(product.name, product.version), name: product.name, version: product.version, purl: purlOf(product.name, product.version) },
    },
    components: [
      ...packages.map((p) => ({
        type: 'library',
        'bom-ref': p.purl,
        name: p.name,
        version: p.version,
        scope: 'required',
        purl: p.purl,
        licenses: licensesOf(p.license),
        properties: p.where.map((w) => ({ name: BUNDLE_PROP, value: w.bundle })),
      })),
      ...Object.entries(peers).sort(([a], [b]) => a.localeCompare(b)).map(([name, range]) => ({
        type: 'library',
        'bom-ref': `pkg:npm/${name.replace(/^@/, '%40')}?peer`,
        name,
        scope: 'optional',
        properties: [{ name: PEER_PROP, value: range }],
        description: 'a peer dependency of the tflw tarball: installed by the user, never bundled',
      })),
    ],
  };
}

/** Every way the document can disagree with the bundle list and the declared peers. */
export function compareSbom(doc, packages, peers) {
  const problems = [];
  if (doc?.bomFormat !== 'CycloneDX') problems.push('not a CycloneDX document');
  const comps = Array.isArray(doc?.components) ? doc.components : [];
  const isPeer = (c) => (c.properties ?? []).some((x) => x.name === PEER_PROP);
  const inlined = comps.filter((c) => !isPeer(c));
  const external = comps.filter(isPeer);

  const want = new Map(packages.map((p) => [p.purl, p]));
  const have = new Map(inlined.map((c) => [c.purl, c]));
  for (const [purl] of want) if (!have.has(purl)) problems.push(`${purl} is inlined into a bundle and missing from the SBOM`);
  for (const [purl] of have) if (!want.has(purl)) problems.push(`${purl} is in the SBOM and in no bundle`);
  for (const [purl, p] of want) {
    const c = have.get(purl);
    if (!c) continue;
    const a = (c.properties ?? []).filter((x) => x.name === BUNDLE_PROP).map((x) => x.value).sort();
    const b = p.where.map((w) => w.bundle).sort();
    if (JSON.stringify(a) !== JSON.stringify(b)) problems.push(`${purl} names bundles ${JSON.stringify(a)}, the metafiles say ${JSON.stringify(b)}`);
    if (c.name !== p.name || c.version !== p.version) problems.push(`${purl} carries name/version ${c.name}@${c.version}`);
  }
  const peerWant = Object.entries(peers).map(([n, r]) => `${n} ${r}`).sort();
  const peerHave = external.map((c) => `${c.name} ${c.properties.find((x) => x.name === PEER_PROP).value}`).sort();
  if (JSON.stringify(peerWant) !== JSON.stringify(peerHave)) problems.push(`external components ${JSON.stringify(peerHave)} are not the tarball's peers ${JSON.stringify(peerWant)}`);
  if (packages.length === 0) problems.push('the bundle list is empty — the metafiles measured nothing');
  return problems;
}

function cliManifest() {
  return JSON.parse(readFileSync(join(ROOT, 'packages/cli/package.json'), 'utf8'));
}

// ---------------------------------------------------------------------------------------------------

function selfTest() {
  const packages = [
    { name: 'ajv', version: '8.20.0', license: 'MIT', purl: purlOf('ajv', '8.20.0'), where: [{ artifact: 'tarball', bundle: 'packages/cli/dist/cli.cjs' }] },
    { name: '@codemirror/view', version: '6.43.13', license: 'MIT', purl: purlOf('@codemirror/view', '6.43.13'), where: [{ artifact: 'tarball', bundle: 'packages/cli/dist/ui/' }] },
    { name: 'minimatch', version: '10.2.6', license: 'BlueOak-1.0.0', purl: purlOf('minimatch', '10.2.6'), where: [{ artifact: 'vsix', bundle: 'packages/vscode/dist/extension.cjs' }] },
  ];
  const peers = { playwright: '>=1.40.0', 'axe-core': '>=4.0.0' };
  const fresh = () => JSON.parse(JSON.stringify(buildSbom(packages, { product: { name: 'tflw', version: '0.1.0' }, peers })));
  const cases = [
    ['the document written from the list matches the list', () => compareSbom(fresh(), packages, peers).length === 0],
    ['a package dropped from the SBOM fails, naming it', () => {
      const d = fresh(); d.components = d.components.filter((c) => c.name !== 'ajv');
      return compareSbom(d, packages, peers).some((p) => p.includes('pkg:npm/ajv@8.20.0') && p.includes('missing'));
    }],
    ['a component in no bundle fails', () => {
      const d = fresh(); d.components.push({ type: 'library', name: 'lodash', version: '4.17.21', purl: purlOf('lodash', '4.17.21') });
      return compareSbom(d, packages, peers).some((p) => p.includes('lodash'));
    }],
    ['a component naming the wrong bundle fails', () => {
      const d = fresh(); d.components.find((c) => c.name === 'ajv').properties = [{ name: BUNDLE_PROP, value: 'packages/cli/dist/mtls-worker.cjs' }];
      return compareSbom(d, packages, peers).some((p) => p.includes('ajv') && p.includes('bundles'));
    }],
    ['a peer range rewritten in the SBOM fails', () => {
      const d = fresh(); d.components.find((c) => c.name === 'axe-core').properties = [{ name: PEER_PROP, value: '^4.13.0' }];
      return compareSbom(d, packages, peers).some((p) => p.includes('peers'));
    }],
    ['an empty bundle list fails even against an empty SBOM', () => {
      const d = buildSbom([], { product: { name: 'tflw', version: '0.1.0' }, peers: {} });
      return compareSbom(d, [], {}).length > 0;
    }],
    ['a scoped name is percent-encoded in its purl', () => purlOf('@codemirror/view', '6.43.13') === 'pkg:npm/%40codemirror/view@6.43.13'],
  ];
  let bad = 0;
  for (const [name, fn] of cases) {
    let ok = false;
    try { ok = fn(); } catch (e) { console.error(`    threw: ${e.message}`); }
    console.log(`  ${ok ? '✓' : '✗'} ${name}`);
    if (!ok) bad++;
  }
  console.log(bad === 0 ? `\n✓ ${cases.length} controls pass.` : `\n✗ ${bad} of ${cases.length} controls failed.`);
  return bad === 0 ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--self-test')) process.exit(selfTest());
  const at = process.argv.indexOf('--out');
  const out = at === -1 ? join(ROOT, 'sbom.cdx.json') : process.argv[at + 1];
  let packages;
  try {
    packages = shippedPackages(ROOT);
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }
  const empty = emptyArtifacts(packages);
  if (empty.length > 0) {
    console.error(`✗ ${empty.map((a) => a.label).join(' and ')} inlines no third-party package by its metafile — an SBOM written from that would be a metafile measuring nothing.`);
    process.exit(1);
  }
  const manifest = cliManifest();
  const peers = manifest.peerDependencies ?? {};
  writeFileSync(out, `${JSON.stringify(buildSbom(packages, { product: { name: manifest.name, version: manifest.version }, peers }), null, 2)}\n`);
  const problems = compareSbom(JSON.parse(readFileSync(out, 'utf8')), packages, peers);
  if (problems.length > 0) {
    console.error(`✗ ${out} does not describe what ships:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    process.exit(1);
  }
  const byArtifact = (id) => packages.filter((p) => p.where.some((w) => w.artifact === id)).length;
  console.log(`✓ ${out}: ${packages.length} inlined components (${byArtifact('tarball')} in the tarball, ${byArtifact('vsix')} in the .vsix) and ${Object.keys(peers).length} peers, equal to the bundles' metafiles.`);
}
