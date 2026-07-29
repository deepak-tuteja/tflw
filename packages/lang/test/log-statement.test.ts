// `log` statement (M27, PLAN_LOG.md decisions 113-122): grammar (level/message/destination),
// checker (unknown-variable in an interpolated message), and the `log destination`/`log level`
// config-dialect keys. Standalone `parseSource`/`parseConfigSource` assertions, not golden
// snapshots — mirrors how `parser.test.ts`'s `HEAD`/`OPTIONS`/`upload type` tests exercise a new
// grammar shape without touching the shared `VALID` fixture list.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, parseConfigSource, checkUnknownVariables } from '../src/index.js';
import type { LogStmt, LogDestinationDecl, LogLevelDecl } from '../src/ast.js';

test('`log "…"` defaults to level info and destination null', () => {
  const { program, diagnostics } = parseSource('test "ok"\n  log "order created"\n');
  assert.deepEqual(diagnostics, []);
  const step = program.tests[0]!.body[0] as LogStmt;
  assert.equal(step.type, 'LogStmt');
  assert.equal(step.level, 'info');
  assert.equal(step.message.value, 'order created');
  assert.equal(step.destination, null);
});

test('`log <level> "…"` parses each of the four levels', () => {
  for (const level of ['debug', 'info', 'warn', 'error'] as const) {
    const { program, diagnostics } = parseSource(`test "ok"\n  log ${level} "msg"\n`);
    assert.deepEqual(diagnostics, [], `unexpected diagnostics for level ${level}`);
    const step = program.tests[0]!.body[0] as LogStmt;
    assert.equal(step.level, level);
  }
});

test('`log "…" to <destination>` parses each of the three destinations', () => {
  for (const dest of ['console', 'html', 'both'] as const) {
    const { program, diagnostics } = parseSource(`test "ok"\n  log "msg" to ${dest}\n`);
    assert.deepEqual(diagnostics, [], `unexpected diagnostics for destination ${dest}`);
    const step = program.tests[0]!.body[0] as LogStmt;
    assert.equal(step.destination, dest);
  }
});

test('`log warn "…" to html` combines level and destination', () => {
  const { program, diagnostics } = parseSource('test "ok"\n  log warn "stock low" to html\n');
  assert.deepEqual(diagnostics, []);
  const step = program.tests[0]!.body[0] as LogStmt;
  assert.equal(step.level, 'warn');
  assert.equal(step.destination, 'html');
});

test('`log "…" to <bad>` is a diagnostic with a did-you-mean hint', () => {
  const { diagnostics } = parseSource('test "ok"\n  log "msg" to consle\n');
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0]!.message, /log destination/);
  assert.match(diagnostics[0]!.hint ?? '', /console/);
});

test('`log` requires a message string', () => {
  const { diagnostics } = parseSource('test "ok"\n  log to console\n');
  assert.ok(diagnostics.length > 0);
});

test('`{var}` interpolation in a log message is checked like any other string (TF030)', () => {
  const { program } = parseSource('test "ok"\n  log "order {orderId} created"\n');
  const diags = checkUnknownVariables(program);
  assert.equal(diags.length, 1);
  assert.match(diags[0]!.message, /unknown variable "orderId"/);
});

test('`{var}` interpolation resolves once bound by a prior `capture`/`let`', () => {
  const { program } = parseSource('test "ok"\n  let orderId = 42\n  log "order {orderId} created"\n');
  const diags = checkUnknownVariables(program);
  assert.deepEqual(diags, []);
});

test('config: `log destination "html"` parses into a LogDestinationDecl', () => {
  const { config, diagnostics } = parseConfigSource('defaults\n  log destination "html"\n');
  assert.deepEqual(diagnostics, []);
  const entry = config.defaults!.entries[0] as LogDestinationDecl;
  assert.equal(entry.type, 'LogDestinationDecl');
  assert.equal(entry.destination, 'html');
});

test('config: `log level "warn"` parses into a LogLevelDecl', () => {
  const { config, diagnostics } = parseConfigSource('defaults\n  log level "warn"\n');
  assert.deepEqual(diagnostics, []);
  const entry = config.defaults!.entries[0] as LogLevelDecl;
  assert.equal(entry.type, 'LogLevelDecl');
  assert.equal(entry.level, 'warn');
});

test('config: `log destination "bogus"` is a diagnostic', () => {
  const { diagnostics } = parseConfigSource('defaults\n  log destination "bogus"\n');
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0]!.message, /unknown log destination/);
});

test('config: `log` alone (no `destination`/`level`) is a diagnostic', () => {
  const { diagnostics } = parseConfigSource('defaults\n  log "html"\n');
  assert.ok(diagnostics.length > 0);
});
