import { test } from 'node:test';
import { withPage, loginAsUserA, WEB_BASE, API_BASE, apiLoginToken, pollUntilVisible } from './_helpers.mjs';

test('cart rows are drag-drop reorderable, verified row by row', async () => {
  const bulk100 = await fetch(`${API_BASE}/products?q=${encodeURIComponent('Bulk Item 100')}&pageSize=1`).then((r) => r.json());
  const bulk10 = await fetch(`${API_BASE}/products?q=${encodeURIComponent('Bulk Item 10')}&pageSize=1`).then((r) => r.json());
  const token = await apiLoginToken();
  // Flush any leftover cart items from an earlier scenario in this same live stack (a 422 "cart is
  // empty" is fine and expected when nothing carried over) — same reasoning as the tflw side.
  await fetch(`${API_BASE}/cart/checkout`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  });

  await withPage(async (page) => {
    await loginAsUserA(page);

    await page.goto(`${WEB_BASE}/products/${bulk100[0].id}`);
    await page.getByLabel('Quantity').fill('1');
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await pollUntilVisible(page, page.getByText('Added 1 × Bulk Item 100 to your cart.'));

    await page.goto(`${WEB_BASE}/products/${bulk10[0].id}`);
    await page.getByLabel('Quantity').fill('1');
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await pollUntilVisible(page, page.getByText('Added 1 × Bulk Item 10 to your cart.'));

    // apiV2's `GET /cart` has no `ORDER BY` on the items relation — ask which product landed in
    // which row rather than assuming insertion order (same lesson the tflw side documents).
    const cart = await fetch(`${API_BASE}/cart`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json());
    const row1Name = cart.items[0].product.name;
    const row2Name = cart.items[1].product.name;

    await page.goto(`${WEB_BASE}/cart`);
    await pollUntilVisible(page, page.locator('table tbody tr:nth-child(1) th', { hasText: row1Name }));

    const handle = page.locator(`.drag-handle[aria-label='Drag to reorder ${row1Name}']`);
    const target = page.locator('table tbody tr th', { hasText: row2Name });

    // Playwright's own `locator.dragTo()` turned out to work fine against this app's native HTML5
    // drag-and-drop listeners (`CartPage.tsx`'s `onDragStart`/`onDrop`) — verified empirically, not
    // assumed. No hand-rolled `DragEvent` dispatch needed here, unlike the file-drop corner
    // (04-file-upload-dropzone.test.mjs), where the target isn't a real `<input type=file>` and
    // `dragTo()` has no file-payload equivalent at all.
    await handle.dragTo(target);

    await pollUntilVisible(page, page.locator('table tbody tr:nth-child(1) th', { hasText: row2Name }));
    await pollUntilVisible(page, page.locator('table tbody tr:nth-child(2) th', { hasText: row1Name }));
  });
});
