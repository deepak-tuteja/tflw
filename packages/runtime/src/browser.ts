// Playwright-backed browser step driver (M3a, SPEC §9). `playwright` is an optional peer (D5,
// PLAN_BROWSER_PERF_SECURITY.md §1.1): dynamically imported on first use so `tflw run` against an
// API-only suite never touches it, and a consumer who never installed the peer never pays for it.
//
// Lifecycle (D13): one shared `Browser` process for the whole `tflw run` invocation
// (`BrowserManager`, owned by the CLI, threaded through `RunOptions`/`TestCtx`), one fresh
// `BrowserContext` + `Page` per test attempt (`BrowserPageState`, created in `runTestAttempt`).
//
// Selector model (D6): the locator noun picks the resolution strategy — `button`/`text`/`list`/
// `css`/`xpath` are single-strategy, `field` is a closed 3-step cascade (label → placeholder →
// role). A below-tier-1 hit is annotated by the caller (the `via` this module returns) rather than
// silently accepted. Ambiguity (D7) is a hard error with up to 5 candidate descriptions — never
// "take the first match".

import type { Locator as LocatorAst, LocatorKind } from '@tflw/lang';
import { RuntimeError, evalValue, type EvalCtx } from './eval.js';

type PWModule = typeof import('playwright');
export type PWBrowser = import('playwright').Browser;
export type PWBrowserContext = import('playwright').BrowserContext;
export type PWPage = import('playwright').Page;
export type PWLocator = import('playwright').Locator;

/** Anything a locator can resolve against — a whole page, or (inside a `within` block) a
 * container `Locator`. Both types implement this same query surface in Playwright's own API. */
export type LocatorScope = PWPage | PWLocator;

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

/** One per `tflw run` invocation (D13) — owned by the CLI, passed through `RunOptions`. Launches
 * lazily on the first browser step anywhere in the run; `close()` is safe to call even if a
 * browser was never actually launched. */
export class BrowserManager {
  private browserPromise: Promise<PWBrowser> | undefined;

  async getBrowser(): Promise<PWBrowser> {
    if (!this.browserPromise) {
      this.browserPromise = loadPlaywright().then((pw) => pw.chromium.launch({ headless: true }));
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
 * its context+page on the first browser step actually executed. */
export class BrowserPageState {
  private page: PWPage | undefined;
  private context: PWBrowserContext | undefined;
  /** Set by `accept dialog`/`dismiss dialog` — armed for exactly the next native dialog, then
   * cleared (SPEC §9.1). */
  armedDialog: 'accept' | 'dismiss' | null = null;
  lastDialogMessage: string | null = null;

  async ensurePage(manager: BrowserManager): Promise<PWPage> {
    if (this.page) return this.page;
    const browser = await manager.getBrowser();
    this.context = await browser.newContext();
    this.page = await this.context.newPage();
    this.page.on('dialog', (dialog) => {
      const armed = this.armedDialog;
      this.armedDialog = null; // one-shot (SPEC §9.1)
      this.lastDialogMessage = dialog.message();
      void (armed === 'accept' ? dialog.accept() : dialog.dismiss());
    });
    return this.page;
  }

  async close(): Promise<void> {
    if (this.context) await this.context.close();
    this.page = undefined;
    this.context = undefined;
  }
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
