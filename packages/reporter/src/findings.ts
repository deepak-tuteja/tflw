// M134b (PLAN_M134_PENTEST_TIER3.md D376/D386/D387/D389) — the report's security section: every
// finding all three scans produced, what the gate did with each one, and which rules stood down.
//
// **Why the findings get their own block rather than living inside the failing step's message.**
// Until this milestone a finding existed only as prose inside the assertion that raised it, which
// made three things impossible: baselining one (there was no stable identity to key on), reading the
// whole run's security posture without scrolling every test, and — the one `M128-01` is filed about
// — learning which rules *stood down*, since a rule that stands down produces no message at all.
//
// Rendering is deliberately flat and sorted rather than grouped by test. A finding is a fact about
// an endpoint, not about the test that happened to notice it, and two tests hitting one weakness
// should read as one row with one fingerprint rather than as two unrelated failures.

import type { RunReport, ScanFinding, ScanRuleCensus, WithheldReason } from '@tflw/runtime';
import { SCAN_KIND_LABEL, WITHHELD_LABEL } from '@tflw/runtime';

import { esc } from './escape.js';
// M135a (D402) — R7's remediation KB. The reason it pays for itself twice: `report.html` gains
// "possible fixes" whether or not anyone ever parses the SARIF file `M135b` writes from the same
// entries.
import { remediationFor, type KbEntry } from './kb.js';

/** Severity order for display — worst first, so the row a reader acts on is the row they see. */
const SEVERITY_ORDER: Readonly<Record<string, number>> = { critical: 0, serious: 1, moderate: 2, minor: 3 };

/**
 * Sort findings for display: gating before withheld, then worst severity, then endpoint.
 *
 * Gating first because those are the ones failing the build right now; a baselined critical is
 * important but it is not what the reader came for. Within a bucket the order is fully determined,
 * so two runs of one suite produce byte-identical output and a diff shows a real change.
 */
export function sortFindings(findings: readonly ScanFinding[]): ScanFinding[] {
  return [...findings].sort(
    (a, b) =>
      Number(Boolean(a.withheld)) - Number(Boolean(b.withheld)) ||
      (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) ||
      a.endpoint.localeCompare(b.endpoint) ||
      a.rule.localeCompare(b.rule) ||
      (a.location ?? '').localeCompare(b.location ?? ''),
  );
}

/** The one-line tally: how many findings gate, and how many were withheld and why. */
export function findingsSummaryLine(findings: readonly ScanFinding[]): string {
  const gating = findings.filter((f) => !f.withheld).length;
  const by = new Map<WithheldReason, number>();
  for (const f of findings) if (f.withheld) by.set(f.withheld, (by.get(f.withheld) ?? 0) + 1);
  const parts = [`${gating} failing`];
  for (const [reason, n] of by) parts.push(`${n} ${WITHHELD_LABEL[reason]}`);
  return `${findings.length} finding${findings.length === 1 ? '' : 's'} — ${parts.join(', ')}`;
}

/**
 * KB prose is authored with markdown-style backtick code spans, because its other consumer is
 * SARIF's `help.markdown` (D408). Here they become `<code>`, after escaping — the escape runs first,
 * so anything inside a span is already inert and the span itself cannot be forged by the content.
 */
function codeSpans(text: string): string {
  return esc(text).replace(/`([^`]+)`/g, '<code>$1</code>');
}

/**
 * The remediation block for one finding: what, why, the repair, and the citations.
 *
 * Collapsed by default. A reader triaging a run wants the list of findings first and the essay
 * second, and the row itself already carries the endpoint, the site and the detector's evidence —
 * this is the part they open once they have decided which row to act on.
 *
 * **The references are links, and that does not break the report's self-containment.** Nothing here
 * is fetched: the document still opens over `file://` with no network access of any kind, and a link
 * is only followed if a human clicks it.
 */
function renderFix(entry: KbEntry): string {
  const refs = entry.refs.map((r) => `<a href="${esc(r.url)}" rel="noreferrer">${esc(r.label)}</a>`).join(' · ');
  return (
    `<details class="finding-fix"><summary>possible fixes</summary>` +
    `<p class="fix-title">${esc(entry.title)}</p>` +
    `<p class="fix-what">${codeSpans(entry.what)}</p>` +
    `<p class="fix-why">${codeSpans(entry.why)}</p>` +
    `<p class="fix-do"><strong>Fix</strong> — ${codeSpans(entry.fixGeneric)}</p>` +
    `<p class="fix-do"><strong>In NestJS</strong> — ${codeSpans(entry.fixNest)}</p>` +
    `<p class="fix-refs">CWE-${entry.cwe} · ${refs}</p>` +
    `</details>`
  );
}

export function renderFindings(report: RunReport): string {
  const findings = report.findings ?? [];
  if (!findings.length) return '';
  const rows = sortFindings(findings)
    .map((f) => {
      const badge = f.withheld ? `<span class="finding-withheld">${esc(WITHHELD_LABEL[f.withheld])}</span>` : '';
      // The fingerprint is rendered on every finding that has one, because it is what a reader
      // copies into a baseline file. A feature whose identity is computed and then hidden is a
      // feature whose adoption step is "run it again and diff the JSON".
      const fp = f.fingerprint ? `<code class="finding-fp">${esc(f.fingerprint)}</code>` : '<span class="finding-fp">— not baselinable</span>';
      const seeded = f.seeded ? `<div class="finding-seeded">seeded (seed ${f.seeded.seed}) — <strong>promote this payload into the corpus</strong>: <code>${esc(f.seeded.payload)}</code></div>` : '';
      const where = [f.endpoint, f.location, f.invariant].filter(Boolean).map((p) => esc(String(p))).join(' · ');
      // M135a (D409) — every rule this build ships has an entry, enforced by the compiler. The
      // fallback arm is for a `results.json` written by a newer build and rendered by an older
      // reporter: it degrades to a row without fixes rather than throwing on someone's report.
      const entry = remediationFor(f.rule);
      const fix = entry ? renderFix(entry) : '';
      return (
        `<tr class="finding ${f.withheld ? 'finding-off' : 'finding-on'}">` +
        `<td class="sev sev-${esc(f.severity)}">${esc(f.severity)}</td>` +
        `<td><code>${esc(f.rule)}</code> ${badge}<div class="finding-where">${where}</div>` +
        `<div class="finding-detail">${esc(f.detail)}</div>${seeded}${fix}</td>` +
        `<td>${fp}</td></tr>`
      );
    })
    .join('\n      ');
  return (
    `<section class="findings">\n` +
    `    <h2>Security findings</h2>\n` +
    `    <p class="findings-summary">${esc(findingsSummaryLine(findings))}</p>\n` +
    `    <table>\n      <thead><tr><th>severity</th><th>rule</th><th>fingerprint</th></tr></thead>\n` +
    `      <tbody>\n      ${rows}\n      </tbody>\n    </table>\n  </section>`
  );
}

/**
 * D389 — `M128-01`'s fix, rendered.
 *
 * The row is about a report that can name its not-applicable rules only inside D285's *no power to
 * fail* message, which prints when **zero** rules applied — so for a rule that applies
 * unconditionally the sentence can never appear at all. Here every scan lists both halves
 * unconditionally, including on a run where everything passed, because the passing run is precisely
 * where the information used to vanish.
 */
export function renderScanCoverage(coverage: readonly ScanRuleCensus[] | undefined): string {
  if (!coverage?.length) return '';
  const blocks = coverage
    .map((c) => {
      const applied = c.applied.length ? c.applied.map((r) => `<code>${esc(r)}</code>`).join(', ') : '<em>none</em>';
      const na = c.notApplicable.length
        ? c.notApplicable
            .map((n) => `<li><code>${esc(n.rule)}</code> — ${n.because.map((b) => esc(b)).join('; ')}</li>`)
            .join('\n        ')
        : '<li><em>every rule in this pack applied somewhere in the run</em></li>';
      return (
        `<div class="scan-census">\n      <h3>${esc(SCAN_KIND_LABEL[c.scan])}</h3>\n` +
        `      <p>applied: ${applied}</p>\n      <p>did not apply:</p>\n      <ul>\n        ${na}\n      </ul>\n    </div>`
      );
    })
    .join('\n    ');
  return `<section class="scan-coverage">\n    <h2>Which rules ran</h2>\n    ${blocks}\n  </section>`;
}
