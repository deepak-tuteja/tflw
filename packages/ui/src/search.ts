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

/**
 * **Every lens the run this page is about to start would actually reach** — `M229` `B` (`D1250`).
 *
 * `workers` and `headed` are run-level flags for one kind of test each: `--workers` forks load
 * generators and is a documented no-op on a test with no `workload`, and `--headed` opens a window
 * for a test that drives a browser. Both were drawn on every door, on every project, always —
 * filed as `M216-01` for `workers` alone, with `headed` the same defect on a different door and
 * unfiled.
 *
 * **AND THE DOOR IS NOT THE KEY, WHICH IS WHERE `PLAN_M229_UI_REVIEW.md`'s `D1250` WAS WRONG.**
 * The plan's repair was two capabilities on `VOCABULARY` — `takesWorkers`, `takesHeaded` — read off
 * the door. That would have removed a working control: this strip faces **the run** (`RunStrip`'s
 * own header says so), and a run is not narrowed by the door. `run all` pressed on the API door
 * has no `files` field and no `--tag`, so it runs the LOAD tests too — and `--workers` is exactly
 * the flag that decides how. A door-keyed rule would have hidden the control that governs them.
 *
 * So the subject of `workers` is *a workload in this run*, which is `D1082` read correctly, and it
 * is construct-keyed rather than door-keyed — `M223` `F`'s own lesson, which the plan reached for
 * and then keyed on the wrong thing.
 *
 * **The narrowing is the same three-way fork the button's label uses**, in the same order, because
 * a strip whose controls and whose label disagreed about what is about to run would be two answers
 * to one question — the thing this strip exists to prevent.
 *
 * **A file that did not parse is INCLUDED here, and `countByDoor` excludes it.** The two are asking
 * different questions and the honest answers differ: *how many tests are behind this door* has no
 * answer for a file whose recovery dropped an unknown number, while *could this run contain a
 * workload* has a safe direction — `D1076`, over-offering beats silent omission. A control drawn
 * for a workload that turns out not to exist is visible and harmless; one hidden from a workload
 * that does is `M216-01` with the sign flipped.
 */
export function lensesInRun(project: ProjectView, selection: readonly string[], query: Query): ReadonlySet<Lens> {
  const out = new Set<Lens>();
  const take = (f: ProjectFile): void => {
    for (const t of f.tests) for (const lens of t.lenses) out.add(lens);
    for (const c of f.crawls) for (const lens of c.lenses) out.add(lens);
  };
  if (selection.length > 0) {
    const chosen = new Set(selection);
    for (const f of project.files) if (chosen.has(f.path)) take(f);
    return out;
  }
  if (query.kind === 'tag') {
    // `--tag` narrows to TESTS, not to files — `D1064`'s gap, and the reason this branch cannot
    // just call `matchingFiles` and take whole files the way the text branch does.
    const wanted = new Set(query.tags);
    for (const f of project.files) {
      // Tests only: a `crawl` carries no tags at all (`ProjectCrawl` has no `tags` field, because
      // the language does not let one be written), so `--tag` can never select one.
      for (const t of f.tests) if (t.tags.some((tag) => wanted.has(tag))) for (const lens of t.lenses) out.add(lens);
    }
    return out;
  }
  if (query.kind === 'text') {
    const lit = matchingFiles(project, query)!;
    for (const f of project.files) if (lit.has(f.path)) take(f);
    return out;
  }
  for (const f of project.files) take(f);
  return out;
}
