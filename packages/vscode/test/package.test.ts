// The `.vsix` ship surface (M92a, review `B6-16`).
//
// `vsce package` builds from this package.json's `files` array, so an entry that names a file
// nobody generates ships nothing and says nothing — which is how the extension came to carry 952 KB
// of bundled third-party code beside one LICENSE naming one person. These tests assert the two
// properties a file list cannot state about itself: every declared entry actually exists after a
// build, and the attribution file is complete with respect to the bundle it describes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — a plain .mjs build script with no type declarations, shared with
// `scripts/bundle.mjs` rather than reimplemented here.
import { collectNotices } from '../../../scripts/third-party-notices.mjs';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

async function manifest(): Promise<{ files: string[]; icon?: string }> {
  return JSON.parse(await readFile(join(pkgRoot, 'package.json'), 'utf8')) as { files: string[]; icon?: string };
}

test('every entry in the extension\'s `files` list exists after a build', async () => {
  const { files, icon } = await manifest();
  for (const entry of files) {
    await access(join(pkgRoot, entry)).catch(() => {
      assert.fail(`package.json lists \`${entry}\` in "files", but it does not exist — \`vsce package\` would silently ship a .vsix without it`);
    });
  }
  // `icon` is a separate field from `files`, and both have to be right: the icon must exist *and*
  // be listed, or the Marketplace listing falls back to a default placeholder. Filed as missing in
  // `FU-28`; it is present, and this is what keeps it that way.
  assert.ok(icon, 'the extension declares no icon');
  assert.ok(files.includes(icon), `\`${icon}\` is declared as the icon but is not in "files"`);
});

test('the extension ships a README — the Marketplace renders it as the entire detail page (M92c, `FU-28`)', async () => {
  const { files } = await manifest();
  assert.ok(files.includes('README.md'), 'README.md must be in "files" or `vsce package` leaves it out');
  const readme = await readFile(join(pkgRoot, 'README.md'), 'utf8');

  // Not a length check dressed up as a content check: the Marketplace page is the extension's only
  // first impression, and an extension introducing a DSL nobody has seen needs to show the DSL and
  // say what to install. Both were absent — there was no README at all.
  assert.match(readme, /```tflw/, 'the page must show the language it exists for');
  assert.match(readme, /npm install -D tflw/, 'the page must say what to install for the extension to do anything');

  // The claims are checkable against the manifest, so they are checked — this milestone closes a
  // cluster about surfaces overselling, and the first draft of this file claimed a workload snippet
  // that does not exist.
  const snippets = JSON.parse(await readFile(join(pkgRoot, 'snippets', 'tflw.json'), 'utf8')) as Record<string, unknown>;
  for (const name of Object.keys(snippets)) {
    const noun = name.toLowerCase().replace(/ hook$/, '').replace(/ table$/, '');
    assert.match(readme.toLowerCase(), new RegExp(noun.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `the README's snippet list omits \`${name}\``);
  }
});

// -- M136b (D427a): the manifest half of the language-id split ------------------------------
//
// The `tflw.config` dialect got its own language id so it could get its own grammar. Six sites in
// this package and `extension.ts` name a language id; the two `D427` did not know about are both
// here, and both fail *silently* — the extension simply does nothing and reports nothing. These are
// written as properties over `contributes`, not as `includes('tflw-config')` assertions, so they
// also hold for the next language id somebody adds without reading this comment.

interface Contributes {
  languages: { id: string }[];
  grammars: { language: string; scopeName: string; path: string }[];
  semanticTokenScopes: { language: string }[];
}

async function contributes(): Promise<{ activationEvents: string[]; contributes: Contributes }> {
  return JSON.parse(await readFile(join(pkgRoot, 'package.json'), 'utf8')) as { activationEvents: string[]; contributes: Contributes };
}

test('every contributed language has an `onLanguage:` activation event (M136b, D427a)', async () => {
  // The failure this exists for: `tflw.config` used to carry the `tflw` id, so `onLanguage:tflw`
  // activated the extension for it. The moment the id split, a user whose only open document is a
  // `tflw.config` — an entirely ordinary thing, it is the file you open to add a service — would
  // have got no extension at all: no diagnostics, no completion, no hover, and no error to say why.
  const { activationEvents, contributes: c } = await contributes();
  for (const { id } of c.languages) {
    assert.ok(
      activationEvents.includes(`onLanguage:${id}`),
      `language \`${id}\` is contributed but nothing activates the extension for it — a buffer in that language would get no extension at all, silently`,
    );
  }
});

test('every contributed language has a grammar and a semantic-token scope map (M136b, D427a)', async () => {
  // A language id with no grammar renders as plain text; one with no `semanticTokenScopes` entry
  // drops every semantic token the server sends, which would make this whole milestone a no-op in
  // exactly the buffer it is for. Neither produces an error anywhere.
  const { contributes: c } = await contributes();
  for (const { id } of c.languages) {
    assert.ok(c.grammars.some((g) => g.language === id), `language \`${id}\` has no grammar — its buffers render unhighlighted`);
    assert.ok(
      c.semanticTokenScopes.some((s) => s.language === id),
      `language \`${id}\` has no semanticTokenScopes entry — the LSP's semantic tokens would arrive and be discarded`,
    );
  }
});

test('every contributed grammar file exists and declares the scopeName the manifest claims (M136b, D427a)', async () => {
  const { contributes: c } = await contributes();
  for (const g of c.grammars) {
    const raw = await readFile(join(pkgRoot, g.path), 'utf8');
    const parsed = JSON.parse(raw) as { scopeName: string };
    assert.equal(parsed.scopeName, g.scopeName, `${g.path} declares scopeName \`${parsed.scopeName}\`, but the manifest binds it as \`${g.scopeName}\``);
  }
});

test('the .vsix attributes every third-party package its bundle inlined (M92a, review `B6-16`)', async () => {
  const meta = JSON.parse(await readFile(join(pkgRoot, '.bundle-meta.json'), 'utf8')) as { inputs: Record<string, unknown> };
  const expected = (collectNotices(meta) as { name: string }[]).map((n) => n.name);
  assert.ok(expected.length > 0, 'the metafile reports no inlined packages — the guard would pass vacuously');

  const notices = await readFile(join(pkgRoot, 'THIRD-PARTY-NOTICES.md'), 'utf8');
  const sections = [...notices.matchAll(/^## (\S+)@/gm)].map((m) => m[1]);
  assert.deepEqual([...sections].sort(), [...expected].sort());

  // BlueOak-1.0.0 (`minimatch`, transitive through `vscode-languageclient`) is a license family the
  // npm tarball does not contain at all — the reason each artifact generates its own notice file
  // rather than sharing one written for the repo.
  assert.match(notices, /Blue Oak Model License/, 'minimatch ships under BlueOak-1.0.0; its text must be reproduced');
});
