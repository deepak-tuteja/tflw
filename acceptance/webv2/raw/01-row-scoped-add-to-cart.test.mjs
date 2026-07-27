import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withPage, loginAsUserA, WEB_BASE, pollUntilVisible } from './_helpers.mjs';

test('row-scoped add-to-cart on a page of a dozen identical buttons, with its async toast', async () => {
  await withPage(async (page) => {
    await loginAsUserA(page);
    await page.goto(WEB_BASE + '/');
    await page.getByLabel('Search').fill('Bulk Item 100');

    const row = page.locator("[aria-label='Bulk Item 100']");
    await row.getByRole('button', { name: 'Add to cart' }).click();

    const toast = page.getByText('Added 1 × Bulk Item 100 to your cart.');
    await pollUntilVisible(page, toast);
    assert.equal(await toast.isVisible(), true);
  });
});
