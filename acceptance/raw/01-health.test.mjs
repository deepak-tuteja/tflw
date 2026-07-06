import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE } from './_helpers.mjs';

test('health check', async () => {
  const res = await fetch(`${BASE}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'OK');
});
