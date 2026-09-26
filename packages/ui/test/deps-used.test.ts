// `M241` `E` (`D1325`) — the milestone's green condition: no dependency this package declares is
// imported zero times. The review found three CodeMirror packages and `@tanstack/react-virtual`
// declared since `M192` and used by nothing — a dependency is a licence, an audit surface and bytes
// in every install, and one nobody imports is all three for no reason.
//
// A package is used when a source file imports it (`from 'x'`, `from 'x/…'`, `import 'x…'`) or a
// stylesheet reaches into it (`url('x/…')`, which is how the fonts are loaded).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('every dependency the page declares is imported by its source', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
  const src = join(root, 'src');
  const text = readdirSync(src)
    .filter((f) => /\.(tsx?|css)$/.test(f))
    .map((f) => readFileSync(join(src, f), 'utf8'))
    .join('\n');
  const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const unused = Object.keys(pkg.dependencies).filter((name) => {
    const n = escape(name);
    return !new RegExp(`(from\\s+|import\\s+|url\\()['"]${n}(/[^'"]*)?['"]`).test(text);
  });
  assert.ok(Object.keys(pkg.dependencies).length > 5, 'the walk read a package with dependencies');
  assert.deepEqual(unused, [], `declared and imported by nothing: ${unused.join(', ')}`);
});
