// Project-wide `*.tflw` index (PLAN_M13_LSP.md Phase 3, design decision 6) — for cross-file rename
// only. `discoverProjectFiles` mirrors packages/cli/src/cli.ts's `discoverTests(cwd)` glob-walk
// exactly (same skip rules); built lazily, only when `findRenameTargets` (Phase 2) actually flags
// `crossFile: true`, never eagerly on server start — the diagnostics/hover/def path that doesn't
// need a rename never pays this cost, per the plan's stated cold-start concern.

import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { parseSource, parseConfigSource, collectSymbols, collectConfigSymbols, type SymbolKind } from '@tflw/lang';
import type { Span } from '@tflw/lang';

export async function discoverProjectFiles(root: string, exclude: readonly string[] = [], reportDir?: string): Promise<string[]> {
  const found: string[] = [];
  // `M251` `B`: `exclude` and the report directory as `packages/cli/src/project.ts`'s
  // `discoverTests` applies them, so the reuse pass the editor offers reads the suite `tflw check`
  // reads. Rename passes neither and walks every file, as it always has.
  const skipReport = reportDir === undefined ? undefined : relative(root, resolve(root, reportDir)).split('\\').join('/');
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const full = join(dir, e.name);
      const rel = relative(root, full).split('\\').join('/');
      if (exclude.includes(rel)) continue;
      if (skipReport !== undefined && skipReport !== '' && rel === skipReport) continue;
      if (e.isDirectory()) await walk(full);
      else if (e.isFile() && e.name.endsWith('.tflw')) found.push(full);
    }
  };
  await walk(root);
  return found.sort();
}

export interface CrossFileRenameEdit {
  readonly absPath: string;
  readonly spans: readonly Span[];
  /** Which of `spans` are declarations (`M251` `A`): find-all-references may leave them out. */
  readonly defs: readonly Span[];
}

/**
 * Every other file's occurrences of `(kind, name)` — same file-wide grouping rule Phase 2's
 * `findRenameTargets` uses within one table, applied across the whole project. `originFilePath` is
 * skipped (the rename request's own file already has its spans from `findRenameTargets`). A
 * `session` rename additionally checks `tflw.config`'s own `SessionDecl` def, since that's where a
 * session name is actually declared.
 */
export async function findCrossFileRenameEdits(root: string, kind: SymbolKind, name: string, originFilePath: string): Promise<CrossFileRenameEdit[]> {
  const files = await discoverProjectFiles(root);
  const edits: CrossFileRenameEdit[] = [];
  for (const file of files) {
    if (file === originFilePath) continue;
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    const parsed = parseSource(text);
    const table = collectSymbols(parsed.program, text);
    const defs = table.defs.filter((d) => d.kind === kind && d.name === name).map((d) => d.span);
    const spans: Span[] = [...defs, ...table.refs.filter((r) => r.kind === kind && r.name === name).map((r) => r.span)];
    if (spans.length > 0) edits.push({ absPath: file, spans, defs });
  }

  if (kind === 'session') {
    const configPath = join(root, 'tflw.config');
    try {
      const configText = await readFile(configPath, 'utf8');
      const parsedConfig = parseConfigSource(configText);
      const table = collectConfigSymbols(parsedConfig.config, configText);
      const spans = table.defs.filter((d) => d.kind === 'session' && d.name === name).map((d) => d.span);
      if (spans.length > 0) edits.push({ absPath: configPath, spans, defs: spans });
    } catch {
      // no tflw.config, or unreadable — nothing to add.
    }
  }

  return edits;
}
