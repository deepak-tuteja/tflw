// Shared helper for the raw Playwright + node:test acceptance baseline (PLAN.md decision 41/50).
// This is exactly the amount of shared infrastructure a competent engineer would factor out by
// hand for a handful of UI scripts — a browser launcher and a login routine — nothing more, so
// the comparison against tflw's built-in auto-wait/locator model stays honest. Uses raw
// `playwright` (the library tflw's own browser layer sits on top of), not the `@playwright/test`
// runner — that runner is itself a tool with auto-wait web-first assertions, retries, and
// fixtures, which would unfairly narrow the gap this comparison exists to measure.

import { chromium } from 'playwright';

export const WEB_BASE = process.env.WEB_BASE ?? 'http://localhost:8090';
export const API_BASE = process.env.API_BASE ?? 'http://localhost:4001/v1';

export async function withPage(fn) {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await fn(page, context);
  } finally {
    await browser.close();
  }
}

export async function loginAsUserA(page) {
  await page.goto(`${WEB_BASE}/login`);
  await page.getByLabel('Email').fill(process.env.USER_A_EMAIL);
  await page.getByLabel('Password').fill(process.env.USER_A_PW);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.getByRole('button', { name: 'Log out' }).waitFor({ state: 'visible' });
}

export async function apiLoginToken() {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: process.env.USER_A_EMAIL, password: process.env.USER_A_PW }),
  });
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  const { accessToken } = await res.json();
  return accessToken;
}

/** Hand-rolled poll loop — tflw's `expect … is visible` retries to `timeout expect` (default 5s)
 * automatically; Playwright's own locator assertions (`expect(locator).toBeVisible()`) would do
 * this too, but that's `@playwright/test`'s tooling, not raw `playwright`. This is what "no tool"
 * looks like for the same wait. */
export async function pollUntilVisible(page, locator, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await locator.isVisible().catch(() => false)) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for element to be visible`);
    await page.waitForTimeout(100);
  }
}
