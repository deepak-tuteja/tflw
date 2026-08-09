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
import {
  DIAGNOSTICS,
  parseSource,
  parseConfigSource,
  checkProgram,
  checkAllowHostsCoversBaseUrls,
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
    return [...parsed.diagnostics, ...allowHosts];
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
      ...(probe.needs?.importedActions
        ? { importedActions: probe.needs.importedActions.map((a) => ({ ...a, from: a.from })) }
        : {}),
      ...(probe.needs?.envBaseUrls ? { envBaseUrls: probe.needs.envBaseUrls } : {}),
    }),
  ];
}

test('every `DIAGNOSTICS` row has at least one probe', () => {
  const bare = DIAGNOSTICS.filter((d) => d.probes.length === 0).map((d) => d.code);
  assert.deepEqual(bare, [], 'a row with no probe renders an empty example cell and asserts nothing');
});

test("every probe emits its own row's code", () => {
  const wrong: string[] = [];
  for (const row of DIAGNOSTICS) {
    row.probes.forEach((probe, i) => {
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
    row.probes.forEach((probe, i) => {
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

test('`example` is derived from `probes`, not stored beside them', () => {
  for (const row of DIAGNOSTICS) {
    assert.equal(row.example, renderDiagnosticExample(row.probes), `${row.code}'s rendered cell must be exactly what its probes render`);
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
