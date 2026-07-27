// Playwright-backed browser step driver (M3a/M3b/M3c/M3d, SPEC §9). `playwright` is an optional
// peer (D5, PLAN_BROWSER_PERF_SECURITY.md §1.1): dynamically imported on first use so `tflw run`
// against an API-only suite never touches it, and a consumer who never installed the peer never
// pays for it.
//
// Lifecycle (D13): one shared `Browser` process for the whole `tflw run` invocation
// (`BrowserManager`, owned by the CLI, threaded through `RunOptions`/`TestCtx`), one fresh
// `BrowserContext` + `Page` per test attempt (`BrowserPageState`, created in `runTestAttempt`).
// M3b extends `BrowserPageState` to track *several* pages per context (tabs/windows) with one
// "active" index — every existing single-page caller keeps working unchanged since `ensurePage`
// always returns whichever page is currently active. M3c adds: engine selection + `--headed` +
// `viewport` on `BrowserManager` (D11); screenshot capture; a Playwright trace started per context
// and conditionally saved by `BrowserPageState.finish()` (D12). M3d adds passive network
// observation (`page.on('response')` → `networkLog`, read by `request to "…"`/`of request to "…"`,
// SPEC §9.7) and `stub` (`page.route()`-backed response mocking, `performStub`) — independently
// implemented (`stub` never reads/writes `networkLog`), but a stubbed request still lands in
// `networkLog` like any other, since Playwright fires `response` for a `route.fulfill()`ed request
// exactly as it would for a real one — `request to "…" was made` sees a stubbed request too.
//
// Selector model (D6): the locator noun picks the resolution strategy — `button`/`text`/`list`/
// `css`/`xpath` are single-strategy, `field` is a closed 3-step cascade (label → placeholder →
// role). A below-tier-1 hit is annotated by the caller (the `via` this module returns) rather than
// silently accepted. Ambiguity (D7) is a hard error with up to 5 candidate descriptions — never
// "take the first match".

import { randomUUID } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { Locator as LocatorAst, LocatorKind } from '@tflw/lang';
import { RuntimeError, evalValue, type EvalCtx } from './eval.js';
import { inferContentType } from './mime.js';
import type { ScreenshotAsset, TraceAsset } from './types.js';

type PWModule = typeof import('playwright');
export type PWBrowser = import('playwright').Browser;
export type PWBrowserContext = import('playwright').BrowserContext;
export type PWPage = import('playwright').Page;
export type PWLocator = import('playwright').Locator;
export type PWFrameLocator = import('playwright').FrameLocator;
export type PWResponse = import('playwright').Response;

/** One completed network round-trip observed on the active page during a test attempt (M3d, D14,
 * SPEC §9.7) — captured passively via `page.on('response')`, never via interception (that's
 * `stub`'s job). `responseJson`/`responseBodyText` are best-effort: a body that fails to read
 * (opaque redirect, streamed/binary response) simply leaves both `null`/`undefined` rather than
 * throwing — matches `request to "…" was made`'s existence-only fallback. */
export interface CapturedNetworkRequest {
  readonly url: string;
  readonly method: string;
  readonly status: number;
  readonly requestBody: string | null;
  readonly responseHeaders: Readonly<Record<string, string>>;
  readonly responseBodyText: string | null;
  readonly responseJson: unknown;
}

/** The three engines Playwright ships (D11) — `chromium` is the default everywhere (`tflw run`,
 * `tflw install-browsers`). A run switches its *whole* suite to one engine; no in-run matrix (D11:
 * "engine is a run-level property in the report header" — CI matrixes three jobs instead). */
export type BrowserEngine = 'chromium' | 'firefox' | 'webkit';
export const SUPPORTED_BROWSER_ENGINES: readonly BrowserEngine[] = ['chromium', 'firefox', 'webkit'];

/** Anything a locator can resolve against — a whole page, a container `Locator` (inside a plain
 * `within` block), or a `FrameLocator` (inside `within frame`, M3b — an iframe's own document has
 * its own resolution root, reached via `Locator.contentFrame()`). All three implement the same
 * `getByRole`/`getByText`/`getByLabel`/`getByPlaceholder`/`locator` query surface in Playwright's
 * own API, which is all `candidateStrategies` below ever calls. */
export type LocatorScope = PWPage | PWLocator | PWFrameLocator;

let pwModulePromise: Promise<PWModule> | undefined;

async function loadPlaywright(): Promise<PWModule> {
  if (!pwModulePromise) {
    pwModulePromise = import('playwright').catch((err) => {
      pwModulePromise = undefined;
      throw new RuntimeError(
        `this test uses a browser step, but the optional \`playwright\` peer dependency isn't installed. Run \`npm install -D playwright && tflw install-browsers\` (SPEC §9, §12). (${(err as Error).message})`,
      );
    });
  }
  return pwModulePromise;
}

export interface BrowserManagerOptions {
  /** D11: chromium default. */
  readonly engine?: BrowserEngine;
  /** `--headed` (M3c) — headless by default, matching every prior milestone's behavior. */
  readonly headless?: boolean;
  /** `viewport <w> <h>` (M3c) — `null`/omitted lets Playwright use its own default. */
  readonly viewport?: { readonly width: number; readonly height: number } | null;
}

/** One per `tflw run` invocation (D13) — owned by the CLI, passed through `RunOptions`. Launches
 * lazily on the first browser step anywhere in the run; `close()` is safe to call even if a
 * browser was never actually launched. `engine`/`viewport` are public so `runProgram` can stamp
 * the report header (D11) and `BrowserPageState.ensurePage` can size new contexts, without either
 * needing its own copy of this run's settings. */
export class BrowserManager {
  readonly engine: BrowserEngine;
  readonly viewport: { readonly width: number; readonly height: number } | null;
  private readonly headless: boolean;
  private browserPromise: Promise<PWBrowser> | undefined;

  constructor(opts: BrowserManagerOptions = {}) {
    this.engine = opts.engine ?? 'chromium';
    this.headless = opts.headless ?? true;
    this.viewport = opts.viewport ?? null;
  }

  async getBrowser(): Promise<PWBrowser> {
    if (!this.browserPromise) {
      this.browserPromise = loadPlaywright().then((pw) => pw[this.engine].launch({ headless: this.headless }));
    }
    return this.browserPromise;
  }

  async close(): Promise<void> {
    if (!this.browserPromise) return;
    const browser = await this.browserPromise;
    await browser.close();
  }
}

/** Per-test-attempt browser state (D13: fresh context per test — and, in this implementation,
 * per retry attempt too, so a failed attempt's UI state never bleeds into a retry). Lazily creates
 * its context + first page on the first browser step actually executed.
 *
 * M3b: tracks every open tab/window in this context (`pages`) plus which one is "active"
 * (`activeIndex`) — `switch to new tab`/`switch to tab N`/`close tab` move `activeIndex`, and
 * every other browser step reads the active page through `ensurePage`/`currentPage`, unaware
 * there's more than one. The dialog handler (SPEC §9.1) is wired identically on every page, first
 * or not — `armedDialog` is one flag shared across tabs, matching the language's "the next dialog,
 * wherever it fires" framing (SPEC §9.1/§9.5). */
export class BrowserPageState {
  private pages: PWPage[] = [];
  private activeIndex = 0;
  private context: PWBrowserContext | undefined;
  /** Set by `accept dialog`/`dismiss dialog` — armed for exactly the next native dialog, then
   * cleared (SPEC §9.1). */
  armedDialog: 'accept' | 'dismiss' | null = null;
  lastDialogMessage: string | null = null;
  /** M3d, SPEC §9.7 — every completed network response observed across every page opened this
   * attempt, in completion order. Resets naturally: a fresh `BrowserPageState` is created per test
   * attempt (`runTestAttempt`, interpreter.ts), same as the trace/screenshot state. */
  private networkLog: CapturedNetworkRequest[] = [];

  private wireDialogHandler(page: PWPage): void {
    page.on('dialog', (dialog) => {
      const armed = this.armedDialog;
      this.armedDialog = null; // one-shot (SPEC §9.1)
      this.lastDialogMessage = dialog.message();
      void (armed === 'accept' ? dialog.accept() : dialog.dismiss());
    });
  }

  /** M3d — passive observation only (never modifies the response, unlike `stub`'s `page.route`).
   * Reading the body is best-effort: a response that can't be read as text (redirect with no body,
   * an opaque/binary payload) still gets logged for `was made`, just with a null body. Errors here
   * must never propagate — a network-capture bug can't be allowed to crash an otherwise-passing
   * browser step. */
  private wireNetworkCapture(page: PWPage): void {
    page.on('response', (response) => {
      void this.captureResponse(response).catch(() => {});
    });
  }

  private async captureResponse(response: PWResponse): Promise<void> {
    const request = response.request();
    let responseBodyText: string | null = null;
    let responseJson: unknown;
    try {
      responseBodyText = await response.text();
      try {
        responseJson = JSON.parse(responseBodyText);
      } catch {
        // not JSON — `responseJson` stays undefined, `body text of request to "…"` still works
      }
    } catch {
      // opaque/binary/streamed response — `was made` and `status of request to "…"` still work
    }
    this.networkLog.push({
      url: response.url(),
      method: request.method(),
      status: response.status(),
      requestBody: request.postData(),
      responseHeaders: await response.allHeaders().catch(() => ({})),
      responseBodyText,
      responseJson,
    });
  }

  /** Every network request observed on this attempt's active page so far (M3d, SPEC §9.7) — read
   * fresh on every poll by the interpreter's network-expect loop. An empty array before any browser
   * step ran, or before any matching request has completed, is a normal, still-polling state, never
   * an error. */
  networkRequestsSoFar(): readonly CapturedNetworkRequest[] {
    return this.networkLog;
  }

  async ensurePage(manager: BrowserManager): Promise<PWPage> {
    if (this.pages.length === 0) {
      const browser = await manager.getBrowser();
      // `acceptDownloads: true` (M3b) — explicit rather than relying on Playwright's own default,
      // since `download as <name>` needs every context to actually surface a `download` event
      // instead of letting the browser navigate to (or silently drop) the response. `viewport`
      // (M3c) is this run's configured size, or Playwright's own default when `null`.
      this.context = await browser.newContext({ acceptDownloads: true, ...(manager.viewport ? { viewport: manager.viewport } : {}) });
      // Started unconditionally (M3c, D12) — cheap enough to always run; `finish()` below decides
      // at the *end* of the attempt whether it's worth keeping (failure, or a retry attempt),
      // discarding it otherwise. `sources: true` lets a trace viewer show the actual `.tflw` source
      // alongside the DOM/network timeline.
      await this.context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      const page = await this.context.newPage();
      this.wireDialogHandler(page);
      this.wireNetworkCapture(page);
      this.pages.push(page);
      this.activeIndex = 0;
    }
    return this.pages[this.activeIndex]!;
  }

  /** The active page, if a browser step has already created one this attempt — never creates one
   * (unlike `ensurePage`). Used for best-effort failure screenshots (M3c): a failing *API* step in
   * an otherwise UI-less test must never spin up a real browser process just to try to screenshot
   * nothing. */
  currentPageIfAny(): PWPage | undefined {
    return this.pages[this.activeIndex];
  }

  /** How many tabs are currently open — used by `switchToTab`/`closeTab` for range/last-tab
   * checks (SPEC §9.5). */
  get tabCount(): number {
    return this.pages.length;
  }

  /** `switch to new tab` + block (SPEC §9.5, M3b): starts listening for the context's next `page`
   * (popup) event *before* `runBody` runs (so a fast-opening tab can't race past the listener),
   * runs the block's own step(s) (expected to trigger the new tab), then makes the newly-opened
   * page active — unlike `within`'s locator scoping, this persists past the block.
   *
   * `runBody` reports whether its own steps succeeded; when they didn't, no popup is coming, so
   * this returns `{ opened: false }` immediately rather than waiting out the full timeout for an
   * event that will never fire. Never throws — a timeout/failure while actually waiting for the
   * popup comes back as `{ opened: false, error }` instead, so the caller (which has already
   * recorded `runBody`'s own step results) can always finish reporting them. */
  async runNewTabBlock(manager: BrowserManager, timeoutMs: number, runBody: () => Promise<boolean>): Promise<{ readonly opened: boolean; readonly error?: string }> {
    await this.ensurePage(manager);
    const context = this.context!;
    const pagePromise = context.waitForEvent('page', { timeout: timeoutMs });
    const bodyOk = await runBody();
    if (!bodyOk) {
      pagePromise.catch(() => {}); // avoid an unhandled rejection once this promise settles unobserved
      return { opened: false };
    }
    try {
      const newPage = await runAction('switch to new tab', () => pagePromise);
      this.wireDialogHandler(newPage);
      this.wireNetworkCapture(newPage);
      this.pages.push(newPage);
      this.activeIndex = this.pages.length - 1;
      return { opened: true };
    } catch (err) {
      return { opened: false, error: (err as Error).message };
    }
  }

  /** `switch to tab N` (1-based, SPEC §9.5) — the tab already exists, no event to wait for. */
  switchToTab(index: number): void {
    if (index < 1 || index > this.pages.length) {
      throw new RuntimeError(`no tab ${index} — ${this.pages.length} tab(s) currently open`);
    }
    this.activeIndex = index - 1;
  }

  /** `close tab` (SPEC §9.5) — closes the active tab, then falls back to the previous one in open
   * order. Closing the last remaining tab is a runtime error, not a silent no-op. */
  async closeTab(): Promise<void> {
    if (this.pages.length <= 1) {
      throw new RuntimeError("can't close tab — it's the only tab open");
    }
    const page = this.pages[this.activeIndex]!;
    await page.close();
    this.pages.splice(this.activeIndex, 1);
    this.activeIndex = Math.max(0, this.activeIndex - 1);
  }

  /** `download as <name>` + block (SPEC §9.5, M3b) — same before/run/await shape and non-throwing
   * contract as `runNewTabBlock`, but listens for the *active* page's `download` event and returns
   * its suggested filename (the value bound to the block's `name`) on success. */
  async runDownloadBlock(manager: BrowserManager, timeoutMs: number, runBody: () => Promise<boolean>): Promise<{ readonly filename: string | null; readonly error?: string }> {
    const page = await this.ensurePage(manager);
    const downloadPromise = page.waitForEvent('download', { timeout: timeoutMs });
    const bodyOk = await runBody();
    if (!bodyOk) {
      downloadPromise.catch(() => {});
      return { filename: null };
    }
    try {
      const download = await runAction('download', () => downloadPromise);
      return { filename: download.suggestedFilename() };
    } catch (err) {
      return { filename: null, error: (err as Error).message };
    }
  }

  async close(): Promise<void> {
    if (this.context) await this.context.close();
    this.pages = [];
    this.activeIndex = 0;
    this.context = undefined;
  }

  /** Ends this attempt's browser state (M3c, D12): stops the trace started in `ensurePage`,
   * keeping the archive only when `shouldSaveTrace` — the caller decides that from "did this
   * attempt fail, or is it a retry" (`runTestAttempt`, interpreter.ts) — then closes the context.
   * Idempotent with `close()`: safe to call `close()` again afterward (a no-op, `context` is
   * already cleared) as a defensive fallback if something throws before `finish()` runs.
   *
   * Playwright's `tracing.stop()` only writes to a real file path, never returns bytes directly —
   * routed through a throwaway temp file, read back into memory, then deleted; the report itself
   * is the archive's permanent home (`reporter`'s `resolveReportAssets`). No context at all (a
   * browser was never actually used this attempt) returns `undefined` without touching tracing. */
  async finish(shouldSaveTrace: boolean): Promise<TraceAsset | undefined> {
    if (!this.context) return undefined;
    let trace: TraceAsset | undefined;
    if (shouldSaveTrace) {
      const tmpPath = join(tmpdir(), `tflw-trace-${randomUUID()}.zip`);
      try {
        await this.context.tracing.stop({ path: tmpPath });
        trace = { base64: (await readFile(tmpPath)).toString('base64') };
      } finally {
        await unlink(tmpPath).catch(() => {});
      }
    } else {
      await this.context.tracing.stop();
    }
    await this.close();
    return trace;
  }
}

/** `screenshot "<name>"` (M3c) — a real step like `click`/`fill`: a failure here (a closed page,
 * an unexpected navigation mid-capture) is itself a diagnosis and surfaces like any other action
 * failure (`runAction`'s cleaned-up message), never silently swallowed. */
export async function performScreenshot(page: PWPage): Promise<ScreenshotAsset> {
  const buf = await runAction('screenshot', () => page.screenshot({ type: 'png' }));
  return { base64: buf.toString('base64') };
}

/** Automatic failure-screenshot capture (M3c, D12's "failure-first capture") — supplementary
 * evidence attached *alongside* an already-failed step, so it must never itself throw and mask (or
 * replace) the real failure. Swallows both "no page exists yet" (`page` is `undefined`, e.g. an
 * API step failed before any browser step ran) and any capture-time error (a mid-navigation page,
 * an already-closed context) the same way — `undefined`, no screenshot, original failure intact. */
export async function captureFailureScreenshot(page: PWPage | undefined): Promise<ScreenshotAsset | undefined> {
  if (!page) return undefined;
  try {
    const buf = await page.screenshot({ type: 'png' });
    return { base64: buf.toString('base64') };
  } catch {
    return undefined;
  }
}

/** A bare path (`/api/orders`) is auto-prefixed with Playwright's own `**` glob wildcard so it
 * matches regardless of origin — the same origin-agnostic ergonomics `request to "…"`'s substring
 * match already has, and consistent with `open "/path"` never asking for a scheme/host either.
 * Left unchanged when it already looks like a full URL or already carries a glob wildcard, so an
 * author who wants Playwright's own pattern language (`https://cdn.example.com/**`, a narrower
 * `**\/api/orders/*`, …) always gets exactly what they wrote. */
function toRoutePattern(urlPattern: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(urlPattern) || urlPattern.includes('*')) return urlPattern;
  return `**${urlPattern}`;
}

/** `stub <METHOD> "<url-pattern>" respond status <code> [body {...}]` (M3d, D14, SPEC §9.7) —
 * route-level response mocking for the active page. `urlPattern` is handed to Playwright's
 * `page.route()` (via `toRoutePattern`), which accepts its own glob/regex matching syntax — no
 * tflw-owned pattern language to reinvent. A request whose method doesn't match this stub calls
 * `route.fallback()`, letting it (and any earlier-registered, still-matching route) continue
 * untouched rather than being silently swallowed. Registered for the rest of the page's lifetime —
 * like tracing/network capture, this naturally resets on the next test attempt's fresh page. */
export async function performStub(page: PWPage, method: string, urlPattern: string, status: number, body: unknown): Promise<void> {
  await runAction('stub', () =>
    page.route(toRoutePattern(urlPattern), async (route) => {
      if (route.request().method().toUpperCase() !== method.toUpperCase()) {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status,
        ...(body !== null ? { contentType: 'application/json', body: JSON.stringify(body) } : {}),
      });
    }),
  );
}

export interface ResolvedLocator {
  readonly pwLocator: PWLocator;
  /** The strategy that actually resolved this locator (`label`/`placeholder`/`role (textbox)` for
   * `field`; the sole strategy name for every other kind) — D6's below-tier-1 annotation. */
  readonly via: string;
}

const POLL_INTERVAL_MS = 100;

function candidateStrategies(scope: LocatorScope, kind: LocatorKind, name: string): { readonly pwLocator: PWLocator; readonly via: string }[] {
  switch (kind) {
    case 'button':
      return [{ pwLocator: scope.getByRole('button', { name }), via: 'role' }];
    case 'text':
      return [{ pwLocator: scope.getByText(name), via: 'text' }];
    case 'list':
      return [{ pwLocator: scope.getByRole('list', { name }), via: 'role' }];
    case 'field':
      // Closed 3-step cascade (D6) — checked in this fixed priority order every poll iteration, so
      // an earlier tier that later starts matching always wins over one already matching now.
      return [
        { pwLocator: scope.getByLabel(name), via: 'label' },
        { pwLocator: scope.getByPlaceholder(name), via: 'placeholder' },
        { pwLocator: scope.getByRole('textbox', { name }), via: 'role (textbox)' },
      ];
    case 'css':
      return [{ pwLocator: scope.locator(name), via: 'css' }];
    case 'xpath':
      return [{ pwLocator: scope.locator(`xpath=${name}`), via: 'xpath' }];
  }
}

export function describeLocator(kind: LocatorKind, name: string): string {
  return `\`${kind} ${JSON.stringify(name)}\``;
}

export interface LocatorCandidate {
  readonly pwLocator: PWLocator;
  readonly via: string;
}

/** Zero-wait snapshot of a locator's candidate resolution — used by the UI-expect path, which
 * (unlike an action) must treat "N elements" as a legitimate, meaningful state for `has count`,
 * and "zero elements" as legitimate for `is hidden`/`has count 0` too — so it never throws here on
 * ambiguity or absence, unlike `resolveLocator`. The caller decides, per matcher, whether a count
 * other than exactly 1 is actually an error (`requireSingleMatch` below) — only `has count` is
 * ever meaningful against more than one element (SPEC §9.4). */
export async function resolveLocatorSnapshot(
  scope: LocatorScope,
  locatorAst: LocatorAst,
  ctx: EvalCtx,
): Promise<LocatorCandidate & { readonly count: number }> {
  const name = String(evalValue(locatorAst.value, ctx));
  const candidates = candidateStrategies(scope, locatorAst.kind, name);
  for (const candidate of candidates) {
    const count = await candidate.pwLocator.count();
    if (count >= 1) return { ...candidate, count };
  }
  return { ...candidates[0]!, count: 0 };
}

/** Every UI matcher except `has count` needs exactly one element to make sense (D7: ambiguity is
 * still a hard error there, just not for `has count` itself) — call this from the UI-expect path
 * once it knows which matcher is being evaluated. */
export async function requireSingleMatch(locatorAst: LocatorAst, name: string, candidate: LocatorCandidate, count: number): Promise<void> {
  if (count > 1) throw await ambiguityError(locatorAst, name, candidate, count);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolves a locator against a live page/scope, polling up to `timeoutMs` (a not-yet-rendered
 * element is not the same failure as a genuinely missing one, D9's spirit even though the full
 * live-DOM "nearest candidate" diagnosis is M5). Throws immediately — never waits out the rest of
 * the timeout — on real ambiguity (D7: strict, N>1 is always an error). */
export async function resolveLocator(scope: LocatorScope, locatorAst: LocatorAst, ctx: EvalCtx, timeoutMs: number): Promise<ResolvedLocator> {
  const name = String(evalValue(locatorAst.value, ctx));
  const attempts = candidateStrategies(scope, locatorAst.kind, name);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    for (const attempt of attempts) {
      const count = await attempt.pwLocator.count();
      if (count === 1) return attempt;
      if (count > 1) throw await ambiguityError(locatorAst, name, attempt, count);
    }
    if (Date.now() >= deadline) {
      const triedVia = attempts.map((a) => a.via).join(', ');
      const suffix = attempts.length > 1 ? ` — tried ${triedVia}, none matched` : '';
      throw new RuntimeError(`no element found for ${describeLocator(locatorAst.kind, name)}${suffix}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

async function ambiguityError(
  locatorAst: LocatorAst,
  name: string,
  attempt: { readonly pwLocator: PWLocator; readonly via: string },
  count: number,
): Promise<RuntimeError> {
  const all = await attempt.pwLocator.all();
  const shown = all.slice(0, 5);
  const descriptions = await Promise.all(
    shown.map(async (l, i) => {
      const text = (await l.innerText().catch(() => '')).trim().replace(/\s+/g, ' ').slice(0, 80);
      return `  ${i + 1}. ${text ? JSON.stringify(text) : '(no visible text)'}`;
    }),
  );
  const more = count > shown.length ? `\n  … and ${count - shown.length} more` : '';
  return new RuntimeError(
    `ambiguous locator ${describeLocator(locatorAst.kind, name)} (resolved via ${attempt.via}) — matched ${count} elements:\n${descriptions.join('\n')}${more}\nnarrow it with \`within <container>\`, or make the name more specific (SPEC §9.3)`,
  );
}

/** Strips Playwright's verbose multi-line "Call log:" trailer down to just its first line, so a
 * failed browser action reports as cleanly as every other tflw failure (P#6). */
async function runAction<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const firstLine = message.split('\n')[0]!.trim();
    throw new RuntimeError(`${label} failed: ${firstLine}`);
  }
}

export type ClickKind = 'single' | 'double' | 'right';

export async function performClick(pwLocator: PWLocator, kind: ClickKind, timeoutMs: number): Promise<void> {
  await runAction('click', () => {
    if (kind === 'double') return pwLocator.dblclick({ timeout: timeoutMs });
    if (kind === 'right') return pwLocator.click({ button: 'right', timeout: timeoutMs });
    return pwLocator.click({ timeout: timeoutMs });
  });
}

export async function performFill(pwLocator: PWLocator, value: string, timeoutMs: number): Promise<void> {
  await runAction('fill', () => pwLocator.fill(value, { timeout: timeoutMs }));
}

export async function performSelect(pwLocator: PWLocator, value: string, timeoutMs: number): Promise<void> {
  await runAction('select', () => pwLocator.selectOption(value, { timeout: timeoutMs }));
}

export async function performCheck(pwLocator: PWLocator, timeoutMs: number): Promise<void> {
  await runAction('check', () => pwLocator.check({ timeout: timeoutMs }));
}

export async function performUncheck(pwLocator: PWLocator, timeoutMs: number): Promise<void> {
  await runAction('uncheck', () => pwLocator.uncheck({ timeout: timeoutMs }));
}

export async function performHover(pwLocator: PWLocator, timeoutMs: number): Promise<void> {
  await runAction('hover', () => pwLocator.hover({ timeout: timeoutMs }));
}

export async function performScrollIntoView(pwLocator: PWLocator, timeoutMs: number): Promise<void> {
  await runAction('scroll', () => pwLocator.scrollIntoViewIfNeeded({ timeout: timeoutMs }));
}

/** `press "Enter"` — page-level, no specific target (SPEC §9.1). */
export async function performPressOnPage(page: PWPage, keys: string): Promise<void> {
  await runAction('press', () => page.keyboard.press(keys));
}

/** `press "Enter" on field "Search"` — scoped to one locator, preferred when the key should go to
 * a specific control (SPEC §9.1). */
export async function performPressOnLocator(pwLocator: PWLocator, keys: string, timeoutMs: number): Promise<void> {
  await runAction('press', () => pwLocator.press(keys, { timeout: timeoutMs }));
}

export async function performOpen(page: PWPage, url: string, timeoutMs: number): Promise<void> {
  await runAction('open', () => page.goto(url, { timeout: timeoutMs }));
}

/** `drag <locator> to <locator>` (SPEC §9.5, M3b) — dispatches a native HTML5 drag-and-drop
 * sequence with a real `DataTransfer` rather than using Playwright's own `dragTo()`, which relies
 * on simulated mouse movement and doesn't reliably fire native `dragstart`/`drop` listeners
 * (testFlow-tests' webV2-3 build hit this directly: `dragTo()` silently no-op'd a hand-rolled
 * drag-reorder list). This is Playwright's own documented manual-DnD recipe. */
export async function performDrag(fromLocator: PWLocator, toLocator: PWLocator, timeoutMs: number): Promise<void> {
  await runAction('drag', async () => {
    await fromLocator.waitFor({ state: 'visible', timeout: timeoutMs });
    await toLocator.waitFor({ state: 'visible', timeout: timeoutMs });
    const page = fromLocator.page();
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await fromLocator.dispatchEvent('dragstart', { dataTransfer });
    await toLocator.dispatchEvent('dragenter', { dataTransfer });
    await toLocator.dispatchEvent('dragover', { dataTransfer });
    await toLocator.dispatchEvent('drop', { dataTransfer });
    await fromLocator.dispatchEvent('dragend', { dataTransfer });
  });
}

/** `drop file "./f.png" onto <locator>` (SPEC §9.5, M3b) — for a dropzone with no underlying
 * `<input type="file">` for `upload`/`setInputFiles` to target. Reads the file's real bytes on the
 * host, base64-encodes them across the Node↔browser boundary (`page.evaluateHandle`'s argument
 * serialization has no first-class Buffer/Uint8Array support), and reconstructs a genuine in-page
 * `File` — not a fake object — before dispatching the drop. */
export async function performDropFile(page: PWPage, absFilePath: string, pwLocator: PWLocator, timeoutMs: number): Promise<void> {
  await runAction('drop file', async () => {
    const buf = await readFile(absFilePath);
    const base64 = buf.toString('base64');
    const fileName = basename(absFilePath);
    const mimeType = inferContentType(absFilePath);
    const dataTransfer = await page.evaluateHandle(
      ({ base64, fileName, mimeType }: { base64: string; fileName: string; mimeType: string }) => {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const file = new File([bytes], fileName, { type: mimeType });
        const dt = new DataTransfer();
        dt.items.add(file);
        return dt;
      },
      { base64, fileName, mimeType },
    );
    await pwLocator.waitFor({ state: 'visible', timeout: timeoutMs });
    await pwLocator.dispatchEvent('dragenter', { dataTransfer });
    await pwLocator.dispatchEvent('dragover', { dataTransfer });
    await pwLocator.dispatchEvent('drop', { dataTransfer });
  });
}
