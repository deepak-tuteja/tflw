// `M246` — `signer` in `tflw.config`, `sign with` under a step, `signed with` on a session.
//
// Before this milestone none of these words meant anything: `signer` at the top of a config was
// `TF022`, and a `sign with` line under an api step was "only `header` or `retry honoring` lines may
// follow an api step". Each negative control below is that refusal or its successor diagnostic.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, parseConfigSource, print, format, checkProgram, collectSymbols, collectConfigSymbols, detectReuse, Codes } from '../src/index.js';
import type { ApiStep, HmacScheme, Sigv4Scheme } from '../src/index.js';

const STRIPE = `signer stripe hmac sha256 hex secret env(STRIPE_WEBHOOK_SECRET)
  signs "{timestamp}.{body}"
  header "Stripe-Signature" is "t={timestamp},v1={signature}"
`;

function configErrors(src: string): { code: string; message: string; hint?: string }[] {
  return parseConfigSource(src).diagnostics.filter((d) => d.severity === 'error').map((d) => ({ code: d.code, message: d.message, ...(d.hint ? { hint: d.hint } : {}) }));
}

// ---- config: the declaration ---------------------------------------------------------------------

test('an hmac signer parses to its algorithm, encoding, secret, template and header lines', () => {
  const { config, diagnostics } = parseConfigSource(STRIPE);
  assert.deepEqual(diagnostics, []);
  const [signer] = config.signers ?? [];
  assert.ok(signer);
  assert.equal(signer.name, 'stripe');
  assert.equal(signer.envs, null);
  const scheme = signer.scheme as HmacScheme;
  assert.equal(scheme.type, 'HmacScheme');
  assert.deepEqual([scheme.algorithm, scheme.encoding, scheme.secret.type, scheme.signs.value], ['sha256', 'hex', 'EnvRef', '{timestamp}.{body}']);
  assert.deepEqual(scheme.headers.map((h) => [h.name.value, h.value.value]), [['Stripe-Signature', 't={timestamp},v1={signature}']]);
});

test('a sigv4 signer reads region, service, key, secret and an optional token, and takes `for env`', () => {
  const src = 'env prod\n  api "https://x.example"\nsigner aws for env prod sigv4 region "eu-west-1" service "execute-api" key env(AWS_ACCESS_KEY_ID) secret env(AWS_SECRET_ACCESS_KEY) token env(AWS_SESSION_TOKEN)\n';
  const { config, diagnostics } = parseConfigSource(src);
  assert.deepEqual(diagnostics, []);
  const signer = config.signers![0]!;
  assert.deepEqual(signer.envs?.map((e) => e.name), ['prod']);
  const scheme = signer.scheme as Sigv4Scheme;
  assert.equal(scheme.type, 'Sigv4Scheme');
  assert.ok(scheme.token);
});

test('a config with no signer has no `signers` field — absent, not `[]`, so no golden changes', () => {
  assert.equal('signers' in parseConfigSource('env local default\n  api "http://x"\n').config, false);
});

test('an hmac signer with no `signs` line, or no `header`, is refused where it is declared', () => {
  assert.match(configErrors('signer s hmac sha256 hex secret "k"\n  header "X" is "{signature}"\n')[0]!.message, /no `signs` line/);
  assert.match(configErrors('signer s hmac sha256 hex secret "k"\n  signs "{body}"\n')[0]!.message, /sends its signature nowhere/);
  assert.match(configErrors('signer s hmac md5 hex secret "k"\n  signs "{body}"\n  header "X" is "{signature}"\n')[0]!.message, /expected a hash after `hmac`/);
  assert.match(configErrors('signer s rsa\n')[0]!.message, /expected `hmac` or `sigv4`/);
});

test('`sigv4` reads its clauses in one order — `service` before `region` is refused naming it', () => {
  const errs = configErrors('signer aws sigv4 service "s3" region "eu-west-1" key "a" secret "b"\n');
  assert.match(errs[0]!.message, /expected `region` in a `sigv4` signer/);
});

// ---- TF087 -----------------------------------------------------------------------------------------

test('TF087: a placeholder the signer does not fill, with a suggestion', () => {
  const errs = configErrors(STRIPE.replace('{timestamp}.{body}', '{timestmp}.{body}'));
  assert.deepEqual(errs.map((e) => e.code), [Codes.SIGNER_DECL]);
  assert.match(errs[0]!.hint ?? '', /did you mean `\{timestamp\}`\?/);
});

test('TF087: `{signature}` inside the string being signed is refused, and says where it belongs', () => {
  const errs = configErrors(STRIPE.replace('{timestamp}.{body}', '{body}{signature}'));
  assert.equal(errs[0]!.code, Codes.SIGNER_DECL);
  assert.match(errs[0]!.hint ?? '', /goes in a `header` line/);
});

test('TF087: no header carries `{signature}`, a header placeholder it cannot fill, and a duplicate name', () => {
  assert.match(configErrors(STRIPE.replace('v1={signature}', 'v1=x'))[0]!.message, /sends it nowhere/);
  assert.match(configErrors(STRIPE.replace('t={timestamp}', 't={body}'))[0]!.message, /`\{body\}` is not something a signer's header can carry/);
  assert.match(configErrors(STRIPE + STRIPE)[0]!.message, /duplicate signer `stripe`/);
});

test('a signer\'s `for env` naming no env is the session clause\'s error, on the name', () => {
  const errs = configErrors('env local default\n  api "http://x"\nsigner s for env locl hmac sha256 hex secret "k"\n  signs "{body}"\n  header "X" is "{signature}"\n');
  assert.equal(errs[0]!.code, Codes.CONFIG_UNKNOWN_ENV);
  assert.match(errs[0]!.hint ?? '', /did you mean `local`\?/);
});

// ---- sessions ---------------------------------------------------------------------------------------

test('`session <name> signed with <signer>` parses, and naming no signer is TF086 in the config', () => {
  const ok = parseConfigSource(STRIPE + 'session partner signed with stripe\n  header "X-Partner" is "p1"\n');
  assert.deepEqual(ok.diagnostics, []);
  assert.equal(ok.config.sessions[0]!.signer?.name, 'stripe');
  const bad = configErrors(STRIPE + 'session partner signed with strpe\n  header "X-Partner" is "p1"\n');
  assert.equal(bad[0]!.code, Codes.UNKNOWN_SIGNER);
  assert.match(bad[0]!.hint ?? '', /did you mean `stripe`\?/);
});

test('`signed with` reads before `oauth2`, so the oauth2 block still parses', () => {
  const { config, diagnostics } = parseConfigSource(STRIPE + 'session svc signed with stripe oauth2\n  token url "https://id.example/token"\n  client id "c"\n  client secret "s"\n');
  assert.deepEqual(diagnostics, []);
  assert.ok(config.sessions[0]!.oauth2);
  assert.equal(config.sessions[0]!.signer?.name, 'stripe');
});

// ---- the step ----------------------------------------------------------------------------------------

const STEP = 'api POST /webhooks/stripe body { id: "evt_1" }';

function stepOf(sub: string): { step: ApiStep | undefined; errors: string[] } {
  const { program, diagnostics } = parseSource(`test "t"\n  ${STEP}\n    ${sub}\n`);
  return { step: program.tests[0]?.body[0] as ApiStep | undefined, errors: diagnostics.filter((d) => d.severity === 'error').map((d) => d.message) };
}

test('`sign with` parses under an api step, with no overrides', () => {
  const { step, errors } = stepOf('sign with stripe');
  assert.deepEqual(errors, []);
  assert.deepEqual(step?.sign && [step.sign.signer.name, step.sign.secret, step.sign.at, step.sign.thenBody], ['stripe', null, null, null]);
});

test('each override parses to its own field, and together in the one order', () => {
  const { step, errors } = stepOf('sign with stripe secret "not-the-secret" at now - 10 minutes then body { amount: 1 }');
  assert.deepEqual(errors, []);
  const c = step!.sign!;
  assert.equal(c.secret?.type, 'StringLit');
  assert.equal(c.at?.type, 'BinaryExpr');
  assert.equal(c.thenBody?.type, 'InlineBody');
});

test('a step with no `sign` line has no `sign` field — absent, so no request golden changes', () => {
  const { program } = parseSource(`test "t"\n  ${STEP}\n`);
  assert.equal('sign' in (program.tests[0]!.body[0] as ApiStep), false);
});

test('a second `sign with` line is refused, and `then` must be followed by a body', () => {
  assert.match(stepOf('sign with stripe\n    sign with stripe').errors[0]!, /signed once/);
  assert.match(stepOf('sign with stripe then { a: 1 }').errors[0]!, /expected the body to send after `then`/);
});

test('the printer writes the clause back as written, and `fmt` leaves it alone', () => {
  for (const sub of ['sign with stripe', 'sign with stripe secret "not-the-secret"', 'sign with stripe at now - 10 minutes', 'sign with stripe then body { amount: 1 }']) {
    const src = `test "t"\n  ${STEP}\n    ${sub}\n`;
    const { program } = parseSource(src);
    const out = print(program.tests[0]!.body[0]!);
    assert.equal(out.ok, true, out.reason);
    assert.equal(out.text, `${STEP}\n  ${sub}`);
    const f = format(src);
    assert.equal(f.ok, true, f.reason);
    assert.equal(f.formatted, src);
  }
});

// ---- TF086 on the test side ------------------------------------------------------------------------

test('TF086: an unknown signer on a step, with a suggestion, anchored on the name', () => {
  const src = `test "t"\n  ${STEP}\n    sign with strpe\n`;
  const diags = checkProgram(parseSource(src).program, { knownSigners: ['stripe'] });
  assert.deepEqual(diags.map((d) => d.code), [Codes.UNKNOWN_SIGNER]);
  assert.match(diags[0]!.hint ?? '', /did you mean `stripe`\?/);
  assert.equal(diags[0]!.span.start.column, src.split('\n')[2]!.indexOf('strpe') + 1);
});

test('TF086: a signer scoped to other envs names them, and no `knownSigners` means no pass', () => {
  const { program } = parseSource(`test "t"\n  ${STEP}\n    sign with aws\n`);
  const scoped = checkProgram(program, { knownSigners: [], outOfScopeSigners: { envName: 'local', declaredElsewhere: new Map([['aws', ['prod']]]) } });
  assert.match(scoped[0]!.hint ?? '', /declared `for env prod`/);
  assert.deepEqual(checkProgram(program, {}).filter((d) => d.code === Codes.UNKNOWN_SIGNER), []);
});

// ---- symbols ------------------------------------------------------------------------------------------

test('a `sign with` name is a signer ref, and the config\'s declaration is its def', () => {
  const src = `test "t"\n  ${STEP}\n    sign with stripe\n`;
  const table = collectSymbols(parseSource(src).program, src);
  assert.ok(table.refs.some((r) => r.kind === 'signer' && r.name === 'stripe'));
  const cfg = STRIPE + 'session partner signed with stripe\n  header "X" is "y"\n';
  const configTable = collectConfigSymbols(parseConfigSource(cfg).config, cfg);
  const def = configTable.defs.find((d) => d.kind === 'signer');
  assert.equal(def?.name, 'stripe');
  const ref = configTable.refs.find((r) => r.kind === 'signer');
  assert.deepEqual(ref?.defSpan, def?.span, 'the session\'s `signed with` resolves to the declaration in the same file');
});

// ---- reuse ---------------------------------------------------------------------------------------------

test('a reuse hint never folds two requests that differ only in their `sign with` overrides', () => {
  // Found by the sibling's `refactor-check` sweep: `RF001` pulled the wrong-key and the replay
  // tests into one action, and both then sent a valid signature. The control is the same pair with
  // identical sign lines, which is a genuine duplicate and still gets its hint.
  const pair = (a: string, b: string): number => {
    // Three steps: `RF001` proposes nothing shorter.
    const tail = '  expect status equals 400\n  expect body.error equals "bad signature"\n';
    const src = `test "a"\n  ${STEP}\n    ${a}\n${tail}\ntest "b"\n  ${STEP}\n    ${b}\n${tail}`;
    const { program, diagnostics } = parseSource(src);
    assert.deepEqual(diagnostics, []);
    return detectReuse([{ path: 'tests/w.tflw', source: src, program }]).length;
  };
  assert.equal(pair('sign with stripe secret "not-the-secret"', 'sign with stripe at now - 10 minutes'), 0);
  assert.equal(pair('sign with stripe then body { amount: 1 }', 'sign with stripe then body { amount: 2 }'), 0);
  assert.equal(pair('sign with stripe secret "not-the-secret"', 'sign with stripe secret "not-the-secret"'), 1);
});
