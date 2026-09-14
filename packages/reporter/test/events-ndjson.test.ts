// PLAN decision 111 (M17): report/events.ndjson is the permanent-artifact half of `--format
// ndjson` — one JSON.stringify'd RunEvent per line.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunEvent } from '@tflw/runtime';
import { writeEventsNdjson } from '../src/events-ndjson.js';

test('writeEventsNdjson writes one JSON object per line, in order', async () => {
  const events: RunEvent[] = [
    { type: 'run:start', total: 1, env: 'local', file: 'a.tflw' },
    { type: 'test:start', name: 'health check', file: 'a.tflw' },
  ];
  const dir = await mkdtemp(join(tmpdir(), 'tflw-events-ndjson-'));
  try {
    const path = await writeEventsNdjson(events, dir);
    const text = await readFile(path, 'utf8');
    const lines = text.trim().split('\n');
    assert.equal(lines.length, 2);
    assert.deepEqual(JSON.parse(lines[0]!), events[0]);
    assert.deepEqual(JSON.parse(lines[1]!), events[1]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('writeEventsNdjson on an empty event list writes an empty file, not a stray blank line', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-events-ndjson-empty-'));
  try {
    const path = await writeEventsNdjson([], dir);
    assert.equal(await readFile(path, 'utf8'), '');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('writeEventsNdjson takes any iterable and writes it a line at a time — a generator, which no `.map().join()` can consume (M192b, `M192-01`)', async () => {
  // The defect was one string of every event; the shape that refuses it is a sink fed from an
  // iterator, which is why the input here is a generator and not an array — an implementation
  // that builds the file as a string from an array throws on this input before it writes a byte.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-events-ndjson-iter-'));
  try {
    let yielded = 0;
    const events = (function* stream(): Generator<RunEvent> {
      for (let i = 0; i < 2000; i++) {
        yielded += 1;
        yield { type: 'test:start', name: `t${i}`, file: 'a.tflw' };
      }
    })();
    const path = await writeEventsNdjson(events, dir);
    const lines = (await readFile(path, 'utf8')).trim().split('\n');
    assert.equal(yielded, 2000);
    assert.equal(lines.length, 2000);
    assert.deepEqual(JSON.parse(lines[1999]!), { type: 'test:start', name: 't1999', file: 'a.tflw' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
