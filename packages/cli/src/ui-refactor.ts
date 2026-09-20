// What a move or a delete would do — `M218` `C` (`D1150`, `D1151`, `D1152`, `D1153`).
//
// ── ONE FUNCTION ANSWERS AND ONE FUNCTION DOES (`D1150`) ───────────────────────────────────────
//
// `GET /api/refactor` previews and `POST /api/move` / `DELETE /api/file` apply, and both call
// `planMove`/`planDelete` here. That is not tidiness. `M217-01` was the create dialog previewing
// bytes built from disk while different bytes landed, and `D1141` exists because of it; a preview
// computed by one code path and applied by another is the same defect with the blast radius of a
// whole project rather than one file.
//
// ── THE MODULE DOES NO I/O ─────────────────────────────────────────────────────────────────────
//
// It takes the project as a `Map<path, text>` and returns the writes and unlinks it wants. That is
// `@tflw/lang`'s own rule one layer out, and it is what lets `ui-refactor.test.ts` ask the hard
// questions — a move whose third member fails validation, a file that imports itself, a rename
// into a directory that does not exist — without a filesystem.
//
// ── WHY THE REWRITE GOES THROUGH `insertIntoSource` ────────────────────────────────────────────
//
// `insert.ts` already has `replaceInSource` with `{ kind: 'file', what: 'import', index, node }` — it replaces one
// `import` declaration in place. Using it rather than a string substitution is `D1087`'s one
// construction path: a regex over `import "…"` would match the word inside a comment, inside a
// string body, and inside a `use` line, and would write text `format` has never seen.
import { dirname, relative } from 'node:path';
import { format, parseSource, replaceInSource, type ImportDecl, type UseDecl } from '@tflw/lang';

/** A file to write, whole. */
export interface FileEdit {
  readonly path: string;
  readonly text: string;
  /** What changed, for the dialog — `import "./a.tflw"` → `import "../a.tflw"`. */
  readonly why: string;
}

export interface RefactorPlan {
  readonly op: 'move' | 'delete';
  readonly subject: string;
  /** Where it goes — `move` only. */
  readonly to: string | null;
  /** Project-relative paths of every file whose `import`/`use` names the subject. */
  readonly importers: readonly string[];
  /** The writes. For a move the subject's own new text is the first member. */
  readonly edits: readonly FileEdit[];
  /** The unlinks — the old path of a move, or the deleted file. */
  readonly removes: readonly string[];
  /**
   * Why this cannot happen, or empty.
   *
   * **A list rather than a first failure**, so the dialog can say everything wrong at once instead
   * of making the reader fix one thing to discover the next.
   */
  readonly refusals: readonly string[];
}

const posix = (p: string): string => p.split('\\').join('/');

/** The import specifier that names `toFileAbs` from a file in `fromDir` — the same shape
 *  `cli.ts:toImportPath` writes for `tflw refactor apply`, kept identical on purpose. */
function specifierFor(fromDir: string, toFileAbs: string): string {
  const rel = posix(relative(fromDir, toFileAbs));
  return rel.startsWith('.') ? rel : `./${rel}`;
}

/**
 * Where a specifier written in `fromPath` points, as a project-relative path. `null` when it
 * escapes the project, which is a thing the plan must refuse rather than follow.
 *
 * **Walked by hand rather than through `node:path`**, and that is a correction rather than a
 * preference: `resolve('/', 'tests', '../../outside.tflw')` is `/outside.tflw`, because `resolve`
 * *clamps at the root* instead of reporting the overshoot. So an import reaching two levels above
 * the project came back as a perfectly ordinary project-relative path, and `importersOf` would
 * have counted a file outside the project as an importer of one inside it. Caught by the gate's
 * third case on its first run.
 */
export function resolveSpecifier(fromPath: string, spec: string): string | null {
  const segs = posix(fromPath).split('/').slice(0, -1).filter((s) => s !== '' && s !== '.');
  for (const part of posix(spec).split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (segs.length === 0) return null;
      segs.pop();
      continue;
    }
    segs.push(part);
  }
  return segs.length === 0 ? null : segs.join('/');
}

type FileRef = { readonly what: 'import' | 'use'; readonly index: number; readonly node: ImportDecl | UseDecl };

/** Every `import`/`use` a file declares, with the index `insertIntoSource` addresses it by. */
export function fileRefs(text: string): readonly FileRef[] {
  const { program } = parseSource(text);
  return [
    ...program.imports.map((node, index) => ({ what: 'import' as const, index, node })),
    ...program.uses.map((node, index) => ({ what: 'use' as const, index, node })),
  ];
}

/**
 * Who names `target`.
 *
 * **`use` counts.** It names a `.ts` helper and this round never moves one, but an importer that
 * the plan cannot see is an importer the refusal cannot name — and `D1153`'s whole promise is that
 * the explorer never leaves the project broken.
 */
export function importersOf(files: ReadonlyMap<string, string>, target: string): readonly string[] {
  const found: string[] = [];
  for (const [path, text] of files) {
    if (path === target) continue;
    for (const r of fileRefs(text)) {
      if (resolveSpecifier(path, r.node.path.value) === target) { found.push(path); break; }
    }
  }
  return found.sort();
}

/**
 * Rewrite one declaration's path in place, through the one construction path.
 *
 * **`parts` is what prints, and `value` is not.** `printString` walks `StringLit.parts` so that an
 * interpolated string round-trips with its `{holes}` intact; a node whose `value` alone was changed
 * prints the **old** path and every check downstream passes, because the file still parses, is
 * still formatted, and still imports something that exists. Measured here as two green refusal
 * lists over an edit set that had changed nothing at all. An import path never interpolates, so
 * one text part is the whole of it.
 */
function rewrite(text: string, ref: FileRef, spec: string): { ok: true; text: string } | { ok: false; why: string } {
  const path = { ...ref.node.path, value: spec, parts: [{ kind: 'text' as const, value: spec }] };
  const node = ref.what === 'import'
    ? ({ ...(ref.node as ImportDecl), path } as ImportDecl)
    : ({ ...(ref.node as UseDecl), path } as UseDecl);
  const out = replaceInSource(text, { kind: 'file', what: ref.what, index: ref.index, node });
  return out.ok ? { ok: true, text: out.text } : { ok: false, why: out.reason };
}

/** Every produced file must parse **and** already be what `format` writes — the same two claims
 *  `writeProjectFile` makes, checked here so `D1151` can abort before anything is written. */
function validate(edits: readonly FileEdit[]): readonly string[] {
  const bad: string[] = [];
  for (const e of edits) {
    const { diagnostics } = parseSource(e.text);
    const error = diagnostics.find((d) => d.severity === 'error');
    if (error) { bad.push(`${e.path} would not parse: ${error.message}`); continue; }
    const f = format(e.text);
    if (!f.ok) { bad.push(`${e.path} would not lex: ${f.reason ?? 'unknown'}`); continue; }
    if (f.formatted !== e.text) bad.push(`${e.path} would not be formatted`);
  }
  return bad;
}

/**
 * **Move, all-or-nothing** (`D1151`).
 *
 * Two directions, because `D1152` made rename and move one gesture: every importer's path *to* the
 * subject, and the subject's own relative paths *out* of it, which mean a different file one
 * directory down. Measured on both corpora, the second half fires on 4 of 275 files — rare, and
 * silently destructive exactly when it does.
 */
export function planMove(files: ReadonlyMap<string, string>, from: string, to: string): RefactorPlan {
  const refusals: string[] = [];
  const importers = importersOf(files, from);
  const source = files.get(from);
  if (source === undefined) refusals.push(`${from} is not a file in this project`);
  if (from === to) refusals.push('that is where it already is');
  if (files.has(to)) refusals.push(`${to} already exists`);
  if (!to.endsWith('.tflw')) refusals.push('a test file has to end in `.tflw`');
  if (to.split('/').some((seg) => seg === '..' || seg === '.' || seg === '')) refusals.push('that is not a path inside this project');
  if (refusals.length > 0 || source === undefined) {
    return { op: 'move', subject: from, to, importers, edits: [], removes: [], refusals };
  }

  const edits: FileEdit[] = [];

  // 1. The subject's own references, re-pointed for its new directory.
  let moved = source;
  const fromDir = dirname(`/${from}`);
  const toDir = dirname(`/${to}`);
  if (fromDir !== toDir) {
    // Rebuilt from the *current* text each time: an index is an index into the file being edited,
    // and a rewrite reformats it, so collecting refs once and applying four would address moved
    // declarations by stale positions.
    for (let i = 0; ; i += 1) {
      const refs = fileRefs(moved);
      const ref = refs[i];
      if (ref === undefined) break;
      const points = resolveSpecifier(from, ref.node.path.value);
      if (points === null) { refusals.push(`${from} imports \`${ref.node.path.value}\`, which is outside this project`); break; }
      const spec = specifierFor(toDir, `/${points}`);
      if (spec === ref.node.path.value) continue;
      const out = rewrite(moved, ref, spec);
      if (!out.ok) { refusals.push(`${from}: ${out.why}`); break; }
      moved = out.text;
    }
  }
  edits.push({ path: to, text: moved, why: fromDir === toDir ? 'renamed' : `moved from ${fromDir.slice(1) || '.'} to ${toDir.slice(1) || '.'}` });

  // 2. Every importer, re-pointed at the new location.
  for (const importer of importers) {
    let text = files.get(importer)!;
    for (let i = 0; ; i += 1) {
      const refs = fileRefs(text);
      const ref = refs[i];
      if (ref === undefined) break;
      if (resolveSpecifier(importer, ref.node.path.value) !== from) continue;
      const spec = specifierFor(dirname(`/${importer}`), `/${to}`);
      const out = rewrite(text, ref, spec);
      if (!out.ok) { refusals.push(`${importer}: ${out.why}`); break; }
      text = out.text;
    }
    edits.push({ path: importer, text, why: `its import of ${from} now names ${to}` });
  }

  refusals.push(...validate(edits));
  return {
    op: 'move',
    subject: from,
    to,
    importers,
    edits: refusals.length > 0 ? [] : edits,
    removes: refusals.length > 0 ? [] : [from],
    refusals,
  };
}

/**
 * **Delete, refusing what is imported** (`D1153`).
 *
 * The asymmetry with `planMove` is the point and not an omission: a move repairs its blast radius
 * by rewriting, and a delete has nothing to rewrite the importers *to*. So the refusal names them
 * and the reader deals with those first.
 */
export function planDelete(files: ReadonlyMap<string, string>, path: string): RefactorPlan {
  const refusals: string[] = [];
  const importers = importersOf(files, path);
  if (!files.has(path)) refusals.push(`${path} is not a file in this project`);
  if (importers.length > 0) {
    refusals.push(
      `${importers.length} file${importers.length === 1 ? '' : 's'} import${importers.length === 1 ? 's' : ''} this: ${importers.join(', ')}`,
    );
  }
  return { op: 'delete', subject: path, to: null, importers, edits: [], removes: refusals.length > 0 ? [] : [path], refusals };
}
