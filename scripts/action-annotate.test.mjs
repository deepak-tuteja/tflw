// `M252` `C` (`D1378`) — the Action's annotator against the `junit.xml` tflw writes.
//
// The fixture is the writer's own shape (`packages/reporter/src/junit.ts`): `classname` is the
// `.tflw` file, a failure is `<failure message="…">`, a pass is self-closing, a skip and a flaky
// pass carry a child that is not a failure. Escaping is the half worth a test: a message with a
// newline or a `%` that reached the log raw would end the annotation early or corrupt it.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { annotation, failures } from '../.github/action/annotate.mjs';

const SCRIPT = join(dirname(dirname(fileURLToPath(import.meta.url))), '.github', 'action', 'annotate.mjs');
const JUNIT = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="tflw" tests="4" failures="1">
  <testsuite name="tests/cart.tflw" tests="4" failures="1">
    <testcase name="adds a line" classname="tests/cart.tflw" time="0.120"/>
    <testcase name="totals &quot;two&quot; lines" classname="tests/cart.tflw" time="0.310">
      <failure message="expected 200, got 500&#10;50% of the body">expected</failure>
    </testcase>
    <testcase name="skipped" classname="tests/cart.tflw" time="0.000">
      <skipped message="not on staging"/>
    </testcase>
    <testcase name="flaky" classname="tests/cart.tflw" time="0.200">
      <system-out>flaky: passed after a retry</system-out>
    </testcase>
  </testsuite>
</testsuites>
`;

test('only the failing testcase is annotated, with its file joined onto the project directory', () => {
  const found = failures(JUNIT, 'e2e/shop');
  assert.deepEqual(found.map((f) => [f.file, f.name]), [['e2e/shop/tests/cart.tflw', 'totals "two" lines']]);
  assert.deepEqual(failures(JUNIT).map((f) => f.file), ['tests/cart.tflw'], 'the project at the repository root keeps the path as written');
  assert.equal(found[0].message, 'expected 200, got 500\n50% of the body', 'entities decoded, the numeric one included');
});

test('the annotation escapes what would end or corrupt a workflow command', () => {
  const line = annotation({ file: 'tests/a,b.tflw', name: 'x: y', message: 'one\n50% two' });
  assert.equal(line, '::error file=tests/a%2Cb.tflw,title=x%3A y::one%0A50%25 two');
});

test('the script prints one annotation per failure, and nothing is an error without a junit.xml', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tflw-annotate-'));
  try {
    writeFileSync(join(dir, 'junit.xml'), JUNIT);
    const out = execFileSync(process.execPath, [SCRIPT, join(dir, 'junit.xml'), '.'], { encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '' } });
    assert.equal(out.split('\n').filter((l) => l.startsWith('::error ')).length, 1);
    assert.match(out, /tflw: 1 failing test — see the annotations/);
    const none = execFileSync(process.execPath, [SCRIPT, join(dir, 'missing.xml')], { encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '' } });
    assert.match(none, /no .*missing\.xml to annotate from/, 'CONTROL — exit 0 and a sentence, not a second failure');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
