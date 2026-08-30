// M3a: browser step grammar (SPEC §9) — open/click/fill/fill form/select/check/uncheck/press/
// hover/scroll/within/dialogs, the locator model, and the `check` dual-grammar disambiguation
// (soft assertion vs. the checkbox action).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '../src/index.js';

function firstStep(source: string) {
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, [], `unexpected diagnostics: ${JSON.stringify(diagnostics)}`);
  return program.tests[0]!.body[0]!;
}

test('`open "..."` parses as an OpenStmt carrying a StringLit path', () => {
  const step = firstStep('test "ok"\n  open "/orders/{orderId}"\n') as { type: string; path: { value: string; parts: unknown[] } };
  assert.equal(step.type, 'OpenStmt');
  assert.equal(step.path.value, '/orders/{orderId}');
  assert.ok(step.path.parts.some((p) => (p as { kind: string }).kind === 'interp'));
});

test('`click button "..."` parses a single-click on a button locator', () => {
  const step = firstStep('test "ok"\n  click button "Add to cart"\n') as {
    type: string;
    kind: string;
    locator: { kind: string; value: { value: string } };
  };
  assert.equal(step.type, 'ClickStmt');
  assert.equal(step.kind, 'single');
  assert.equal(step.locator.kind, 'button');
  assert.equal(step.locator.value.value, 'Add to cart');
});

test('`double click`/`right click` set ClickStmt.kind accordingly', () => {
  const dbl = firstStep('test "ok"\n  double click button "Row"\n') as { kind: string };
  assert.equal(dbl.kind, 'double');
  const right = firstStep('test "ok"\n  right click button "Row"\n') as { kind: string };
  assert.equal(right.kind, 'right');
});

test('`fill field "..." with ...` parses a FillStmt', () => {
  const step = firstStep('test "ok"\n  fill field "Email" with {email}\n') as {
    type: string;
    locator: { kind: string; value: { value: string } };
    value: { type: string };
  };
  assert.equal(step.type, 'FillStmt');
  assert.equal(step.locator.kind, 'field');
  assert.equal(step.locator.value.value, 'Email');
  assert.equal(step.value.type, 'Interp');
});

test('`fill form` parses an indented `| "Field" | value |` table into FillFormStmt.rows', () => {
  const step = firstStep(
    'test "ok"\n  fill form\n    | "Name" | "Widget" |\n    | "Email" | unique email |\n',
  ) as { type: string; rows: { field: { value: string }; value: { type: string } }[] };
  assert.equal(step.type, 'FillFormStmt');
  assert.equal(step.rows.length, 2);
  assert.equal(step.rows[0]!.field.value, 'Name');
  assert.equal(step.rows[0]!.value.type, 'StringLit');
  assert.equal(step.rows[1]!.field.value, 'Email');
  assert.equal(step.rows[1]!.value.type, 'UniqueEmailExpr');
});

test('`fill form` with no indented rows is an error, not a silent empty step', () => {
  const { diagnostics } = parseSource('test "ok"\n  fill form\n  expect status equals 200\n');
  assert.ok(diagnostics.some((d) => d.code === 'TF015'), JSON.stringify(diagnostics));
});

test('`select "..." from field "..."` parses a SelectStmt', () => {
  const step = firstStep('test "ok"\n  select "Widget" from field "Size"\n') as {
    type: string;
    locator: { kind: string; value: { value: string } };
    value: { value: string };
  };
  assert.equal(step.type, 'SelectStmt');
  assert.equal(step.locator.kind, 'field');
  assert.equal(step.locator.value.value, 'Size');
  assert.equal(step.value.value, 'Widget');
});

test('`untick field "..."` always parses as the action (no assertion form exists)', () => {
  const step = firstStep('test "ok"\n  untick field "Accept terms"\n') as { type: string; locator: { kind: string } };
  assert.equal(step.type, 'UntickStmt');
  assert.equal(step.locator.kind, 'field');
});

test('`hover button "..."` parses a HoverStmt', () => {
  const step = firstStep('test "ok"\n  hover button "Menu"\n') as { type: string; locator: { kind: string } };
  assert.equal(step.type, 'HoverStmt');
});

test('`scroll to list "..."` parses a ScrollStmt', () => {
  const step = firstStep('test "ok"\n  scroll to list "Cart items"\n') as { type: string; locator: { kind: string } };
  assert.equal(step.type, 'ScrollStmt');
  assert.equal(step.locator.kind, 'list');
});

test('`press "..."` (page-level) parses a PressStmt with a null locator', () => {
  const step = firstStep('test "ok"\n  press "Enter"\n') as { type: string; keys: { value: string }; locator: unknown };
  assert.equal(step.type, 'PressStmt');
  assert.equal(step.keys.value, 'Enter');
  assert.equal(step.locator, null);
});

test('`press "..." on field "..."` parses a PressStmt scoped to a locator', () => {
  const step = firstStep('test "ok"\n  press "Enter" on field "Search"\n') as {
    type: string;
    keys: { value: string };
    locator: { kind: string; value: { value: string } } | null;
  };
  assert.equal(step.type, 'PressStmt');
  assert.equal(step.locator?.kind, 'field');
  assert.equal(step.locator?.value.value, 'Search');
});

test('`within <locator>` + an indented block parses a WithinBlock with a nested body', () => {
  const step = firstStep('test "ok"\n  within list "Cart items"\n    click button "Remove"\n    expect text "Removed" is visible\n') as {
    type: string;
    locator: { kind: string };
    body: { type: string }[];
  };
  assert.equal(step.type, 'WithinBlock');
  assert.equal(step.locator.kind, 'list');
  assert.deepEqual(
    step.body.map((s) => s.type),
    ['ClickStmt', 'ExpectStmt'],
  );
});

test('`accept dialog`/`dismiss dialog` parse as their own zero-field statements', () => {
  assert.equal((firstStep('test "ok"\n  accept dialog\n') as { type: string }).type, 'AcceptDialogStmt');
  assert.equal((firstStep('test "ok"\n  dismiss dialog\n') as { type: string }).type, 'DismissDialogStmt');
});

test('locator kinds: button/field/text/list/css/xpath all parse as Locator nodes with the right kind', () => {
  for (const kind of ['button', 'field', 'text', 'list']) {
    const step = firstStep(`test "ok"\n  hover ${kind} "x"\n`) as { locator: { kind: string } };
    assert.equal(step.locator.kind, kind);
  }
  const css = firstStep('test "ok"\n  hover css ".row .remove"\n') as { locator: { kind: string; value: { value: string } } };
  assert.equal(css.locator.kind, 'css');
  assert.equal(css.locator.value.value, '.row .remove');
  const xpath = firstStep('test "ok"\n  hover xpath "//button[1]"\n') as { locator: { kind: string } };
  assert.equal(xpath.locator.kind, 'xpath');
});

test('an unknown locator keyword is a diagnosed error with a suggestion, not a silent parse', () => {
  const { diagnostics } = parseSource('test "ok"\n  hover buton "x"\n');
  assert.ok(diagnostics.length > 0);
  assert.match(diagnostics[0]!.hint ?? '', /did you mean `button`/);
});

// ---- `check` is the soft assertion only (SPEC §9.1, FS-04) -----------------

test('`tick <locator>` with nothing after it is the checkbox action (TickStmt)', () => {
  const step = firstStep('test "ok"\n  tick field "Accept terms"\n') as { type: string; locator: { kind: string; value: { value: string } } };
  assert.equal(step.type, 'TickStmt');
  assert.equal(step.locator.kind, 'field');
  assert.equal(step.locator.value.value, 'Accept terms');
});

test('`check <locator> is <matcher>` is the soft assertion (ExpectStmt, soft: true)', () => {
  const step = firstStep('test "ok"\n  check field "Accept terms" is checked\n') as {
    type: string;
    soft: boolean;
    subject: { type: string };
    matcher: { name: string };
  };
  assert.equal(step.type, 'ExpectStmt');
  assert.equal(step.soft, true);
  assert.equal(step.subject.type, 'LocatorSubject');
  assert.equal(step.matcher.name, 'checked');
});

test('`check status equals 200` (a non-locator subject) is unaffected — still requires a matcher', () => {
  const step = firstStep('test "ok"\n  check status equals 200\n') as { type: string; soft: boolean; subject: { type: string } };
  assert.equal(step.type, 'ExpectStmt');
  assert.equal(step.soft, true);
  assert.equal(step.subject.type, 'StatusSubject');
});

test('`check status` with no matcher is still a diagnosed error (non-locator subjects never become an action)', () => {
  const { diagnostics } = parseSource('test "ok"\n  check status\n');
  assert.ok(diagnostics.length > 0, 'expected a diagnostic for a bare `check status`');
});

test('expect subjects: button/field/text/list/css/xpath all parse as LocatorSubject', () => {
  for (const kind of ['button', 'field', 'text', 'list']) {
    const step = firstStep(`test "ok"\n  expect ${kind} "x" is visible\n`) as { subject: { type: string; locator: { kind: string } } };
    assert.equal(step.subject.type, 'LocatorSubject');
    assert.equal(step.subject.locator.kind, kind);
  }
});

test('`expect field "..." has value "..."` and `has count N` parse against a locator subject', () => {
  const hasValue = firstStep('test "ok"\n  expect field "Email" has value "a@b.com"\n') as { matcher: { name: string } };
  assert.equal(hasValue.matcher.name, 'hasValue');
  const hasCount = firstStep('test "ok"\n  expect list "Cart items" has count 3\n') as { matcher: { name: string } };
  assert.equal(hasCount.matcher.name, 'hasCount');
});

// ---- M3b: frames / tabs / downloads / drag-drop / wait until <ui> ---------

test('`within <locator>` (no `frame`) parses WithinBlock with frame: false', () => {
  const step = firstStep('test "ok"\n  within list "Cart items"\n    click button "Remove"\n') as { type: string; frame: boolean };
  assert.equal(step.type, 'WithinBlock');
  assert.equal(step.frame, false);
});

test('`within frame <locator>` sets WithinBlock.frame: true', () => {
  const step = firstStep('test "ok"\n  within frame css "#payment-frame"\n    click button "Pay"\n') as {
    type: string;
    frame: boolean;
    locator: { kind: string; value: { value: string } };
    body: { type: string }[];
  };
  assert.equal(step.type, 'WithinBlock');
  assert.equal(step.frame, true);
  assert.equal(step.locator.kind, 'css');
  assert.equal(step.locator.value.value, '#payment-frame');
  assert.deepEqual(
    step.body.map((s) => s.type),
    ['ClickStmt'],
  );
});

test('`switch to new tab` + an indented block parses a SwitchToNewTabBlock with a nested body', () => {
  const step = firstStep('test "ok"\n  switch to new tab\n    click text "Open in new tab"\n') as { type: string; body: { type: string }[] };
  assert.equal(step.type, 'SwitchToNewTabBlock');
  assert.deepEqual(
    step.body.map((s) => s.type),
    ['ClickStmt'],
  );
});

test('`switch to tab N` parses a SwitchToTabStmt carrying the 1-based index', () => {
  const step = firstStep('test "ok"\n  switch to tab 2\n') as { type: string; index: number };
  assert.equal(step.type, 'SwitchToTabStmt');
  assert.equal(step.index, 2);
});

test('`close tab` parses a zero-field CloseTabStmt', () => {
  const step = firstStep('test "ok"\n  close tab\n') as { type: string };
  assert.equal(step.type, 'CloseTabStmt');
});

test('`download as <name>` + an indented block parses a DownloadBlock', () => {
  const step = firstStep('test "ok"\n  download as file\n    click text "Download report"\n') as {
    type: string;
    name: string;
    body: { type: string }[];
  };
  assert.equal(step.type, 'DownloadBlock');
  assert.equal(step.name, 'file');
  assert.deepEqual(
    step.body.map((s) => s.type),
    ['ClickStmt'],
  );
});

test('`download as <name>` with no indented body is an error, not a silent empty step', () => {
  const { diagnostics } = parseSource('test "ok"\n  download as file\n  expect status equals 200\n');
  assert.ok(diagnostics.some((d) => d.code === 'TF015'), JSON.stringify(diagnostics));
});

test('`drag <locator> to <locator>` parses a DragStmt with both locators', () => {
  const step = firstStep('test "ok"\n  drag text "First item" to text "Second item"\n') as {
    type: string;
    from: { kind: string; value: { value: string } };
    to: { kind: string; value: { value: string } };
  };
  assert.equal(step.type, 'DragStmt');
  assert.equal(step.from.kind, 'text');
  assert.equal(step.from.value.value, 'First item');
  assert.equal(step.to.kind, 'text');
  assert.equal(step.to.value.value, 'Second item');
});

test('`drop file "..." onto <locator>` parses a DropFileStmt', () => {
  const step = firstStep('test "ok"\n  drop file "./receipt.txt" onto css "#dropzone"\n') as {
    type: string;
    filePath: { value: string };
    locator: { kind: string; value: { value: string } };
  };
  assert.equal(step.type, 'DropFileStmt');
  assert.equal(step.filePath.value, './receipt.txt');
  assert.equal(step.locator.kind, 'css');
  assert.equal(step.locator.value.value, '#dropzone');
});

test('`wait until <locator> <matcher>` parses a WaitUntilUiStmt (not the api form)', () => {
  const step = firstStep('test "ok"\n  wait until button "Submit" is enabled\n') as {
    type: string;
    subject: { type: string; locator: { kind: string; value: { value: string } } };
    matcher: { name: string };
  };
  assert.equal(step.type, 'WaitUntilUiStmt');
  assert.equal(step.subject.type, 'LocatorSubject');
  assert.equal(step.subject.locator.kind, 'button');
  assert.equal(step.subject.locator.value.value, 'Submit');
  assert.equal(step.matcher.name, 'enabled');
});

test('`wait until` against a subject that cannot change between polls is a diagnosed error', () => {
  // Renamed by `M147d`/`A3-11` (D641), and the rename is the point: "non-locator" was the rule this
  // test was written against, and it is no longer the rule. `page`, `request to "…"` and a value
  // `of request to "…"` are all non-locator subjects that a `wait until` now polls — the property
  // that decides is whether re-reading between polls can give a different answer. `status` reads
  // the last `api` response, so it still fails, and this test still covers M3b's dispatch; what it
  // must no longer claim is that *being a locator* is what earned admission. The widened set has
  // its own file (`pollableSubjects.test.ts`).
  const { diagnostics } = parseSource('test "ok"\n  wait until status equals 200\n');
  assert.ok(diagnostics.length > 0, 'expected a diagnostic');
  assert.ok(diagnostics[0]!.message.includes('can change between polls'), diagnostics[0]!.message);
});

test('`wait until api …` still parses as WaitUntilApiStmt (unaffected by the `wait until <ui>` dispatch)', () => {
  const step = firstStep('test "ok"\n  wait until api GET /orders/{orderId}\n    expect body.status equals "shipped"\n') as { type: string };
  assert.equal(step.type, 'WaitUntilApiStmt');
});

// ---- FS-05 (milestone B1): `wait until … for <duration>` -------------------
//
// The sustained-condition case. Without `for`, `wait until text "Error" is hidden` returns on its
// first poll — which for a toast that has not rendered yet is immediately, so the assertion passes
// precisely because nothing has happened yet and goes on passing as the toast appears. The freeze
// review measured this as gap 1 of five, and the only one that an extension of `wait until` can
// reach at all (pacing and TTL are not conditions, so no amount of polling expresses them).

test('FS-05: `wait until <locator> <matcher> for <duration>` parses, carrying the hold window in ms', () => {
  const step = firstStep('test "ok"\n  wait until text "Error" is hidden for 2s\n') as {
    type: string;
    matcher: { name: string };
    holdMs: number | null;
  };
  assert.equal(step.type, 'WaitUntilUiStmt');
  assert.equal(step.matcher.name, 'hidden');
  assert.equal(step.holdMs, 2000);
});

test('FS-05: `for` composes with a negated condition — `not visible for 500ms` (FS-08 made the copula optional in the same milestone)', () => {
  for (const source of [
    'test "ok"\n  wait until button "Submit" is not visible for 500ms\n',
    'test "ok"\n  wait until button "Submit" not visible for 500ms\n',
  ]) {
    const step = firstStep(source) as { matcher: { name: string; negated: boolean }; holdMs: number | null };
    assert.equal(step.matcher.name, 'visible');
    assert.equal(step.matcher.negated, true);
    assert.equal(step.holdMs, 500);
  }
});

test('FS-05: omitting `for` leaves `holdMs` null — the original "pass the first true poll" semantics, unchanged', () => {
  const step = firstStep('test "ok"\n  wait until button "Submit" is enabled\n') as { holdMs: number | null };
  assert.equal(step.holdMs, null);
});

test('FS-05: `for` with no duration after it is a diagnosed error, not a silently-dropped clause', () => {
  const { diagnostics } = parseSource('test "ok"\n  wait until button "Submit" is enabled for\n');
  assert.ok(diagnostics.length > 0, 'expected a diagnostic');
});

test('FS-05: `for <duration>` on the `api` form is refused by name, saying what it would cost rather than reporting a bare unexpected token', () => {
  const { diagnostics } = parseSource('test "ok"\n  wait until api GET /orders/1 for 2s\n    expect status equals 200\n');
  const first = diagnostics[0]!;
  assert.ok(first, 'expected a diagnostic');
  assert.match(first.message, /`for <duration>` is not supported on `wait until api …`/);
  // The hint has to name the UI form (where it does work) and the reason it is not merely an
  // oversight here — sustaining an API condition re-issues the request for the whole window.
  assert.match(first.hint ?? '', /wait until text "Error" is hidden for 2s/);
  assert.match(first.hint ?? '', /load, not waiting/);
});

// ---- M3c: `screenshot "<name>"` --------------------------------------------

test('`screenshot "..."` parses a ScreenshotStmt carrying a StringLit name', () => {
  const step = firstStep('test "ok"\n  screenshot "checkout-step-2"\n') as { type: string; name: { value: string } };
  assert.equal(step.type, 'ScreenshotStmt');
  assert.equal(step.name.value, 'checkout-step-2');
});

test('`screenshot` with no name string is a diagnosed error, not a silent empty step', () => {
  const { diagnostics } = parseSource('test "ok"\n  screenshot\n');
  assert.ok(diagnostics.length > 0, 'expected a diagnostic for a bare `screenshot`');
});

// ---- M3d: network observation + `stub` -------------------------------------

test('`expect request to "..." was made` parses a NetworkRequestSubject with the wasMade matcher', () => {
  const step = firstStep('test "ok"\n  expect request to "/api/orders" was made\n') as {
    subject: { type: string; ref: { urlPattern: { value: string }; method: unknown } };
    matcher: { name: string; negated: boolean };
  };
  assert.equal(step.subject.type, 'NetworkRequestSubject');
  assert.equal(step.subject.ref.urlPattern.value, '/api/orders');
  assert.equal(step.subject.ref.method, null);
  assert.equal(step.matcher.name, 'wasMade');
  assert.equal(step.matcher.negated, false);
});

test('`expect request to "..." with method "POST" was made` carries the method on the ref', () => {
  const step = firstStep('test "ok"\n  expect request to "/api/orders" with method "POST" was made\n') as {
    subject: { ref: { method: { value: string } | null } };
  };
  assert.equal(step.subject.ref.method?.value, 'POST');
});

test('`expect request to "..." not was made` negates via the ordinary `not` prefix', () => {
  const step = firstStep('test "ok"\n  expect request to "/api/orders" not was made\n') as { matcher: { name: string; negated: boolean } };
  assert.equal(step.matcher.name, 'wasMade');
  assert.equal(step.matcher.negated, true);
});

test('bare `expect request connects`/`fails` (§6.2.2, no `to`) is unaffected — still RequestSubject', () => {
  const { program, diagnostics } = parseSource('test "ok"\n  api GET /health\n  expect request connects\n');
  assert.deepEqual(diagnostics, []);
  const expectStep = program.tests[0]!.body[1] as { subject: { type: string } };
  assert.equal(expectStep.subject.type, 'RequestSubject');
});

test('`status of request to "..."` parses a StatusSubject carrying the `of` ref', () => {
  const step = firstStep('test "ok"\n  expect status of request to "/api/orders" equals 201\n') as {
    subject: { type: string; of: { urlPattern: { value: string } } | null };
  };
  assert.equal(step.subject.type, 'StatusSubject');
  assert.equal(step.subject.of?.urlPattern.value, '/api/orders');
});

test('`header "..." of request to "..."` parses a HeaderSubject carrying the `of` ref', () => {
  const step = firstStep('test "ok"\n  expect header "content-type" of request to "/api/orders" contains "json"\n') as {
    subject: { type: string; name: { value: string }; of: { urlPattern: { value: string } } | null };
  };
  assert.equal(step.subject.type, 'HeaderSubject');
  assert.equal(step.subject.name.value, 'content-type');
  assert.equal(step.subject.of?.urlPattern.value, '/api/orders');
});

test('`body.<path> of request to "..."` and `body text of request to "..."` carry the `of` ref', () => {
  const body = firstStep('test "ok"\n  expect body.id of request to "/api/orders" equals "abc"\n') as {
    subject: { type: string; path: { name: string }[]; of: { urlPattern: { value: string } } | null };
  };
  assert.equal(body.subject.type, 'BodySubject');
  assert.deepEqual(body.subject.path, [{ kind: 'prop', name: 'id' }]);
  assert.equal(body.subject.of?.urlPattern.value, '/api/orders');

  const text = firstStep('test "ok"\n  expect body text of request to "/api/orders" contains "ok"\n') as {
    subject: { type: string; of: { urlPattern: { value: string } } | null };
  };
  assert.equal(text.subject.type, 'BodyTextSubject');
  assert.equal(text.subject.of?.urlPattern.value, '/api/orders');
});

test('an ordinary `expect status equals ...` (no `of` clause) keeps `of: null` — unchanged behavior', () => {
  const { program } = parseSource('test "ok"\n  api GET /health\n  expect status equals 200\n');
  const expectStep = program.tests[0]!.body[1] as { subject: { of: unknown } };
  assert.equal(expectStep.subject.of, null);
});

test('`of request` with no `to` is a diagnosed error, not a silent parse', () => {
  const { diagnostics } = parseSource('test "ok"\n  expect status of request equals 200\n');
  assert.ok(diagnostics.length > 0, 'expected a diagnostic');
});

test('`stub <METHOD> "<url>" respond status <code>` parses a StubStmt with no body', () => {
  const step = firstStep('test "ok"\n  stub GET "/api/orders/**" respond status 500\n') as {
    type: string;
    method: string;
    urlPattern: { value: string };
    status: { value: number };
    body: unknown;
  };
  assert.equal(step.type, 'StubStmt');
  assert.equal(step.method, 'GET');
  assert.equal(step.urlPattern.value, '/api/orders/**');
  assert.equal(step.status.value, 500);
  assert.equal(step.body, null);
});

test('`stub` with `body {...}` parses the object literal onto StubStmt.body', () => {
  const step = firstStep('test "ok"\n  stub POST "/api/payments/**" respond status 200 body { approved: true }\n') as {
    type: string;
    method: string;
    body: { fields: { key: string }[] } | null;
  };
  assert.equal(step.type, 'StubStmt');
  assert.equal(step.method, 'POST');
  assert.equal(step.body?.fields[0]?.key, 'approved');
});

test('`stub` with an unknown HTTP method is a diagnosed error with a suggestion', () => {
  const { diagnostics } = parseSource('test "ok"\n  stub GRAB "/api/x" respond status 200\n');
  assert.ok(diagnostics.length > 0, 'expected a diagnostic for an unknown method');
});

test('`stub` missing `respond status` is a diagnosed error, not a silent parse', () => {
  const { diagnostics } = parseSource('test "ok"\n  stub GET "/api/orders"\n');
  assert.ok(diagnostics.length > 0, 'expected a diagnostic for a missing `respond status`');
});

// ---- M3e: `page` subject + `has no [<severity>] a11y violations` ----------

test('`expect page has no a11y violations` parses a PageSubject with the hasNoA11yViolations matcher, no severity', () => {
  const step = firstStep('test "ok"\n  expect page has no a11y violations\n') as {
    subject: { type: string };
    matcher: { name: string; negated: boolean; severityFloor: string | undefined };
  };
  assert.equal(step.subject.type, 'PageSubject');
  assert.equal(step.matcher.name, 'hasNoA11yViolations');
  assert.equal(step.matcher.negated, false);
  assert.equal(step.matcher.severityFloor, undefined);
});

test('`expect page has no <severity> a11y violations` carries the severity for each of minor/moderate/serious/critical', () => {
  for (const severity of ['minor', 'moderate', 'serious', 'critical']) {
    const step = firstStep(`test "ok"\n  expect page has no ${severity} a11y violations\n`) as {
      matcher: { severityFloor: string | undefined };
    };
    assert.equal(step.matcher.severityFloor, severity);
  }
});

test('`expect page not has no critical a11y violations` negates via the ordinary `not` prefix', () => {
  const step = firstStep('test "ok"\n  expect page not has no critical a11y violations\n') as {
    matcher: { name: string; negated: boolean; severityFloor: string | undefined };
  };
  assert.equal(step.matcher.name, 'hasNoA11yViolations');
  assert.equal(step.matcher.negated, true);
  assert.equal(step.matcher.severityFloor, 'critical');
});

test('`check page has no a11y violations` parses as the soft ExpectStmt form, same as any other subject', () => {
  const step = firstStep('test "ok"\n  check page has no a11y violations\n') as { type: string; soft: boolean };
  assert.equal(step.type, 'ExpectStmt');
  assert.equal(step.soft, true);
});

test('`has no` with an unknown word instead of `a11y` is a diagnosed error, not a silent parse', () => {
  const { diagnostics } = parseSource('test "ok"\n  expect page has no bogus violations\n');
  assert.ok(diagnostics.length > 0, 'expected a diagnostic');
});

test('`has` with neither `count`/`value`/`no` after it is still a diagnosed error (unaffected by the new `no` branch)', () => {
  const { diagnostics } = parseSource('test "ok"\n  expect list "items" has 3\n');
  assert.ok(diagnostics.length > 0, 'expected a diagnostic');
});

// ---- M4b: `matches snapshot "<name>"` + `mask <locator>` -------------------

test('`expect page matches snapshot "<name>"` parses a PageSubject with the matchesSnapshot matcher and no masks', () => {
  const step = firstStep('test "ok"\n  expect page matches snapshot "checkout-page"\n') as {
    subject: { type: string };
    matcher: { name: string; negated: boolean; snapshotName: { value: string } | undefined };
    masks: readonly unknown[];
  };
  assert.equal(step.subject.type, 'PageSubject');
  assert.equal(step.matcher.name, 'matchesSnapshot');
  assert.equal(step.matcher.negated, false);
  assert.equal(step.matcher.snapshotName?.value, 'checkout-page');
  assert.deepEqual(step.masks, []);
});

test('`expect <locator> matches snapshot "<name>"` parses a LocatorSubject with the matchesSnapshot matcher', () => {
  const step = firstStep('test "ok"\n  expect list "Cart items" matches snapshot "cart-badge"\n') as {
    subject: { type: string; locator: { kind: string; value: { value: string } } };
    matcher: { name: string; snapshotName: { value: string } | undefined };
  };
  assert.equal(step.subject.type, 'LocatorSubject');
  assert.equal(step.subject.locator.kind, 'list');
  assert.equal(step.matcher.snapshotName?.value, 'cart-badge');
});

test('one or more trailing `mask <locator>` clauses parse into ExpectStmt.masks, in source order', () => {
  const step = firstStep('test "ok"\n  expect page matches snapshot "checkout-page" mask css ".timestamp" mask css ".order-id"\n') as {
    masks: readonly { readonly kind: string; readonly value: { readonly value: string } }[];
  };
  assert.equal(step.masks.length, 2);
  assert.equal(step.masks[0]!.kind, 'css');
  assert.equal(step.masks[0]!.value.value, '.timestamp');
  assert.equal(step.masks[1]!.value.value, '.order-id');
});

test('`mask <locator>` is also accepted after `check ... matches snapshot`, the soft ExpectStmt form', () => {
  const step = firstStep('test "ok"\n  check page matches snapshot "checkout-page" mask css ".timestamp"\n') as {
    type: string;
    soft: boolean;
    masks: readonly unknown[];
  };
  assert.equal(step.type, 'ExpectStmt');
  assert.equal(step.soft, true);
  assert.equal(step.masks.length, 1);
});

test('`not matches snapshot "<name>"` negates via the ordinary `not` prefix', () => {
  const step = firstStep('test "ok"\n  expect page not matches snapshot "checkout-page"\n') as {
    matcher: { name: string; negated: boolean };
  };
  assert.equal(step.matcher.name, 'matchesSnapshot');
  assert.equal(step.matcher.negated, true);
});

test('every other subject/matcher pair still parses with an empty `masks` array (no accidental grammar change)', () => {
  const step = firstStep('test "ok"\n  expect status equals 200\n') as { masks: readonly unknown[] };
  assert.deepEqual(step.masks, []);
});

test('`matches` with an unknown word instead of `subset`/`schema`/`file`/`snapshot` still falls through to the plain regex case, unaffected', () => {
  const step = firstStep('test "ok"\n  expect body matches "^ok$"\n') as { matcher: { name: string; value: { value: string } | null } };
  assert.equal(step.matcher.name, 'matches');
  assert.equal(step.matcher.value?.value, '^ok$');
});

// ---- M159/D798/D799: the two dialog subjects ---------------------------------------------------

test('`dialog message` and `dialog type` parse as their own subjects', () => {
  const message = firstStep('test "ok"\n  expect dialog message equals "Really?"\n') as { subject: { type: string } };
  assert.equal(message.subject.type, 'DialogMessageSubject');
  const kind = firstStep('test "ok"\n  expect dialog type equals "confirm"\n') as { subject: { type: string } };
  assert.equal(kind.subject.type, 'DialogTypeSubject');
});

test('a bare `dialog` subject is refused, naming both halves rather than defaulting to one', () => {
  // `D628`'s reasoning against a hyphen is the same reasoning against a default: a reader should
  // not have to know which half was implied. Two bare words, and the second is required.
  const { diagnostics } = parseSource('test "ok"\n  expect dialog equals "x"\n');
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0]!.message, /expected `message` or `type` after `dialog`/);
  assert.match(diagnostics[0]!.hint ?? '', /alert.*confirm.*prompt.*beforeunload/);
});
