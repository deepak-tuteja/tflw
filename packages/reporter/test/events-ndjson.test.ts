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
