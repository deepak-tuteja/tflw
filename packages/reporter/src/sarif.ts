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
//     assertion in `M135c` checks the URI's *form* — and on its first run it found this exporter
//     emitting `positives.tflw` for a file the repository holds at
//     `tflw-acceptance/security/positives.tflw`, because `ScanFinding.file` is relative to the
//     directory tflw ran in. `SarifOptions.sourceRoot` is the repair; `sarifUri` carries the detail.
//
// **One correction to the plan's own sketch, made by the schema.** D405 wrote the logical location
// as `physicalLocation.logicalLocations[0]`. In SARIF 2.1.0 `logicalLocations` is a property of
// `location`, not of `physicalLocation`, and the schema is `additionalProperties: false`, so the
// sketched shape is a rejected document. This is D414's argument arriving before the code shipped
// rather than after.

import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { Location, Log, ReportingDescriptor, Result } from 'sarif';
import type { ReproSubject, RunReport, ScanFinding, ScanKind, Severity } from '@tflw/runtime';
import { SCAN_RULE_IDS, SCAN_RULE_SEVERITY, templateEndpoint } from '@tflw/runtime';

import { ARTIFACT_CONTRACT } from './artifact-contract.js';
import { renderRepro, reproDirFor, reproFileName } from './repro.js';
import { sortFindings } from './findings.js';
import { remediationFor, type KbEntry } from './kb.js';
import { sarifSeverityOf } from './sarif-severity.js';

/** Every key below that another repository reads (`M137a`, `M136c-01`). Aliased once rather than
 * spelled `ARTIFACT_CONTRACT.sarif` at each of the eleven emit sites, which would make the emitter
 * harder to read to no benefit — the property that matters is that the string literals are gone
 * from here, not how far the reference travels. */
const SARIF = ARTIFACT_CONTRACT.sarif;

/** The file name, in the report directory beside `report.html` and `results.json`. */
export const SARIF_FILE = 'findings.sarif';

/** The schema this document declares. schemastore's copy is **draft-07**, which `ajv` reads without
 *  a second dialect package — measured before the test was written, per `M135` risk 1. */
export const SARIF_SCHEMA_URL = 'https://json.schemastore.org/sarif-2.1.0.json';

/** The homepage a consumer follows from the tool block. */
const TFLW_INFORMATION_URI = 'https://deepak-tuteja.github.io/tflw/';

/**
 * `M136a` (D421) — one entry in `run.properties['tflw/notApplicable']`.
 *
 * D412 created the property to carry *did-not-look* into the machine-readable artifact, so that a
 * scan which never ran could not read as a scan that found nothing. It carried only the rule-keyed
 * half. This is the shape both halves share, with `kind` as the discriminator so a consumer grouping
 * by `id` is never comparing a rule against a principal.
 *
 * `because` is an array for the rule half because a rule can stand down for different reasons in
 * different assertions of one run and D389 deduplicates them; the subject half always has one reason
 * per aggregated row and carries `count` instead, which is the number the row is actually about.
 */
interface NotAsked {
  readonly kind: 'rule' | 'subject';
  readonly scan: ScanKind;
  readonly id: string;
  readonly because: readonly string[];
  readonly count?: number;
}

/**
 * What kind of thing each scan's un-asked subjects are, used to namespace `NotAsked.id`.
 *
 * Total over `ScanKind` rather than a lookup with a fallback, so a fourth tier cannot be added
 * without deciding what its subjects are called — the same discipline `CLASS_OPT_IN` uses to stop a
 * fifth payload class arriving without a decision about its opt-in word.
 *
 * `security` has no inhabitant (Tier 1 judges one observed response and sends nothing), so its entry
 * is the honest generic rather than a guess at a noun it will never print.
 */
const SUBJECT_NAMESPACE: Readonly<Record<ScanKind, string>> = {
  security: 'subject',
  authorization: 'principal',
  'input-handling': 'endpoint',
};

export interface SarifOptions {
  /** tflw's own version, if the caller knows it. Omitted rather than guessed. */
  readonly version?: string;
  /** The run's repro subjects, from D331's sink — what the repro links are joined from. Absent on a
   *  run whose scans emitted no repro, which is most runs.
   *
   *  **Was `authzFindings` until M137d (D474).** It now carries a discriminated union, because Tier 3
   *  emits repros too; the old name would have been false about most of its contents on any run with an
   *  input scan, which is the same argument `D473` makes for not putting both kinds in one directory. */
  readonly reproSubjects?: readonly ReproSubject[];
  /**
   * The repository root `%SRCROOT%` names — absolute, and the base every `artifactLocation.uri` is
   * made relative to (D405).
   *
   * **Absent is not the same as "the current directory".** With no root the exporter emits
   * `ScanFinding.file` as it stands, which is relative to the process that produced it; that is
   * correct only when the run happened at the repository root, and silently unanchored otherwise.
   * The caller that knows where the root is passes it; a caller that genuinely does not know keeps
   * the old shape rather than inventing one.
   */
  readonly sourceRoot?: string;
  /**
   * The directory `ScanFinding.file` paths are relative to — the run's working directory. Only
   * consulted when `sourceRoot` is set, and defaults to `process.cwd()` because that is what the
   * CLI relativized against when it recorded them.
   */
  readonly fileBase?: string;
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

/**
 * A `.tflw` path as a SARIF URI reference **relative to the repository root**, or `undefined` if it
 * cannot be one honestly.
 *
 * `ScanFinding.file` is written by the CLI as `relative(cwd, file)`, so it is relative to *wherever
 * tflw was invoked*. That is the repository root only by coincidence — a corpus with its own
 * `tflw.config` is normally run from its own directory, and `positives.tflw` under `%SRCROOT%`
 * then names a file the repository does not have. D405 called this out in advance ("an absolute
 * path, or one relative to the process CWD rather than the repo root, matches nothing and the alert
 * never anchors") and the first run of `M135c`'s acceptance found the exporter doing exactly it, on
 * the one path nothing downstream reports: **an unanchored alert uploads successfully.**
 *
 * So with a `sourceRoot` the path is re-based — resolved against the run's directory, then made
 * relative to the root. Without one the value passes through as it stands, which is the old
 * behaviour and correct whenever the run *did* happen at the root.
 *
 * Three refusals, each because the alternative anchors to nothing while looking correct: a path that
 * lands **outside** the root (`../x`, or an absolute path elsewhere on the disk — a URI relative to
 * `%SRCROOT%` cannot leave it), the root **itself**, and the runtime's `'inline'` placeholder, which
 * is what an in-memory test has instead of a file. A finding that fails this still ships — with
 * `logicalLocations` and no `physicalLocation`, which is legal SARIF and degrades to "no annotation"
 * rather than to a rejected document.
 *
 * Separators are normalized to `/` because a URI reference is not a filesystem path, and a Windows
 * path with backslashes is not a valid one.
 */
export function sarifUri(file: string | undefined, sourceRoot?: string, fileBase?: string): string | undefined {
  if (!file || file === 'inline') return undefined;
  const normalized = file.replace(/\\/g, '/').replace(/^\.\//, '');
  if (sourceRoot) {
    const rebased = relative(sourceRoot, resolve(fileBase ?? process.cwd(), normalized)).replace(/\\/g, '/');
    if (rebased === '' || rebased === '..' || rebased.startsWith('../') || isAbsolute(rebased)) return undefined;
    return rebased;
  }
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return undefined;
  if (normalized === '..' || normalized.startsWith('../')) return undefined;
  return normalized;
}

function locationsFor(f: ScanFinding, opts: SarifOptions): Location[] {
  const uri = sarifUri(f.file, opts.sourceRoot, opts.fileBase);
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
    // `M137a`/`M136c-01`: the key comes from the cross-repo contract, so renaming it is an edit to
    // `artifact-contract.ts` and therefore an edit a consumer's gate can see.
    properties: { tags, [SARIF.ruleProperties.securitySeverity]: securitySeverity },
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
 * The one key both sides of the repro join compute, so neither can spell it differently.
 *
 * **The input arm needs the invariant and the authorization arm must not have it.** An authorization
 * finding is identified by its principal, and one principal reaching one endpoint is one finding. An
 * input finding is identified by its *site*, and one site can produce more than one — a stack frame and
 * a SQL fragment at the same query parameter are two repairs, which is exactly what R8's fingerprint
 * separates them on and what `reproFileName` puts in the file name. A key without the invariant would
 * make those two findings collide, and the visible symptom would be **two SARIF alerts pointing at one
 * repro file**, one of which is about a different leak.
 */
function reproKey(scan: ScanKind, rule: string, endpoint: string, location: string, invariant?: string): string {
  const base = `${rule} | ${endpoint} | ${location}`;
  return scan === 'input-handling' ? `${base} | ${invariant ?? ''}` : base;
}

/**
 * `(rule, endpoint, site)` → the repro file the emitter already wrote.
 *
 * The join is exact rather than heuristic: both sides compute their strings from the same inputs — an
 * authorization `ScanFinding` carries the principal as its `location` (`authzRules.ts`), an input one
 * carries the mutation site there and the detector's label as its `invariant`, and every endpoint on
 * both sides is `templateEndpoint(method, url)` of the same request.
 *
 * **There are two directories, and neither is `report/repros/`.** The plan sketched that name; the
 * emitter has shipped `report/authz-repro/` since `M130b` and a rename would move a published artifact
 * for no gain, so `M137d` added `input-repro/` beside it (`D473`) and this points at whichever the
 * subject's own kind names.
 *
 * **D413's deferral is discharged here, except for hygiene, which is now a decision (`D476`).** Tier 1
 * has nothing to re-send beyond "make this request and read the header", which restates the assertion
 * rather than reproducing anything — so it emits no repro and `resultObject` finds no link for it,
 * rather than finding a broken one.
 */
function reproIndex(subjects: readonly ReproSubject[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const f of subjects) {
    // Skipped rather than indexed when the emitter would decline to write the file: a link to a repro
    // that does not exist is worse than no link, and `renderRepro` is the only thing that knows.
    if (renderRepro(f) === null) continue;
    const rel = `${reproDirFor(f.kind)}/${reproFileName(f)}`;
    if (f.kind === 'authorization') {
      index.set(reproKey('authorization', f.rule, templateEndpoint(f.method, f.url), f.principal), rel);
    } else {
      index.set(reproKey('input-handling', f.rule, templateEndpoint(f.method, f.url), f.location, f.invariant), rel);
    }
  }
  return index;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

function resultObject(f: ScanFinding, ruleIndex: number, repros: ReadonlyMap<string, string>, opts: SarifOptions): Result {
  const { level } = sarifSeverityOf(f.severity);
  const repro = f.location !== undefined ? repros.get(reproKey(f.scan, f.rule, f.endpoint, f.location, f.invariant)) : undefined;
  return {
    ruleId: f.rule,
    ...(ruleIndex >= 0 ? { ruleIndex } : {}),
    level,
    message: { text: f.detail },
    locations: locationsFor(f, opts),
    // R8's identity, unchanged: the fingerprint is computed once by the runtime and carried, never
    // re-derived here. A reporter that re-hashed would be a second definition of the thing a
    // baseline file is keyed on.
    ...(f.fingerprint ? { partialFingerprints: { [SARIF.partialFingerprint]: f.fingerprint } } : {}),
    // D410 — `baseline` suppresses; `--fail-on` does not. An external suppression is an exact
    // semantic match for a decision a human recorded outside the tool, and GitHub renders it as a
    // dismissed alert. A finding below a severity floor is *unranked*, not accepted: nobody looked
    // at it, every consumer already filters by `level`, and suppressing it would make a team that
    // later lowers `--fail-on` watch a pile of alerts un-dismiss themselves with no corresponding
    // change in the application.
    ...(f.withheld === 'baseline' ? { suppressions: [{ kind: 'external', justification: 'accepted in the run\'s baseline file' }] } : {}),
    properties: {
      [SARIF.resultProperties.scan]: f.scan,
      [SARIF.resultProperties.endpoint]: f.endpoint,
      ...(f.location !== undefined ? { [SARIF.resultProperties.site]: f.location } : {}),
      ...(f.invariant !== undefined ? { [SARIF.resultProperties.invariant]: f.invariant } : {}),
      ...(f.withheld ? { [SARIF.resultProperties.withheld]: f.withheld } : {}),
      ...(repro ? { [SARIF.resultProperties.repro]: repro } : {}),
      // `M137c` (D437). Deliberately a *property* and never part of `partialFingerprints`: the
      // fingerprint above is carried from the runtime verbatim, so the same weakness found by two
      // seeds keeps one identity and a GitHub alert does not un-dismiss itself when a suite adds a
      // seed. What the property buys is the sentence D437 wanted in the report — how this route was
      // reached — on the surface a reviewer actually opens.
      ...(f.via !== undefined ? { [SARIF.resultProperties.via]: f.via } : {}),
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
  const repros = reproIndex(opts.reproSubjects ?? []);

  // D412's bucket, and D421's second half joining it.
  //
  // **One property, two kinds, and the `kind` discriminator is what keeps that honest.** A rule that
  // stood down and a subject that was never asked are both *did-not-look*, which is why they belong
  // in the property D412 created to carry did-not-look into the machine-readable artifact rather than
  // in a second one a consumer would have to know to read. They are not the same fact, which is why
  // neither is emitted without saying which it is: `kind: 'rule'` declined to judge an observation it
  // was given, `kind: 'subject'` never got an observation at all.
  //
  // `id` is namespaced by kind rather than left bare. A rule id and a principal name live in
  // different namespaces and can collide with no warning — and the whole value of this property is
  // that a consumer can group by it.
  const notApplicable: NotAsked[] = [
    ...(report.scanCoverage ?? []).flatMap((c) =>
      c.notApplicable.map((n) => ({ kind: 'rule' as const, scan: c.scan, id: n.rule, because: n.because })),
    ),
    ...(report.scanBlindSpot?.declines ?? []).map((d) => ({
      kind: 'subject' as const,
      scan: d.scan,
      id: `${SUBJECT_NAMESPACE[d.scan]}:${d.subject}`,
      because: [d.reason],
      count: d.count,
    })),
  ];

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
        results: findings.map((f) => resultObject(f, rules.indexOf(f.rule), repros, opts)),
        // `executionSuccessful` is about the *tool*, not the findings: a run that crashed produces a
        // partial document, and a consumer that cannot tell it apart from a clean sweep is being
        // told a scan finished when it did not.
        invocations: [{ executionSuccessful: report.ok !== false }],
        properties: {
          [SARIF.runProperties.notApplicable]: notApplicable,
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
