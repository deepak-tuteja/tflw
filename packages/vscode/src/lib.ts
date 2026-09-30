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

// ---- `M251` `C` (`D1368`): the Test Explorer's vscode-free half ------------------------------

/** One `test "…"` declaration in a file: its decoded name and 0-based line. The same scan the
 * CodeLens uses, so an explorer item and a lens always agree about where a test is. */
export function testsInText(text: string): { name: string; line: number }[] {
  const out: { name: string; line: number }[] = [];
  text.split(/\r?\n/).forEach((l, line) => {
    const name = parseTestDeclarationLine(l);
    if (name !== undefined) out.push({ name, line });
  });
  return out;
}

/** `tflw run`'s arguments for one explorer run: a file (or the whole suite), one test by name, or
 * the failing tests (`D1414`). `--format ndjson` streams the event log the explorer reads. */
export function runArgs(target: { file?: string; only?: string; failed?: boolean }): string[] {
  const args = ['run'];
  if (target.file !== undefined) args.push(target.file);
  if (target.only !== undefined) args.push('--only', target.only);
  if (target.failed) args.push('--failed');
  args.push('--format', 'ndjson', '--no-color');
  return args;
}

/** How to start `bin` with `args` without a shell on POSIX. On Windows a project-local bin is
 * `tflw.cmd`, which only a shell can start (`M243-02`), so each argument is quoted for `cmd.exe`. */
export function spawnSpec(bin: string, args: readonly string[], platform: NodeJS.Platform = process.platform): { command: string; args: string[]; shell: boolean } {
  if (platform !== 'win32') return { command: bin, args: [...args], shell: false };
  const q = (a: string): string => (/^[\w./:=\\-]+$/.test(a) ? a : `"${a.replace(/"/g, '""')}"`);
  return { command: q(bin), args: args.map(q), shell: true };
}

/** Splits a byte stream into complete lines; a partial line waits for the next chunk. */
export class LineReader {
  private rest = '';
  push(chunk: string): string[] {
    const parts = (this.rest + chunk).split('\n');
    this.rest = parts.pop() ?? '';
    return parts.map((p) => p.replace(/\r$/, '')).filter((p) => p.length > 0);
  }
  flush(): string[] {
    const last = this.rest;
    this.rest = '';
    return last.length > 0 ? [last] : [];
  }
}

/** The two events the explorer acts on, out of one `--format ndjson` line; anything else is `null`
 * (a step event, a hook's own start/end, a line that is not JSON). */
export type ExplorerEvent =
  | { kind: 'start'; name: string; file?: string }
  | { kind: 'end'; name: string; file?: string; verdict: Verdict };

export interface Verdict {
  readonly state: 'passed' | 'failed' | 'skipped';
  readonly durationMs?: number;
  /** Why it failed: the failing step's source and detail, or the test's fatal error. */
  readonly message?: string;
  /** 1-based line of the failing step in `file`, when the report carries one. */
  readonly line?: number;
  readonly file?: string;
}

interface EntryLike {
  name?: string; kind?: string; ok?: boolean; skipped?: string; error?: string; durationMs?: number; file?: string;
  steps?: { ok?: boolean; source?: string; detail?: string; line?: number; file?: string }[];
}

/** A `ReportEntry` (what `test:end` carries and `results.json`'s `tests` holds) as a verdict. */
export function verdictOf(entry: EntryLike): Verdict {
  const base = { ...(entry.durationMs !== undefined ? { durationMs: entry.durationMs } : {}), ...(entry.file !== undefined ? { file: entry.file } : {}) };
  if (entry.skipped !== undefined) return { state: 'skipped', ...base, message: entry.skipped };
  if (entry.ok) return { state: 'passed', ...base };
  const step = entry.steps?.find((s) => s.ok === false);
  const message = step ? [step.source?.trim(), step.detail].filter(Boolean).join('\n') : (entry.error ?? 'failed');
  return { state: 'failed', ...base, message, ...(step?.line !== undefined ? { line: step.line } : {}), ...(step?.file !== undefined ? { file: step.file } : {}) };
}

export function parseExplorerEvent(line: string): ExplorerEvent | null {
  let e: { type?: string; name?: string; hook?: unknown; file?: string; result?: EntryLike };
  try {
    e = JSON.parse(line);
  } catch {
    return null;
  }
  if (e.hook !== undefined) return null;
  if (e.type === 'test:start' && typeof e.name === 'string') return { kind: 'start', name: e.name, ...(e.file !== undefined ? { file: e.file } : {}) };
  if (e.type === 'test:end' && e.result && typeof e.result.name === 'string') {
    const file = e.file ?? e.result.file;
    return { kind: 'end', name: e.result.name, ...(file !== undefined ? { file } : {}), verdict: verdictOf(e.result) };
  }
  return null;
}

/** The report directory a run writes to, as far as `tflw.config`'s `defaults` block says; `report`
 * when it says nothing. Read for the explorer's link to `report.html`, nothing else. */
export function reportDirOf(configText: string): string {
  const m = /^\s+report\s+"([^"]+)"/m.exec(configText);
  return m ? m[1]! : 'report';
}
