import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, authHeaders, uniqueName } from './_helpers.mjs';

test('update reflects on read', async () => {
  const headers = await authHeaders();

  const createRes = await fetch(`${BASE}/products`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: uniqueName('Poll Widget'), price: 1, category: 'tools' }),
  });
  assert.equal(createRes.status, 201);
  const { id } = await createRes.json();

  const updateRes = await fetch(`${BASE}/products/${id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ name: 'Polled Widget', price: 2, category: 'tools' }),
  });
  assert.equal(updateRes.status, 200);

  // Hand-rolled poll — tflw's `wait until api ... expect ...` is one block; here it's a manual
  // deadline loop with its own sleep helper.
  const deadline = Date.now() + 30_000;
  for (;;) {
    const getRes = await fetch(`${BASE}/products/${id}`, { headers });
    const product = await getRes.json();
    if (product.price === 2) break;
    if (Date.now() >= deadline) throw new Error(`timed out waiting for price to become 2, last saw ${product.price}`);
    await new Promise((r) => setTimeout(r, 300));
  }
});
