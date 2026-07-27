import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withPage, loginAsUserA, WEB_BASE, API_BASE, pollUntilVisible } from './_helpers.mjs';

test('a full checkout — product page, cart, the iframe payment widget, and the real network request', async () => {
  const productsRes = await fetch(`${API_BASE}/products?q=${encodeURIComponent('Bulk Item 100')}&pageSize=1`);
  assert.equal(productsRes.status, 200);
  const [product] = await productsRes.json();

  await withPage(async (page) => {
    // No built-in network-observation API on a raw `page` beyond low-level `page.on('request'/
    // 'response')` — tflw's `expect request to "…" was made` (SPEC §9.7) is this same
    // instrumentation wired in by default for every test; here it has to be hand-attached before
    // navigation even starts, or an early request is simply missed.
    const requests = [];
    page.on('requestfinished', async (req) => {
      const res = await req.response();
      requests.push({ url: req.url(), method: req.method(), status: res ? res.status() : null });
    });

    await loginAsUserA(page);
    await page.goto(`${WEB_BASE}/products/${product.id}`);
    await pollUntilVisible(page, page.locator('#product-heading', { hasText: 'Bulk Item 100' }));
    await page.getByLabel('Quantity').fill('1');
    await page.getByRole('button', { name: 'Add to cart' }).click();

    await page.goto(`${WEB_BASE}/cart`);
    await pollUntilVisible(page, page.locator("th[scope='row']", { hasText: 'Bulk Item 100' }));

    const paymentFrame = page.frameLocator("iframe[title='Payment']");
    await paymentFrame.getByLabel('Card number').fill('4111111111111111');
    await paymentFrame.getByLabel('Expiry (MM/YY)').fill('12/30');
    await paymentFrame.getByLabel('CVC').fill('123');
    await paymentFrame.getByRole('button', { name: 'Authorize payment' }).click();

    // Hand-rolled "wait until enabled" — no `wait until … is enabled` construct exists outside
    // tflw; the closest raw equivalent is polling the `disabled` DOM property directly.
    const checkoutButton = page.getByRole('button', { name: 'Checkout' });
    const deadline = Date.now() + 5000;
    for (;;) {
      if (!(await checkoutButton.isDisabled())) break;
      if (Date.now() > deadline) throw new Error('checkout button never enabled');
      await page.waitForTimeout(100);
    }
    await checkoutButton.click();
    await pollUntilVisible(page, page.getByText('Order confirmed'));

    const checkoutCalls = requests.filter(
      (r) => r.url.includes('/cart/checkout') && r.method === 'POST',
    );
    assert.ok(checkoutCalls.length > 0, 'expected a POST /cart/checkout request');
    assert.equal(checkoutCalls.at(-1).status, 201);
  });
});
