import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, authHeaders, uniqueName } from './_helpers.mjs';

test('product CRUD lifecycle', async () => {
  const headers = await authHeaders();

  const createRes = await fetch(`${BASE}/products`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: uniqueName('Crud Widget'), price: 5, category: 'tools' }),
  });
  assert.equal(createRes.status, 201);
  const { id } = await createRes.json();

  const getRes = await fetch(`${BASE}/products/${id}`, { headers });
  assert.equal(getRes.status, 200);
  assert.equal((await getRes.json()).price, 5);

  const updateRes = await fetch(`${BASE}/products/${id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ name: 'Updated Widget', price: 7.5, category: 'tools' }),
  });
  assert.equal(updateRes.status, 200);
  assert.equal((await updateRes.json()).price, 7.5);

  const deleteRes = await fetch(`${BASE}/products/${id}`, { method: 'DELETE', headers });
  assert.equal(deleteRes.status, 200);

  const goneRes = await fetch(`${BASE}/products/${id}`, { headers });
  assert.equal(goneRes.status, 404);
});
