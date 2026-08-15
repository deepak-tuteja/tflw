// M135b (PLAN_M135_SARIF.md D403–D407, D410–D413) — R8's SARIF 2.1.0 document, written from
// `RunReport.findings[]`.
//
// **Its container was deleted, so it re-attaches here (D403).** `PLAN_REPORTS_PERF_SECURITY.md` R2
// assigned `findings.sarif` to a `tflw scan` mode, and D364 established that mode will never exist —
// `M50`–`M53` spent four milestones collapsing the *other* promised mode into `run`. D376 already
// moved R8's fingerprints onto `RunReport` and D377 moved R11's gate; this moves the file. R1's
// "three fully independent report types" is now two: `RunReport` and `LoadReport`.
//
// **Why this format is worth a milestone rather than an afternoon: it fails silently.** An invalid
// SARIF document uploads successfully and produces no alerts, with no error anywhere to read. Every
// other artifact tflw writes is verified by a human opening it; this one is verified by a machine
// that says nothing when it declines. That asymmetry is why `sarif.test.ts` validates against the
// real schema instead of asserting the fields somebody remembered.
//
// **Two shape traps are load-bearing and both are silent when wrong:**
//   - `security-severity` is a **string**. GitHub ignores a numeric one — the alert appears, ranked
//     wrong. `sarif-severity.ts` types it that way for this reason.
//   - `artifactLocation.uri` must be **repo-relative with `uriBaseId`**. An absolute path, or one
//     relative to somewhere other than the repository root, matches nothing in the tree and the
//     alert never anchors — it renders as an unattached list, which is most of what SARIF was
//     wanted for. D415 deliberately declined the upload that would have caught this, so the acceptance
//     assertion in `M135c` checks the URI's *form*.
//
// **One correction to the plan's own sketch, made by the schema.** D405 wrote the logical location
// as `physicalLocation.logicalLocations[0]`. In SARIF 2.1.0 `logicalLocations` is a property of
// `location`, not of `physicalLocation`, and the schema is `additionalProperties: false`, so the
// sketched shape is a rejected document. This is D414's argument arriving before the code shipped
// rather than after.

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Location, Log, ReportingDescriptor, Result } from 'sarif';
import type { AuthzFinding, RunReport, ScanFinding, Severity } from '@tflw/runtime';
import { SCAN_RULE_IDS, SCAN_RULE_SEVERITY, templateEndpoint } from '@tflw/runtime';

import { AUTHZ_REPRO_DIR, reproFileName } from './authz-repro.js';
import { sortFindings } from './findings.js';
import { remediationFor, type KbEntry } from './kb.js';
import { sarifSeverityOf } from './sarif-severity.js';

/** The file name, in the report directory beside `report.html` and `results.json`. */
export const SARIF_FILE = 'findings.sarif';

/** The schema this document declares. schemastore's copy is **draft-07**, which `ajv` reads without
 *  a second dialect package — measured before the test was written, per `M135` risk 1. */
export const SARIF_SCHEMA_URL = 'https://json.schemastore.org/sarif-2.1.0.json';

/** The homepage a consumer follows from the tool block. */
const TFLW_INFORMATION_URI = 'https://deepak-tuteja.github.io/tflw/';

export interface SarifOptions {
  /** tflw's own version, if the caller knows it. Omitted rather than guessed. */
  readonly version?: string;
  /** The run's authorization findings, from D331's sink — the input D413's repro links are joined
   *  from. Absent on a run with no authorization scan, which is most runs. */
  readonly authzFindings?: readonly AuthzFinding[];
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

/**
 * A `.tflw` path as a SARIF URI reference, or `undefined` if it cannot be one honestly.
 *
 * Three refusals, each because the alternative anchors to nothing while looking correct:
 * an **absolute** path (a URI relative to `%SRCROOT%` cannot start at a filesystem root), a path
 * that **escapes upward** (`../x` resolves outside the repository), and the runtime's `'inline'`
 * placeholder, which is what an in-memory test has instead of a file. A finding that fails this
 * still ships — with `logicalLocations` and no `physicalLocation`, which is legal SARIF and degrades
 * to "no annotation" rather than to a rejected document.
 *
 * Separators are normalized to `/` because a URI reference is not a filesystem path, and a Windows
 * path with backslashes is not a valid one.
 */
export function sarifUri(file: string | undefined): string | undefined {
  if (!file || file === 'inline') return undefined;
  const normalized = file.replace(/\\/g, '/').replace(/^\.\//, '');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return undefined;
  if (normalized === '..' || normalized.startsWith('../')) return undefined;
  return normalized;
}

function locationsFor(f: ScanFinding): Location[] {
  const uri = sarifUri(f.file);
  const logical = f.endpoint
    ? // `kind: "resource"` is SARIF's own vocabulary for a thing that is addressed rather than
      // compiled. The endpoint is the finding's real subject — the `.tflw` file is only where the
      // assertion that noticed it lives — and this is the field the format provides for saying so,
      // where a consumer can group by it.
      [{ fullyQualifiedName: f.endpoint, kind: 'resource' }]
    : [];
  const physical = uri
    ? {
        physicalLocation: {
          artifactLocation: { uri, uriBaseId: '%SRCROOT%' },
          ...(f.line !== undefined ? { region: { startLine: f.line } } : {}),
        },
      }
    : {};
  if (!uri && logical.length === 0) return [];
  return [{ ...physical, ...(logical.length ? { logicalLocations: logical } : {}) }];
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/** Plain-text `help`. **Required even though `markdown` is present**: a multiformat message string
 *  must carry `text`, and omitting it is a validation failure rather than a downgrade. */
function helpText(e: KbEntry): string {
  const refs = e.refs.map((r) => `${r.label}: ${r.url}`).join('\n');
  return `${e.what}\n\n${e.why}\n\nFix: ${e.fixGeneric}\n\nIn NestJS: ${e.fixNest}\n\nReferences:\n${refs}`;
}

function helpMarkdown(e: KbEntry): string {
  const refs = e.refs.map((r) => `- [${r.label}](${r.url})`).join('\n');
  return `${e.what}\n\n${e.why}\n\n**Fix** — ${e.fixGeneric}\n\n**In NestJS** — ${e.fixNest}\n\n**References**\n\n${refs}`;
}

function ruleObject(rule: string, severity: Severity): ReportingDescriptor {
  const { level, securitySeverity } = sarifSeverityOf(severity);
  const entry = remediationFor(rule);
  const tags = ['security', ...(entry ? [`external/cwe/cwe-${entry.cwe}`] : [])];
  return {
    id: rule,
    ...(entry ? { shortDescription: { text: entry.title } } : {}),
    ...(entry ? { fullDescription: { text: entry.what } } : {}),
    ...(entry ? { help: { text: helpText(entry), markdown: helpMarkdown(entry) } } : {}),
    defaultConfiguration: { level },
    // D407 — CodeQL's convention, and the one GitHub's UI filters and groups on, so a tflw finding
    // sits beside native alerts instead of in a bucket of its own. A full `taxonomies[]` block was
    // rejected: it is spec-pure, largely ignored by the consumer that matters, and its `guid`
    // fields are a validation cost paid for a reach nothing currently has.
    properties: { tags, 'security-severity': securitySeverity },
  };
}

/**
 * D412 — `rules[]` declares what **applied**, in `SCAN_RULE_IDS` order.
 *
 * This is the three-state coverage model in SARIF's own vocabulary: a rule that fires is here with
 * results, a rule that was applied and found nothing is here with **zero** results — a measured
 * silence — and a rule that stood down is absent, listed instead in `run.properties` with its
 * reason. Declaring all eighteen every run is the conventional choice and it flattens *silent* and
 * *not applicable* into one indistinguishable empty state, which is the exact conflation this arc
 * spent two milestones separating.
 *
 * A rule that produced a result is included whether or not the census names it: a result whose
 * `ruleId` matches nothing in `rules[]` is a document describing a finding it cannot explain.
 */
function appliedRules(report: RunReport): string[] {
  const applied = new Set<string>();
  for (const c of report.scanCoverage ?? []) for (const r of c.applied) applied.add(r);
  for (const f of report.findings ?? []) if (!f.seeded) applied.add(f.rule);
  const known = SCAN_RULE_IDS.filter((id) => applied.has(id));
  // Anything the census named that this build does not know about — a `results.json` replayed
  // through an older reporter — keeps its place rather than vanishing from the catalog.
  const unknown = [...applied].filter((id) => !(SCAN_RULE_IDS as readonly string[]).includes(id)).sort();
  return [...known, ...unknown];
}

function severityOfRule(rule: string, findings: readonly ScanFinding[]): Severity {
  const known = (SCAN_RULE_SEVERITY as Readonly<Record<string, Severity>>)[rule];
  if (known) return known;
  // An unknown rule takes the severity of a finding that carries it, and `critical` if even that is
  // missing. Guessing downward would rank an unrecognised weakness as noise, which is the direction
  // this arc consistently refuses.
  return findings.find((f) => f.rule === rule)?.severity ?? 'critical';
}

// ---------------------------------------------------------------------------
// Repros (D413)
// ---------------------------------------------------------------------------

/**
 * `(rule, endpoint, principal)` → the repro file `M130b`'s emitter already wrote.
 *
 * The join is exact rather than heuristic: an authorization `ScanFinding` carries the principal as
 * its `location` (`authzRules.ts`) and its endpoint is `templateEndpoint(method, url)` of the same
 * request the `AuthzFinding` records, so both sides compute the same two strings from the same
 * inputs.
 *
 * **There is no second directory.** The plan sketched `report/repros/`; the emitter has shipped
 * `report/authz-repro/` since `M130b` and a rename would move a published artifact for no gain, so
 * the property points at the files that exist. What is deferred (D413) is *generalizing* the emitter
 * to the other two scans — an input repro must re-send a payload, and a hygiene repro has nothing to
 * re-send beyond "make this request and read the header", which restates the assertion rather than
 * reproducing anything. Both mean editing the interpreter, and this is a reporter milestone.
 */
function reproIndex(authzFindings: readonly AuthzFinding[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const f of authzFindings) {
    index.set(`${f.rule} | ${templateEndpoint(f.method, f.url)} | ${f.principal}`, `${AUTHZ_REPRO_DIR}/${reproFileName(f)}`);
  }
  return index;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

function resultObject(f: ScanFinding, ruleIndex: number, repros: ReadonlyMap<string, string>): Result {
  const { level } = sarifSeverityOf(f.severity);
  const repro = f.location !== undefined ? repros.get(`${f.rule} | ${f.endpoint} | ${f.location}`) : undefined;
  return {
    ruleId: f.rule,
    ...(ruleIndex >= 0 ? { ruleIndex } : {}),
    level,
    message: { text: f.detail },
    locations: locationsFor(f),
    // R8's identity, unchanged: the fingerprint is computed once by the runtime and carried, never
    // re-derived here. A reporter that re-hashed would be a second definition of the thing a
    // baseline file is keyed on.
    ...(f.fingerprint ? { partialFingerprints: { tflwFindingV1: f.fingerprint } } : {}),
    // D410 — `baseline` suppresses; `--fail-on` does not. An external suppression is an exact
    // semantic match for a decision a human recorded outside the tool, and GitHub renders it as a
    // dismissed alert. A finding below a severity floor is *unranked*, not accepted: nobody looked
    // at it, every consumer already filters by `level`, and suppressing it would make a team that
    // later lowers `--fail-on` watch a pile of alerts un-dismiss themselves with no corresponding
    // change in the application.
    ...(f.withheld === 'baseline' ? { suppressions: [{ kind: 'external', justification: 'accepted in the run\'s baseline file' }] } : {}),
    properties: {
      'tflw/scan': f.scan,
      'tflw/endpoint': f.endpoint,
      ...(f.location !== undefined ? { 'tflw/site': f.location } : {}),
      ...(f.invariant !== undefined ? { 'tflw/invariant': f.invariant } : {}),
      ...(f.withheld ? { 'tflw/withheld': f.withheld } : {}),
      ...(repro ? { 'tflw/repro': repro } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

/**
 * Did this run scan at all?
 *
 * D404's condition, and the reason the whole file is conditional: `upload-sarif` reads an empty
 * `results` array as *everything previously reported is fixed* and resolves the matching alerts. A
 * repository whose functional suite and security suite are separate CI jobs would have the
 * functional job silently close the security job's entire backlog. **Absence of the file is a signal
 * a workflow can test (`hashFiles`) and cannot misread; an empty file is a signal that reads as good
 * news.** This is the three-state model one layer up: did-not-look must not render as clean.
 *
 * A findings array is checked as well as the census, so no path exists on which a finding is
 * computed and then dropped for want of a census entry.
 */
export function runScanned(report: RunReport): boolean {
  return (report.scanCoverage?.length ?? 0) > 0 || (report.findings?.length ?? 0) > 0;
}

/**
 * The SARIF log for a run, or `undefined` if the run did not scan.
 *
 * D411 — **seeded findings are excluded entirely.** D369's seeded layer carries no fingerprint by
 * construction, and that absence is what makes it un-baselinable and non-gating. GitHub dedupes on
 * `partialFingerprints` and falls back to a location hash without them, so a random payload that
 * fires once and never again becomes a permanent alert and the next seed adds another. SARIF's
 * consumer is a *tracking* system keyed on stable identity; feeding it something that structurally
 * cannot be keyed churns, and the obvious fix for the churn would be to invent the fingerprint D369
 * deliberately withheld. Seeded findings keep `results.json` and the `report.html` block, where
 * their actual call to action — promote this payload into the corpus — is a human review step.
 */
export function buildSarifLog(report: RunReport, opts: SarifOptions = {}): Log | undefined {
  if (!runScanned(report)) return undefined;

  const findings = sortFindings((report.findings ?? []).filter((f) => !f.seeded));
  const rules = appliedRules(report);
  const ruleObjects = rules.map((r) => ruleObject(r, severityOfRule(r, findings)));
  const repros = reproIndex(opts.authzFindings ?? []);

  const notApplicable = (report.scanCoverage ?? []).flatMap((c) =>
    c.notApplicable.map((n) => ({ scan: c.scan, rule: n.rule, because: n.because })),
  );

  return {
    $schema: SARIF_SCHEMA_URL,
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'tflw',
            informationUri: TFLW_INFORMATION_URI,
            ...(opts.version ? { version: opts.version } : {}),
            rules: ruleObjects,
          },
        },
        results: findings.map((f) => resultObject(f, rules.indexOf(f.rule), repros)),
        // `executionSuccessful` is about the *tool*, not the findings: a run that crashed produces a
        // partial document, and a consumer that cannot tell it apart from a clean sweep is being
        // told a scan finished when it did not.
        invocations: [{ executionSuccessful: report.ok !== false }],
        properties: {
          'tflw/notApplicable': notApplicable,
        },
      },
    ],
  };
}

/**
 * Write `findings.sarif` into `dir`, or write nothing and return `undefined` when the run did not
 * scan (D404). Two trailing newlines are not added; the file is JSON, and a consumer parses it.
 */
export async function writeSarif(report: RunReport, dir: string, opts: SarifOptions = {}): Promise<string | undefined> {
  const log = buildSarifLog(report, opts);
  if (!log) return undefined;
  const outDir = resolve(dir);
  await mkdir(outDir, { recursive: true });
  const path = join(outDir, SARIF_FILE);
  await writeFile(path, JSON.stringify(log, null, 2) + '\n', 'utf8');
  return path;
}
