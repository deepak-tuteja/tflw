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

test('`uncheck field "..."` always parses as the action (no assertion form exists)', () => {
  const step = firstStep('test "ok"\n  uncheck field "Accept terms"\n') as { type: string; locator: { kind: string } };
  assert.equal(step.type, 'UncheckStmt');
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

// ---- `check` dual grammar (SPEC §9.1) --------------------------------------

test('`check <locator>` with nothing after it is the checkbox action (CheckStmt)', () => {
  const step = firstStep('test "ok"\n  check field "Accept terms"\n') as { type: string; locator: { kind: string; value: { value: string } } };
  assert.equal(step.type, 'CheckStmt');
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

test('`wait until` against a non-locator, non-`api` subject is a diagnosed error', () => {
  const { diagnostics } = parseSource('test "ok"\n  wait until status equals 200\n');
  assert.ok(diagnostics.length > 0, 'expected a diagnostic');
  assert.ok(diagnostics[0]!.message.includes('expects either'), diagnostics[0]!.message);
});

test('`wait until api …` still parses as WaitUntilApiStmt (unaffected by the `wait until <ui>` dispatch)', () => {
  const step = firstStep('test "ok"\n  wait until api GET /orders/{orderId}\n    expect body.status equals "shipped"\n') as { type: string };
  assert.equal(step.type, 'WaitUntilApiStmt');
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
