// Unit tests for workspace/configResolution.ts (PLAN_M13_LSP.md Phase 3) — loads a real
// `tflw.config` off disk (mkdtemp fixtures, same pattern as packages/cli/test/e2e.test.ts) and
// resolves it exactly the way `loadAndValidate` does in the CLI (decision A: config files get
// checkSessionServices diagnostics too; decision B: a `tflw.env` setting picks the active env).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadProjectConfig, resolutionErrorDiagnostic } from '../src/workspace/configResolution.js';

async function withTmpProject<T>(configSource: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-lsp-config-'));
  try {
    await writeFile(join(dir, 'tflw.config'), configSource, 'utf8');
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('loadProjectConfig resolves the sole/default env and reports zero diagnostics for a clean config', async () => {
  await withTmpProject(`env local default\n  api "http://localhost:3001"\n  api billing "http://localhost:3002"\n\nsession admin\n  api billing GET /health\n`, async (dir) => {
    const project = await loadProjectConfig(dir, undefined);
    assert.deepEqual(project.diagnostics, []);
    assert.equal(project.resolutionError, undefined);
    assert.equal(project.resolved?.envName, 'local');
    assert.deepEqual(project.resolved?.services, { billing: 'http://localhost:3002' });
  });
});

test('loadProjectConfig: checkSessionServices flags a session step using an undeclared service (decision A)', async () => {
  await withTmpProject(`env local default\n  api "http://localhost:3001"\n\nsession admin\n  api billng POST /auth/login\n`, async (dir) => {
    const project = await loadProjectConfig(dir, undefined);
    assert.equal(project.diagnostics.length, 1);
    assert.equal(project.diagnostics[0]!.code, 'TF026');
    assert.match(project.diagnostics[0]!.message, /unknown api service "billng"/);
  });
});

test('loadProjectConfig: the tflw.env setting picks a non-default env (decision B)', async () => {
  const configSource = `env local default\n  api "http://localhost:3001"\n\nenv staging\n  api "https://staging.example.com"\n`;
  await withTmpProject(configSource, async (dir) => {
    const defaultProject = await loadProjectConfig(dir, undefined);
    assert.equal(defaultProject.resolved?.envName, 'local');

    const stagingProject = await loadProjectConfig(dir, 'staging');
    assert.equal(stagingProject.resolved?.envName, 'staging');
    assert.equal(stagingProject.resolved?.apiBaseUrl, 'https://staging.example.com');
  });
});

test('loadProjectConfig: an ambiguous env selection (no default, no tflw.env) surfaces as resolutionError, not a crash', async () => {
  const configSource = `env local\n  api "http://localhost:3001"\n\nenv staging\n  api "https://staging.example.com"\n`;
  await withTmpProject(configSource, async (dir) => {
    const project = await loadProjectConfig(dir, undefined);
    assert.equal(project.resolved, undefined);
    assert.match(project.resolutionError ?? '', /no active env/);

    const diag = resolutionErrorDiagnostic(project);
    assert.ok(diag);
    assert.equal(diag!.code, 'TFLSP001');
    assert.equal(diag!.severity, 'error');
    assert.deepEqual(diag!.span, project.config.span);
  });
});

test('resolutionErrorDiagnostic: null when the config resolved cleanly', async () => {
  await withTmpProject(`env local default\n  api "http://localhost:3001"\n`, async (dir) => {
    const project = await loadProjectConfig(dir, undefined);
    assert.equal(resolutionErrorDiagnostic(project), null);
  });
});

test('`M147d`/`M137f-02`: a session scoped to another env is not squiggled in this one (D642)', async () => {
  // The row, in the editor. `loadProjectConfig` resolves an env and then checks session bodies
  // against it — so handing it every declared session reported `TF026` on a config `tflw check`
  // calls clean, which is the CLI and the language server disagreeing about what is legal. The
  // fix is the same one-line swap the CLI got, and this file's own comments already promised the
  // behaviour: *the editor squiggles the env this workspace actually resolves to*.
  const config =
    'env one default\n  api adminConsole "https://console.example.com"\n  api shared "https://shared.example.com"\n\n' +
    'env two\n  api shared "https://shared.example.com"\n\n' +
    'session console for env one\n  api adminConsole GET /login\n';

  await withTmpProject(config, async (dir) => {
    // The env that has the console: resolves, and its body is still checked — the scope clause must
    // not buy silence for the env it names.
    const one = await loadProjectConfig(dir, 'one');
    assert.deepEqual(one.diagnostics, []);

    // The env that does not: the session is simply not this env's to check.
    const two = await loadProjectConfig(dir, 'two');
    assert.deepEqual(two.diagnostics, []);
  });
});

test('`M147d`: the scope clause does not silence a real error in the env it names', async () => {
  // The control for the test above. If `checkSessionBody` were handed an empty roster instead of a
  // filtered one, both assertions there would pass for the wrong reason.
  const config =
    'env one default\n  api shared "https://shared.example.com"\n\n' +
    'session console for env one\n  api adminConsole GET /login\n';
  await withTmpProject(config, async (dir) => {
    const project = await loadProjectConfig(dir, 'one');
    assert.equal(project.diagnostics[0]!.code, 'TF026');
  });
});
