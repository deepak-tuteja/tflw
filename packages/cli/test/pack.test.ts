// Packaging verification (PLAN.md decision 43, M2.7): `tflw` is published as one self-contained,
// esbuild-bundled package — `@tflw/*` workspace deps must never appear in the published
// `dependencies` (they're inlined into dist/cli.cjs), and a consumer's `npm install` must never
// pull them in. This is the automated form of the "npm pack + install in a scratch dir" check
// decision 43 calls for.

import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer, type Server } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm, readdir, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — a plain .mjs build script with no type declarations, deliberately shared with
// `scripts/bundle.mjs` rather than reimplemented here (M92a).
import { collectNotices } from '../../../scripts/third-party-notices.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(here, '..');
const execFileAsync = promisify(execFile);

let scratchDir: string;
let tarballPath: string;

/** The environment a *publish* happens in, which is not necessarily the one the tests run in.
 *
 * `TFLW_BUNDLE_SOURCEMAP=1` (M86) makes `bundle.mjs` emit `.map` files so `npm run coverage` can
 * attribute the spawned bundle's lines back to `cli.ts`. `scripts/coverage.mjs` sets it for the
 * whole `npm test` tree — including this file, whose `npm pack` runs `prepack`, which re-runs
 * `bundle.mjs`, which emitted maps that `files: ["dist"]` then shipped. Under coverage the tarball
 * grew two members and this test failed; it was found by running it, having been argued away in a
 * comment claiming the gate made it impossible.
 *
 * The lesson is the boundary, not the variable: an ambient env var that changes the build must be
 * stripped by whatever builds the artifact that gets *published*, because publishing must not
 * depend on who happened to be watching. Strip the key rather than pass a fixed env, for the same
 * reason `envWithout` exists in `e2e.test.ts` — omitting an override means "inherit". */
function publishEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.TFLW_BUNDLE_SOURCEMAP;
  return env;
}

before(async () => {
  // `npm pack` runs `prepack` for us: rm -rf dist, rebuild @tflw/lang+runtime+reporter, then
  // esbuild-bundle src/cli.ts into one dist/cli.cjs.
  scratchDir = await mkdtemp(join(tmpdir(), 'tflw-pack-'));
  execFileSync('npm', ['pack', '--pack-destination', scratchDir], { cwd: cliRoot, stdio: 'pipe', env: publishEnv() });
  const entries = await readdir(scratchDir);
  const tgz = entries.find((f) => f.endsWith('.tgz'));
  if (!tgz) throw new Error('npm pack did not produce a .tgz in ' + scratchDir);
  tarballPath = join(scratchDir, tgz);
});

test('the published tarball contains dist/cli.cjs + dist/mtls-worker.cjs + package.json + README.md + LICENSE, with zero runtime dependencies', async () => {
  const { stdout } = await execFileAsync('tar', ['-tzf', tarballPath]);
  const files = stdout
    .trim()
    .split('\n')
    .map((f) => f.replace(/^package\//, ''))
    .sort();
  // `dist/mtls-worker.cjs` (M35c) — the isolated mTLS-dispatch child process, its own separate
  // esbuild output (bundle.mjs) specifically so `undici` (needed for its client-cert `Agent`) is
  // never imported by `dist/cli.cjs` itself (M35b: importing it, even unused, cripples this
  // process's own global `fetch()` by ~20x).
  assert.deepEqual(files, ['LICENSE', 'README.md', 'THIRD-PARTY-NOTICES.md', 'dist/cli.cjs', 'dist/mtls-worker.cjs', 'package.json']);

  // The other half of the same property, and the half a file list cannot express (M86). Excluding
  // `.map` files from the tarball is not by itself correct: a bundle built with source maps carries
  // a trailing `//# sourceMappingURL=cli.cjs.map`, so dropping the map leaves every consumer's
  // stack traces pointing at a file that was never published. Ship both or neither — this asserts
  // neither, which is what `files: ["dist"]` plus the list above already commits us to.
  for (const member of ['dist/cli.cjs', 'dist/mtls-worker.cjs']) {
    const { stdout: js } = await execFileAsync('tar', ['-xzOf', tarballPath, `package/${member}`], { maxBuffer: 32 * 1024 * 1024 });
    assert.doesNotMatch(js, /\/\/# sourceMappingURL=/, `${member} references a source map the tarball does not contain — it was built with TFLW_BUNDLE_SOURCEMAP set`);
  }

  const { stdout: pkgText } = await execFileAsync('tar', ['-xzOf', tarballPath, 'package/package.json']);
  const pkg = JSON.parse(pkgText) as { dependencies?: Record<string, string>; private?: boolean };
  assert.equal(pkg.dependencies, undefined, 'a published API-only tool should declare zero runtime dependencies (P#43)');
  assert.equal(pkg.private, undefined, '"private": true would make npm publish refuse outright (decision 74)');
});

test('the optional peer constraints that govern the runtime are the ones the tarball declares (M92b, review `B6-09`)', async () => {
  // `@tflw/runtime` has always declared `playwright`/`axe-core` as optional peers — and is
  // `"private": true` and bundled into `dist/cli.cjs`, so its package.json never reaches a consumer.
  // The constraint existed as documentation for this repo only. It now ships on `tflw` itself.
  //
  // npm gives no way to inherit a peer range, so the range lives in two files and this asserts they
  // are equal. Catching the drift rather than preventing it is the honest option when prevention
  // isn't available — and saying so is better than a comment asking people to remember.
  const runtimePkg = JSON.parse(await readFile(join(cliRoot, '..', 'runtime', 'package.json'), 'utf8')) as {
    peerDependencies: Record<string, string>;
    peerDependenciesMeta: Record<string, { optional?: boolean }>;
  };
  const { stdout: pkgText } = await execFileAsync('tar', ['-xzOf', tarballPath, 'package/package.json']);
  const shipped = JSON.parse(pkgText) as {
    peerDependencies?: Record<string, string>;
    peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  };

  assert.deepEqual(shipped.peerDependencies, runtimePkg.peerDependencies, 'the published peer ranges have drifted from @tflw/runtime, the package that actually imports them');
  assert.deepEqual(shipped.peerDependenciesMeta, runtimePkg.peerDependenciesMeta);
  // Optional is load-bearing, not decorative: a non-optional peer would make `npm install tflw`
  // fail (or auto-install ~200 MB of playwright) for the API-only user who is the majority case.
  for (const name of Object.keys(shipped.peerDependencies ?? {})) {
    assert.equal(shipped.peerDependenciesMeta?.[name]?.optional, true, `\`${name}\` must be an *optional* peer — a required one breaks every API-only install`);
  }
});

test('the tarball attributes every third-party package its own bundles inlined (M92a, review `B6-06`)', async () => {
  // The claim under test is *completeness*, not presence — a notice file that names eleven of
  // twelve packages reads exactly like a correct one. So the expected set is re-derived here from
  // the same esbuild metafile `bundle.mjs` generated the file from, via the same shared module.
  // Nothing is hardcoded: adding a dependency that reaches either bundle changes both sides at
  // once, and the test only fails when the *file* stops matching the *bundle*.
  //
  // What this can and cannot catch, established by running both controls rather than reasoning
  // about them: hand-editing the shipped file proves nothing, because `before()`'s `npm pack` runs
  // `prepack`, which regenerates it — a *stale* notice file is structurally impossible, which is
  // the whole argument for generating it. What remains possible is a renderer that silently drops
  // entries, and that is what fails here (verified: rendering `notices.slice(1)` fails this test
  // naming the dropped package). The tarball-member assertion above covers the other direction —
  // the file existing but never being packaged.
  const meta = JSON.parse(await readFile(join(cliRoot, '.bundle-meta.json'), 'utf8')) as { inputs: Record<string, unknown> };
  const expected = collectNotices(meta as never).map((n) => n.name);
  assert.ok(expected.length > 0, 'the metafile should report inlined packages — a zero here means the guard is measuring nothing');

  const { stdout: notices } = await execFileAsync('tar', ['-xzOf', tarballPath, 'package/THIRD-PARTY-NOTICES.md'], { maxBuffer: 4 * 1024 * 1024 });

  for (const name of expected) {
    assert.match(notices, new RegExp(`^## ${name.replace(/[/@.]/g, '\\$&')}@`, 'm'), `\`${name}\` is compiled into a shipped bundle but has no section in THIRD-PARTY-NOTICES.md`);
  }
  // The converse direction, so a stale entry for a package that has since left the bundle is caught
  // too — an over-broad notice is a smaller wrong than an incomplete one, but it is still the file
  // describing something other than what shipped.
  const sections = [...notices.matchAll(/^## (\S+)@/gm)].map((m) => m[1]);
  assert.deepEqual([...sections].sort(), [...expected].sort());

  // Full license *text*, not a scraped copyright line (`D-M92-1`): MIT and its relatives require
  // the permission notice as well as the notice of copyright, and `minimatch`'s license opens its
  // copyright as a markdown heading, so a line-scraper is silently wrong on real inputs.
  assert.match(notices, /Permission is hereby granted, free of charge/, 'the MIT permission notice must be reproduced, not summarized');
  assert.match(notices, /Copyright \(c\) Matteo Collina and Undici contributors/, "undici is the largest thing in the tarball; its copyright line is the canary for the file being generated at all");
});

test('installing the tarball into a fresh project pulls in no @tflw/* packages, and the binary runs end-to-end', async () => {
  const projectDir = join(scratchDir, 'consumer');
  await mkdir(projectDir, { recursive: true });
  await writeFile(join(projectDir, 'package.json'), JSON.stringify({ name: 'consumer', version: '0.0.0', private: true }), 'utf8');
  await execFileAsync('npm', ['install', tarballPath], { cwd: projectDir });

  await assert.rejects(access(join(projectDir, 'node_modules', '@tflw')), 'no @tflw/* package should ever be installed alongside tflw');
  await access(join(projectDir, 'node_modules', '.bin', 'tflw'));

  const server: Server = createServer((req, res) => {
    if (req.url === '/health') res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    else res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await writeFile(join(projectDir, 'tflw.config'), `env local default\n  api "${baseUrl}"\n`, 'utf8');
    await writeFile(join(projectDir, 'health.tflw'), `test "health check"\n  api GET /health\n  expect status equals 200\n`, 'utf8');

    const tflwBin = join(projectDir, 'node_modules', '.bin', 'tflw');
    const { stdout } = await execFileAsync(tflwBin, ['run', '--no-color'], { cwd: projectDir });
    assert.match(stdout, /1\/1 passed/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('`tflw init` scaffolds a working project from the installed binary', async () => {
  const projectDir = join(scratchDir, 'consumer'); // reuses the install from the previous test
  const tflwBin = join(projectDir, 'node_modules', '.bin', 'tflw');
  const initDir = join(scratchDir, 'init-target');
  await mkdir(initDir, { recursive: true });

  const { stdout } = await execFileAsync(tflwBin, ['init'], { cwd: initDir });
  assert.match(stdout, /created tflw\.config, example\.tflw, \.env\.example, package\.json, \.gitignore/);
  await access(join(initDir, 'tflw.config'));
  await access(join(initDir, 'example.tflw'));

  // Secrets hygiene from day one (decision 82): a tool whose flagship feature is "secrets never
  // leak into reports" shouldn't leave `.env` committable in its own quickstart.
  const envExample = await readFile(join(initDir, '.env.example'), 'utf8');
  assert.match(envExample, /API_TOKEN=/);
  const gitignore = await readFile(join(initDir, '.gitignore'), 'utf8');
  assert.match(gitignore, /^\.env$/m);
  assert.match(gitignore, /^report\/$/m);
});

after(async () => {
  await rm(scratchDir, { recursive: true, force: true });
});
