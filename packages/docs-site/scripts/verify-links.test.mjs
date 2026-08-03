// The anchor guard, against a fixture site (M62, DT-08).
//
// The regression that matters is M65's: VitePress keeps the em-dash in a generated heading id, so
// a link written against the id a slugifier "obviously" produces silently misses. The fixture site
// therefore contains a real em-dash heading id — a check that only ever sees ASCII ids would pass
// while the site it guards was broken.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const SCRIPT = fileURLToPath(new URL('verify-links.mjs', import.meta.url));

/** A scratch site: `pages` are markdown sources, `built` are the rendered pages ids come from. */
async function guard(pages, built) {
  const root = await mkdtemp(join(tmpdir(), 'tflw-links-test-'));
  const dist = join(root, 'dist');
  try {
    for (const [name, body] of Object.entries(pages)) {
      if (name.includes('/')) await mkdir(join(root, name, '..'), { recursive: true });
      await writeFile(join(root, name), body, 'utf8');
    }
    for (const [name, body] of Object.entries(built ?? {})) {
      await mkdir(join(dist, name, '..'), { recursive: true });
      await writeFile(join(dist, name), body, 'utf8');
    }
    const env = { ...process.env, TFLW_DOCS_ROOT: root, TFLW_DOCS_DIST: dist, NO_COLOR: '1' };
    return await execFileAsync(process.execPath, [SCRIPT], { env })
      .then(({ stdout, stderr }) => ({ code: 0, stdout, stderr }))
      .catch((e) => ({ code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const BUILT = {
  'guide/ci.html': '<h2 id="junit-xml">junit.xml</h2><h2 id="evidence-levels-—-how-much-lands-in-the-report">Evidence levels — how much lands in the report</h2>',
  'index.html': '<h1 id="tflw">tflw</h1>',
};

test('a resolving anchor passes', async () => {
  const { code, stdout } = await guard({ 'index.md': 'See [junit](/guide/ci#junit-xml).\n' }, BUILT);
  assert.equal(code, 0, stdout);
  assert.match(stdout, /every internal anchor resolves/);
});

test('an em-dash heading id resolves — the exact shape M65 got wrong by hand', async () => {
  const link = 'See [evidence](/guide/ci#evidence-levels-—-how-much-lands-in-the-report).\n';
  assert.equal((await guard({ 'index.md': link }, BUILT)).code, 0);

  // The same link written as a slugifier that strips punctuation would produce it.
  const stripped = 'See [evidence](/guide/ci#evidence-levels-how-much-lands-in-the-report).\n';
  const bad = await guard({ 'index.md': stripped }, BUILT);
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /no heading with id/);
});

test('a stale anchor fails, with the page and line', async () => {
  const { code, stderr } = await guard({ 'index.md': 'line one\n\n[gone](/guide/ci#renamed-away)\n' }, BUILT);
  assert.equal(code, 1);
  assert.match(stderr, /index\.md:3/);
});

test('a link to a page that does not exist fails', async () => {
  const { code, stderr } = await guard({ 'index.md': '[x](/guide/nope#anything)\n' }, BUILT);
  assert.equal(code, 1);
  assert.match(stderr, /no such page/);
});

test('a raw href carrying the /tflw/ base is checked too — index.md writes its cards that way', async () => {
  const ok = await guard({ 'index.md': '<a href="/tflw/guide/ci#junit-xml">x</a>\n' }, BUILT);
  assert.equal(ok.code, 0, ok.stderr);
  const bad = await guard({ 'index.md': '<a href="/tflw/guide/ci#nope">x</a>\n' }, BUILT);
  assert.equal(bad.code, 1);
});

test('an external link is left alone', async () => {
  assert.equal((await guard({ 'index.md': '[gh](https://github.com/x/y#readme)\n' }, BUILT)).code, 0);
});

test('a same-page anchor resolves against its own page', async () => {
  const bad = await guard({ 'index.md': '[self](#not-here)\n' }, BUILT);
  assert.equal(bad.code, 1);
  const ok = await guard({ 'index.md': '[self](#tflw)\n' }, BUILT);
  assert.equal(ok.code, 0, ok.stderr);
});

test('no built site is a hard error naming the build command, never a silent skip', async () => {
  const { code, stderr } = await guard({ 'index.md': '[x](/guide/ci#junit-xml)\n' }, {});
  assert.equal(code, 1);
  assert.match(stderr, /npm run build -w @tflw\/docs-site/);
});
