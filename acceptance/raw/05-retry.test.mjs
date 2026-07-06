// No built-in retry in node:test — hand-rolled here. Note the honesty gap vs tflw's `retry N`:
// this blindly retries *any* failure (including a real assertion bug, not just a flake), never
// marks the eventual pass as suspect ("flaky"), and doesn't reset any seed between attempts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, authHeaders, uniqueName } from './_helpers.mjs';

test('creates a product (with hand-rolled retry)', async () => {
  const maxAttempts = 3;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(`${BASE}/products`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ name: uniqueName('Retry Widget'), price: 3, category: 'tools' }),
      });
      assert.equal(res.status, 201);
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
});
