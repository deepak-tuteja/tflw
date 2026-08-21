#!/usr/bin/env node
// Regenerates SPEC.md's matcher table (section 6.2), generators quick-reference table (section
// 7), and diagnostic codes table (section 17) from `src/spec-data.ts` - the canonical structured
// manifest (PLAN decision 103, enterprise arc cluster 4, decision 16.4; diagnostics added by
// decision 20, cluster 9). SPEC.md's own hand-written tables used to be the source of truth; this
// reverses the direction so they can never silently drift from what `packages/docs-site`'s
// Reference pages and the LSP's hover text actually show. Marker comments (`<!--
// GENERATED:<name>:start/end -->`) bound each regenerated region; everything outside them (intro
// prose, section headings) is untouched.
//
// `renderMatcherTable`/`renderGeneratorTable`/`renderDiagnosticsTable` are exported (pure,
// string-in/string-out) so a test can exercise them against small fixture arrays instead of the
// real manifest - same reasoning `gen-docs.mjs`'s `parseSpecToTopics` test already uses. The
// file's own top-level code only runs the read/write side when invoked directly, not when
// imported.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MATCHERS, GENERATORS, DIAGNOSTICS, STEP_KEYWORDS } from '../src/spec-data.ts';

/**
 * One markdown table cell.
 *
 * `M147c` — a `|` inside a cell ends the cell, **and backticks do not protect it**: GFM splits a
 * row on pipes before it ever looks at code spans. The generator had no escaping for six milestones
 * because no manifest entry had contained one; `TF072` is about a `with each` header, so its
 * example cannot avoid `| name | name |` and the row it rendered tore SPEC §17's table into
 * columns. `\|` is unescaped back to a literal `|` by GFM, inside a code span as well as outside
 * it, so the rendered cell reads exactly as written here. The same trap `M134` hit from the other
 * direction — there it was a plan document's table, here the generator that writes one.
 *
 * Applied to every interpolated field in all four renderers rather than to the one that needed it:
 * a manifest is edited by whoever adds the next code, and the escaping that only guards the field
 * someone thought of is the escaping that is missing next time.
 *
 * @param {unknown} value
 */
function cell(value) {
  return String(value).replace(/\|/g, '\\|');
}

/** @param {import('../src/spec-data.js').MatcherEntry[]} matchers */
export function renderMatcherTable(matchers) {
  const header = '| Matcher | Applies to | Example |\n|---|---|---|';
  const rows = matchers.map((m) => `| ${cell(m.syntax)} | ${cell(m.appliesTo)} | ${cell(m.example)} |`);
  return [header, ...rows].join('\n');
}

/** @param {import('../src/spec-data.js').GeneratorEntry[]} generators */
export function renderGeneratorTable(generators) {
  const header = '| Family | Generator | Notes | Example |\n|---|---|---|---|';
  const rows = generators.map((g) => `| ${cell(g.family)} | ${cell(g.syntax)} | ${cell(g.notes)} | ${cell(g.example)} |`);
  return [header, ...rows].join('\n');
}

/** @param {import('../src/spec-data.js').DiagnosticEntry[]} diagnostics */
export function renderDiagnosticsTable(diagnostics) {
  const header = '| Code | Meaning | Example |\n|---|---|---|';
  const rows = diagnostics.map((d) => `| \`${cell(d.code)}\` | ${cell(d.meaning)} | ${cell(d.example)} |`);
  return [header, ...rows].join('\n');
}

/** @param {import('../src/spec-data.js').StepKeywordEntry[]} steps */
export function renderStepKeywordTable(steps) {
  const header = '| Family | Keyword | Syntax | What it does | Example |\n|---|---|---|---|---|';
  const rows = steps.map((s) => `| ${cell(s.family)} | \`${cell(s.id)}\` | ${cell(s.syntax)} | ${cell(s.summary)} | ${cell(s.example)} |`);
  return [header, ...rows].join('\n');
}

function replaceMarkerRegion(text, name, replacement) {
  const start = `<!-- GENERATED:${name}:start -->`;
  const end = `<!-- GENERATED:${name}:end -->`;
  const startIdx = text.indexOf(start);
  const endIdx = text.indexOf(end);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(`gen-spec-tables: couldn't find marker pair "${name}" in SPEC.md`);
  }
  const before = text.slice(0, startIdx + start.length);
  const after = text.slice(endIdx);
  return `${before}\n${replacement}\n${after}`;
}

/** Every generated region, applied to `text` in one place so `main` and `--check` can never differ
 * about which regions exist — the drift `M147-10` found was in one of four and the other three were
 * clean, which is exactly the shape a second, hand-maintained list produces. */
export function regenerate(text) {
  text = replaceMarkerRegion(text, 'matchers', renderMatcherTable(MATCHERS));
  text = replaceMarkerRegion(text, 'generators', renderGeneratorTable(GENERATORS));
  text = replaceMarkerRegion(text, 'diagnostics', renderDiagnosticsTable(DIAGNOSTICS));
  text = replaceMarkerRegion(text, 'step-keywords', renderStepKeywordTable(STEP_KEYWORDS));
  return text;
}

const SUMMARY = () =>
  `${MATCHERS.length} matcher rows + ${GENERATORS.length} generator rows + ${DIAGNOSTICS.length} diagnostic rows + ${STEP_KEYWORDS.length} step keyword rows`;

/**
 * `--check` — assert SPEC.md's generated regions are what this generator produces (`M147e`,
 * `M147-10`).
 *
 * **Generating a file is not the same as keeping it generated, and for six milestones nothing said
 * so.** `docs:gen` runs as a `pre` hook of build and typecheck, so it rewrites SPEC.md on every
 * developer machine — and then leaves the result in the working tree for someone to commit or not.
 * Nothing in `scripts/`, in this file, or in `.github/workflows/*.yml` compared the committed
 * output against the source, and nothing failed CI on a dirty tree. Measured at `M147e`: `main`'s
 * §17 table had **63** rows where the manifest produces **65**, and it had drifted in *both*
 * directions — `TF074` and `TF023`'s D638 rewording never reached the output, while `TF042`'s D641
 * sentence and `TF055`'s D640 sentence had been written **into the generated block by hand** and
 * would have vanished on the next legitimate run. All fifteen checks on the PR that shipped them
 * were green.
 *
 * This is the exposure `M144a-2` closed for `diagnostics.md`, still open for SPEC.md, and it is a
 * `--check` mode rather than a new CI job on purpose: `CONTRIBUTING.md` holds the gate set to
 * `ci.yml`, and a mode on a script the build already runs adds an assertion without adding a gate.
 */
function check(specPath) {
  const text = readFileSync(specPath, 'utf8');
  const want = regenerate(text);
  if (want === text) {
    console.log(`gen-spec-tables --check: SPEC.md matches the manifest (${SUMMARY()})`);
    return 0;
  }
  const wantLines = want.split('\n');
  const haveLines = text.split('\n');
  const first = haveLines.findIndex((l, i) => l !== wantLines[i]);
  console.error(
    `✗ SPEC.md's generated regions are not what \`spec-data.ts\` produces — first difference at line ${first + 1}.\n` +
      `    committed: ${JSON.stringify((haveLines[first] ?? '').slice(0, 120))}\n` +
      `    generated: ${JSON.stringify((wantLines[first] ?? '').slice(0, 120))}\n\n` +
      `  A generated block is not a place to edit. Either the manifest changed and SPEC.md was not\n` +
      `  regenerated, or SPEC.md was edited by hand inside the markers and the edit is about to be\n` +
      `  overwritten. Run \`npm run docs:gen -w @tflw/lang\` and commit the result; if the change you\n` +
      `  want is prose, it belongs in \`packages/lang/src/spec-data.ts\`, which is what renders it.`,
  );
  return 1;
}

function main() {
  const specPath = fileURLToPath(new URL('../../../SPEC.md', import.meta.url));
  if (process.argv.includes('--check')) return check(specPath);
  writeFileSync(specPath, regenerate(readFileSync(specPath, 'utf8')), 'utf8');
  // Counts every region it wrote, not most of them: a generator whose report omits one of its
  // outputs is a report you cannot use to tell whether that output ran.
  console.log(`gen-spec-tables: wrote ${SUMMARY()} to SPEC.md`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main());
