import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, uniqueName } from './_helpers.mjs';

test('logs in and creates a product', async () => {
  const loginRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PW }),
  });
  assert.equal(loginRes.status, 200);
  const { token } = await loginRes.json();

  const createRes = await fetch(`${BASE}/products`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: uniqueName('Widget'), price: 9.99, category: 'tools' }),
  });
  assert.equal(createRes.status, 201);
  const product = await createRes.json();
  assert.equal(product.category, 'tools');
});
