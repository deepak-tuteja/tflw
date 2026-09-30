// Search over the project (`M209` `S5`, `D1064`/`D1065`) — one box above the tree, and the tag
// chips folded into it (`M205` Q12: the sibling's 84 chips were a control nobody could read).
//
// **TWO KINDS OF QUERY, AND THE PAGE HAS TO SAY WHICH ONE IT IS DOING.** That is `D1064`'s accepted
// cost written down as code:
//
//   - `@tag` narrows the tree **and the run**. It passes `--tag`, which is the language's own
//     narrowing, so what runs is exactly the tests carrying the tag. Measured on the sibling:
//     `@crud` is **59 tests in 16 files**, and those 16 files hold **97** tests — so filtering the
//     tree to files and running them whole would run 38 tests nobody asked for. The tree says
//     *where*; the flag decides *what*.
//   - plain text narrows the **tree only**. There is no `--name` flag, so a text match can only
//     ever run whole files, and the hint says so rather than letting a reader assume otherwise.
//
// A tag query matches by PREFIX and expands to the project's own tags, because `--tag a,b` is OR
// (`cli.ts:817`) and `--tag nope` is an error: expanding against tags that exist keeps every
// request legal while the reader is still typing. A query that matches no tag at all is said out
// loud and runs nothing — a search that silently ran the whole suite is the failure this avoids.
//
// Endpoints are deliberately absent (`D1065`), with the condition named in `PLAN_M209` §5: when
// `readProject` stops discarding parsed request paths. They would need server work and could only
// ever run whole files, which is the half of `D1064` that is already the accepted cost.
import type { Lens, ProjectFile, ProjectView } from './contract';
import { markKey } from './verdicts';

export type Query =
  | { readonly kind: 'none' }
  | { readonly kind: 'tag'; readonly typed: string; readonly tags: readonly string[] }
  | { readonly kind: 'text'; readonly typed: string };

/** Every tag any test in the project carries, sorted. Not door-narrowed: search is over the
 *  project, and the door is a count (`D1063`). */
export function projectTags(project: ProjectView): string[] {
  const seen = new Set<string>();
  for (const f of project.files) for (const t of f.tests) for (const tag of t.tags) seen.add(tag);
  return [...seen].sort();
}

export function parseQuery(raw: string, project: ProjectView): Query {
  const typed = raw.trim();
  if (typed === '') return { kind: 'none' };
  if (!typed.startsWith('@')) return { kind: 'text', typed };
  const prefix = typed.slice(1).toLowerCase();
  const tags = prefix === '' ? projectTags(project) : projectTags(project).filter((t) => t.toLowerCase().startsWith(prefix));
  return { kind: 'tag', typed, tags };
}

/** The files a query lights up. `null` means *the query narrows nothing*, which is a different
 *  answer from *nothing matches* and must not be drawn the same way. */
export function matchingFiles(project: ProjectView, query: Query): ReadonlySet<string> | null {
  if (query.kind === 'none') return null;
  const out = new Set<string>();
  if (query.kind === 'tag') {
    const wanted = new Set(query.tags);
    for (const f of project.files) if (f.tests.some((t) => t.tags.some((tag) => wanted.has(tag)))) out.add(f.path);
    return out;
  }
  const needle = query.typed.toLowerCase();
  for (const f of project.files) {
    if (f.path.toLowerCase().includes(needle)) out.add(f.path);
    else if (f.tests.some((t) => t.name.toLowerCase().includes(needle))) out.add(f.path);
    else if (f.crawls.some((c) => c.name.toLowerCase().includes(needle))) out.add(f.path);
  }
  return out;
}

/** How many TESTS a tag query will actually run — the number `--tag` decides, which is not the
 *  number of tests in the files it lights up. The gap is the whole of `D1064`. */
export function taggedTestCount(project: ProjectView, query: Query): number {
  if (query.kind !== 'tag') return 0;
  const wanted = new Set(query.tags);
  let n = 0;
  for (const f of project.files) for (const t of f.tests) if (t.tags.some((tag) => wanted.has(tag))) n += 1;
  return n;
}

/** One row ▶ would run: a test or a crawl, the file it is in, and the kinds it is of. */
export interface RunRow {
  readonly file: string;
  readonly name: string;
  readonly lenses: readonly Lens[];
}

/**
 * **What ▶ runs, row by row** — `M254` (`D1403`), the one derivation behind the label's count, the
 * run's lens set (`D1250`) and, from `M255`, the explorer's rows.
 *
 * It is `App`'s `request()` read the other way round, so the two cannot disagree: the files are the
 * selection, else the ones a text query lit, else all; a tag query then keeps the tests carrying one
 * of its tags (`--tag` is OR); the chip keeps the rows of its kind (`--kind`). A crawl carries no
 * tags on the wire, so under a tag query none is counted — the CLI may still run a tagged crawl, and
 * the count is then low by exactly those, which is the limit `lensesInRun` has always had.
 */
export function runRows(project: ProjectView, selection: readonly string[], query: Query, kind: Lens | null = null, failed: ReadonlySet<string> | null = null): RunRow[] {
  const files = selection.length > 0 ? new Set(selection) : query.kind === 'text' ? matchingFiles(project, query)! : null;
  const wanted = query.kind === 'tag' ? new Set(query.tags) : null;
  const ofKind = (lenses: readonly Lens[]): boolean => kind === null || lenses.includes(kind);
  // `M255` (`D1404`) — the `failed` chip keeps the rows whose newest verdict failed (`markKey`).
  const kept = (file: string, name: string): boolean => failed === null || failed.has(markKey(file, name));
  const out: RunRow[] = [];
  for (const f of project.files) {
    if (files !== null && !files.has(f.path)) continue;
    for (const t of f.tests) {
      if (wanted !== null && !t.tags.some((tag) => wanted.has(tag))) continue;
      if (ofKind(t.lenses) && kept(f.path, t.name)) out.push({ file: f.path, name: t.name, lenses: t.lenses });
    }
    if (wanted !== null) continue;
    for (const c of f.crawls) if (ofKind(c.lenses) && kept(f.path, c.name)) out.push({ file: f.path, name: c.name, lenses: c.lenses });
  }
  return out;
}

/**
 * **Which lenses a run touches** — what the header's `workers` and `headed` are drawn by (`D1250`:
 * the lens set of the RUN, never the chip). The union over `runRows`, so a flag appears exactly when
 * a row ▶ would run can spend it.
 */
export function lensesInRun(project: ProjectView, selection: readonly string[], query: Query, kind: Lens | null = null, failed: ReadonlySet<string> | null = null): ReadonlySet<Lens> {
  const out = new Set<Lens>();
  for (const r of runRows(project, selection, query, kind, failed)) for (const l of r.lenses) out.add(l);
  return out;
}
