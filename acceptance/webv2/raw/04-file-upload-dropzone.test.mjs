import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { withPage, loginAsUserA, WEB_BASE, pollUntilVisible } from './_helpers.mjs';

test('the support page drop-zone accepts a real file, surviving a per-render dynamic field id', async () => {
  const bytes = await readFile(new URL('./payloads/sample.csv', import.meta.url));
  const base64 = bytes.toString('base64');

  await withPage(async (page) => {
    await loginAsUserA(page);
    await page.goto(`${WEB_BASE}/support`);

    // The field has a per-render dynamic id (`subject-${random}`) — only the label text is
    // stable, so `getByLabel` (accessible-name resolution) is required here, same as tflw's
    // `field` locator's own label-first cascade (SPEC §9.3).
    await page.getByLabel('Subject').fill('M7 acceptance upload');

    // No built-in "drop a real file onto an arbitrary element" API in Playwright — `setInputFiles`
    // only targets a real `<input type=file>`, and this drop-zone is a plain `<div onDrop=…>`.
    // Reconstructing a real `File` (not a fake Blob with a made-up name) from actual on-disk bytes
    // and dispatching the native DragEvent sequence has to be hand-rolled via `page.evaluate`.
    const dropZone = page.locator('.drop-zone');
    await dropZone.evaluate(
      (el, { base64, filename }) => {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const file = new File([bytes], filename, { type: 'text/csv' });
        const dt = new DataTransfer();
        dt.items.add(file);
        el.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: dt }));
        el.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
        el.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
      },
      { base64, filename: 'sample.csv' },
    );

    const uploaded = page.getByText('sample.csv');
    await pollUntilVisible(page, uploaded);
    assert.equal(await uploaded.isVisible(), true);
  });
});
