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

import { readFile, stat } from 'node:fs/promises';
import { dirname, basename } from 'node:path';
import {
  parseSource,
  parseConfigSource,
  collectSymbols,
  collectConfigSymbols,
  checkProgram,
  checkSessionBody,
  checkAllowHostsCoversBaseUrls,
  type ConfigFile,
  type Diagnostic,
  type Program,
  type SymbolTable,
} from '@tflw/lang';
import { ConfigError, selectEnv, resolveConfig, resolveImportedActions, resolveMissingFiles } from '@tflw/runtime';
import { findProjectRoot } from './project.js';
import { loadProjectConfig } from './configResolution.js';

export type DocumentKind = 'test' | 'config';

interface OpenDoc {
  /** `undefined` for a buffer that has no path on disk — an unsaved `untitled:` document (M122,
   * `B5-06`, D214). Deliberately not a synthetic stand-in path: this field feeds `findProjectRoot`,
   * `resolveImportedActions` and `resolveMissingFiles`, all of which would then answer confidently
   * about a directory that does not exist — every `import "./x.tflw"` in a scratch buffer coming
   * back `TF043 — file does not exist`. Absent is a fact those passes already know how to handle;
   * a wrong path is not. */
  absPath: string | undefined;
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
  /** Absent for a pathless buffer (D214) — nothing relative can be resolved against it. */
  readonly baseDir?: string;
}

const DEBOUNCE_MS = 200;

/** A pathless buffer is always a test document: `tflw.config` is recognised by filename, and an
 * unsaved buffer has no filename to recognise. The `tflw` language id VS Code routes here is the
 * test dialect's, so this is what the author is writing. */
function classify(absPath: string | undefined): DocumentKind {
  return absPath !== undefined && basename(absPath) === 'tflw.config' ? 'config' : 'test';
}

export class DocumentStore {
  private readonly docs = new Map<string, OpenDoc>();

  open(uri: string, absPath: string | undefined, text: string): void {
    this.docs.set(uri, {
      absPath,
      kind: classify(absPath),
      text,
      root: absPath === undefined ? undefined : findProjectRoot(dirname(absPath)),
    });
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

  get(uri: string): { readonly absPath: string | undefined; readonly kind: DocumentKind; readonly root: string | undefined } | undefined {
    return this.docs.get(uri);
  }

  async analyze(uri: string, envSetting: string | undefined): Promise<DocumentAnalysis | undefined> {
    const doc = this.docs.get(uri);
    if (!doc) return undefined;
    const baseDir = doc.absPath === undefined ? undefined : dirname(doc.absPath);

    if (doc.kind === 'config') {
      const parsed = parseConfigSource(doc.text);
      const symbols = collectConfigSymbols(parsed.config, doc.text);
      let diagnostics: Diagnostic[] = [...parsed.diagnostics];
      try {
        const envBlock = selectEnv(parsed.config, { flag: undefined, envVar: envSetting ?? process.env.TFLW_ENV });
        const resolved = resolveConfig(parsed.config, envBlock);
        diagnostics = [
          ...diagnostics,
          // M116/D152 — the same env this block already resolved, so a `session` body gets `TF051`
          // in the editor exactly as it does from `tflw check`.
          ...checkSessionBody(parsed.config.sessions, Object.keys(resolved.services), {
            envName: resolved.envName,
            api: resolved.apiBaseUrl !== null,
            web: resolved.webBaseUrl !== null,
          }),
          // `TF036` (M85) — same env scope as everything else here: the env this workspace
          // resolves to, not every env the file declares.
          ...checkAllowHostsCoversBaseUrls(parsed.config, envBlock),
        ];
      } catch (e) {
        if (!(e instanceof ConfigError)) throw e;
        // No active env resolvable yet (e.g. mid-edit, no `default` env) — session-service
        // diagnostics simply can't run; parse/validateConfig diagnostics still stand on their own.
      }
      return { diagnostics, symbols, config: parsed.config, ...(doc.root ? { root: doc.root } : {}), ...(baseDir === undefined ? {} : { baseDir }) };
    }

    const parsed = parseSource(doc.text);
    const symbols = collectSymbols(parsed.program, doc.text);
    // An unresolvable project (no root, or an unreadable `tflw.config`) still checks against `[]`
    // rather than `undefined`, unchanged from before M60: a file outside any project genuinely
    // can't name a service or session that resolves, so the server keeps reporting them. Only the
    // docs-site demo — a browser, where no config can exist even in principle — omits these.
    let knownServices: string[] = [];
    let knownSessions: string[] = [];
    // `envBaseUrls` (M116/D148, `TF051`) stays `undefined` when no project resolves, and that is the
    // one option here that must NOT fall back to a permissive default. `[]` for services says "this
    // env declares none", which is a real error about a real env; `{api: false, web: false}` would
    // say the same about an env nobody selected, squiggling every `api GET /path` in a file the
    // server could not place. The rule needs a resolved env or nothing — see `EnvBaseUrls`.
    let envBaseUrls: { envName: string; api: boolean; web: boolean } | undefined;
    if (doc.root) {
      const project = await loadProjectConfig(doc.root, envSetting).catch(() => undefined);
      if (project?.resolved) {
        knownServices = Object.keys(project.resolved.services);
        knownSessions = Array.from(project.resolved.sessions.keys());
        envBaseUrls = {
          envName: project.resolved.envName,
          api: project.resolved.apiBaseUrl !== null,
          web: project.resolved.webBaseUrl !== null,
        };
      }
    }
    // The CLI's own pass list, verbatim — one shared entry point, so the server can't fall behind it
    // again (M60). It ran four of the CLI's six until now.
    //
    // `importedActions` (M87) is resolved through the same shared function the CLI calls, with a
    // reader that prefers an open buffer: an imported `shared/orders.tflw` being edited in another
    // tab is more current on screen than on disk, and squiggling the file in *this* tab against a
    // stale copy of that one is exactly the sort of "the editor disagrees with the CLI" gap M60
    // closed. Falls back to disk for anything not open.
    //
    // Both of these need `doc.absPath` to resolve a relative `import` against, so both are skipped
    // for a pathless buffer (D214) — left `undefined`, never `[]`. That distinction is the one
    // `checker.ts` already documents (`importsResolved = imports.length === 0 || importedActions
    // !== undefined`): `undefined` means "these could not be read", which is exactly true of a
    // buffer with nowhere to read from, and suppresses the passes that would otherwise report
    // every import in an unsaved scratch file as unresolved.
    const importedActions = doc.absPath === undefined ? undefined : await resolveImportedActions(doc.absPath, parsed.program, async (absPath) => {
      const open = [...this.docs.values()].find((d) => d.absPath === absPath);
      return open ? open.text : readFile(absPath, 'utf8');
    });
    // `TF043` (M97c, D144) — same shape, same reason, and the same open-buffer rule: a file the
    // author created in another tab and has not saved yet exists as far as this editor session is
    // concerned, and squiggling `import "./shared/orders.tflw"` red while that very file sits open
    // two tabs over is the "the editor disagrees with the CLI" gap M60 closed, running backwards.
    const missingFiles = doc.absPath === undefined ? undefined : await resolveMissingFiles(doc.absPath, parsed.program, async (absPath) => {
      if ([...this.docs.values()].some((d) => d.absPath === absPath)) return true;
      return stat(absPath).then(
        () => true,
        () => false,
      );
    });
    const diagnostics = [
      ...parsed.diagnostics,
      ...checkProgram(parsed.program, {
        knownServices,
        knownSessions,
        ...(importedActions === undefined ? {} : { importedActions }),
        ...(missingFiles === undefined ? {} : { missingFiles }),
        ...(envBaseUrls ? { envBaseUrls } : {}),
      }),
    ];
    return { diagnostics, symbols, program: parsed.program, ...(doc.root ? { root: doc.root } : {}), ...(baseDir === undefined ? {} : { baseDir }) };
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
