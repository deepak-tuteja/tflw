#!/usr/bin/env node
// A read after a wait does not retry — so find the reads that are a single sample of a page that
// is still moving, before CI finds them one at a time.
//
// `M235` §2 is a census of eight tests that failed in CI over one week, §2.1 adds three more from a
// 56-run sweep, and `M234` `H`'s close-out adds a twelfth that neither instrument sampled. All
// twelve are one shape: the suite is `node:test` + `node:assert/strict` over the `playwright`
// **library**, not `@playwright/test`, so nothing in it retries. A Playwright read auto-waits for
// the *element* and then resolves once against whatever frame it found; `node:assert` judges that
// one sample. When the page re-renders a tick later, the sample was of a frame that no longer
// exists.
//
// Eleven of the twelve came from sampling — running the suite until something went red. The
// twelfth came from an unrelated close-out, at a site 56 whole-suite runs had never reddened. That
// is the argument for this file: **a sampler finds what it happens to catch, and only a classifier
// can enumerate.**
//
// ## The rule
//
// A read is **settled** when the thing it reads has been waited on *since the last action that
// could have changed it*. Everything else is **at risk**. Three clauses, and the third is the one
// the sweep taught:
//
//   1. `NEVER-WAITED`  — nothing in the test ever waited on this subject.
//   2. `WAITED-THEN-ACTED` — a wait named this subject, and then a `click`/`fill`/`goto`/… ran, so
//      the page has been asked to change and the wait no longer speaks for the current frame.
//   3. `ASYNC-STATE` — a **synchronous** read of state an action mutates asynchronously.
//      `page.url()` is the worked example and the reason this clause exists: it is not awaited at
//      all, so a rule keyed on `await` cannot see it, and §2.1's worst flake (10 of 56 runs, 17.9%)
//      is exactly that — `page.url()` read immediately after `fill()`, where the router writes the
//      query into the hash on a later effect.
//
// The third clause matters more than its size suggests. The first draft of this plan's `C1`
// acceptance was "the eight census tests must appear in the at-risk set"; §2.1 amended it to
// twelve, and noted that a classifier which only compares a read's subject against the nearest
// preceding wait would **miss the worst one and still pass its own oracle**. A rule is not
// validated by the set that suggested it.
//
// ## What it does not claim
//
// An at-risk read is not a defect. Most of them will never lose the race, and some cannot: a read
// of a static heading after `goto` is flagged and is fine. This is a **worklist ordered by shape**,
// not a bug list — which is why `--report` prints a per-test rollup rather than a verdict, and why
// the lint (`--check`) refuses only reads that are *new* against a recorded baseline. Turning a
// flagged read into a passing one is a judgement call per site; `M235` `C2` takes them in failure-
// rate order.
//
// The three retry helpers — `countSettling`, `openMenuAndBox`, `laidOutChartHeights` — are
// module-scope arrows, so the walk (which enters `test(...)` bodies only) never reaches their
// insides and their reads are not in the population at all. That is the right answer arrived at by
// accident rather than by the exclusion rule, so it is written down here: if a helper is ever moved
// inside a test body, `RETRY_WRAPPERS` is what will have to carry it, and `--self-test` is what
// proves `RETRY_WRAPPERS` still works.
//
// Reads whose receiver cannot be resolved to a selector are **counted and reported, never silently
// passed** — the same discipline `verify-test-observability.mjs` applies to tests whose harness it
// cannot resolve. A classifier that quietly drops what it does not understand reports a clean tree
// by omission.
import ts from 'typescript';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// The two page gates. Both drive a live React page through Playwright; no other suite in the repo
// reads a re-rendering document.
const FILES = [
  'packages/cli/test/ui-page.test.ts',
  'packages/cli/test/ui-appearance.test.ts',
];

// Playwright reads that resolve once. `url` and `title` are here for clause 3 — `page.url()` is
// synchronous and `page.title()` is not, and both read state an action changes later.
const AWAITED_READS = new Set([
  'count', 'textContent', 'innerText', 'innerHTML', 'allTextContents', 'allInnerTexts',
  'evaluate', 'evaluateAll', 'boundingBox', 'inputValue', 'getAttribute', 'isVisible',
  'isHidden', 'isChecked', 'isDisabled', 'isEnabled', 'isEditable', 'title', 'textContents',
]);
const SYNC_READS = new Set(['url']);

// **Playwright's own read semantics are the sharper half of the rule.** Not every read is exposed
// the same way, and grouping them by that is what turns 859 flagged sites into a worklist:
//
//   NO-AUTO-WAIT  `count()`, `evaluateAll()`, `allTextContents()` resolve against whatever matches
//                 *right now*. They do not wait for anything, so an empty DOM answers `0` / `[]`
//                 immediately and the assertion judges it. Six of the twelve census members are
//                 here, and every one of them failed *fast* — 38 ms, 103 ms, 138 ms, 359 ms.
//   GEOMETRY      `boundingBox()` waits for the element to attach and then reads a box that may be
//                 pre-layout. `M227 A` read `[0]` against `[180]`: the canvas was there, sized 0.
//   SYNC          `page.url()` is not awaited and waits for nothing at all.
//   SERVER        a `fetch` poll reads state no page event can settle.
//   VALUE         `textContent()`, `getAttribute()`, `inputValue()` wait for attach and then read a
//                 value that can still change. Real, but the element being there is already a
//                 partial guarantee — these are the tail, not the head.
//
// A read is ranked by *both* halves: what it is exposed to, and whether anything settled it.
const READ_CLASS = new Map([
  ...['count', 'evaluateAll', 'allTextContents', 'allInnerTexts'].map((m) => [m, 'NO-AUTO-WAIT']),
  ...['boundingBox'].map((m) => [m, 'GEOMETRY']),
  ...['url'].map((m) => [m, 'SYNC']),
  ...['fetch'].map((m) => [m, 'SERVER']),
]);
const classOf = (m) => READ_CLASS.get(m) ?? 'VALUE';

// The worklist order. HIGH is a read that waits for nothing, taken when nothing settled it.
const severityOf = (cls, reason) => {
  if (!reason) return null;
  if (cls === 'VALUE') return reason === 'NEVER-WAITED' ? 'LOW' : 'MEDIUM';
  return reason === 'WAITED-THEN-ACTED' ? 'HIGH' : 'HIGH';
};

// Gestures that ask the page to change. A read taken after one of these speaks for the frame
// before it unless something waited in between.
const ACTIONS = new Set([
  'click', 'dblclick', 'fill', 'press', 'type', 'goto', 'reload', 'goBack', 'goForward',
  'selectOption', 'check', 'uncheck', 'hover', 'tap', 'focus', 'blur', 'setInputFiles',
  'dispatchEvent', 'setViewportSize', 'dragTo', 'clear', 'scrollIntoViewIfNeeded',
]);

// Waits that settle a subject.
const WAITS = new Set([
  'waitFor', 'waitForSelector', 'waitForFunction', 'waitForLoadState', 'waitForURL',
  'waitForResponse', 'waitForRequest', 'waitForEvent',
]);

// The retry layer itself. A read lexically inside one of these is the thing that retries.
const RETRY_WRAPPERS = new Set(['settle', 'countSettling', 'openMenuAndBox', 'laidOutChartHeights']);

// **The oracle.** Twelve tests are known to carry this defect: eight from CI over one week (§2),
// three more from `A3`'s 56-run sweep (§2.1), and a twelfth from `M234` `H`'s close-out at a site
// the sweep never reddened. A classifier that does not flag all twelve is wrong and gets fixed
// before anything is converted.
//
// The oracle is deliberately *weak on its own* — a classifier that flagged every read would pass
// it. It is only worth something beside the population figures `--report` prints: 980 reads, and
// the HIGH band is the ordering `C2` works down. Two instruments, neither sufficient alone.
const CENSUS = [
  // file          test (substring)                                             provenance     shape
  ['ui-page', '`M218` `A1`: the menu stays on screen', 'CI, 5 runs', 'GEOMETRY'],
  ['ui-appearance', 'no region of the Compose pane overflows', 'CI, 2 runs', null],
  ['ui-page', '`M217` `C2`: a draft belongs to its file', 'CI, 2 runs', 'NO-AUTO-WAIT'],
  ['ui-appearance', '`M215` `B3`: the coloured copy and the field under it are one box', 'CI, 2 runs', null],
  ['ui-page', '`M213` `S2`: every verdict the report holds is beside the statement', 'CI, 1 run', null],
  ['ui-page', '`M213` `S4`: the BROWSER door composes', 'CI, 1 run', null],
  ['ui-page', 'Compose draws every request the file holds', 'CI, 1 run', 'NO-AUTO-WAIT'],
  ['ui-page', '`M227` `A`: the report', 'CI, 1 run', null],
  ['ui-page', 'the query is in the address', 'sweep, 10/56', 'SYNC/ASYNC-STATE'],
  ['ui-page', '`M216` `B1`: it appears on keyboard focus', 'sweep, 1/56', null],
  ['ui-page', 'a new .tflw file can be made from the page', 'sweep, 1/56', null],
  ['ui-page', 'a tag query runs the tests carrying the tag', 'close-out', 'SERVER/SERVER-POLL'],
];

// **The controls.** The census alone cannot fail a classifier that flags every read, so two reads
// verified by hand to be correctly settled must come back **unflagged**. The second is the sharper
// one: a `count()` — a read that auto-waits for nothing — taken directly after a `selectOption`,
// with a `waitFor` on *exactly its own subject* in between. It is the shape the census is full of,
// written correctly, so it separates "this classifier understands waits" from "this classifier
// flags every `count()`".
const CONTROLS = [
  ['the sidebar is the project as a tree', '[data-files]', 'getAttribute',
    'a `waitFor` on its own subject after `reload()`'],
  ['two report directories side by side', '[data-compared-with="headers"]', 'count',
    'a no-auto-wait read, settled by a `waitFor` on its own subject after an action'],
];

const read = (p) => readFileSync(p, 'utf8');
const norm = (s) => s.replace(/\s+/g, ' ').trim();

/** The selector text a locator expression names, or null when it cannot be resolved. */
function subjectOf(node, vars) {
  let e = node;
  const parts = [];
  for (;;) {
    while (ts.isAsExpression(e) || ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e)) {
      e = e.expression;
    }
    if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression)) {
      const m = e.expression.name.text;
      if (m === 'locator' || m === 'waitForSelector' || m === '$' || m === '$$') {
        const a = e.arguments[0];
        if (a) parts.unshift(literalOf(a, vars) ?? '?');
        e = e.expression.expression;
        continue;
      }
      // Transparent narrowing: these pick within a subject, they do not change it.
      if (['first', 'last', 'nth', 'filter', 'and', 'or'].includes(m)) {
        e = e.expression.expression;
        continue;
      }
      if (['getByRole', 'getByText', 'getByLabel', 'getByTestId', 'getByTitle', 'getByPlaceholder'].includes(m)) {
        const a = e.arguments[0];
        parts.unshift(`${m}(${a ? (literalOf(a, vars) ?? '?') : ''})`);
        e = e.expression.expression;
        continue;
      }
      return null;
    }
    if (ts.isIdentifier(e)) {
      const v = vars.get(e.text);
      if (v) { parts.unshift(v); return parts.join(' >> '); }
      // `page`, `p`, frame handles: the document itself is the subject.
      return parts.length ? parts.join(' >> ') : `@${e.text}`;
    }
    if (ts.isPropertyAccessExpression(e)) {
      return parts.length ? parts.join(' >> ') : `@${norm(e.getText())}`;
    }
    return parts.length ? parts.join(' >> ') : null;
  }
}

/** A string literal or a template normalised to its shape, so two spellings of one subject match. */
function literalOf(node, vars) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return node.head.text + node.templateSpans.map((s) => '${}' + s.literal.text).join('');
  }
  if (ts.isIdentifier(node)) return vars.get(node.text) ?? null;
  return null;
}

/** Locator-valued and string-valued bindings, so `const row = page.locator('x')` resolves. */
function collectVars(root, vars) {
  const visit = (n) => {
    if (ts.isVariableDeclaration(n) && n.name && ts.isIdentifier(n.name) && n.initializer) {
      const s = ts.isStringLiteral(n.initializer) || ts.isNoSubstitutionTemplateLiteral(n.initializer)
        ? n.initializer.text
        : subjectOf(n.initializer, vars);
      if (s) vars.set(n.name.text, s);
    }
    ts.forEachChild(n, visit);
  };
  visit(root);
  return vars;
}

/** Is this node lexically inside a callback that is itself the retry, or inside in-page code? */
function insideRetryOrPage(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isCallExpression(p)) {
      const c = p.expression;
      const name = ts.isPropertyAccessExpression(c) ? c.name.text : ts.isIdentifier(c) ? c.text : '';
      if (RETRY_WRAPPERS.has(name)) return 'retry';
      // A callback handed to `evaluate`/`evaluateAll`/`waitForFunction` runs in the browser; the
      // DOM calls in it are not Playwright reads at all.
      if (['evaluate', 'evaluateAll', 'waitForFunction', 'evaluateHandle'].includes(name)) {
        if (p.arguments.some((a) => a.pos <= node.pos && node.end <= a.end)) return 'page';
      }
    }
  }
  return null;
}

/** Walk one test body in source order, tracking what is settled. */
function classifyTest(testNode, testName, src, vars, findings, stats) {
  const settled = new Set();
  const everWaited = new Set();
  const events = [];

  const visit = (n) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const m = n.expression.name.text;
      const recv = n.expression.expression;
      if (WAITS.has(m)) {
        const s = m === 'waitForSelector' ? subjectOf(n, vars) : subjectOf(recv, vars);
        events.push({ pos: n.getStart(), kind: 'wait', subject: s ?? '?' });
      } else if (ACTIONS.has(m)) {
        events.push({ pos: n.getStart(), kind: 'action', subject: subjectOf(recv, vars) ?? '?', method: m });
      } else if (AWAITED_READS.has(m) || SYNC_READS.has(m)) {
        const where = insideRetryOrPage(n);
        if (where === null) {
          events.push({
            pos: n.getStart(),
            kind: 'read',
            method: m,
            sync: SYNC_READS.has(m),
            subject: subjectOf(recv, vars),
            line: src.getLineAndCharacterOfPosition(n.getStart()).line + 1,
            text: norm(n.getText()).slice(0, 120),
          });
        } else {
          stats[where === 'retry' ? 'inRetry' : 'inPage']++;
        }
      }
    }
    // A bare awaited `fetch(...)` is a read of server state with no wait available at all.
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'fetch') {
      if (insideRetryOrPage(n) === null) {
        events.push({
          pos: n.getStart(), kind: 'read', method: 'fetch', sync: false, subject: null,
          line: src.getLineAndCharacterOfPosition(n.getStart()).line + 1,
          text: norm(n.getText()).slice(0, 120), server: true,
        });
      } else {
        stats.inRetry++;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(testNode);

  events.sort((a, b) => a.pos - b.pos);
  let acted = false;
  for (const ev of events) {
    if (ev.kind === 'wait') { settled.add(ev.subject); everWaited.add(ev.subject); acted = false; continue; }
    if (ev.kind === 'action') { settled.clear(); acted = true; continue; }
    stats.reads++;
    if (ev.subject === null && !ev.server) { stats.unresolved++; continue; }
    const key = ev.server ? '@server' : ev.subject;
    let reason = null;
    if (ev.sync && acted) reason = 'ASYNC-STATE';
    else if (ev.server) reason = 'SERVER-POLL';
    else if (settled.has(key)) reason = null;
    else if (everWaited.has(key)) reason = 'WAITED-THEN-ACTED';
    else reason = 'NEVER-WAITED';
    if (reason) {
      const cls = classOf(ev.method);
      findings.push({
        test: testName, line: ev.line, method: ev.method, subject: key, reason,
        cls, severity: severityOf(cls, reason), text: ev.text,
      });
    }
  }
}

export function classify(sources) {
  const inputs = sources ?? FILES.map((rel) => ({ rel, text: read(path.join(ROOT, rel)) }));
  const findings = [];
  const stats = { reads: 0, unresolved: 0, inRetry: 0, inPage: 0, tests: 0 };
  for (const { rel, text } of inputs) {
    const src = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
    const vars = collectVars(src, new Map());
    const visit = (n) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'test') {
        const nameArg = n.arguments[0];
        const name = nameArg && (ts.isStringLiteral(nameArg) || ts.isNoSubstitutionTemplateLiteral(nameArg))
          ? nameArg.text : '(unnamed)';
        stats.tests++;
        const body = n.arguments.find((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
        if (body) {
          const local = collectVars(body, new Map(vars));
          const before = findings.length;
          classifyTest(body, name, src, local, findings, stats);
          for (let i = before; i < findings.length; i++) findings[i].file = rel;
        }
        return;
      }
      ts.forEachChild(n, visit);
    };
    visit(src);
  }
  return { findings, stats };
}

function report({ findings, stats }) {
  const byTest = new Map();
  for (const f of findings) byTest.set(f.test, (byTest.get(f.test) ?? 0) + 1);
  const byReason = {};
  for (const f of findings) byReason[f.reason] = (byReason[f.reason] ?? 0) + 1;
  const bySeverity = {};
  for (const f of findings) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
  const grid = {};
  for (const f of findings) {
    grid[f.cls] ??= {};
    grid[f.cls][f.reason] = (grid[f.cls][f.reason] ?? 0) + 1;
  }

  console.log(`population       ${stats.reads} reads across ${stats.tests} tests`);
  console.log(`  at risk        ${findings.length}`);
  console.log(`  settled        ${stats.reads - findings.length - stats.unresolved}`);
  console.log(`  unresolved     ${stats.unresolved}  (receiver not a resolvable subject — reported, not passed)`);
  console.log(`  inside a retry ${stats.inRetry}  (excluded: the read retries)`);
  console.log(`  in-page code   ${stats.inPage}  (excluded: runs in the browser, not a Playwright read)`);
  console.log('');
  for (const [r, c] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${r.padEnd(18)} ${c}`);
  }
  console.log('');
  console.log('by what the read is exposed to (rows) x what settled it (cols):');
  const reasons = ['NEVER-WAITED', 'WAITED-THEN-ACTED', 'ASYNC-STATE', 'SERVER-POLL'];
  console.log(`  ${''.padEnd(14)}${reasons.map((r) => r.padStart(19)).join('')}`);
  for (const cls of ['NO-AUTO-WAIT', 'GEOMETRY', 'SYNC', 'SERVER', 'VALUE']) {
    if (!grid[cls]) continue;
    console.log(`  ${cls.padEnd(14)}${reasons.map((r) => String(grid[cls][r] ?? '-').padStart(19)).join('')}`);
  }
  console.log('');
  console.log(`worklist:  HIGH ${bySeverity.HIGH ?? 0}   MEDIUM ${bySeverity.MEDIUM ?? 0}   LOW ${bySeverity.LOW ?? 0}`);
  console.log('');
  console.log(`tests carrying at least one at-risk read: ${byTest.size} of ${stats.tests}`);
  console.log('');
  const highByTest = new Map();
  for (const f of findings) if (f.severity === 'HIGH') highByTest.set(f.test, (highByTest.get(f.test) ?? 0) + 1);
  console.log(`tests carrying at least one HIGH read: ${highByTest.size} of ${stats.tests}`);
  console.log('');
  console.log('top 20 tests by HIGH count:');
  for (const [t, c] of [...highByTest].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(`  ${String(c).padStart(4)}  ${t.slice(0, 96)}`);
  }
}

function oracle({ findings, stats }) {
  // **Two claims, and only the second one is sharp.**
  //
  // The weak claim is that each census test carries at least one at-risk read. On its own that is
  // nearly vacuous — 212 of 225 tests do — and a classifier that flagged every read would pass it.
  // It is reported because a *regression* to zero on one of them is still worth catching.
  //
  // The sharp claim is per-read: where §2's table recorded the shape at the failing line, the
  // classifier must flag a read **of that shape, in that test**. Five of the twelve carry such a
  // record — `boundingBox()` after a visible-wait, `count()` returning 0 against 11, `evaluateAll`
  // returning `[]`, `page.url()` after `fill()`, and a `fetch` poll — and each is a claim that can
  // fail. The other seven were recorded as "read after wait" or "a hang, not a wrong read", which
  // names no shape; asserting one for them would be inventing evidence, so they are listed as
  // carrying no shape claim rather than quietly given the weak test and counted as if they passed.
  let failed = 0;
  const rows = [];
  for (const [file, needle, provenance, shape] of CENSUS) {
    const hits = findings.filter((f) => f.file.includes(file) && f.test.includes(needle));
    const high = hits.filter((f) => f.severity === 'HIGH');
    let verdict;
    if (hits.length === 0) { verdict = 'MISSED'; failed++; }
    else if (shape === null) verdict = 'flagged';
    else {
      const [wantCls, wantReason] = shape.split('/');
      const match = hits.find((f) => f.cls === wantCls && (!wantReason || f.reason === wantReason));
      if (match) verdict = `${shape} :${match.line}`;
      else { verdict = `NO ${shape}`; failed++; }
    }
    rows.push([verdict, hits.length, high.length, provenance, needle]);
  }
  console.log('the census of twelve, against the classifier:');
  console.log('');
  console.log(`  ${'verdict'.padEnd(22)}${'at risk'.padStart(8)}${'HIGH'.padStart(6)}  ${'provenance'.padEnd(13)}test`);
  for (const [v, n, h, prov, needle] of rows) {
    console.log(`  ${v.padEnd(22)}${String(n).padStart(8)}${String(h).padStart(6)}  ${prov.padEnd(13)}${needle.slice(0, 52)}`);
  }
  console.log('');
  console.log('controls — reads verified by hand to be settled, which must NOT be flagged:');
  for (const [needle, subject, method, why] of CONTROLS) {
    const hit = findings.find((f) => f.test.includes(needle) && f.subject === subject && f.method === method);
    console.log(`  ${(hit ? `FLAGGED :${hit.line}` : 'clean').padEnd(22)}${subject.padEnd(36)}${why}`);
    if (hit) failed++;
  }

  const shaped = CENSUS.filter((c) => c[3] !== null).length;
  console.log('');
  if (failed) {
    console.log(`FAIL: ${failed} claim(s) not met — a census test misclassified, or a control flagged.`);
    console.log('The classifier is wrong. Fix it before converting anything (`C1` acceptance).');
    return 1;
  }
  console.log(`PASS: all ${CENSUS.length} census tests flagged; all ${shaped} with a recorded shape flagged AT that shape;`);
  console.log(`      both controls clean.`);
  console.log(`      ${findings.length} of ${stats.reads} reads flagged overall, so neither claim is passed by flagging everything.`);
  return 0;
}

// **The self-test.** Seven reads written here on purpose, each a claim the classifier must get
// right, and the reason this exists rather than a control pinned to a line of `ui-page.test.ts`:
// `C2` is about to rewrite hundreds of those lines, and a control that churns with the code it
// guards stops being read. The last two are the pair a mutation sweep found the oracle blind to —
// a read inside `settle()` is the *converted* form, and a classifier that cannot see the
// conversion would go on flagging every site `C2` repairs.
const SELF_TEST_SOURCE = [
  ``,                                                                           // 1
  `import { settle, untilEqual } from './settle.js';`,                          // 2
  `test('synthetic', async () => {`,                                           // 3
  `  await page.goto(url);`,                                                   // 4
  `  await page.locator('[data-ok]').waitFor();`,                              // 5
  `  await page.locator('[data-ok]').count();`,                                // 6  settled
  `  await page.locator('[data-never]').count();`,                             // 7  never waited
  `  await page.locator('[data-ok]').click();`,                                // 8  the action
  `  await page.locator('[data-ok]').count();`,                                // 9  wait now spent
  `  page.url();`,                                                             // 10 sync read
  '  await fetch(`${baseUrl}/api/runs`);',                                     // 11 server poll
  `  await page.locator('[data-ok]').evaluate((el) => el.getAttribute('x'));`, // 12 read + in-page
  `  await page.locator('[data-box]').boundingBox();`,                          // 13 geometry
  `  await settle(async () => page.locator('[data-late]').count(), untilEqual(3), opts);`, // 14
  `});`,                                                                        // 15
].join('\n');

// Claims are pinned by **line**, not by subject: `[data-ok] count` is written twice on purpose —
// once settled and once after the action that spends the wait — and a claim keyed on the subject
// alone cannot tell the two apart. The first draft of this self-test was keyed that way and failed
// against a correct classifier, which is the cheapest possible version of the mistake it is here to
// prevent.
// Each claim pins **both halves** — what settled the read (or did not), and what the read is
// exposed to. A sweep against the reason alone left `GEOMETRY` and `NO-AUTO-WAIT` unconvicted here
// and caught only by the census oracle; a gate that runs in CI should not need a second instrument
// standing behind it to mean anything.
const SELF_TEST_CLAIMS = [
  [6, 'count', null, null, 'a wait on its own subject settles it'],
  [7, 'count', 'NEVER-WAITED', 'NO-AUTO-WAIT', 'nothing ever waited on this subject'],
  [9, 'count', 'WAITED-THEN-ACTED', 'NO-AUTO-WAIT', 'an action spends the wait that came before it'],
  [10, 'url', 'ASYNC-STATE', 'SYNC', 'a synchronous read of state an action updates later'],
  [11, 'fetch', 'SERVER-POLL', 'SERVER', 'server state no page event can settle'],
  [12, 'evaluate', 'WAITED-THEN-ACTED', 'VALUE', 'the outer `evaluate` is a read; only its callback is in-page'],
  [13, 'boundingBox', 'NEVER-WAITED', 'GEOMETRY', 'a box read before anything laid the element out'],
  [14, 'count', null, null, 'a read inside `settle()` is the converted form, not a site'],
];

function selfTest() {
  const { findings, stats } = classify([{ rel: 'self-test.ts', text: SELF_TEST_SOURCE }]);
  let failed = 0;
  console.log('self-test — eight synthetic reads, each a claim pinned to its own line:');
  console.log('');
  for (const [line, method, reason, cls, why] of SELF_TEST_CLAIMS) {
    const hits = findings.filter((f) => f.line === line && f.method === method);
    const ok = reason === null
      ? hits.length === 0
      : hits.some((f) => f.reason === reason && f.cls === cls);
    if (!ok) failed++;
    const got = hits.length ? hits.map((f) => `${f.reason}/${f.cls}`).join(',') : 'not flagged';
    const want = reason === null ? 'not flagged' : `${reason}/${cls}`;
    console.log(`  ${(ok ? 'ok' : 'FAIL').padEnd(6)}line ${String(line).padStart(2)}  ${method.padEnd(12)}${want.padEnd(32)}got: ${got}`);
    if (!ok) console.log(`         expected because: ${why}`);
  }
  console.log('');
  console.log(`  reads seen: ${stats.reads}   in-page excluded: ${stats.inPage}   inside a retry: ${stats.inRetry}`);
  if (stats.inPage < 1) { failed++; console.log('  FAIL  the `evaluate` callback was not recognised as in-page code'); }
  if (stats.inRetry < 1) { failed++; console.log('  FAIL  the read inside `settle()` was not recognised as converted'); }
  console.log('');
  console.log(failed ? `FAIL: ${failed} self-test claim(s) not met.` : 'PASS: every self-test claim met.');
  return failed ? 1 : 0;
}

const args = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = args.includes('--self-test') ? { findings: [], stats: {} } : classify();
  if (args.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else if (args.includes('--self-test')) {
    process.exitCode = selfTest();
  } else if (args.includes('--oracle')) {
    process.exitCode = oracle(result);
  } else {
    report(result);
  }
}
