// M135b (PLAN_M135_SARIF.md D403–D414) — the SARIF document.
//
// **Why this file validates against a real schema instead of asserting the fields somebody
// remembered.** SARIF's failure mode is silence: an invalid document uploads successfully, produces
// no alerts, and reports no error anywhere. There is nothing to work backwards from. A hand-written
// checklist can only assert what its author thought of, and the constraints that actually get
// documents rejected — required-when-present rules, enum values, URI forms, and the
// `text`-required-alongside-`markdown` rule in every multiformat message string — are exactly the
// ones nobody thinks of. That is D414's whole argument, and it paid immediately: the plan's own
// sketch put `logicalLocations` inside `physicalLocation`, which the schema rejects.
//
// **The schema is vendored, and which copy it is matters** (`M135` risk 1). `fixtures/` holds
// schemastore's `sarif-2.1.0.json`, which declares **draft-07** and so is read by `ajv` directly.
// The OASIS original is authored against draft-04 and would have cost a third dependency
// (`ajv-draft-04`). Checked before the test was written rather than after it failed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AjvModule from 'ajv';
import type { Log, Result } from 'sarif';
import type { AuthzFinding, RunReport, ScanFinding } from '@tflw/runtime';
import { buildSarifLog, runScanned, sarifUri, writeSarif, SARIF_FILE } from '../src/sarif.js';

// `ajv` is CJS with both a `module.exports` and a `.default`; which one an ESM default import lands
// on depends on the interop, and getting it wrong fails as `Ajv is not a constructor` rather than as
// anything readable. Accept either.
const Ajv = ((AjvModule as unknown as { default?: unknown }).default ?? AjvModule) as typeof AjvModule;

const SCHEMA = JSON.parse(readFileSync(new URL('./fixtures/sarif-schema-2.1.0.json', import.meta.url), 'utf8')) as object;

function validate(log: Log): void {
  // `strict: false` because the vendored schema uses keywords ajv's strict mode objects to; the
  // objection is about the schema's style, not about the document's validity.
  const ajv = new Ajv({ strict: false, allErrors: true });
  const check = ajv.compile(SCHEMA);
  if (!check(log)) {
    assert.fail(`SARIF document is invalid:\n${(check.errors ?? []).map((e) => `  ${e.instancePath || '/'} ${e.message}`).join('\n')}`);
  }
}

// ---------------------------------------------------------------------------
// A realistic run: all three scans, one baselined, one below the floor, one seeded, one stood down
// ---------------------------------------------------------------------------

function f(over: Partial<ScanFinding> = {}): ScanFinding {
  return {
    scan: 'security',
    rule: 'sec/cookie-not-httponly',
    severity: 'critical',
    description: 'cookie is readable by JavaScript (no HttpOnly)',
    detail: 'cookie `sid` — any XSS on this origin can read it',
    endpoint: 'POST /v1/auth/login',
    location: 'cookie sid',
    fingerprint: 'a'.repeat(16),
    file: 'tests/api/auth.tflw',
    line: 12,
    ...over,
  };
}

// The id is `4821` and not something like `9f3a` on purpose. `templateEndpoint` templates only the
// segment shapes it can recognise — a UUID, a run of digits, a long hex string — so a four-character
// hex id stays literal, the two sides of the repro join compute different endpoints, and the link
// silently does not attach. Found by this test failing, which is what makes the join *exact* rather
// than merely intended.
const AUTHZ_FINDING: AuthzFinding = {
  rule: 'sec/authz-object-leak',
  principal: 'peer',
  method: 'GET',
  url: 'https://api.example.com/v1/orders/4821',
  ids: ['4821'],
  owners: ['shopper'],
};

function report(over: Partial<RunReport> = {}): RunReport {
  return {
    ok: false,
    findings: [
      f(),
      f({ scan: 'authorization', rule: 'sec/authz-object-leak', endpoint: 'GET /v1/orders/{id}', location: 'peer', detail: 'peer read the owner\'s order', fingerprint: 'b'.repeat(16), file: 'tests/api/authz.tflw', line: 30 }),
      f({ scan: 'input-handling', rule: 'sec/oversized-input-accepted', severity: 'minor', endpoint: 'POST /v1/vuln/notes', location: 'body `title`', detail: 'accepted 64 KiB with 201', fingerprint: 'c'.repeat(16), withheld: 'fail-on' }),
      f({ rule: 'sec/csp-missing', severity: 'serious', endpoint: 'GET /v1/docs', location: undefined, detail: 'nothing constrains where this document may load script from', fingerprint: 'd'.repeat(16), withheld: 'baseline' }),
      f({ scan: 'input-handling', rule: 'sec/error-detail-disclosure', severity: 'serious', endpoint: 'POST /v1/vuln/notes', detail: 'answered 500 with an ORM exception name', fingerprint: undefined, seeded: { seed: 7, payload: "tflw'\"" } }),
    ],
    scanCoverage: [
      { scan: 'security', applied: ['sec/cookie-not-httponly', 'sec/csp-missing'], notApplicable: [{ rule: 'sec/tls-version-old', because: ['the scheme is https and the TLS probe succeeded — it did not: connection refused'] }] },
      { scan: 'authorization', applied: ['sec/authz-object-leak'], notApplicable: [{ rule: 'sec/authz-collection-leak', because: ["the owner's response is an object, not an array"] }] },
      { scan: 'input-handling', applied: ['sec/oversized-input-accepted', 'sec/error-detail-disclosure'], notApplicable: [] },
    ],
    ...over,
  } as unknown as RunReport;
}

function resultsOf(log: Log): Result[] {
  return log.runs[0]!.results ?? [];
}

/** Results are ordered by `sortFindings` — gating before withheld, then worst severity, then
 *  endpoint — so an index is not a stable handle on a particular finding. Select by rule. */
function resultFor(log: Log, rule: string): Result {
  const found = resultsOf(log).find((r) => r.ruleId === rule);
  assert.ok(found, `no result for ${rule}`);
  return found;
}

// ---------------------------------------------------------------------------
// D414 — the document is valid, which is the assertion no consumer will make for us
// ---------------------------------------------------------------------------

test('a realistic run produces a schema-valid SARIF 2.1.0 document', () => {
  const log = buildSarifLog(report(), { version: '0.1.0', authzFindings: [AUTHZ_FINDING] });
  assert.ok(log);
  validate(log);
  assert.equal(log.version, '2.1.0');
  assert.equal(log.runs.length, 1);
});

test('every rule carries `text` alongside `markdown`, which is the rule that silently invalidates', () => {
  const log = buildSarifLog(report())!;
  for (const rule of log.runs[0]!.tool.driver.rules ?? []) {
    if (rule.help) assert.ok(rule.help.text, `${rule.id}: a multiformat message string without \`text\` is a rejected document`);
    assert.ok(rule.shortDescription?.text, `${rule.id}: shortDescription needs text`);
  }
});

// ---------------------------------------------------------------------------
// D404 — no scan, no file
// ---------------------------------------------------------------------------

test('a run that never scanned produces no document at all', () => {
  // The trap: `upload-sarif` reads an empty `results` array as *everything previously reported is
  // fixed*, so a functional-only job emitting an empty file would silently resolve the security
  // job's whole backlog. Absence is a signal a workflow can test; emptiness is one that reads as
  // good news.
  assert.equal(runScanned({ ok: true } as unknown as RunReport), false);
  assert.equal(buildSarifLog({ ok: true } as unknown as RunReport), undefined);
});

test('a scan that found nothing still produces a document — silence is a result', () => {
  const log = buildSarifLog(report({ findings: [] }));
  assert.ok(log, 'the census is non-empty, so this run looked and found nothing — which is not the same as not looking');
  assert.equal(resultsOf(log).length, 0);
  assert.ok((log.runs[0]!.tool.driver.rules ?? []).length > 0, 'the rules that applied are still declared, with zero results each');
});

test('writeSarif writes nothing when the run did not scan, and returns undefined', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-sarif-'));
  assert.equal(await writeSarif({ ok: true } as unknown as RunReport, dir), undefined);
  assert.deepEqual(await readdir(dir), []);
});

test('writeSarif writes findings.sarif when it did', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-sarif-'));
  const path = await writeSarif(report(), dir, { version: '0.1.0' });
  assert.ok(path?.endsWith(SARIF_FILE));
  validate(JSON.parse(await readFile(path, 'utf8')) as Log);
});

// ---------------------------------------------------------------------------
// D405 — where a result points
// ---------------------------------------------------------------------------

test('a result anchors to the .tflw assertion, repo-relative and with a uriBaseId', () => {
  // The most likely way this milestone ships something that looks right in a file and anchors to
  // nothing in a UI. GitHub matches the URI against the repository tree; an absolute path or one
  // relative to the process CWD matches nothing, and nothing says so.
  const loc = resultFor(buildSarifLog(report())!, 'sec/cookie-not-httponly').locations![0]!;
  assert.equal(loc.physicalLocation!.artifactLocation!.uri, 'tests/api/auth.tflw');
  assert.equal(loc.physicalLocation!.artifactLocation!.uriBaseId, '%SRCROOT%');
  assert.equal(loc.physicalLocation!.region!.startLine, 12);
});

test('the endpoint is a logical location, because it is the finding\'s real subject', () => {
  const loc = resultFor(buildSarifLog(report())!, 'sec/cookie-not-httponly').locations![0]!;
  assert.equal(loc.logicalLocations![0]!.fullyQualifiedName, 'POST /v1/auth/login');
  assert.equal(loc.logicalLocations![0]!.kind, 'resource');
});

test('a finding with no usable file degrades to a logical location rather than an invalid document', () => {
  // `'inline'` is what an in-memory runtime test has instead of a path; an absolute path cannot be
  // relative to `%SRCROOT%`; `../` resolves outside the repository. All three anchor to nothing, so
  // all three are refused rather than emitted and hoped for.
  assert.equal(sarifUri('inline'), undefined);
  assert.equal(sarifUri('/abs/tests/x.tflw'), undefined);
  assert.equal(sarifUri('../outside/x.tflw'), undefined);
  assert.equal(sarifUri('tests\\api\\auth.tflw'), 'tests/api/auth.tflw', 'a URI reference is not a filesystem path');

  const log = buildSarifLog(report({ findings: [f({ file: 'inline', line: undefined })] }))!;
  validate(log);
  const loc = resultsOf(log)[0]!.locations![0]!;
  assert.equal(loc.physicalLocation, undefined);
  assert.ok(loc.logicalLocations);
});

// ---------------------------------------------------------------------------
// D406 / D407 — severity and taxonomy
// ---------------------------------------------------------------------------

test('security-severity is a string on every rule, and the level agrees with the gate', () => {
  const rules = buildSarifLog(report())!.runs[0]!.tool.driver.rules ?? [];
  const byId = new Map(rules.map((r) => [r.id, r]));
  assert.equal(typeof byId.get('sec/cookie-not-httponly')!.properties!['security-severity'], 'string');
  assert.equal(byId.get('sec/cookie-not-httponly')!.properties!['security-severity'], '9.5');
  assert.equal(byId.get('sec/cookie-not-httponly')!.defaultConfiguration!.level, 'error');
  // `serious` reads as `error` too: `--fail-on` fails a build on it by default, and a document
  // filing it as a warning makes the tool say two different things about one finding.
  assert.equal(byId.get('sec/csp-missing')!.defaultConfiguration!.level, 'error');
  assert.equal(byId.get('sec/oversized-input-accepted')!.defaultConfiguration!.level, 'note');
});

test('the CWE rides in tags, in the form GitHub filters on', () => {
  const rules = buildSarifLog(report())!.runs[0]!.tool.driver.rules ?? [];
  const tags = rules.find((r) => r.id === 'sec/authz-object-leak')!.properties!.tags as string[];
  assert.deepEqual(tags, ['security', 'external/cwe/cwe-639']);
});

// ---------------------------------------------------------------------------
// D410 / D411 — what suppresses, and what is not there at all
// ---------------------------------------------------------------------------

test('a baselined finding is suppressed; one below the floor is an ordinary result', () => {
  const results = resultsOf(buildSarifLog(report())!);
  const baselined = results.find((r) => r.ruleId === 'sec/csp-missing')!;
  assert.equal(baselined.suppressions?.[0]?.kind, 'external');

  const belowFloor = results.find((r) => r.ruleId === 'sec/oversized-input-accepted')!;
  assert.equal(belowFloor.suppressions, undefined, 'unranked is not accepted — nobody looked at it');
  assert.equal(belowFloor.level, 'note');
});

test('seeded findings are absent from the document entirely', () => {
  // They carry no fingerprint by construction (D369), and GitHub dedupes on fingerprints — so each
  // reseed would mint a permanent new alert, and the obvious cure would be to invent the identity
  // D369 deliberately withheld.
  const results = resultsOf(buildSarifLog(report())!);
  assert.equal(results.filter((r) => r.ruleId === 'sec/error-detail-disclosure').length, 0);
  assert.equal(results.length, 4);
});

test('the fingerprint is carried, never re-derived', () => {
  assert.equal(resultFor(buildSarifLog(report())!, 'sec/cookie-not-httponly').partialFingerprints!.tflwFindingV1, 'a'.repeat(16));
});

// ---------------------------------------------------------------------------
// D412 — the three-state model in SARIF's vocabulary
// ---------------------------------------------------------------------------

test('rules[] declares what applied; what stood down goes to run.properties with its reason', () => {
  const run = buildSarifLog(report())!.runs[0]!;
  const declared = (run.tool.driver.rules ?? []).map((r) => r.id);
  assert.ok(declared.includes('sec/csp-missing'), 'applied and found something');
  assert.ok(!declared.includes('sec/tls-version-old'), 'stood down — declaring it would read as a check that never fires');

  const na = run.properties!['tflw/notApplicable'] as { rule: string; because: string[] }[];
  const tls = na.find((n) => n.rule === 'sec/tls-version-old')!;
  assert.match(tls.because[0]!, /connection refused/, 'the reason travels, or the reader learns only that something did not happen');
});

test('rules[] is ordered by the pack order, so two runs of one suite diff only on real change', () => {
  const declared = (buildSarifLog(report())!.runs[0]!.tool.driver.rules ?? []).map((r) => r.id);
  assert.deepEqual(declared, ['sec/cookie-not-httponly', 'sec/csp-missing', 'sec/authz-object-leak', 'sec/error-detail-disclosure', 'sec/oversized-input-accepted']);
});

test('every result names a rule the catalog declares', () => {
  const run = buildSarifLog(report())!.runs[0]!;
  const declared = (run.tool.driver.rules ?? []).map((r) => r.id);
  for (const r of run.results ?? []) {
    assert.ok(declared.includes(r.ruleId!), `${r.ruleId} has a result and no rule object`);
    assert.equal(declared[r.ruleIndex!], r.ruleId, 'ruleIndex must agree with ruleId or a consumer reads the wrong rule');
  }
});

// ---------------------------------------------------------------------------
// D413 — repros
// ---------------------------------------------------------------------------

test('an authorization result links the repro the emitter already wrote', () => {
  const results = resultsOf(buildSarifLog(report(), { authzFindings: [AUTHZ_FINDING] })!);
  const authz = results.find((r) => r.ruleId === 'sec/authz-object-leak')!;
  assert.equal(authz.properties!['tflw/repro'], 'authz-repro/object-leak--get--v1-orders-4821--peer.tflw');
});

test('the other two scans carry no repro property, rather than a broken link', () => {
  const results = resultsOf(buildSarifLog(report(), { authzFindings: [AUTHZ_FINDING] })!);
  for (const r of results.filter((x) => x.ruleId !== 'sec/authz-object-leak')) {
    assert.equal(r.properties!['tflw/repro'], undefined);
  }
});

test('a repro link is joined on the endpoint, so a different endpoint does not borrow one', () => {
  // The join is `(rule, endpoint, principal)` and both sides compute the endpoint with the same
  // function. A looser match would attach one finding's repro to another's alert, which is worse
  // than no link: the file it points at goes green while the alert stays red.
  const other: AuthzFinding = { ...AUTHZ_FINDING, url: 'https://api.example.com/v1/invoices/4821' };
  const results = resultsOf(buildSarifLog(report(), { authzFindings: [other] })!);
  assert.equal(results.find((r) => r.ruleId === 'sec/authz-object-leak')!.properties!['tflw/repro'], undefined);
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test('two builds of one report are byte-identical', () => {
  const r = report();
  assert.equal(JSON.stringify(buildSarifLog(r, { authzFindings: [AUTHZ_FINDING] })), JSON.stringify(buildSarifLog(r, { authzFindings: [AUTHZ_FINDING] })));
});

test('the run says whether the tool itself finished', () => {
  // Not about findings: a run that crashed produces a partial document, and a consumer that cannot
  // tell that apart from a clean sweep has been told a scan completed when it did not.
  assert.equal(buildSarifLog(report({ ok: false }))!.runs[0]!.invocations![0]!.executionSuccessful, false);
  assert.equal(buildSarifLog(report({ ok: true }))!.runs[0]!.invocations![0]!.executionSuccessful, true);
});
