// `M234` — the per-package floor gate, verified over ledgers whose defects are known.
//
// The gate itself is twenty lines of arithmetic, which is exactly the shape that ships untested and
// then turns out to have been answering a different question. Two of its properties are worth more
// than the arithmetic and neither is visible from reading it: that an **unpinned** package fails
// rather than defaulting to green (`D540` — an allow-list is the honest half, not a silencer), and
// that a floor naming a package the report has never heard of fails too (`M86`'s other direction: a
// pin nobody can reach describes a package that no longer exists under that name).
//
// The fixtures are lcov by hand, because lcov is the one input this tool has and a fixture built by
// running c8 would make the test depend on the coverage of the repository it is checking.

import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregate, check, packageOf } from './coverage-floors.mjs';

/** Two files in one package and one in another, with counters chosen so the percentages are exact. */
const LCOV = [
  'SF:packages/lang/src/a.ts', 'LF:100', 'LH:90', 'BRF:10', 'BRH:8', 'FNF:10', 'FNH:9', 'end_of_record',
  'SF:packages/lang/src/b.ts', 'LF:100', 'LH:80', 'BRF:10', 'BRH:9', 'FNF:10', 'FNH:10', 'end_of_record',
  'SF:packages/ui/src/c.tsx', 'LF:200', 'LH:100', 'BRF:20', 'BRH:5', 'FNF:50', 'FNH:10', 'end_of_record',
].join('\n');

test('a package is every file under packages/<name>, and a root script is its own directory', () => {
  assert.equal(packageOf('packages/lang/src/deep/x.ts'), 'packages/lang');
  assert.equal(packageOf('scripts/coverage-floors.mjs'), 'scripts');
});

test('the aggregate is lcov\'s own counters summed, not an average of averages', () => {
  const t = aggregate(LCOV);
  // 170 of 200 lines in lang — NOT (90% + 80%) / 2, which is the same number here by construction
  // and would not be if the two files were different sizes. The point is which arithmetic ran, so
  // the ui row is the witness: one file, no averaging to get wrong.
  assert.deepEqual(t.get('packages/lang'), { lines: [200, 170], branches: [20, 17], functions: [20, 19] });
  assert.deepEqual(t.get('packages/ui'), { lines: [200, 100], branches: [20, 5], functions: [50, 10] });
});

test('a package at or above its own pin passes, and one under it is named with its own number', () => {
  const floors = {
    'packages/lang': { lines: 85, branches: 85, functions: 95 },
    'packages/ui': { lines: 50, branches: 25, functions: 20 },
  };
  assert.deepEqual(check(aggregate(LCOV), floors).problems, []);

  const tighter = { ...floors, 'packages/ui': { lines: 50, branches: 25, functions: 21 } };
  const { problems } = check(aggregate(LCOV), tighter);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /packages\/ui functions 20\.00% is under its floor of 21%/);
});

test('a package with coverage and no floor FAILS — the property the whole file exists for', () => {
  // Written as its own test because it is the one a future edit is most likely to soften: the
  // tempting change is `if (floor === undefined) continue`, which is green forever and holds
  // nothing. A tenth package must not be able to arrive unmeasured.
  const { problems } = check(aggregate(LCOV), { 'packages/lang': { lines: 85, branches: 85, functions: 95 } });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /packages\/ui has coverage in the report and no floor/);
  assert.match(problems[0], /50\.00\/25\.00\/20\.00/, 'the refusal must carry the measurement, so the fix is to pin it and not to guess');
});

test('a floor naming a package the report never mentions FAILS, which is the other direction', () => {
  const floors = {
    'packages/lang': { lines: 85, branches: 85, functions: 95 },
    'packages/ui': { lines: 50, branches: 25, functions: 20 },
    'packages/gone': { lines: 90, branches: 90, functions: 90 },
  };
  const { problems } = check(aggregate(LCOV), floors);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /pins packages\/gone, which the report does not mention at all/);
});

test('a package with no branches at all is 100%, not a division by zero', () => {
  const t = aggregate(['SF:scripts/x.mjs', 'LF:10', 'LH:10', 'BRF:0', 'BRH:0', 'FNF:1', 'FNH:1', 'end_of_record'].join('\n'));
  const { problems } = check(t, { scripts: { lines: 100, branches: 100, functions: 100 } });
  assert.deepEqual(problems, [], 'a file with no branches must not be reported as 0% branch coverage');
});
