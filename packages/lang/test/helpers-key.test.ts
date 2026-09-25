// `TF083` and the `helpers` directive (`M239` `D`, `D1279`) — where a `use` may load from.
//
// The rule is textual: the checker resolves a `use` literal against the checked file's own
// directory, the way the runtime does, and asks whether the result sits inside a directory
// `tflw.config` allows. No filesystem here, so every case is a pair of strings and the tests can
// be exhaustive about the shapes that matter — the dogfood's `../../helpers/x.ts` from two levels
// down, a module beside the allowed directory whose name shares its prefix, and a path that
// climbs into the directory and back out.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, parseConfigSource, checkProgram, checkHelperDirs, normalizePosixPath, DEFAULT_HELPER_DIRS, Codes, type HelperPolicy } from '../src/index.js';

const program = (...uses: string[]) => parseSource(`${uses.map((u) => `use "${u}"`).join('\n')}\ntest "t"\n  api GET /health\n  expect status equals 200\n`).program;
const judge = (use: string, policy: HelperPolicy) => checkHelperDirs(program(use), { helpers: policy });
const defaults = (file: string): HelperPolicy => ({ dirs: DEFAULT_HELPER_DIRS, file });

test('`normalizePosixPath`: dots collapse, a climb above the root keeps its `..`, separators and empties fold', () => {
  assert.equal(normalizePosixPath('tests/api/../../helpers/x.ts'), 'helpers/x.ts');
  assert.equal(normalizePosixPath('./helpers/./x.ts'), 'helpers/x.ts');
  assert.equal(normalizePosixPath('../lib/x.ts'), '../lib/x.ts');
  assert.equal(normalizePosixPath('a/../../b'), '../b');
  assert.equal(normalizePosixPath('a//b/'), 'a/b');
  assert.equal(normalizePosixPath('.'), '');
});

test('a `use` inside an allowed directory passes — including the dogfood shape, two levels up into `helpers/`', () => {
  assert.deepEqual(judge('../../helpers/receipt.ts', defaults('tests/api/orders.tflw')), []);
  assert.deepEqual(judge('./helpers/x.ts', defaults('a.tflw')), []);
  assert.deepEqual(judge('./helpers/x.ts', defaults('tests/a.tflw')), [], '`tests/helpers` is the second default');
  assert.deepEqual(judge('./helpers/deep/er/x.ts', defaults('a.tflw')), [], 'a subdirectory of an allowed directory is inside it');
  assert.deepEqual(judge('../helpers/x.ts', { dirs: ['./helpers'], file: 'tests/a.tflw' }), []);
  assert.deepEqual(judge('./x.ts', { dirs: ['./helpers'], file: 'helpers/loader.tflw' }), [], 'a file inside the directory names a sibling');
});

test('a `use` that resolves outside every allowed directory is `TF083`, an error at the path, naming where it landed and how to allow it', () => {
  const [d, ...rest] = judge('../lib/sign.ts', defaults('tests/a.tflw'));
  assert.equal(rest.length, 0);
  assert.equal(d!.code, Codes.HELPER_OUTSIDE_DIRS);
  assert.equal(d!.code, 'TF083');
  assert.equal(d!.severity, 'error', 'this declaration decides what a run executes');
  assert.match(d!.message, /`use "\.\.\/lib\/sign\.ts"` loads a module outside the directories `helpers` allows/);
  assert.match(d!.message, /resolves to `lib\/sign\.ts`/);
  assert.match(d!.hint ?? '', /`\.\/helpers`, `\.\/tests\/helpers` \(the default when tflw\.config declares none\)/);
  assert.match(d!.hint ?? '', /helpers "\.\/lib"/, 'the repair names the directory the module is in');
  assert.equal(d!.span.start.line, 1);
  // The shapes a prefix check gets wrong, each refused:
  assert.equal(judge('./helpersx/x.ts', defaults('a.tflw')).length, 1, 'a directory whose name merely starts with an allowed one');
  assert.equal(judge('./helpers/../lib/x.ts', defaults('a.tflw')).length, 1, 'in and back out');
  assert.equal(judge('../../etc/x.ts', defaults('a.tflw')).length, 1, 'above the project');
  assert.match(judge('../../etc/x.ts', defaults('a.tflw'))[0]!.message, /resolves to `\.\.\/\.\.\/etc\/x\.ts`/);
  assert.match(judge('./root.ts', defaults('a.tflw'))[0]!.hint ?? '', /helpers "\."/, 'a module at the root is allowed by `helpers "."`, not `"./."`');
  // Every `use` is judged, not the first.
  assert.equal(checkHelperDirs(program('../lib/a.ts', './helpers/b.ts', '../lib/c.ts'), { helpers: defaults('tests/a.tflw') }).length, 2);
});

test('declared directories replace the defaults rather than adding to them, and the hint stops calling them the default', () => {
  const lib: HelperPolicy = { dirs: ['./lib'], file: 'a.tflw' };
  assert.equal(judge('./helpers/x.ts', lib).length, 1, '`./helpers` is not allowed once the file declares something else');
  assert.deepEqual(judge('./lib/x.ts', lib), []);
  assert.doesNotMatch(judge('./helpers/x.ts', lib)[0]!.hint ?? '', /the default/);
  assert.match(judge('./helpers/x.ts', lib)[0]!.hint ?? '', /`helpers` allows `\.\/lib`/);
});

test('`refuseAll` — `tflw run --no-helpers` — reports every `use` and names the flag, whatever the directories say', () => {
  const diags = checkHelperDirs(program('./helpers/a.ts', './helpers/b.ts'), { helpers: { dirs: DEFAULT_HELPER_DIRS, file: 'a.tflw', refuseAll: true } });
  assert.equal(diags.length, 2);
  for (const d of diags) {
    assert.equal(d.code, 'TF083');
    assert.match(d.message, /refused: this run was started with `--no-helpers`/);
    assert.match(d.hint ?? '', /drop the flag/);
  }
});

test('no policy, no pass — a caller that cannot read the config says nothing rather than guessing, and a file with no `use` costs nothing', () => {
  assert.deepEqual(checkProgram(program('../../../anything.ts')).filter((d) => d.code === 'TF083'), []);
  assert.deepEqual(checkHelperDirs(parseSource('test "t"\n  api GET /x\n').program, { helpers: { dirs: [], file: 'a.tflw' } }), []);
  // …and through `checkProgram`, the pass is wired: the same policy reaches `TF083`.
  assert.equal(checkProgram(program('../lib/x.ts'), { helpers: defaults('tests/a.tflw') }).filter((d) => d.code === 'TF083').length, 1);
});

test('the parser: `helpers` is a top-level directive with string paths, and the field is absent — not empty — when a config declares none', () => {
  const declared = parseConfigSource('helpers "./lib", "./shared/tflw"\nenv local default\n  api "http://127.0.0.1:1"\n');
  assert.deepEqual(declared.diagnostics, []);
  assert.deepEqual(declared.config.helpers?.map((h) => h.paths.map((p) => p.value)), [['./lib', './shared/tflw']]);
  const twice = parseConfigSource('helpers "./a"\nhelpers "./b"\nenv local default\n  api "http://127.0.0.1:1"\n');
  assert.equal(twice.config.helpers?.length, 2, 'two lines are two declarations, and the runtime flattens them');
  const none = parseConfigSource('env local default\n  api "http://127.0.0.1:1"\n');
  assert.equal('helpers' in none.config, false, 'absent-when-empty, for the goldens (`ConfigFile.helpers`)');
  const bare = parseConfigSource('helpers lib\nenv local default\n  api "http://127.0.0.1:1"\n');
  assert.ok(bare.diagnostics.some((d) => /directory string/.test(d.message)), 'a bare name is refused with the string form named');
});
