// Open-document state + analysis (PLAN_M13_LSP.md Phase 3). Two different freshness needs share
// one `analyze()`: on-demand requests (hover/definition/completion/rename/signature-help) always
// re-analyze the buffer's *current* in-memory text synchronously — no debounce, since a pull
// request must answer against what's on screen right now, and `.tflw`/`tflw.config` files are
// small enough that re-parsing per request is cheap. Diagnostics are different: they're a push
// notification the server sends unprompted on every edit, so those go through
// `scheduleDiagnostics`'s ~200ms debounce (decision 17.9) to collapse a burst of keystrokes into
// one publish instead of one per character.
//
// Dialect branch (decision A): a `tflw.config` buffer gets `parseConfigSource` (which already runs
// `validateConfig`) + `checkSessionServices` against *its own in-memory text* (not a re-read of the
// file on disk — the open buffer is the source of truth while editing); a `*.tflw` buffer gets
// `parseSource` + the same four checker passes `loadAndValidate` runs in the CLI, using known
// services/sessions resolved from the *project's* `tflw.config` on disk (not itself being edited in
// the common case).

import { dirname, basename } from 'node:path';
import {
  parseSource,
  parseConfigSource,
  collectSymbols,
  collectConfigSymbols,
  checkServices,
  checkDataTables,
  checkSessions,
  checkUnknownVariables,
  checkSessionServices,
  type ConfigFile,
  type Diagnostic,
  type Program,
  type SymbolTable,
} from '@tflw/lang';
import { ConfigError, selectEnv, resolveConfig } from '@tflw/runtime';
import { findProjectRoot } from './project.js';
import { loadProjectConfig } from './configResolution.js';

export type DocumentKind = 'test' | 'config';

interface OpenDoc {
  absPath: string;
  kind: DocumentKind;
  text: string;
  readonly root: string | undefined;
  timer?: ReturnType<typeof setTimeout>;
}

export interface DocumentAnalysis {
  readonly diagnostics: readonly Diagnostic[];
  readonly symbols: SymbolTable;
  readonly program?: Program;
  readonly config?: ConfigFile;
  readonly root?: string;
  readonly baseDir: string;
}

const DEBOUNCE_MS = 200;

function classify(absPath: string): DocumentKind {
  return basename(absPath) === 'tflw.config' ? 'config' : 'test';
}

export class DocumentStore {
  private readonly docs = new Map<string, OpenDoc>();

  open(uri: string, absPath: string, text: string): void {
    this.docs.set(uri, { absPath, kind: classify(absPath), text, root: findProjectRoot(dirname(absPath)) });
  }

  update(uri: string, text: string): void {
    const doc = this.docs.get(uri);
    if (doc) doc.text = text;
  }

  close(uri: string): void {
    const doc = this.docs.get(uri);
    if (doc?.timer) clearTimeout(doc.timer);
    this.docs.delete(uri);
  }

  get(uri: string): { readonly absPath: string; readonly kind: DocumentKind; readonly root: string | undefined } | undefined {
    return this.docs.get(uri);
  }

  async analyze(uri: string, envSetting: string | undefined): Promise<DocumentAnalysis | undefined> {
    const doc = this.docs.get(uri);
    if (!doc) return undefined;
    const baseDir = dirname(doc.absPath);

    if (doc.kind === 'config') {
      const parsed = parseConfigSource(doc.text);
      const symbols = collectConfigSymbols(parsed.config, doc.text);
      let diagnostics: Diagnostic[] = [...parsed.diagnostics];
      try {
        const envBlock = selectEnv(parsed.config, { flag: undefined, envVar: envSetting ?? process.env.TFLW_ENV });
        const resolved = resolveConfig(parsed.config, envBlock);
        diagnostics = [...diagnostics, ...checkSessionServices(parsed.config.sessions, Object.keys(resolved.services))];
      } catch (e) {
        if (!(e instanceof ConfigError)) throw e;
        // No active env resolvable yet (e.g. mid-edit, no `default` env) — session-service
        // diagnostics simply can't run; parse/validateConfig diagnostics still stand on their own.
      }
      return { diagnostics, symbols, config: parsed.config, ...(doc.root ? { root: doc.root } : {}), baseDir };
    }

    const parsed = parseSource(doc.text);
    const symbols = collectSymbols(parsed.program, doc.text);
    let knownServices: string[] = [];
    let knownSessions: string[] = [];
    if (doc.root) {
      const project = await loadProjectConfig(doc.root, envSetting).catch(() => undefined);
      if (project?.resolved) {
        knownServices = Object.keys(project.resolved.services);
        knownSessions = Array.from(project.resolved.sessions.keys());
      }
    }
    const diagnostics = [
      ...parsed.diagnostics,
      ...checkServices(parsed.program, knownServices),
      ...checkDataTables(parsed.program),
      ...checkSessions(parsed.program, knownSessions),
      ...checkUnknownVariables(parsed.program),
    ];
    return { diagnostics, symbols, program: parsed.program, ...(doc.root ? { root: doc.root } : {}), baseDir };
  }

  /** Resets the debounce timer on every call for the same `uri` — a burst of keystrokes collapses
   * into one reparse + one `publish` after typing pauses for `DEBOUNCE_MS` (decision 17.9). */
  scheduleDiagnostics(uri: string, envSetting: string | undefined, publish: (diagnostics: readonly Diagnostic[]) => void): void {
    const doc = this.docs.get(uri);
    if (!doc) return;
    if (doc.timer) clearTimeout(doc.timer);
    doc.timer = setTimeout(() => {
      void this.analyze(uri, envSetting).then((analysis) => {
        if (analysis) publish(analysis.diagnostics);
      });
    }, DEBOUNCE_MS);
  }
}
