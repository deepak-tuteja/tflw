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
