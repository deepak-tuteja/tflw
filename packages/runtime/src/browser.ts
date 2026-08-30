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
import { allowHostsRefusal, isHostAllowed } from './allowHosts.js';
import { inferContentType } from './mime.js';
import { computePlatformKey } from './snapshot.js';
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

/** D15's own stated philosophy (`snapshot.ts`): "font hinting/subpixel AA between two OSes/engines
 * never reconciles" — a mismatch is meant to be a hard platform-key error, never a fuzzy tolerance
 * knob. That assumes a matching platform key actually renders byte-identically, which Chromium
 * doesn't do by default: it defers glyph rasterization to the host's own FreeType/fontconfig, so
 * even the exact same embedded `@font-face` file can come out subtly different on two Linux
 * distros with different FreeType/fontconfig builds (surfaced via testFlow-tests M45's dogfood: a
 * self-hosted webfont still didn't reconcile a real Fedora-dev-vs-ubuntu-latest-CI pixel diff,
 * ~2% differed, purely from AA/hinting — same platform key, genuinely different renders).
 * `--font-render-hinting=none`/`--disable-lcd-text` push Chromium onto its own internal rendering
 * path instead of the host's hinting/subpixel-AA behavior, and `--force-color-profile=srgb` removes
 * a similar ICC-profile source of drift — closing the gap D15 assumed platform-pinning alone
 * already closed. Chromium-only: Firefox/WebKit don't take Chromium's CLI flag surface. */
export function chromiumDeterministicRenderArgs(engine: BrowserEngine): string[] | undefined {
  return engine === 'chromium'
    ? ['--font-render-hinting=none', '--disable-lcd-text', '--force-color-profile=srgb']
    : undefined;
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
      this.browserPromise = loadPlaywright().then((pw) =>
        pw[this.engine].launch({ headless: this.headless, args: chromiumDeterministicRenderArgs(this.engine) }),
      );
    }
    return this.browserPromise;
  }

  /** `linux-chromium-131.0.6778.33` (M4b, D15) — `snapshot.ts#computePlatformKey`, this run's own
   * engine plus the actually-launched build's real version string. Requires the browser to already
   * be running (`browser.version()`), so this necessarily launches it if nothing has yet — same
   * lazy-launch cost every other browser step already pays on first use. */
  async platformKey(): Promise<string> {
    const browser = await this.getBrowser();
    return computePlatformKey(this.engine, browser.version());
  }

  /**
   * `M111` (review row `B6-03`) — teardown never re-raises a launch that already failed.
   *
   * `getBrowser()` memoizes the launch *promise*, so a rejected launch stays on the field. The step
   * that triggered it handled the rejection and failed its test normally; this then re-awaited the
   * same rejected promise and threw it a second time. The CLI awaits `close()` **outside** the
   * per-file `try/catch`, after the summary and every artifact write, so that second throw reached
   * `main`'s top-level `.catch` → `err(message)` → `process.exit(EXIT_USAGE)`.
   *
   * Measured: one passing API test plus one browser test whose launch fails prints
   * `FAIL 1/2 passed, 1 failed`, writes `report.html`, `junit.xml` and `results.json` in full — and
   * then exits `2`, which `cli.ts` defines as "usage / config error — could not run". A run that
   * produced a complete report demonstrably could. It also printed the same message a third time,
   * after the summary, having already printed it live and in the failing step.
   *
   * The missing `playwright` peer is only the cheapest way to reach this; the repro that confirmed
   * it used a **missing browser binary**, which is the far more common first-run case. Every
   * `browser.launch()` failure takes this path: no binary downloaded, a sandbox refusal, a corrupt
   * install.
   *
   * Swallowing is correct *here specifically* and nowhere else: this is teardown for a launch whose
   * failure has already been reported through the step that requested it, so the only thing
   * re-raising can add is a second, worse-attributed copy. A `browser.close()` that itself fails is
   * a different event and still propagates.
   */
  async close(): Promise<void> {
    if (!this.browserPromise) return;
    const browser = await this.browserPromise.catch(() => undefined);
    if (browser) await browser.close();
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
 * or not — `armedDialogs` is one queue shared across tabs, matching the language's "the next
 * dialog, wherever it fires" framing (SPEC §9.1/§9.5). Sharing it is the point: an arming made
 * before a `switch to new tab` is still answered by whatever raises next. */
/** The four native modal kinds a browser raises, as Playwright's `dialog.type()` reports them
 * (`D799`). A closed set, stated here and in `SPEC` §9.1 so a reader knows the four values without
 * reading Playwright's documentation. */
export type DialogKind = 'alert' | 'confirm' | 'prompt' | 'beforeunload';

/** One `accept dialog`/`dismiss dialog`, waiting for a dialog to consume it (`D797`). `text` is
 * `accept dialog with "…"`'s prompt answer (`D800`) and is `undefined` when the step omitted it,
 * which is not the same as the empty string: omitted means *accept with Playwright's default*,
 * and `with ""` means *answer this prompt with nothing*. */
export interface DialogArming {
  readonly which: 'accept' | 'dismiss';
  /** `D800` — the `with` answer, already evaluated at arming time. `undefined` on a bare `accept
   * dialog`, which is not the same as `''`: `dialog.accept()` with no argument and with the empty
   * string behave identically on a prompt, but the distinction is what lets `TF080` fire only
   * where an answer was actually written. */
  readonly text?: string;
  /** Where the arming was written. Carried because `TF080` must point at the `accept dialog with`
   * line — the dialog itself has no line, and by the time it fires the arming step is long past. */
  readonly line: number;
  readonly source: string;
}

export class BrowserPageState {
  private pages: PWPage[] = [];
  private activeIndex = 0;
  private context: PWBrowserContext | undefined;
  /** FS-01 (review finding V2-01): binary evidence exists only at `evidence full`. A trace archive
   * is a time-travel recording of the rendered page — DOM, network bodies, per-action screenshots —
   * and **no redactor reaches rendered pixels**, so the only promise the tool can keep about a
   * captured trace is "we didn't capture it". Below `full` tracing is therefore never *started*,
   * not merely discarded at the end: `finish()`'s decision is about whether an archive is worth
   * keeping, and that question shouldn't be reachable when the archive must not exist. Defaults to
   * `true` so a hand-built harness (and `browser-steps.test.ts`) behaves as it did before FS-01. */
  private readonly captureBinaryEvidence: boolean;
  /** This env's `allow hosts` list (SPEC §3.7), or `null` for no enforcement. M85, review finding
   * `B4-03`: the guardrail whose stated purpose is anti-pointed-at-prod had **three** call sites,
   * all in `interpreter.ts`, all on the API half — so one run, one config, one host would refuse
   * `api other GET /echo` and then happily `open` a page on that same host. The browser is the half
   * of the tool most likely to be aimed at a real environment by accident, and it was the half with
   * no guard at all. */
  private readonly allowHosts: readonly string[] | null;
  /** The first request this attempt refused, kept until a step boundary reads it (see
   * `takeHostRefusal`). */
  private hostRefusal: string | null = null;

  constructor(captureBinaryEvidence = true, allowHosts: readonly string[] | null = null) {
    this.captureBinaryEvidence = captureBinaryEvidence;
    this.allowHosts = allowHosts;
  }
  /** `M159`/`D797`. Set by `accept dialog`/`dismiss dialog` — **a queue, not a slot**, and that is
   * the whole repair. Each arming is consumed by exactly one dialog, in order, which is what SPEC
   * §9.1's *one-shot* was always trying to say; a single field was an implementation choice the
   * sentence never required.
   *
   * A slot loses arms silently, and the case is **inexpressible** rather than merely awkward: two
   * `confirm()`s raised by one `click` cannot have a step interleaved between them, so two
   * consecutive armings is the only spelling the language has — and under a slot the second dialog
   * was dismissed while nothing refused the program (`M154b-02`).
   *
   * An empty queue keeps today's behaviour exactly: dismiss, which is what an unarmed page already
   * does, because Playwright's unhandled default is dismissal. */
  readonly armedDialogs: DialogArming[] = [];
  /** `D803`. The last dialog **of this attempt**, never of the run: a fresh `BrowserPageState` is
   * built per test attempt, the same invariant `networkLog` states below. Both `dialog message` and
   * `dialog type` read these, so a subject whose scope a reader has to infer does not exist here. */
  lastDialogMessage: string | null = null;
  lastDialogType: DialogKind | null = null;
  /** `D802` — how many armings this attempt has raised a dialog for, against how many were made.
   * Free to count under a queue and invisible under a slot, which is why the warning could not have
   * existed before `D797`. */
  dialogsArmed = 0;
  dialogsRaised = 0;
  /** M3d, SPEC §9.7 — every completed network response observed across every page opened this
   * attempt, in completion order. Resets naturally: a fresh `BrowserPageState` is created per test
   * attempt (`runTestAttempt`, interpreter.ts), same as the trace/screenshot state. */
  private networkLog: CapturedNetworkRequest[] = [];

  private wireDialogHandler(page: PWPage): void {
    page.on('dialog', (dialog) => {
      // Shift, not read-and-clear: each arming is consumed by one dialog, in order (`D797`).
      const armed = this.armedDialogs.shift();
      const kind = dialog.type() as DialogKind;
      this.lastDialogMessage = dialog.message();
      this.lastDialogType = kind;
      this.dialogsRaised += 1;
      // `D801`: Playwright silently ignores `promptText` on a non-prompt, which is the exact
      // silent-no-op class this milestone removes — so the mismatch is recorded for the runtime to
      // warn about. It is not an error: a page that conditionally raises either kind is legitimate,
      // and the kind is not knowable statically.
      if (armed?.text !== undefined && kind !== 'prompt') {
        this.dialogTextIgnored.push({ text: armed.text, kind, line: armed.line, source: armed.source });
      }
      void (armed?.which === 'accept' ? dialog.accept(armed.text) : dialog.dismiss());
    });
  }

  /** `D801` — armings that carried text a non-prompt dialog could not take, drained into `TF080`
   * at the end of the attempt. Recorded rather than thrown: a page that raises either an `alert` or
   * a `confirm` depending on state is legitimate, and which one fired is not knowable until it
   * does. */
  readonly dialogTextIgnored: { text: string; kind: DialogKind; line: number; source: string }[] = [];

  /** M3d — passive observation only (never modifies the response, unlike `stub`'s `page.route`).
   * Reading the body is best-effort: a response that can't be read as text (redirect with no body,
   * an opaque/binary payload) still gets logged for `was made`, just with a null body. Errors here
   * must never propagate — a network-capture bug can't be allowed to crash an otherwise-passing
   * browser step. */
  /** `allow hosts` for the browser half (M85, `B4-03`). One blanket context route, registered
   * before the first page exists, so nothing this context sends can get out ahead of it.
   *
   * **Scope: every request, not just navigations.** SPEC §3.7 says "covers every real network call
   * a run makes", and the modern shape of pointing a test at prod isn't a `open "https://prod…"` —
   * it's a staging page whose bundle calls `https://api.prod…` over XHR. Guarding navigation alone
   * would leave exactly that case open while reading as covered.
   *
   * `route.abort()` is what makes this a guardrail rather than a report: the request is refused in
   * the browser, before a connection, which is the same promise the API half keeps.
   *
   * Registered **only** when a list is actually declared. Routing every request through a handler
   * is not free — it disables some of the browser's own fast paths and is observable in timing —
   * and a run that never wrote `allow hosts` must behave exactly as it did before this milestone.
   * The same opt-in split `http.ts#mustFollowByHand` makes, for the same reason.
   *
   * Page-level routes (`stub`, SPEC §9.6) are registered later and on the page, and Playwright runs
   * page routes ahead of context routes — so a stubbed call is fulfilled locally and never reaches
   * this handler. That ordering is the correct semantics, not a loophole: a stubbed request is not
   * a real network call, and `allow hosts` is about real ones. */
  private async wireAllowHostsGuard(context: PWBrowserContext): Promise<void> {
    const allowHosts = this.allowHosts;
    if (!allowHosts || allowHosts.length === 0) return;
    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = request.url();
      if (isHostAllowed(url, allowHosts)) {
        // `route.continue()`, not `route.fallback()`. `fallback()` defers to the *next matching
        // handler*, and this guard is registered first, at context creation, so at the moment it
        // runs there is by construction nothing left to defer to — the request simply never went
        // out, and a run with `allow hosts` declared could not load an allowed page either.
        // Verified, not assumed: with `fallback()` the allowed-host repro failed identically to the
        // blocked one.
        await route.continue();
        return;
      }
      // First one only: a blocked page typically retries or cascades (a failed bundle takes its
      // API calls with it), and the tenth refusal explains nothing the first didn't.
      this.hostRefusal ??= allowHostsRefusal(url, allowHosts, {
        kind: 'browser',
        navigation: request.isNavigationRequest(),
        pageUrl: request.frame()?.url() || '(not yet loaded)',
        resourceType: request.resourceType(),
      });
      await route.abort('blockedbyclient');
    });
  }

  /** The refusal to raise, if this attempt has one pending, clearing it as it's read (M85).
   *
   * A refusal can't simply throw from the route handler — the handler runs on Playwright's own
   * event loop, with no step to attach a failure to. So it's recorded there and collected at the
   * next step boundary (`execSteps`), which covers both shapes: a *navigation* that was blocked
   * makes `page.goto` reject with a bare `net::ERR_FAILED`, and this is what replaces that with the
   * reason; a blocked *subresource* fails nothing on its own, and this is what keeps it from
   * passing silently into a confusing downstream assertion. */
  takeHostRefusal(): string | null {
    const refusal = this.hostRefusal;
    this.hostRefusal = null;
    return refusal;
  }

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
      // Started for the whole attempt whenever binary evidence is allowed at all (M3c, D12) —
      // cheap enough to always run; `finish()` below decides at the *end* of the attempt whether
      // it's worth keeping (failure, or a retry attempt), discarding it otherwise. `sources: true`
      // lets a trace viewer show the actual `.tflw` source alongside the DOM/network timeline.
      // Below `evidence full` it never starts at all (FS-01) — see `captureBinaryEvidence`.
      await this.wireAllowHostsGuard(this.context);
      if (this.captureBinaryEvidence) await this.context.tracing.start({ screenshots: true, snapshots: true, sources: true });
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
    // Nothing was ever recorded below `evidence full` (FS-01), so there is no archive to stop or
    // keep — `tracing.stop()` on a context that never started tracing is not a supported call.
    if (!this.captureBinaryEvidence) {
      await this.close();
      return undefined;
    }
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

/** `expect page|<locator> matches snapshot "<name>" [mask <locator>]*` (M4b, D15) — captures either
 * the whole page or a single element's own bounding box, painting solid boxes over `masks` first
 * (Playwright's own `mask` screenshot option — the exact mechanism D15 asks for, not a tflw-owned
 * reimplementation). `target` is `null` for a `page` subject, a resolved `PWLocator` for a
 * `LocatorSubject` one. */
export async function performSnapshotCapture(page: PWPage, target: PWLocator | null, masks: readonly PWLocator[]): Promise<Buffer> {
  const opts = { type: 'png' as const, ...(masks.length > 0 ? { mask: [...masks] } : {}) };
  return runAction('matches snapshot', () => (target ? target.screenshot(opts) : page.screenshot(opts)));
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

/** How long a locator may go unresolved before `resolveLocator` says so out loud (`FU-14`, D248).
 * Not a new deadline and not a fast-fail — the step still polls to its own timeout. */
const SPECULATIVE_DIAGNOSIS_MS = 3000;

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
 * element is not the same failure as a genuinely missing one, D9's spirit). Throws immediately —
 * never waits out the rest of the timeout — on real ambiguity (D7: strict, N>1 is always an
 * error). A persistent zero-match failure gets the live-DOM "nearest candidate" diagnosis (M5,
 * `diagnoseMissingLocator` below) appended before throwing. */
export async function resolveLocator(scope: LocatorScope, locatorAst: LocatorAst, ctx: EvalCtx, timeoutMs: number): Promise<ResolvedLocator> {
  const name = String(evalValue(locatorAst.value, ctx));
  const attempts = candidateStrategies(scope, locatorAst.kind, name);
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  // Speak only when at least as much waiting would remain as has already passed — under a step
  // timeout of 3 s or so the line would land a blink before the failure it precedes and be pure
  // noise. `M119`'s guard is untouched: this is progress, and the diagnosis still fires exactly
  // once, at the end, on the step's final failure.
  const speakAt = timeoutMs > SPECULATIVE_DIAGNOSIS_MS * 2 ? startedAt + SPECULATIVE_DIAGNOSIS_MS : undefined;
  let spoken = false;
  for (;;) {
    for (const attempt of attempts) {
      const count = await attempt.pwLocator.count();
      if (count === 1) return attempt;
      if (count > 1) throw await ambiguityError(locatorAst, name, attempt, count);
    }
    if (Date.now() >= deadline) {
      const triedVia = attempts.map((a) => a.via).join(', ');
      const suffix = attempts.length > 1 ? ` — tried ${triedVia}, none matched` : '';
      const diagnosis = await diagnoseMissingLocator(scope, locatorAst.kind, name);
      throw new RuntimeError(`no element found for ${describeLocator(locatorAst.kind, name)}${suffix}${diagnosis}`);
    }
    if (speakAt !== undefined && !spoken && Date.now() >= speakAt) {
      spoken = true;
      await announceStillWaiting(scope, locatorAst.kind, name, timeoutMs);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

/** `FU-14`/D248. The most common UI authoring error — a typo in a locator name — used to buy 30.4 s
 * of unbroken silence and then a good diagnosis; measured on the box, all eleven console lines of
 * the run landed within 12 ms of each other at the very end. The complaint in the row is the
 * silence, not the thirty seconds, and the silence is the part that can be fixed without changing
 * what passes: a slow-rendering app that resolves at 8 s still resolves at 8 s.
 *
 * **Console only, and deliberately not buffered.** `--verbose` step logs are collected per file and
 * flushed as a block under `--parallel > 1` so they never interleave; this line is the one piece of
 * output where that treatment would destroy the entire point, since it would then arrive *after*
 * the failure it exists to pre-empt. It also adds no event to the stream — a progress line is not a
 * result (C4/`B3-05`).
 *
 * It speaks even when nothing on the page resembles the name. That case is the one the row's own
 * re-measurement singled out as worst: against a page with no near-miss, the wait is not even paid
 * off with a suggestion at the end. */
async function announceStillWaiting(scope: LocatorScope, kind: LocatorKind, name: string, timeoutMs: number): Promise<void> {
  const described = describeLocator(kind, name);
  const closest = (await nearestCandidates(scope, kind, name).catch(() => []))[0];
  const seconds = (ms: number): string => `${Math.round(ms / 1000)}s`;
  const detail = closest
    ? `the closest thing on the page is ${closest.suggestion}`
    : 'nothing on the page resembles it yet';
  process.stderr.write(`⏳ tflw: still nothing matching ${described} after ${seconds(SPECULATIVE_DIAGNOSIS_MS)} — ${detail}; still waiting, up to ${seconds(timeoutMs)}\n`);
}

const MAX_AMBIGUITY_CANDIDATES = 5;

/** One matched element, as the ambiguity message needs to talk about it: what it says, and the one
 * fact that tells it apart from its identical siblings (`M125c`, `FU-21`). */
export interface AmbiguousMatch {
  readonly text: string;
  /** Already rendered — `data-testid="save-profile"`, `in "Billing"` — or null when the page offers
   * nothing at all and the ordinal is the only handle there is. */
  readonly discriminator: string | null;
}

/** **One query.** `count` and the descriptions used to come from two independent round-trips — the
 * caller's `.count()` and this function's own `.all()` — against a DOM that can change between
 * them, which is the only explanation for `FU-21`'s filed "2 matches, 1 candidate shown, … and 1
 * more" (D253). Everything the message says now derives from a single in-page evaluation, so the
 * arithmetic is consistent by construction rather than by luck.
 *
 * It is also strictly cheaper than what it replaces: one `evaluateAll` instead of a `.count()`, an
 * `.all()`, and N `innerText()` calls. */
async function describeAmbiguousMatches(pwLocator: PWLocator): Promise<AmbiguousMatch[]> {
  try {
    // No named inner bindings — see `scanDomCandidates`' comment; this callback is serialized into
    // the page and a `__name` helper reference would not exist there.
    return await pwLocator.evaluateAll((els: Element[]) => {
      const out: { text: string; discriminator: string | null }[] = [];
      for (const el of els) {
        let raw = (el as HTMLElement).innerText ?? el.textContent ?? '';
        if (!raw.trim()) raw = (el as HTMLInputElement).value ?? '';
        const text = raw.trim().replace(/\s+/g, ' ').slice(0, 80);

        // The cascade, most-specific first: something a human can paste, then something a human can
        // read. `id` and `data-testid` are stable handles; `aria-label` is what the control calls
        // itself; a labelled or headed container is where it lives.
        let discriminator: string | null = null;
        const testid = el.getAttribute('data-testid');
        const aria = el.getAttribute('aria-label');
        if (testid?.trim()) {
          discriminator = `data-testid="${testid.trim()}"`;
        } else if (el.id) {
          discriminator = `id="${el.id}"`;
        } else if (aria?.trim()) {
          discriminator = `aria-label="${aria.trim()}"`;
        } else {
          let node: Element | null = el.parentElement;
          while (node && !discriminator) {
            const tag = node.tagName.toLowerCase();
            const containerLabel = node.getAttribute('aria-label');
            if (containerLabel?.trim()) {
              discriminator = `in "${containerLabel.trim().slice(0, 60)}"`;
            } else if (['section', 'nav', 'main', 'aside', 'header', 'footer', 'form', 'article', 'li', 'fieldset'].includes(tag)) {
              const heading = node.querySelector('h1, h2, h3, h4, h5, h6, legend');
              const headingText = heading?.textContent?.trim();
              if (headingText) discriminator = `in "${headingText.replace(/\s+/g, ' ').slice(0, 60)}"`;
            }
            node = node.parentElement;
          }
        }

        out.push({ text, discriminator });
      }
      return out;
    });
  } catch {
    return []; // a page that navigated mid-description must not replace the real failure
  }
}

/** Pure, so the degenerate branch below is reachable from a unit test rather than only from a race
 * nobody can stage on demand. */
export function formatAmbiguity(described: string, via: string, observedCount: number, matches: readonly AmbiguousMatch[]): string {
  const tail = 'narrow it with `within <container>`, or make the name more specific (SPEC §9.3)';
  // The caller counted N>1 and threw; if the single describing query then sees fewer than two, the
  // page settled in between. Saying "matched 1 elements" would be internally consistent and
  // actively misleading, so the race is named instead of smoothed over.
  if (matches.length < 2) {
    return (
      `ambiguous locator ${described} (resolved via ${via}) — matched ${observedCount} elements when the step ran, ` +
      `but the page changed while the failure was being described (it now matches ${matches.length}), so there is no stable list to show\n${tail}`
    );
  }
  const shown = matches.slice(0, MAX_AMBIGUITY_CANDIDATES);
  const descriptions = shown.map((m, i) => {
    const text = m.text ? JSON.stringify(m.text) : '(no visible text)';
    return `  ${i + 1}. ${text}${m.discriminator ? ` — ${m.discriminator}` : ''}`;
  });
  const more = matches.length > shown.length ? `\n  … and ${matches.length - shown.length} more` : '';
  return `ambiguous locator ${described} (resolved via ${via}) — matched ${matches.length} elements:\n${descriptions.join('\n')}${more}\n${tail}`;
}

async function ambiguityError(
  locatorAst: LocatorAst,
  name: string,
  attempt: { readonly pwLocator: PWLocator; readonly via: string },
  observedCount: number,
): Promise<RuntimeError> {
  const matches = await describeAmbiguousMatches(attempt.pwLocator);
  return new RuntimeError(formatAmbiguity(describeLocator(locatorAst.kind, name), attempt.via, observedCount, matches));
}

// ---- M5: live-DOM "nearest candidate" diagnosis (SPEC §9.3) ---------------------------------
//
// A persistently-unresolved semantic locator (button/field/text/list — `css`/`xpath` are the
// explicit escape hatch and have no semantic name to fuzzy-match against, so they're skipped) gets
// one extra round-trip: scan the live DOM for elements of the right shape, rank them by how close
// their computed name is to what the author typed, and print the closest few as ready-to-paste
// tflw locators. An element with no usable name at all (icon-only buttons, e.g.) still gets
// surfaced via a generated CSS selector rather than being silently dropped — "including generated
// CSS/XPath when nothing semantic exists" (PLAN.md §9) — but only for the kinds where an unnamed
// element is still a candidate at all; see `UNNAMED_IS_STILL_A_CANDIDATE`, which `text` is
// deliberately not in (`M119-01`). This is a diagnosis, not a fallback: it
// never changes which element a step actually acts on, only what the failure message suggests.

const DIAGNOSIS_SCAN_CSS: Partial<Record<LocatorKind, string>> = {
  button: 'button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"], a[role="button"]',
  field: 'input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="hidden"]), textarea, select, [role="textbox"]',
  text: '*',
  list: 'ul, ol, [role="list"]',
};

/** Kinds where an element the scan could not name is *still* a real candidate, and so is worth
 * surfacing via a generated CSS path (PLAN.md §9). Opt-in, not a `!== 'text'` exclusion, so a kind
 * added to `DIAGNOSIS_SCAN_CSS` later has to answer this question rather than inherit an answer:
 * of the two ways to be wrong, offering a ready-to-paste locator that cannot be what the author
 * meant is worse than omitting one that might have been.
 *
 * `text` is deliberately absent (`M119-01`). For `button`/`field`/`list` the scan is shape-scoped,
 * so an unnamed hit is a genuine control that merely lacks an accessible name — an icon-only
 * button is exactly the case the arm was written for, and a CSS path is the only way to name it.
 * For `text` the scan is `*` and a name is only computed for leaves, so *every* element with
 * children lands in the unnamed arm: on the four-element `/diagnose` fixture,
 * `text "Somethign Unrelated"` answered with `css "html"`, `css "html > head"`,
 * `css "html > body"` and two more — structural containers in document order, one of which can
 * never be visible, none of which has any relationship to what was typed. The arm scores 0 and is
 * appended without passing `MIN_DIAGNOSIS_SIMILARITY`, so on a real page it also crowds out the
 * ranked matches it sits behind. An element with no text is not a near-miss for a text locator;
 * it is not a candidate at all, and the honest answer is the unchanged message. */
const UNNAMED_IS_STILL_A_CANDIDATE: Partial<Record<LocatorKind, true>> = { button: true, field: true, list: true };

const MAX_DIAGNOSIS_CANDIDATES = 5;
const MIN_DIAGNOSIS_SIMILARITY = 0.3;

interface DomCandidateRaw {
  readonly name: string | null;
  readonly cssPath: string;
}

/** Hand-rolled Levenshtein distance — no dependency justified for ~15 lines (contrast `pixelmatch`,
 * added in M4b only because pixel-diffing genuinely isn't a from-scratch afternoon). */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] = a[i - 1] === b[j - 1] ? dp[i - 1]![j - 1]! : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
    }
  }
  return dp[m]![n]!;
}

/** 1.0 = identical, 0 = nothing in common. A containment match (typed text is a substring of the
 * candidate's name, or vice versa — the common case of comparing a short typed name against a
 * longer real label) is deliberately scored above plain edit-distance so `field "Email"` ranks a
 * real `field "Email address"` ahead of an unrelated same-length label a few edits away. */
function similarity(typed: string, candidate: string): number {
  const a = typed.toLowerCase().trim();
  const b = candidate.toLowerCase().trim();
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (b.includes(a) || a.includes(b)) return 0.85;
  return Math.max(0, 1 - editDistance(a, b) / Math.max(a.length, b.length));
}

/** Runs entirely inside the page (Playwright serializes this function into the browser) — DOM
 * access has to happen there. Computes, per candidate element: its best-effort accessible name
 * (aria-label → the kind-specific tier: field's own label/placeholder, a leaf text node for
 * `text`, else innerText/value) and a generated CSS selector good enough to paste (`#id` →
 * `data-testid` → `name` attr → a short tag+nth-of-type path up to 4 ancestors). */
async function scanDomCandidates(scope: LocatorScope, kind: LocatorKind): Promise<DomCandidateRaw[]> {
  const css = DIAGNOSIS_SCAN_CSS[kind];
  if (!css) return []; // css/xpath: no semantic name to scan for
  try {
    // Deliberately has NO named inner function/const bindings (`cssPathFor`, `labelFor`, …) —
    // Playwright serializes this callback via `.toString()` and re-evaluates it inside the page's
    // own isolated realm, which doesn't share this module's scope. Under some build/dev-loader
    // pipelines (esbuild's name-preservation transform, used by `tsx` here) a named function
    // binding gets rewritten to call a `__name` helper that only exists in *this* module — that
    // helper reference then throws `ReferenceError: __name is not defined` once the string is
    // re-parsed with no such helper in scope. Anonymous callback arguments (`.filter((c) => …)`)
    // are unaffected, so the fix is inlining rather than factoring into named helpers.
    return await scope.locator(css).evaluateAll((els: Element[], k: string) => {
      const seen = new Set<Element>();
      const out: { name: string | null; cssPath: string }[] = [];
      for (const el of els) {
        if (seen.has(el)) continue;
        seen.add(el);

        let cssPath: string;
        if (el.id) {
          cssPath = `#${CSS.escape(el.id)}`;
        } else if (el.getAttribute('data-testid')) {
          cssPath = `[data-testid="${el.getAttribute('data-testid')}"]`;
        } else if (el.getAttribute('name')) {
          cssPath = `${el.tagName.toLowerCase()}[name="${el.getAttribute('name')}"]`;
        } else {
          const parts: string[] = [];
          let node: Element | null = el;
          for (let i = 0; i < 4 && node; i++) {
            let part = node.tagName.toLowerCase();
            const parent: Element | null = node.parentElement;
            if (parent) {
              const siblings = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
              if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
            }
            parts.unshift(part);
            node = parent;
          }
          cssPath = parts.join(' > ');
        }

        let name: string | null = null;
        const ariaLabel = el.getAttribute('aria-label');
        if (ariaLabel?.trim()) {
          name = ariaLabel.trim();
        } else if (k === 'field') {
          let label: string | null = null;
          const id = el.getAttribute('id');
          if (id) {
            const lbl = document.querySelector(`label[for="${CSS.escape(id)}"]`);
            if (lbl?.textContent?.trim()) label = lbl.textContent.trim();
          }
          if (!label) {
            const parentLabel = el.closest('label');
            if (parentLabel?.textContent?.trim()) label = parentLabel.textContent.trim();
          }
          if (label) {
            name = label;
          } else {
            const ph = el.getAttribute('placeholder');
            name = ph?.trim() ? ph.trim() : null;
          }
        } else if (k === 'text') {
          if (el.children.length === 0) {
            const t = (el.textContent ?? '').trim();
            name = t.length > 0 && t.length < 120 ? t : null;
          }
        } else {
          const text = (el as HTMLElement).innerText?.trim();
          if (text) {
            name = text;
          } else {
            const value = (el as HTMLInputElement).value;
            name = value?.trim() ? value.trim() : null;
          }
        }

        out.push({ name, cssPath });
      }
      return out;
    }, kind);
  } catch {
    return []; // best-effort diagnosis — never let a scan failure mask the real "not found" error
  }
}

/** Empty string when nothing plausible was found (leaves the caller's message unchanged) — never
 * itself the failure, only ever appended to one.
 *
 * Exported since `B4-08`: the assertion path (`execUiExpect`/`execWaitUntilUi` in interpreter.ts)
 * resolves through `resolveLocatorSnapshot`, which — correctly — treats zero matches as an
 * observation rather than an error, and so never reached the `resolveLocator` throw site this
 * used to be private to. The diagnosis is about the *name*, not about how the caller feels about
 * a zero count, so both paths get it. */
export async function diagnoseMissingLocator(scope: LocatorScope, kind: LocatorKind, typedName: string): Promise<string> {
  return renderNearestCandidates(await nearestCandidates(scope, kind, typedName));
}

/** A suggestion, plus the fact that decides whether it is usable: how many elements on the page
 * render to this exact string (`M125c`, `B4-11`). */
export interface NearestCandidate {
  readonly suggestion: string;
  readonly score: number;
  readonly matches: number;
}

/** Collapses byte-identical suggestions, keeping first-seen order (the caller sorts by score before
 * calling, so first-seen *is* best-first) and the best score in each group.
 *
 * `B4-11`: two `Save` buttons produced the list ``- `button "Save"`` twice, and SPEC §9.3 calls
 * these ready-to-paste. Measured on a twelve-control page the defect is worse than duplication —
 * all five slots of `MAX_DIAGNOSIS_CANDIDATES` were the *same* string, so a genuinely different
 * candidate could not be shown at all. Deduping before the slice is what returns those slots. */
export function dedupeCandidates(entries: readonly { suggestion: string; score: number }[]): NearestCandidate[] {
  const groups = new Map<string, { suggestion: string; score: number; matches: number }>();
  for (const entry of entries) {
    const existing = groups.get(entry.suggestion);
    if (existing) {
      existing.matches += 1;
      if (entry.score > existing.score) existing.score = entry.score;
    } else {
      groups.set(entry.suggestion, { suggestion: entry.suggestion, score: entry.score, matches: 1 });
    }
  }
  return [...groups.values()];
}

/** Deduping alone would still hand back a locator that cannot work: one `button "Save"` pasted into
 * a page with two of them fails with the *ambiguity* error, which is a different failure than the
 * one being diagnosed — `B4-11`'s actual complaint. So a non-unique suggestion says so, and names
 * the way out, rather than being quietly offered as if it were ready to paste. */
export function renderNearestCandidates(candidates: readonly NearestCandidate[]): string {
  if (candidates.length === 0) return '';
  const lines = candidates.map((c) => {
    const caveat = c.matches > 1 ? ` — ${c.matches} elements render this same locator, so pasting it as-is is ambiguous; add \`within <container>\`` : '';
    return `    - ${c.suggestion}${caveat}`;
  });
  return `\n  nearest matches on the page:\n${lines.join('\n')}`;
}

/** Exported for `FU-14`'s speculative line, which needs the closest candidate rather than the whole
 * rendered block. */
export async function nearestCandidates(scope: LocatorScope, kind: LocatorKind, typedName: string): Promise<NearestCandidate[]> {
  const raw = await scanDomCandidates(scope, kind);
  const named = raw
    .filter((c): c is { name: string; cssPath: string } => !!c.name)
    .map((c) => ({ suggestion: describeLocator(kind, c.name), score: similarity(typedName, c.name) }))
    .filter((c) => c.score >= MIN_DIAGNOSIS_SIMILARITY)
    .sort((a, b) => b.score - a.score);
  const unnamed = UNNAMED_IS_STILL_A_CANDIDATE[kind] ? raw.filter((c) => !c.name).map((c) => ({ suggestion: `css ${JSON.stringify(c.cssPath)}`, score: 0 })) : [];
  return dedupeCandidates([...named, ...unnamed]).slice(0, MAX_DIAGNOSIS_CANDIDATES);
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

// ---- M5: `tflw pick <url>` (SPEC §12) ---------------------------------------------------------
//
// Opens a real headed browser at a URL, lets a human click an element, and prints the best tflw
// locator for it — reusing this module's own resolution model (`candidateStrategies`, D6) to
// *verify* the guess, not just print a plausible-looking one: a suggestion only ever gets printed
// once Node has confirmed it resolves to exactly one element (D7) and that element is the one that
// was actually clicked. Falls back to a generated CSS selector when no semantic name round-trips
// (an icon-only button, e.g.) — same "always give the author something to paste" spirit as the M5
// diagnosis above, just verified rather than best-effort-ranked.
//
// `installPickClickCapture` is passed BY REFERENCE to `page.addInitScript` — Playwright serializes
// it via `.toString()` and re-runs it inside the page's own isolated realm. It deliberately has NO
// nested named function/const bindings in its body, for the same reason `scanDomCandidates` above
// doesn't: some build/dev-loader pipelines (esbuild's name-preservation transform, used by `tsx`)
// rewrite a *nested* named binding into a call to a `__name` helper that only exists in this
// module, throwing `ReferenceError: __name is not defined` once the extracted text is re-parsed
// with no such helper in scope. A plain top-level named function with no such nesting serializes
// cleanly (verified empirically) — keep it that way if this ever needs another helper.

const PICK_MARKER_ATTR = 'data-tflw-pick';

export type PickLocatorKind = 'button' | 'field' | 'list' | 'text' | 'css';

export interface PickedLocator {
  /** Ready to paste as-is, e.g. `button "Add to Cart"` — no surrounding backticks. */
  readonly syntax: string;
  readonly via: PickLocatorKind;
}

/** Best-effort per-kind name guesses for the just-clicked element, plus a generated CSS fallback —
 * computed entirely in the page (`installPickClickCapture`), verified against the live DOM in
 * Node (`resolvePickedLocator`) before anything is ever printed. */
interface RawPickInfo {
  readonly buttonName: string | null;
  readonly fieldName: string | null;
  readonly listName: string | null;
  readonly textName: string | null;
  readonly cssPath: string;
  readonly primaryKind: 'button' | 'field' | 'list' | 'text' | null;
}

/** `page.addInitScript` callback (re-attaches on every navigation, so picking survives the user
 * clicking a real link before `preventDefault` stops it) — captures the next click anywhere on the
 * page, marks the clicked element (`data-tflw-pick="1"`; any prior mark is cleared first, so a
 * fast double-click can't leave two elements marked), gives it a brief visual highlight, and
 * reports its per-kind name guesses up to Node via `window.__tflwPickReport`. `preventDefault`/
 * `stopPropagation` keep picking inert — clicking a link or a submit button identifies it without
 * actually navigating or submitting. */
function installPickClickCapture(marker: string): void {
  document.addEventListener(
    'click',
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      const el = event.target;
      if (!(el instanceof Element)) return;

      document.querySelectorAll(`[${marker}]`).forEach((prior) => prior.removeAttribute(marker));
      el.setAttribute(marker, '1');
      const prevOutline = (el as HTMLElement).style.outline;
      (el as HTMLElement).style.outline = '3px solid #ff5252';
      setTimeout(() => {
        (el as HTMLElement).style.outline = prevOutline;
      }, 500);

      const tag = el.tagName;
      const ariaLabel = el.getAttribute('aria-label');

      let buttonName: string | null = null;
      if (ariaLabel?.trim()) {
        buttonName = ariaLabel.trim();
      } else {
        const text = (el as HTMLElement).innerText?.trim();
        if (text) {
          buttonName = text;
        } else {
          // `el` is only *cast* to HTMLInputElement — a custom element can genuinely define its own
          // `value` property of any type (e.g. a shadow-DOM `<star-rating>` widget whose `value` is
          // a number, testFlow-tests webV2 M42 dogfooding). `value?.trim` only guards against a
          // nullish `value`, not a wrong-typed one — a non-nullish, non-string `value` (like a real
          // `0`) still reaches `.trim()` and throws inside this page-injected click listener,
          // silently killing the whole pick report for that click (uncaught in the page, invisible
          // at the CLI).
          const value: unknown = (el as HTMLInputElement).value;
          buttonName = typeof value === 'string' && value.trim() ? value.trim() : null;
        }
      }

      let fieldName: string | null = null;
      if (ariaLabel?.trim()) {
        fieldName = ariaLabel.trim();
      } else {
        let label: string | null = null;
        const id = el.getAttribute('id');
        if (id) {
          const lbl = document.querySelector(`label[for="${CSS.escape(id)}"]`);
          if (lbl?.textContent?.trim()) label = lbl.textContent.trim();
        }
        if (!label) {
          const parentLabel = el.closest('label');
          if (parentLabel?.textContent?.trim()) label = parentLabel.textContent.trim();
        }
        if (label) {
          fieldName = label;
        } else {
          const ph = el.getAttribute('placeholder');
          fieldName = ph?.trim() ? ph.trim() : null;
        }
      }

      const listName = ariaLabel?.trim() ? ariaLabel.trim() : null;

      let textName: string | null = null;
      if (el.children.length === 0) {
        const t = (el.textContent ?? '').trim();
        textName = t.length > 0 && t.length < 120 ? t : null;
      }

      let cssPath: string;
      if (el.id) {
        cssPath = `#${CSS.escape(el.id)}`;
      } else if (el.getAttribute('data-testid')) {
        cssPath = `[data-testid="${el.getAttribute('data-testid')}"]`;
      } else if (el.getAttribute('name')) {
        cssPath = `${tag.toLowerCase()}[name="${el.getAttribute('name')}"]`;
      } else {
        const parts: string[] = [];
        let node: Element | null = el;
        for (let i = 0; i < 4 && node; i++) {
          let part = node.tagName.toLowerCase();
          const parent: Element | null = node.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
            if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
          }
          parts.unshift(part);
          node = parent;
        }
        cssPath = parts.join(' > ');
      }

      const isButtonish =
        tag === 'BUTTON' ||
        el.getAttribute('role') === 'button' ||
        (tag === 'INPUT' && ['button', 'submit', 'reset'].includes((el as HTMLInputElement).type)) ||
        (tag === 'A' && el.getAttribute('role') === 'button');
      const isFieldish = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.getAttribute('role') === 'textbox';
      const isListish = tag === 'UL' || tag === 'OL' || el.getAttribute('role') === 'list';
      const primaryKind = isButtonish ? 'button' : isFieldish ? 'field' : isListish ? 'list' : el.children.length === 0 ? 'text' : null;

      (window as unknown as { __tflwPickReport: (info: RawPickInfo) => void }).__tflwPickReport({
        buttonName,
        fieldName,
        listName,
        textName,
        cssPath,
        primaryKind,
      });
    },
    true,
  );
}

const PICK_KIND_ORDER: readonly ('button' | 'field' | 'list' | 'text')[] = ['button', 'field', 'list', 'text'];

/** Tries the clicked element's tag-inferred kind first (so a `<div role="button">` prefers its
 * clearer button name before falling through to a coincidental text match), then the remaining
 * three, in each case walking that kind's own resolution tiers (D6, `candidateStrategies`) and
 * accepting the first one that resolves to exactly one element (D7) *and* that element is the one
 * marked as clicked. No tier anywhere verifies → the generated CSS path, which is unique by
 * construction (derived from the live DOM path to that exact element). */
async function resolvePickedLocator(page: PWPage, raw: RawPickInfo): Promise<PickedLocator> {
  const namesByKind: Record<'button' | 'field' | 'list' | 'text', string | null> = {
    button: raw.buttonName,
    field: raw.fieldName,
    list: raw.listName,
    text: raw.textName,
  };
  const order = raw.primaryKind ? [raw.primaryKind, ...PICK_KIND_ORDER.filter((k) => k !== raw.primaryKind)] : PICK_KIND_ORDER;
  for (const kind of order) {
    const name = namesByKind[kind];
    if (!name) continue;
    for (const strategy of candidateStrategies(page, kind, name)) {
      const count = await strategy.pwLocator.count();
      if (count !== 1) continue;
      const marked = await strategy.pwLocator.first().getAttribute(PICK_MARKER_ATTR);
      if (marked === '1') {
        await clearPickMarker(page);
        return { syntax: `${kind} ${JSON.stringify(name)}`, via: kind };
      }
    }
  }
  await clearPickMarker(page);
  return { syntax: `css ${JSON.stringify(raw.cssPath)}`, via: 'css' };
}

async function clearPickMarker(page: PWPage): Promise<void> {
  await page.locator(`[${PICK_MARKER_ATTR}]`).evaluateAll((els, attr) => {
    for (const el of els) el.removeAttribute(attr);
  }, PICK_MARKER_ATTR);
}

/** Wires an already-created page for picking: click-capture (survives navigation), the Node-side
 * report bridge, and a `close`/`disconnected` → `onClosed` bridge. Deliberately takes a `PWPage`
 * rather than launching one itself — the actual "must be a real, visible window" requirement
 * (`headless: false`) lives only in `startPickSession` below, so this half (which is where
 * virtually all of the real logic is: capture, name-guessing, verified resolution) stays testable
 * against an ordinary headless page, same as every other browser-step test in this package. Headed
 * vs. headless makes no difference to DOM events, `addInitScript`, or `evaluateAll` — only to
 * whether a window is actually rendered on screen. */
export function wirePickSession(page: PWPage, onPick: (picked: PickedLocator) => void, onClosed: () => void): Promise<void> {
  let closed = false;
  const notifyClosed = (): void => {
    if (closed) return;
    closed = true;
    onClosed();
  };
  page.on('close', notifyClosed);
  page.context().browser()?.on('disconnected', notifyClosed);
  return (async () => {
    await page.exposeFunction('__tflwPickReport', async (raw: RawPickInfo) => {
      onPick(await resolvePickedLocator(page, raw));
    });
    await page.addInitScript(installPickClickCapture, PICK_MARKER_ATTR);
  })();
}

export interface PickSessionHandle {
  /** Closes the browser this session opened. Safe to call even after the user already closed the
   * window themselves (`browser.close()` on an already-closed browser is a no-op in Playwright). */
  readonly close: () => Promise<void>;
}

/** Drives one `tflw pick <url>` session end-to-end: launches a real, visible browser at `url`
 * (`headless: false` — the whole point is a human clicking it), reports every verified pick via
 * `onPick`, and calls `onClosed` once (whichever of "user closed the window" / "the browser
 * process disconnected" fires first) so the CLI knows to stop waiting. */
export async function startPickSession(
  url: string,
  engine: BrowserEngine,
  onPick: (picked: PickedLocator) => void,
  onClosed: () => void,
): Promise<PickSessionHandle> {
  const manager = new BrowserManager({ engine, headless: false });
  const browser = await manager.getBrowser();
  const page = await browser.newPage();
  await wirePickSession(page, onPick, onClosed);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return {
    close: async () => {
      await manager.close().catch(() => {});
    },
  };
}
