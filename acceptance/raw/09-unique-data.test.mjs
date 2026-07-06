import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, authHeaders, uniqueName } from './_helpers.mjs';

test('creates two distinctly-named products', async () => {
  const headers = await authHeaders();

  const first = await fetch(`${BASE}/products`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: uniqueName('Batch Widget'), price: 1, category: 'tools' }),
  });
  assert.equal(first.status, 201);

  const second = await fetch(`${BASE}/products`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: uniqueName('Batch Widget'), price: 1, category: 'tools' }),
  });
  assert.equal(second.status, 201);
});
