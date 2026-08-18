// D332 — the repro emitter. What these pin is not "a file was written" but the two properties that
// make a written file worth more than an evidence dump:
//
//   1. **The assertion is right for the rule.** D314's sketch always asserts `403`. That is correct
//      for an object leak and wrong for a collection leak, where the correct behaviour is a filtered
//      `200` — so one template would hand whoever fixes the bug a regression that goes red the
//      moment they succeed. The `expect all body.id not equals` form is, line for line, what
//      `authz.tflw` hand-writes, so the generator and the control converge on the same *spelling*.
//   2. **No body ever reaches the file.** An id is an identifier; a body is contents.
//      `PLAN_REPORTS_PERF_SECURITY.md` R10's prove-without-reproducing rule is that split.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderAuthzRepro, renderInputRepro, renderRepro, reproFileName, writeRepros, AUTHZ_REPRO_DIR, INPUT_REPRO_DIR } from '../src/repro.js';
import type { AuthzFinding, InputHandlingFinding } from '@tflw/runtime';

const objectLeak: AuthzFinding = {
  kind: 'authorization',
  rule: 'sec/authz-object-leak',
  principal: 'peer',
  method: 'GET',
  url: 'http://localhost:4001/orders/a1e3-9f',
  // D478 — the path the RUNTIME computed, base-relative. The emitter no longer derives one from `url`.
  path: '/orders/a1e3-9f',
  env: 'local',
  ids: ['a1e3-9f'],
  owners: ['shopper'],
};

const collectionLeak: AuthzFinding = { ...objectLeak, rule: 'sec/authz-collection-leak', url: 'http://localhost:4001/orders', path: '/orders' };

test('an object leak emits `expect status equals 403`', () => {
  const src = renderAuthzRepro(objectLeak);
  assert.match(src, /test "peer must not read shopper's \/orders\/a1e3-9f" as peer/);
  assert.match(src, /api GET \/orders\/a1e3-9f/);
  assert.match(src, /expect status equals 403/);
});

test('a collection leak asserts on contents, never on status — the whole reason there are two templates', () => {
  // Control: if this ever becomes `expect status equals 403`, the emitted regression is red against
  // a correctly-fixed app, because a filtered `200` is the right answer for a non-owner here.
  const src = renderAuthzRepro(collectionLeak);
  assert.match(src, /expect all body\.id not equals "a1e3-9f"/);
  assert.doesNotMatch(src, /expect status/);
});

test('every repro names the rule that produced it and the principal it was served to', () => {
  for (const f of [objectLeak, collectionLeak]) {
    const src = renderAuthzRepro(f);
    assert.match(src, /^# emitted by tflw M130 — sec\/authz-/);
    assert.match(src, /served `shopper`'s resource to `peer`/);
  }
});

test('the emitted file runs as the *probing* principal, not as the owner', () => {
  // The finding is that `peer` could read it. A repro that ran as `shopper` would pass forever.
  assert.match(renderAuthzRepro(objectLeak), /as peer\n/);
  assert.doesNotMatch(renderAuthzRepro(objectLeak), /as shopper/);
});

test('the name is deterministic from rule + method + path + principal', () => {
  assert.equal(reproFileName(objectLeak), 'object-leak--get--orders-a1e3-9f--peer.tflw');
  assert.equal(reproFileName(collectionLeak), 'collection-leak--get--orders--peer.tflw');
});

test('two identical findings collide into one identical file rather than racing', () => {
  // The reason the name is derived rather than counted: under `--workers N` the same finding can
  // arrive twice, and two files differing only by a sequence number is not evidence of two bugs.
  assert.equal(reproFileName(objectLeak), reproFileName({ ...objectLeak }));
});

test('two principals leaking the same resource are two files, because that is the whole output', () => {
  const other = { ...objectLeak, principal: 'oauthLong' };
  assert.notEqual(reproFileName(objectLeak), reproFileName(other));
});

test('an unparseable path still yields a named file rather than a silent skip', () => {
  // Overriding `path` rather than `url` since D478: the runtime computes the address a repro dials, and
  // `reproPathFor` hands back whatever it was given when it cannot make sense of it. Naming an
  // unparseable address is still more useful than silently naming nothing.
  const broken = { ...objectLeak, url: 'not a url', path: 'not a url' };
  assert.match(reproFileName(broken), /\.tflw$/);
  assert.match(renderAuthzRepro(broken), /api GET not a url/);
});

// A mutated path carries the payload, and the seeded layer's payloads are up to 32 KiB (D369), so the
// name is only bounded if something bounds it. The assertion is a **write**, not a length: the defect
// this pins killed the whole run out of `writeRepros`, taking `results.json` with it, and a test that
// only measured `.length` would pass against an implementation that still could not create the file.
const oversizedQuery = (payload: string): InputHandlingFinding => ({
  kind: 'input-handling',
  rule: 'sec/oversized-input-accepted',
  method: 'GET',
  url: `http://localhost:4001/v1/products?q=${payload}`,
  path: `/products?q=${payload}`,
  env: 'secureLocal',
  location: 'query `q`',
  payloadId: 'seeded:oversized/1',
  payloadText: payload,
});

test('an oversized payload in the path still yields a file the filesystem accepts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tflw-repro-'));
  const finding = oversizedQuery('A'.repeat(4096));
  // The write comes FIRST and the length second, deliberately. Asserting the length up front reads
  // better and is worth less: it short-circuits before `writeRepros` runs, so the negative check
  // proves only that a number is large — never that the call which actually threw `ENAMETOOLONG` in
  // production still throws. Ordered this way, removing the bound fails on the syscall.
  const written = await writeRepros([finding], dir);
  assert.equal(written.length, 1);
  assert.ok(reproFileName(finding).length <= 200, 'the name must fit NAME_MAX with room to spare');
});

test('two oversized draws on one endpoint stay two files, because truncation alone would merge them', () => {
  // They differ *only* in the part a bare truncation cuts, which is exactly why the cut carries a
  // digest. Merging them would turn a loud crash into a silent loss of one of the two findings.
  const a = oversizedQuery('A'.repeat(4096));
  const b = oversizedQuery('A'.repeat(4097));
  assert.notEqual(reproFileName(a), reproFileName(b));
  assert.ok(reproFileName(a).length <= 200 && reproFileName(b).length <= 200);
});

test('a name that already fits is left exactly as it was', () => {
  // The bound must be invisible to every name that has ever been written, or it is a rename of every
  // published artifact rather than a fix.
  assert.equal(reproFileName(objectLeak), 'object-leak--get--orders-a1e3-9f--peer.tflw');
  assert.equal(reproFileName(oversizedQuery('AAAA')), 'oversized-input-accepted--get--products-q-aaaa--query-q.tflw');
});

test('no finding writes no directory — an ordinary run\'s report dir is unchanged', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tflw-repro-'));
  try {
    assert.deepEqual(await writeRepros([], dir), []);
    assert.equal(existsSync(join(dir, AUTHZ_REPRO_DIR)), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('findings are written one file each, in stable name order', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tflw-repro-'));
  try {
    const written = await writeRepros([objectLeak, collectionLeak, { ...objectLeak }], dir);
    assert.equal(written.length, 2, 'the duplicate collapses into the same file');
    const names = readdirSync(join(dir, AUTHZ_REPRO_DIR)).sort();
    assert.deepEqual(names, ['collection-leak--get--orders--peer.tflw', 'object-leak--get--orders-a1e3-9f--peer.tflw']);
    assert.match(readFileSync(join(dir, AUTHZ_REPRO_DIR, names[1]!), 'utf8'), /expect status equals 403/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R10: a repro carries the leaked id and never a response body', async () => {
  // The finding type has no body field to leak — this asserts the *shape* stays that way, since the
  // cheapest future "improvement" here is to paste the response in for context.
  const src = renderAuthzRepro(objectLeak);
  assert.match(src, /a1e3-9f/);
  assert.doesNotMatch(src, /\{|\}/, 'a repro is four lines of tflw, not a transcript');
});

// --- M137d: the input-handling arm (D471/D472/D475) -----------------------------------------------
//
// The properties here are not the same as above, because the failure available is not the same. An
// authorization template can assert the *wrong behaviour*; an input template can assert something that
// is **true of an unfixed application**, which is worse because it is silent. Every test in this block
// exists to pin one of the four templates against that.

const disclosure: InputHandlingFinding = {
  kind: 'input-handling',
  rule: 'sec/error-detail-disclosure',
  method: 'GET',
  // Percent-encoded and ABSOLUTE, because that is literally what `applyMutation` returns — the
  // fixtures are its output, not a tidied version of it.
  url: 'http://localhost:4001/v1/products?q=tflw%27',
  // Base-relative: the env's `api` is `.../v1`, so a suite writes `/products`, NOT `/v1/products` (D478).
  path: '/products?q=tflw%27',
  env: 'secureLocal',
  principal: 'shopper',
  location: 'query `q`',
  payloadId: 'injection/sql-quote',
  payloadText: "tflw'",
  invariant: 'a SQL error fragment',
};

const reflection: InputHandlingFinding = {
  kind: 'input-handling',
  rule: 'sec/reflected-input-unescaped',
  method: 'GET',
  url: 'http://localhost:4001/v1/search?q=%3Ctflw%3E',
  path: '/search?q=%3Ctflw%3E',
  env: 'secureLocal',
  location: 'query `q`',
  payloadId: 'injection/html-metacharacters',
  payloadText: '<tflw>',
};

const traversal: InputHandlingFinding = {
  kind: 'input-handling',
  rule: 'sec/path-traversal-read',
  method: 'GET',
  url: 'http://localhost:4001/v1/files/..%2F..%2Fetc%2Fpasswd',
  path: '/files/..%2F..%2Fetc%2Fpasswd',
  env: 'plaintext',
  location: 'path segment 3',
  payloadId: 'traversal/encoded',
  payloadText: '..%2f..%2f..%2f..%2fetc%2fpasswd',
  invariant: 'a Unix passwd entry',
};

const oversized: InputHandlingFinding = {
  kind: 'input-handling',
  rule: 'sec/oversized-input-accepted',
  method: 'POST',
  url: 'http://localhost:4001/v1/orders',
  path: '/orders',
  env: 'secureLocal',
  body: '{"note":"AAAA"}',
  location: 'body.note',
  payloadId: 'oversized/64kib-string',
};

test('THE D471 PROPERTY — no input repro re-asserts tflw\'s own input-handling matcher', () => {
  // The single most important test in this file. The obvious generalisation is to re-send the mutated
  // request and re-assert `expect response has no input handling violations`, and that file PASSES
  // against an unfixed app: the rules are differential against the observed request and subtract the
  // control by label, so in a repro the leak is subtracted from itself. If this assertion ever fails,
  // the emitter has started producing artifacts that go green on live vulnerabilities.
  for (const f of [disclosure, reflection, traversal, oversized]) {
    const src = renderInputRepro(f)!;
    assert.ok(src, `${f.rule} emitted nothing`);
    assert.doesNotMatch(src, /input handling violations/, `${f.rule} re-asserted the matcher that found it`);
    assert.doesNotMatch(src, /has no .* violations/, `${f.rule} re-asserted a scan matcher`);
  }
});

test('error-detail-disclosure asserts the matched detector\'s own pattern', () => {
  const src = renderInputRepro(disclosure)!;
  // `body text`, not `body`: a disclosure often arrives as an HTML error page and `BodySubject` throws
  // on a non-JSON response, so the bare-body subject could not assert about it at all.
  assert.match(src, /expect body text not matches "/);
  assert.match(src, /SQLSTATE/, "the SQL detector's own needles are what the repro forbids");
});

test('path-traversal-read asserts the filesystem signature, never the payload it echoed', () => {
  // The distinction the rule itself rests on: an app that reflects `../../etc/passwd` in an error
  // message has not read anything. A repro asserting the *payload* would fire on that app forever.
  const src = renderInputRepro(traversal)!;
  assert.match(src, /expect body text not matches "/);
  assert.match(src, /root:/, "the passwd signature is the assertion");
  assert.doesNotMatch(src, /not contains "\.\.%2f/, 'asserting the echoed payload would be the wrong oracle');
});

test('reflected-input-unescaped asserts the raw payload, because the echo IS the finding', () => {
  const src = renderInputRepro(reflection)!;
  assert.match(src, /expect body text not contains "<tflw>"/);
});

test('oversized-input-accepted asserts a refusal, not a specific status', () => {
  // The rule fires only on a 2xx, so "refused it somehow" is the repair. Naming `400` or `413` would
  // pick a winner the rule itself declines to pick, and the repro would go red on the other one.
  const src = renderInputRepro(oversized)!;
  assert.match(src, /expect status is greater than 399/);
  assert.doesNotMatch(src, /status equals/);
});

test('the repro dials the MUTATED request, relative — never the observed URL and never absolute', () => {
  // Two failures in one assertion, and both are silent. Dialling the *observed* URL would exercise the
  // request that behaved correctly, so the repro would pass on a real finding. Emitting the ABSOLUTE
  // URL `applyMutation` actually returns would make the file conditional on `allow hosts` (D246), so a
  // recipient's own config would refuse it — D469's trap from the authoring side.
  const src = renderInputRepro(disclosure)!;
  // `/products`, NOT `/v1/products` — D478. Emitting the URL's pathname re-applies the base URL's own
  // prefix, so the repro dials `/v1/v1/products`, 404s, finds no leak and PASSES on a live finding.
  assert.match(src, /api GET \/products\?q=tflw%27/);
  assert.doesNotMatch(src, /\/v1\/products/, "the base URL's prefix must not be emitted twice");
  assert.doesNotMatch(src, /http:\/\/localhost:4001/, 'an absolute URL would need `allow hosts`');
});

test('a body-site repro carries the request body and restores its content type', () => {
  // The body is the REQUEST's (D475) — omitting it would dial a different endpoint than the finding
  // describes. `body text` sets no content type of its own, so the header line puts back the one the
  // observed request carried; without it the app may 415 and the repro reproduces nothing.
  const src = renderInputRepro(oversized)!;
  assert.match(src, /body text "\{\\"note\\":\\"AAAA\\"\}"/);
  assert.match(src, /header "content-type" is "application\/json"/);
});

test('each rule\'s test name reads as its own finding, not as one generic sentence', () => {
  // Written as one "must not leak at <site>" first, which is wrong on two of the four: nothing leaked
  // when a length bound was missing. A generated name that misdescribes the finding is worse than a
  // bare one, because it is the line a reader sees in the run summary.
  assert.match(renderInputRepro(disclosure)!, /must not disclose a SQL error fragment for query `q`/);
  assert.match(renderInputRepro(traversal)!, /must not read a file through path segment 3/);
  assert.match(renderInputRepro(reflection)!, /must escape what it echoes from query `q`/);
  assert.match(renderInputRepro(oversized)!, /must bound the length of body\.note/);
  assert.doesNotMatch(renderInputRepro(oversized)!, /leak/, 'a missing bound is not a leak');
});

test('a site name carrying a quote cannot break out of the test name', () => {
  // `location` embeds a query-parameter name, which is the APPLICATION's data, not the author's. An
  // unescaped one would close the string and emit a file that does not parse — the same class of bug as
  // the regex backslashes, arriving through a field nobody thinks of as untrusted.
  const hostile: InputHandlingFinding = { ...disclosure, location: 'query `a"b`' };
  const src = renderInputRepro(hostile)!;
  assert.match(src, /query `a\\"b`/, 'the quote must arrive escaped');
  // Exactly two unescaped quotes on the `test` line: the ones that delimit the name.
  const testLine = src.split('\n').find((l) => l.startsWith('test '))!;
  assert.equal(testLine.replace(/\\"/g, '').split('"').length - 1, 2);
});

test('D479 — every repro names the env it came from, in a command you can paste', () => {
  // Found by running the emitted files: a repro is base-RELATIVE, so the env decides which application it
  // reaches, and nothing in the language lets a file pin its own. The traversal repro passed under
  // `secureLocal` — an env that withholds `probe traversal`, so the route reads no files — and that green
  // is indistinguishable from a fix. Naming the env is the whole remedy, and it belongs in the file rather
  // than in the report, because the file is what gets handed to somebody.
  assert.match(renderInputRepro(traversal)!, /^# re-run: tflw run --env plaintext input-repro\/path-traversal-read--/m);
  assert.match(renderInputRepro(disclosure)!, /--env secureLocal input-repro\//);
  // Authorization gets it too: the gap is not specific to Tier 3, only sharper there.
  assert.match(renderAuthzRepro(objectLeak), /^# re-run: tflw run --env local authz-repro\/object-leak--/m);
});

test('a repro is made as the same principal, and a scan with no session declares none', () => {
  assert.match(renderInputRepro(disclosure)!, /" as shopper\n/);
  assert.doesNotMatch(renderInputRepro(reflection)!, / as /, 'no session means no `as` clause, not an invented one');
});

test('a regex reaches the file with its backslashes DOUBLED', () => {
  // Not cosmetic: TF047 makes an escape outside `\" \\ \n \r \t` an *error*, so an emitted `\s` does
  // not merely mean the wrong thing — the repro refuses to parse, in a file whose entire purpose is to
  // be handed to somebody else.
  const stackFrame: InputHandlingFinding = { ...disclosure, invariant: 'a stack frame' };
  const src = renderInputRepro(stackFrame)!;
  assert.match(src, /\\\\s\+at/, 'the pattern\'s `\\s` must be written `\\\\s`');
  assert.doesNotMatch(src, /[^\\]\\s\+at/, 'a single backslash here is a TF047 error');
});

test('a `{`-bearing payload emits literally, and is not mistaken for an interpolation', () => {
  // `injection/template-expression` is `{{7*7}}`. A tflw string parses `{…}` as interpolation from the
  // DECODED text and there is no `\{` escape, so this survives only because `parseRefText` rejects
  // both `{7*7` and `7*7`. Verified against a real `tflw check` when the template was designed; pinned
  // here so a future escaping change cannot quietly turn it into an unbound variable.
  const templated: InputHandlingFinding = { ...reflection, payloadId: 'injection/template-expression', payloadText: '{{7*7}}' };
  assert.match(renderInputRepro(templated)!, /expect body text not contains "\{\{7\*7\}\}"/);
});

test('R10 by construction: an input repro emits only tflw\'s own bytes', () => {
  // The property that makes this arm safe without an `--unsafe-evidence` decision: every literal in
  // the file is a payload tflw sent or a pattern tflw looks for. The finding's `detail` carries an
  // excerpt of the app's response; the repro deliberately does not, because its job is to provoke the
  // leak again rather than to quote it.
  const src = renderInputRepro(disclosure)!;
  assert.doesNotMatch(src, /at OrderService|Whitelabel|stack frame:/);
});

test('a rule with no template writes nothing rather than an empty file', () => {
  const unknown = { ...disclosure, rule: 'sec/some-future-input-rule' };
  assert.equal(renderInputRepro(unknown), null);
  // And a disclosure whose detector label is not in the map — a label renamed upstream — is the same
  // case rather than a crash or an assertion against `undefined`.
  assert.equal(renderInputRepro({ ...disclosure, invariant: 'a detector nobody defines' }), null);
});

test('the two kinds land in separate directories, and each names itself', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tflw-repro-'));
  try {
    const written = await writeRepros([objectLeak, disclosure, reflection], dir);
    assert.equal(written.length, 3);
    assert.deepEqual(readdirSync(join(dir, AUTHZ_REPRO_DIR)), ['object-leak--get--orders-a1e3-9f--peer.tflw']);
    // The site AND the detector are both in the name, because R8's fingerprint separates two
    // weaknesses on exactly that pair: one endpoint leaking a stack frame and a SQL fragment at the
    // same site is two repairs, and a name omitting the detector would overwrite one with the other.
    assert.deepEqual(readdirSync(join(dir, INPUT_REPRO_DIR)).sort(), [
      'error-detail-disclosure--get--products-q-tflw-27--query-q--a-sql-error-fragment.tflw',
      'reflected-input-unescaped--get--search-q-3ctflw-3e--query-q.tflw',
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a run with only authorization findings writes no `input-repro/` at all', async () => {
  // The mirror of the no-findings test above: a directory holding zero repros is a report claiming an
  // artifact it does not have, and `mkdir` running before the template check is how that happens.
  const dir = mkdtempSync(join(tmpdir(), 'tflw-repro-'));
  try {
    await writeRepros([objectLeak], dir);
    assert.equal(existsSync(join(dir, INPUT_REPRO_DIR)), false);
    // And the reverse, including the case that only *looks* like a finding: a rule with no template
    // must not bring a directory into existence on its own.
    const dir2 = mkdtempSync(join(tmpdir(), 'tflw-repro-'));
    try {
      assert.deepEqual(await writeRepros([{ ...disclosure, rule: 'sec/some-future-input-rule' }], dir2), []);
      assert.equal(existsSync(join(dir2, INPUT_REPRO_DIR)), false);
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('renderRepro dispatches on the discriminant, not on a field-shape guess', () => {
  // The union's whole point. A `kind`-less duck-typing check ("has `principal` → authorization") would
  // have silently mis-routed every input finding that carries one, which is most of them.
  assert.match(renderRepro(objectLeak)!, /expect status equals 403/);
  assert.match(renderRepro(disclosure)!, /expect body text not matches/);
});

// `D437`'s provenance in the header — the item list's last line for this milestone, and the one thing
// here that is about a *reader* rather than about a run. A synthesized request is one no test declared,
// so the repro is the only artifact that can say tflw invented it; `D467`'s synthesis also invents
// values, which makes "derived from your schema" the caveat that decides whether a reader treats the
// finding as real or as a bad guess.
test('a crawl-derived repro says so, in both kinds', () => {
  const viaInput = renderRepro({ ...disclosure, via: 'openapi' as const })!;
  assert.match(viaInput, /^# via: derived by a crawl from `seed openapi`/m);
  // Both arms, and not for symmetry: `D465` lets a crawl issue mutating requests when `probe mutating`
  // is declared, and Tier 2 judges those — so an authorization finding on a synthesized `POST` is
  // precisely where the note is load-bearing.
  const viaAuthz = renderRepro({ ...objectLeak, via: 'traffic' as const })!;
  assert.match(viaAuthz, /^# via: derived by a crawl from `seed traffic`/m);
});

test('a hand-written request emits no `via` line at all', () => {
  // The absent case is the common one, and staying silent is what makes the present case findable: a
  // `# via: hand-written` on all twelve files would bury the one file that matters.
  for (const f of [objectLeak, collectionLeak, disclosure, reflection, traversal, oversized]) {
    assert.doesNotMatch(renderRepro(f)!, /# via:/, `${f.rule} emitted a via line with no provenance`);
  }
});

test('the `via` line sits above the paste-able command, so the caveat is read before the command is run', () => {
  // Ordering is the whole value. A provenance note *below* `# re-run:` is a note a reader meets after
  // they have already run the file and formed a view of the finding.
  const lines = renderRepro({ ...disclosure, via: 'openapi' as const })!.split('\n');
  const via = lines.findIndex((l) => l.startsWith('# via:'));
  const rerun = lines.findIndex((l) => l.startsWith('# re-run:'));
  assert.ok(via !== -1 && rerun !== -1, 'both header lines must be present');
  assert.ok(via < rerun, `via line at ${via} must precede the re-run line at ${rerun}`);
});
