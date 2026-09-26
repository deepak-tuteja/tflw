// `M242` `E` (`D1330`) — `--shard i/n`: the shards of one `n` are disjoint and together the whole
// list, whatever the list's length, and a malformed value is refused by name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inShard, parseShard } from '../src/run-flags.js';

test('for every n up to 7 and every list up to 20 files, the shards partition the list', () => {
  for (let n = 1; n <= 7; n++) {
    for (let files = 0; files <= 20; files++) {
      const owners = Array.from({ length: files }, (_, k) => {
        const mine = Array.from({ length: n }, (_, i) => i + 1).filter((i) => inShard(k, { index: i, count: n }));
        return mine;
      });
      assert.ok(owners.every((o) => o.length === 1), `n=${n}, ${files} files: each file in exactly one shard`);
    }
  }
});

test('round-robin, so neighbours in the sorted list land in different shards', () => {
  const shardOf = (k: number) => [1, 2, 3].find((i) => inShard(k, { index: i, count: 3 }));
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(shardOf), [1, 2, 3, 1, 2, 3]);
});

test('the value is `i/n` with 1 <= i <= n, and anything else says what it should be', () => {
  assert.deepEqual(parseShard('2/4'), { index: 2, count: 4 });
  assert.deepEqual(parseShard(' 1/1 '), { index: 1, count: 1 });
  for (const [raw, says] of [['2', /takes `i\/n`/], ['0/3', /i counts from 1 to n/], ['4/3', /i counts from 1 to n/], ['1/0', /n is at least 1/], ['a/b', /takes `i\/n`/]] as const) {
    const r = parseShard(raw);
    assert.equal(typeof r, 'string', raw);
    assert.match(r as string, says);
  }
});
