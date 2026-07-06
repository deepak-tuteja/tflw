import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, authHeaders } from './_helpers.mjs';

test('audits a created product', async () => {
  const res = await fetch(`${BASE}/products`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ name: 'Audit Widget', price: 15, category: 'electronics' }),
  });
  assert.equal(res.status, 201);
  const product = await res.json();

  // Soft assertions hand-rolled: collect every failure instead of stopping at the first, then
  // report them all at once — tflw's `check` gives this for free, with per-check pass/fail rows
  // in the report; here it's one bundled string.
  const failures = [];
  if (product.name !== 'Audit Widget') failures.push(`name: expected "Audit Widget", got ${JSON.stringify(product.name)}`);
  if (product.price !== 15) failures.push(`price: expected 15, got ${JSON.stringify(product.price)}`);
  if (product.category !== 'electronics') failures.push(`category: expected "electronics", got ${JSON.stringify(product.category)}`);
  if (product.inStock !== true) failures.push(`inStock: expected true, got ${JSON.stringify(product.inStock)}`);
  assert.equal(failures.length, 0, failures.join('\n'));
});
