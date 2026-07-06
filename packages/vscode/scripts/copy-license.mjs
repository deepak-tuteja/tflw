#!/usr/bin/env node
// Copies LICENSE from the monorepo root so the packaged .vsix carries one — same one-source-of-
// truth pattern as packages/cli/scripts/bundle.mjs (decision 74e). Run automatically by `vsce
// package`/`vsce publish` via the `vscode:prepublish` script.

import { copyFileSync } from 'node:fs';

copyFileSync(new URL('../../../LICENSE', import.meta.url), new URL('../LICENSE', import.meta.url));
