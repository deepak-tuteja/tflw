import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { withPage, loginAsUserA, WEB_BASE, API_BASE } from './_helpers.mjs';

// No built-in accessibility-scan API in raw Playwright — `axe-core` has to be fetched as its own
// dependency, injected as a script tag by hand, and its results shape (`violations[]`, `impact`,
// `nodes[].target`) understood and filtered manually. tflw's `expect page has no … a11y
// violations` (SPEC §9.8) is this exact injection + `axe.run()` + severity-floor filter, built in.
const axeSource = await readFile(new URL('../../../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');

async function assertNoViolations(page) {
  await page.addScriptTag({ content: axeSource });
  const results = await page.evaluate(() => window.axe.run());
  assert.deepEqual(
    results.violations.map((v) => v.id),
    [],
    `a11y violations: ${results.violations.map((v) => `${v.id} (${v.impact})`).join(', ')}`,
  );
}

test('the happy-path product and catalog pages have no accessibility violations', async () => {
  const productsRes = await fetch(`${API_BASE}/products?q=${encodeURIComponent('Bulk Item 100')}&pageSize=1`);
  const [product] = await productsRes.json();

  await withPage(async (page) => {
    await loginAsUserA(page);
    await page.goto(`${WEB_BASE}/products/${product.id}`);
    await assertNoViolations(page);
    await page.goto(`${WEB_BASE}/`);
    await assertNoViolations(page);
  });
});
