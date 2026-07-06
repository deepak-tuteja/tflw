import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, authHeaders } from './_helpers.mjs';

test('validation and not-found errors', async () => {
  const headers = await authHeaders();

  const badRes = await fetch(`${BASE}/products`, { method: 'POST', headers, body: JSON.stringify({}) });
  assert.equal(badRes.status, 400);
  const badBody = await badRes.json();
  assert.ok(badBody.error.includes('required'));

  const notFoundRes = await fetch(`${BASE}/products/does-not-exist`, { headers });
  assert.equal(notFoundRes.status, 404);
  assert.equal((await notFoundRes.json()).error, 'Product not found');
});
