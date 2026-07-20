// Pure, vscode-independent logic used by extension.ts — factored out so it can be unit-tested with
// plain node:test. `vscode` isn't a real installable npm package (only its *types* are, via
// @types/vscode); the real module only exists inside a running extension host, so anything that
// imports it can only be exercised there, not in a headless `node --test` run. Everything here
// deliberately has zero `vscode` dependency.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Walks up from `startDir` looking for `tflw.config` — the project root `tflw check`/`tflw run`
 * need as their cwd. Stops at the filesystem root; returns undefined if none is found (e.g. a
 * .tflw file opened outside any tflw project). */
export function findProjectRoot(startDir: string, exists: (p: string) => boolean = existsSync): string | undefined {
  let dir = startDir;
  for (;;) {
    if (exists(join(dir, 'tflw.config'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Prefers a project-local install (`node_modules/.bin/tflw`) over a global one on PATH — matches
 * how the CLI is actually consumed in practice (testFlow-tests' own tarball-vendored install). */
export function resolveTflwBin(root: string, platform: NodeJS.Platform = process.platform, exists: (p: string) => boolean = existsSync): string {
  const local = join(root, 'node_modules', '.bin', platform === 'win32' ? 'tflw.cmd' : 'tflw');
  return exists(local) ? local : 'tflw';
}

const TEST_LINE = /^test\s+"((?:[^"\\]|\\.)*)"/;

/** Matches a `test "..."` declaration line, decoding `\"`/`\\` escapes the same way the lexer
 * does — returns the decoded test name, or undefined if this line isn't a test declaration.
 * Regex-based rather than a real parse: editor-only CodeLens positioning, not a
 * correctness-sensitive check (that's what the language server's diagnostics are for), so this is
 * a deliberately lightweight scan — documented as not handling every exotic escape sequence. */
export function parseTestDeclarationLine(line: string): string | undefined {
  const m = TEST_LINE.exec(line);
  if (!m) return undefined;
  return m[1]!.replace(/\\(.)/g, '$1');
}
