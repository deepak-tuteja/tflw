// Accessibility scanning (M3e, SPEC §9.8, PLAN_BROWSER_PERF_SECURITY.md §1.10 D14). `axe-core` is
// a second optional peer dependency alongside `playwright` (D5's exact pattern, browser.ts's
// `loadPlaywright`): a suite that never writes `expect page has no … a11y violations` never needs
// it installed, and it's pure JS with no native bindings, so the "optional" cost really is just one
// file read, once per run.
//
// This is the one file that knows axe-core exists — `runA11yScan` maps its output onto `finding.ts`'s
// generic `Finding`/`Severity` model, which is the reusable half (SPEC §9.8's scan-arc-reuse note).

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { RuntimeError } from './eval.js';
import type { Finding, Severity } from './finding.js';
import type { PWPage } from './browser.js';

let axeSourcePromise: Promise<string> | undefined;

async function loadAxeSource(): Promise<string> {
  if (!axeSourcePromise) {
    axeSourcePromise = (async () => {
      let path: string;
      try {
        // `import.meta.resolve` is an ESM-only construct — dead in the packaged CLI's bundled
        // CJS output (esbuild empties `import.meta` there, same warning `browser.ts`'s
        // `loadPlaywright` sidesteps with a plain dynamic `import()` instead), so a real
        // `expect page has no … a11y violations` run against the *published* `tflw` threw
        // "import_meta.resolve is not a function" even though `axe-core` was genuinely
        // installed (M7 acceptance — invisible from the monorepo's own tsx/ESM-run tests, which
        // never exercise the bundled artifact). The CJS bundle's own `require` (a real local
        // binding esbuild's wrapper provides) resolves the consumer's `node_modules` exactly the
        // way `import.meta.resolve` would have in genuine ESM — but the two return different
        // shapes: `require.resolve` is already a plain filesystem path, while
        // `import.meta.resolve` returns a `file://` URL that still needs `fileURLToPath`.
        path =
          typeof require === 'function'
            ? require.resolve('axe-core/axe.min.js')
            : fileURLToPath(import.meta.resolve('axe-core/axe.min.js'));
      } catch (err) {
        throw new RuntimeError(
          `this test uses \`expect page has no … a11y violations\`, but the optional \`axe-core\` peer dependency isn't installed. Run \`npm install -D axe-core\` (SPEC §9.8). (${(err as Error).message})`,
        );
      }
      return readFile(path, 'utf8');
    })();
    axeSourcePromise.catch(() => {
      axeSourcePromise = undefined;
    });
  }
  return axeSourcePromise;
}

/** axe-core's own `impact` scale, narrowed onto this project's `Severity`. A rule with no impact
 * (a handful of "best-practice"-tagged rules axe-core can report even without opting into the
 * `best-practice` tag) is floored to `minor` rather than dropped — still visible to a
 * severity-less `expect page has no a11y violations`, just never able to trip a `critical`/
 * `serious`/`moderate` floor on its own. */
function toSeverity(impact: string | null | undefined): Severity {
  return impact === 'critical' || impact === 'serious' || impact === 'moderate' || impact === 'minor' ? impact : 'minor';
}

interface AxeNode {
  readonly target: readonly string[];
}
interface AxeViolation {
  readonly id: string;
  readonly impact: string | null;
  readonly description: string;
  readonly helpUrl: string;
  readonly nodes: readonly AxeNode[];
}
interface AxeResults {
  readonly violations: readonly AxeViolation[];
}

/** Runs a real axe-core scan against the page's *current* DOM and returns its violations as
 * `Finding[]`. One full scan per call — `execA11yExpect` (interpreter.ts) calls this again on
 * every poll iteration, the same "resolve fresh every time" shape `execUiExpect` already uses for
 * locators, so a page still settling (an async toast, a label attached after data loads) is
 * re-observed rather than judged once against a stale DOM. The axe-core script itself is injected
 * only once per page (checked via `window.axe`), not re-read/re-parsed on every poll. */
export async function runA11yScan(page: PWPage): Promise<Finding[]> {
  const alreadyInjected = await page.evaluate(() => typeof (globalThis as unknown as { axe?: unknown }).axe !== 'undefined');
  if (!alreadyInjected) {
    const source = await loadAxeSource();
    await page.addScriptTag({ content: source });
  }
  const results = await page.evaluate<AxeResults>(() => (globalThis as unknown as { axe: { run: () => Promise<AxeResults> } }).axe.run());
  return results.violations.map((v) => {
    const first = v.nodes[0];
    const where = first ? first.target.join(' ') : '(no element)';
    const more = v.nodes.length > 1 ? ` (+${v.nodes.length - 1} more)` : '';
    return {
      id: v.id,
      severity: toSeverity(v.impact),
      description: v.description,
      detail: `${where}${more} — ${v.helpUrl}`,
    };
  });
}
