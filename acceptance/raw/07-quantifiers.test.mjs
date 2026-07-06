import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, authHeaders } from './_helpers.mjs';

test('lists products', async () => {
  const res = await fetch(`${BASE}/products`, { headers: await authHeaders() });
  assert.equal(res.status, 200);
  const { products } = await res.json();
  assert.ok(products.some((p) => p.category === 'tools'), 'expected any product with category "tools"');
  assert.ok(products.every((p) => p.price > 0), 'expected every product to have price > 0');
});
