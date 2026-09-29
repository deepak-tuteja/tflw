// `M251` `B` (`D1367`) — the reuse pass's hints as editor code actions. The plan is `@tflw/lang`'s
// `planReuseApply`, the one `tflw refactor apply` writes from, so the edit the editor applies is
// the command's bytes (one planner, two writers). The suite is the one `tflw check` reads — the
// project's `.tflw` files less `exclude` and the report directory — with any file open in the
// editor read from its buffer, because that is the text the edit lands on.

import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { relative, join } from 'node:path';
import { parseSource, allReuseHints, planReuseApply, type SuiteEntry, type ReuseApplyPlan } from '@tflw/lang';
import { discoverProjectFiles } from './workspaceIndex.js';

export interface ReuseActionRequest {
  readonly root: string;
  /** The document asking, as an absolute path. */
  readonly absPath: string;
  /** 0-based lines the editor's range covers, inclusive. */
  readonly fromLine: number;
  readonly toLine: number;
  readonly exclude: readonly string[];
  readonly reportDir?: string;
  /** Text of the files open in the editor, by absolute path. */
  readonly openText: (absPath: string) => string | undefined;
}

export interface ReuseAction {
  readonly title: string;
  readonly plan: ReuseApplyPlan;
  /** The text each file has now, by absolute path — the whole-file replacement is computed against it. */
  readonly before: ReadonlyMap<string, string>;
}

let cached: { key: string; entries: SuiteEntry[] } | undefined;

async function suite(req: ReuseActionRequest): Promise<{ entries: SuiteEntry[]; texts: Map<string, string> } | undefined> {
  const files = await discoverProjectFiles(req.root, req.exclude, req.reportDir);
  const texts = new Map<string, string>();
  for (const abs of files) {
    const text = req.openText(abs) ?? (await readFile(abs, 'utf8').catch(() => undefined));
    if (text !== undefined) texts.set(abs, text);
  }
  // The pass is quadratic in the suite's step windows and the editor asks on every cursor move; the
  // parse is reused while no file's text has changed.
  const key = [...texts].map(([p, t]) => `${p}\u0000${t}`).join('\u0001');
  if (cached?.key !== key) {
    const entries: SuiteEntry[] = [];
    for (const [abs, text] of texts) {
      const parsed = parseSource(text);
      // `refactor apply` refuses a suite that does not check; the editor offers nothing over one
      // that does not parse, since a hint read off a recovered AST is not one the command would give.
      if (parsed.diagnostics.some((d) => d.severity === 'error')) return undefined;
      entries.push({ path: relative(req.root, abs), source: text, program: parsed.program });
    }
    cached = { key, entries };
  }
  return { entries: cached.entries, texts };
}

/** The extractions whose occurrences touch the requested lines of the requesting file. */
export async function reuseActionsAt(req: ReuseActionRequest): Promise<ReuseAction[]> {
  const s = await suite(req);
  if (!s) return [];
  const here = relative(req.root, req.absPath);
  const out: ReuseAction[] = [];
  for (const hint of allReuseHints(s.entries)) {
    const touches = hint.occurrences.some((o) => o.path === here && o.span.start.line - 1 <= req.toLine && o.span.end.line - 1 >= req.fromLine);
    if (!touches) continue;
    const planned = planReuseApply(s.entries, hint.id, (path) => {
      const abs = join(req.root, path);
      // The suite's own text first; then the disk, for a file the suite excludes — the command
      // reads the disk, and must refuse (or append to) the same files the editor does.
      if (s.texts.has(abs)) return s.texts.get(abs)!;
      try {
        return readFileSync(abs, 'utf8');
      } catch {
        return null;
      }
    });
    if (!planned.ok) continue;
    const before = new Map<string, string>();
    for (const path of planned.plan.files.keys()) {
      const abs = join(req.root, path);
      const text = s.texts.get(abs) ?? (planned.plan.created === path ? undefined : readFileSync(abs, 'utf8'));
      if (text !== undefined) before.set(abs, text);
    }
    out.push({ title: `${planned.plan.title} (${hint.id})`, plan: planned.plan, before });
  }
  return out;
}

/** Test seam: drop the memoised suite. */
export function clearReuseCache(): void {
  cached = undefined;
}
