import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, authHeaders, uniqueName } from './_helpers.mjs';

for (const category of ['tools', 'hardware']) {
  test(`creates a ${category} product`, async () => {
    const res = await fetch(`${BASE}/products`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ name: uniqueName('Widget'), price: 12.5, category }),
    });
    assert.equal(res.status, 201);
    assert.equal((await res.json()).category, category);
  });
}
