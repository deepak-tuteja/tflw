// Unit tests for workspace/project.ts (PLAN_M13_LSP.md Phase 3) — a deliberate duplicate of
// packages/vscode/src/lib.ts's findProjectRoot, tested the same way (fake-fs injection, no real
// filesystem needed).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findProjectRoot } from '../src/workspace/project.js';

test('findProjectRoot walks up until it finds a directory containing tflw.config', () => {
  const fakeFs = new Set(['/home/user/project/tflw.config']);
  const exists = (p: string) => fakeFs.has(p);
  assert.equal(findProjectRoot('/home/user/project/tests/nested', exists), '/home/user/project');
  assert.equal(findProjectRoot('/home/user/project', exists), '/home/user/project');
});

test('findProjectRoot returns undefined when no tflw.config exists anywhere above', () => {
  const exists = () => false;
  assert.equal(findProjectRoot('/home/user/not-a-project/tests', exists), undefined);
});
