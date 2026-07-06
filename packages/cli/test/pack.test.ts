// Packaging verification (PLAN.md decision 43, M2.7): `tflw` is published as one self-contained,
// esbuild-bundled package — `@tflw/*` workspace deps must never appear in the published
// `dependencies` (they're inlined into dist/cli.js), and a consumer's `npm install` must never
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

const here = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(here, '..');
const execFileAsync = promisify(execFile);

let scratchDir: string;
let tarballPath: string;

before(async () => {
  // `npm pack` runs `prepack` for us: rm -rf dist, rebuild @tflw/lang+runtime+reporter, then
  // esbuild-bundle src/cli.ts into one dist/cli.js.
  scratchDir = await mkdtemp(join(tmpdir(), 'tflw-pack-'));
  execFileSync('npm', ['pack', '--pack-destination', scratchDir], { cwd: cliRoot, stdio: 'pipe' });
  const entries = await readdir(scratchDir);
  const tgz = entries.find((f) => f.endsWith('.tgz'));
  if (!tgz) throw new Error('npm pack did not produce a .tgz in ' + scratchDir);
  tarballPath = join(scratchDir, tgz);
});

test('the published tarball contains dist/cli.js + package.json + README.md + LICENSE, with zero runtime dependencies', async () => {
  const { stdout } = await execFileAsync('tar', ['-tzf', tarballPath]);
  const files = stdout
    .trim()
    .split('\n')
    .map((f) => f.replace(/^package\//, ''))
    .sort();
  assert.deepEqual(files, ['LICENSE', 'README.md', 'dist/cli.js', 'package.json']);

  const { stdout: pkgText } = await execFileAsync('tar', ['-xzOf', tarballPath, 'package/package.json']);
  const pkg = JSON.parse(pkgText) as { dependencies?: Record<string, string>; private?: boolean };
  assert.equal(pkg.dependencies, undefined, 'a published API-only tool should declare zero runtime dependencies (P#43)');
  assert.equal(pkg.private, undefined, '"private": true would make npm publish refuse outright (decision 74)');
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
  assert.match(stdout, /created tflw\.config, example\.tflw, \.env\.example, \.gitignore/);
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
