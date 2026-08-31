// M110b (`M110-01`) — every worked example in SPEC §17 is now **run**, and asserted to produce the
// code it sits under.
//
// `diagnosticsCoverage.test.ts` is the completeness floor: every code has a row. This is the
// correctness one: every row's example is source, and the source emits that row's code. Between
// them they cover the two ways §17 goes wrong, and only the first was guarded before now.
//
// **The failure this exists for is not hypothetical.** `V4-05`: `TF027`'s worked example — a
// `{col}` typo in a test *body* — produces `TF030` when run, a different code, and it sat under a
// `TF027` heading on SPEC §17, the docs-site reference page, `tflw docs diagnostic-codes` and LSP
// hover simultaneously for the fifty milestones between the V4 pass and M110. Four surfaces, one
// stale string, because all four generate from one manifest — and a manifest nothing executes.
//
// **What this milestone found on its first run**, none of it by re-reading:
//   · `TF003` claimed "a block indented 3 spaces inside one indented 2". That shape emits `TF011`
//     ("expected a step, found an indented block"). `TF003` is a *dedent* to a column matching no
//     enclosing block. The row documenting indentation had the indentation wrong.
//   · `TF023` quoted ``unknown time unit `5x` ``. The lexer prints ``unknown time unit `x` `` — it
//     names the unit, not the literal.
//   · `TF034` quoted `threshold for "checkotu" matches no step in this test`; the checker prints
//     ``threshold `for "checkotu"` matches no step in this test``.
//   · `TF040` quoted a hint offering ``let id = create thing()`` and ``{id}``. The checker offers
//     ``let result = create thing(…)`` and ``{result}`` — a variable name that appears nowhere in
//     the tool.
//
// **Why the probes are not a second field beside the prose.** They are the prose:
// `DiagnosticEntry.example` is computed by `renderDiagnosticExample`, so a row cannot render a
// claim its probe does not make. A separate `probe` field would be authored independently and
// could be right while the prose stayed wrong — the vacuous-control class arriving as its own
// remedy, which is exactly the mistake this arc keeps having to unmake.
//
// **The harness measured itself first, and was wrong five times before the manifest was wrong
// once.** Transcribing the prose fragments into runnable source, five probes reported the wrong
// code on the first pass — `where` for `with each`, `upload` as its own step rather than an `api`
// clause, `timeout step` as a step rather than a `defaults` key, a `threshold` in a test with no
// workload line, and the `TF003` shape above. Four of those five were the harness; one was the
// manifest. Had the harness been trusted, four false findings would have been filed against rows
// that are correct.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DIAGNOSTICS,
  parseSource,
  parseConfigSource,
  checkProgram,
  checkAllowHostsCoversBaseUrls,
  checkConfigDeclaredEnvRefs,
  checkConfigBracedEnvRefs,
  renderDiagnosticExample,
  type Diagnostic,
  type DiagnosticProbe,
} from '../src/index.js';

/** Make a probe's source a whole file of whatever `wrap` names, and report everything the tool
 *  says about it — the same `checkProgram` pass list `tflw check` and the language server run, so
 *  a row that passes here is a row the shipped tool agrees with. */
function runProbe(probe: DiagnosticProbe): readonly Diagnostic[] {
  if (probe.wrap === 'config') {
    const parsed = parseConfigSource(`${probe.source.join('\n')}\n`);
    const allowHosts = parsed.config.envs.flatMap((env) => checkAllowHostsCoversBaseUrls(parsed.config, env));
    // `M156a`/`M156b` — the config dialect's own `env()` rules, which `tflw check` runs beside
    // `checkAllowHostsCoversBaseUrls` at the same call site. `TF077` is gated on `needs.requiredEnv`
    // for the reason the field documents: without a declaration set nobody has said what this
    // config requires, and reporting every `env()` in every other row's probe would be the harness
    // being wrong rather than the row. `TF078` needs nothing and is wired unconditionally, exactly
    // as it is in the CLI.
    const envRefs = probe.needs?.requiredEnv ? checkConfigDeclaredEnvRefs(parsed.config, probe.needs.requiredEnv) : [];
    return [...parsed.diagnostics, ...allowHosts, ...envRefs, ...checkConfigBracedEnvRefs(parsed.config)];
  }
  const source =
    probe.wrap === 'step'
      ? `test "example"\n${probe.source.map((line) => `  ${line}`).join('\n')}\n`
      : `${probe.source.join('\n')}\n`;
  const parsed = parseSource(source);
  return [
    ...parsed.diagnostics,
    ...checkProgram(parsed.program, {
      ...(probe.needs?.services ? { knownServices: probe.needs.services } : {}),
      ...(probe.needs?.sessions ? { knownSessions: probe.needs.sessions } : {}),
      ...(probe.needs?.missingFiles ? { missingFiles: new Set(probe.needs.missingFiles) } : {}),
      ...(probe.needs?.importsWithErrors ? { importsWithErrors: new Set(probe.needs.importsWithErrors) } : {}),
      ...(probe.needs?.importedActions
        ? { importedActions: probe.needs.importedActions.map((a) => ({ ...a, from: a.from })) }
        : {}),
      ...(probe.needs?.envBaseUrls ? { envBaseUrls: probe.needs.envBaseUrls } : {}),
      ...(probe.needs?.envTimeouts ? { envTimeouts: probe.needs.envTimeouts } : {}),
      ...(probe.needs?.envAllowHosts ? { envAllowHosts: probe.needs.envAllowHosts } : {}),
      ...(probe.needs?.envAuthorizedTargets ? { envAuthorizedTargets: probe.needs.envAuthorizedTargets } : {}),
      ...(probe.needs?.allowPublicTargets ? { allowPublicTargets: probe.needs.allowPublicTargets } : {}),
      ...(probe.needs?.requiredEnv ? { requiredEnv: probe.needs.requiredEnv } : {}),
    }),
  ];
}

test('every `DIAGNOSTICS` row carries exactly one kind of evidence', () => {
  // `M159c` widened this from "at least one probe" to "one of probes or `runtime`", because
  // `TF080` is the first code no source text provokes (`D801`). The widening is the risk: "at
  // least one probe" could not be satisfied by writing nothing, and a two-way rule can be, if
  // `runtime` becomes the field a lazy row reaches for. Hence *exactly* one — a row carrying both
  // is as red as a row carrying neither, so `runtime` cannot be bolted onto a checkable code to
  // dodge writing its probe.
  const bare = DIAGNOSTICS.filter((d) => (d.probes?.length ?? 0) === 0 && d.runtime === undefined).map((d) => d.code);
  assert.deepEqual(bare, [], 'a row with no probe and no `runtime` renders an empty example cell and asserts nothing');
  const both = DIAGNOSTICS.filter((d) => (d.probes?.length ?? 0) > 0 && d.runtime !== undefined).map((d) => d.code);
  assert.deepEqual(both, [], 'a row carrying both is claiming its code is check-time and runtime at once — one of the two is false');
});

test('every `runtime` row points at a test that exists and names a test that exists', () => {
  // What makes `runtime` evidence rather than an assertion about itself. The manifest harness
  // cannot *execute* a browser test from here, so it does the one thing it can: resolve the
  // pointer. A row naming a deleted file, or a renamed test, goes red — which is the failure mode
  // that actually occurs, since the row and the test it names live in different packages and
  // nothing else relates them.
  const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
  const wrong: string[] = [];
  for (const row of DIAGNOSTICS) {
    if (!row.runtime) continue;
    const abs = join(repoRoot, row.runtime.test);
    if (!existsSync(abs)) {
      wrong.push(`${row.code} names ${row.runtime.test}, which does not exist`);
      continue;
    }
    const src = readFileSync(abs, 'utf8');
    // Matched as a quoted literal so a test name that merely appears in a comment cannot satisfy
    // it — the name has to be the argument to a `test(...)` call.
    const quoted = [`test('${row.runtime.name}'`, `test("${row.runtime.name}"`, 'test(`' + row.runtime.name + '`'];
    if (!quoted.some((q) => src.includes(q))) {
      wrong.push(`${row.code} names the test ${JSON.stringify(row.runtime.name)}, which ${row.runtime.test} does not declare`);
    }
  }
  assert.deepEqual(wrong, [], 'a `runtime` row whose pointer does not resolve is a claim with nothing behind it');
});

test('a `runtime` row naming a test that does not exist IS flagged', () => {
  // The control for the check above. Without it, "the pointer resolves" is a test that passes
  // whether or not resolution works — the exact shape three of four M92 controls turned out to be.
  const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
  assert.ok(!existsSync(join(repoRoot, 'packages/runtime/test/no-such-file.test.ts')), 'precondition');
  const real = join(repoRoot, 'packages/runtime/test/browser-steps.test.ts');
  assert.ok(existsSync(real), 'precondition: the file TF080 names is there');
  assert.ok(!readFileSync(real, 'utf8').includes("test('a name no test has'"), 'so a renamed test would be caught above');
});

test("every probe emits its own row's code", () => {
  const wrong: string[] = [];
  for (const row of DIAGNOSTICS) {
    (row.probes ?? []).forEach((probe, i) => {
      const codes = runProbe(probe).map((d) => d.code);
      if (!codes.includes(row.code)) {
        wrong.push(`${row.code}[${i}] emitted ${codes.join(', ') || '(nothing)'} — source: ${JSON.stringify(probe.source)}`);
      }
    });
  }
  assert.deepEqual(
    wrong,
    [],
    'a worked example that produces a different code than the row it sits under is `V4-05` — fix the example, or the row is documenting a rule the tool does not have',
  );
});

test('every quoted output appears verbatim in the message or hint', () => {
  const wrong: string[] = [];
  for (const row of DIAGNOSTICS) {
    (row.probes ?? []).forEach((probe, i) => {
      if (probe.says === undefined) return;
      const said = runProbe(probe)
        .filter((d) => d.code === row.code)
        .flatMap((d) => [d.message, d.hint ?? ''])
        .join('\n');
      if (!said.includes(probe.says)) wrong.push(`${row.code}[${i}] quotes ${JSON.stringify(probe.says)}, tool says ${JSON.stringify(said)}`);
    });
  }
  assert.deepEqual(wrong, [], 'the table quotes output the tool does not produce — a reader who searches for that string will not find it');
});

// The two negative controls below are what stop the pair above from being a passing test of
// nothing. Each mutates a *fixture*, never the manifest, and asserts the check goes red — a guard
// that cannot fail is the class `scripts/mutate.mjs` exists to catch, and three of four controls
// written for M92 failed to control anything on the first attempt.
test('a probe whose source emits a different code IS flagged', () => {
  const probe: DiagnosticProbe = { wrap: 'step', source: ['expect statuss equals 200'] };
  const codes = runProbe(probe).map((d) => d.code);
  assert.ok(codes.includes('TF013'), 'precondition: this source emits TF013');
  assert.ok(!codes.includes('TF030'), 'so a row claiming TF030 for it would be caught by the check above');
});

test('a probe quoting output the tool does not produce IS flagged', () => {
  const probe: DiagnosticProbe = { wrap: 'step', source: ['api GET'], says: 'expected a path like `/orders`, found end of line' };
  const said = runProbe(probe)
    .filter((d) => d.code === 'TF010')
    .flatMap((d) => [d.message, d.hint ?? ''])
    .join('\n');
  assert.ok(said.includes(probe.says!), 'precondition: this quote is real');
  assert.ok(!said.includes('expected a path like `/invoices`'), 'so a one-word drift in the quote would be caught by the check above');
});

test('`example` is derived from the row\'s evidence, not stored beside it', () => {
  for (const row of DIAGNOSTICS) {
    if (row.probes) {
      assert.equal(row.example, renderDiagnosticExample(row.probes), `${row.code}'s rendered cell must be exactly what its probes render`);
    } else {
      assert.ok(row.example.includes(row.runtime!.as), `${row.code}'s rendered cell must show the prose its \`runtime\` evidence declares`);
      assert.ok(row.example.includes('run time'), `${row.code} must say in the table that it is not a \`tflw check\` diagnostic — a reader who probes it with \`check\` gets nothing back`);
    }
  }
});

test('renderDiagnosticExample doubles the backticks when the text contains one', () => {
  assert.equal(renderDiagnosticExample([{ wrap: 'step', source: ['api GET'] }]), '`api GET`');
  assert.equal(renderDiagnosticExample([{ wrap: 'step', source: ['api GET'], says: 'no path' }]), '`api GET` → `no path`');
  assert.equal(
    renderDiagnosticExample([{ wrap: 'step', source: ['api GET'], says: 'did you mean `expect`?' }]),
    '`api GET` → `` did you mean `expect`? ``',
  );
  assert.equal(renderDiagnosticExample([{ wrap: 'file', source: ['a', 'b'] }]), '`a` then `b`');
  assert.equal(renderDiagnosticExample([{ wrap: 'file', source: ['a'], as: 'two blocks' }]), 'two blocks');
  assert.equal(
    renderDiagnosticExample([
      { wrap: 'step', source: ['a'], says: 'x' },
      { wrap: 'step', source: ['b'], says: 'y' },
    ]),
    '`a` → `x`; `b` → `y`',
  );
});
