// `M242` `B` (`D1327`) — `--tag` as a selection: plain tags include and OR together, `!`-tags exclude
// and AND together, so a job's "not this" lives on the command line and never as a `skip` in a file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tagsKeep } from '../src/run-flags.js';

test('includes are an OR, as `--tag` always was', () => {
  assert.equal(tagsKeep(['smoke', 'api'], ['api']), true);
  assert.equal(tagsKeep(['smoke', 'api'], ['ui']), false);
  assert.equal(tagsKeep(undefined, []), true, 'no `--tag` keeps everything');
});

test('exclusions are an AND, and only-exclusions means everything less those', () => {
  assert.equal(tagsKeep(['!slow'], ['api']), true);
  assert.equal(tagsKeep(['!slow'], ['api', 'slow']), false);
  assert.equal(tagsKeep(['!slow', '!flaky'], ['flaky']), false);
  assert.equal(tagsKeep(['!slow', '!flaky'], []), true);
});

test('an exclusion beats an inclusion on the same test', () => {
  assert.equal(tagsKeep(['smoke', '!slow'], ['smoke', 'slow']), false);
  assert.equal(tagsKeep(['smoke', '!slow'], ['smoke']), true);
});
