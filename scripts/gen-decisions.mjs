#!/usr/bin/env node
// Generates `DECISIONS.md` — the public resolution target for the private notation both public
// repositories are written in (`M152`, D666-D684).
//
// The problem this exists for: `SPEC.md`, `GRAMMAR.md`, `CHANGELOG.md`, `CONTRIBUTING.md` and the
// package READMEs cite `P#43`, `D318` and `M137d` roughly 950 times. Every one of those names a
// block in a file `.gitignore` excludes (lines 33-37), so every one is a pointer a reader outside
// this working tree cannot follow, with nothing on the page to say it is dead. `M149a-02` and
// `M149b-01` described the 52 that spell a filename; the other ~900 spell an identifier instead and
// are the same defect (D666).
//
// The fix is not to delete the citations and not to publish the records. It is to lift the cited
// blocks — verbatim, never summarised (D668) — into one tracked document the citations can point
// at. Nothing here paraphrases: if an extracted block does not stand alone out of context, the fix
// is written into the private record and this is re-run (D669), so the published text and the
// design record can never say different things.
//
// Three properties are checked, in two tiers, because the extraction source does not exist on a CI
// runner (D683). `--check` says which tier it ran. It never prints a bare green for a tier it
// skipped, which is the whole reason this ledger's `D527` exists.

import { readFileSync, writeFileSync, existsSync, readdirSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname, basename } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUTPUT = 'DECISIONS.md';

// ---------------------------------------------------------------------------------------------
// Citation collection — what tracked prose actually asks for
// ---------------------------------------------------------------------------------------------

/**
 * The three citation spellings. `P#n` indexes `PLAN.md`'s ordered list (D671); `D<n>` is the modern
 * decision sequence; `M<n>` is a milestone. `(?<![\w#])` keeps `#D12` and `xM4` out, and the `#` in
 * particular stops `P#43` being re-read as a bare `43`.
 */
export const CITATION = /(?<![\w#])(D\d{1,3}[a-z]?|M\d{1,3}[a-z]?\d?|P#\d{1,3}[a-z]?)\b/g;

/**
 * A range citation cites its interior (D681). `SPEC.md` writes `D93-D122` and `CHANGELOG.md` writes
 * `M9–M28`; a reader who follows either wants the thirty entries between the endpoints, not the two
 * ends. Measured at the baseline: 52 ranges implying 220 interior identifiers, 92 of them cited
 * nowhere else. An index that resolved only the endpoints would answer two thirtieths of that
 * question and report itself complete.
 */
export const RANGE = /(?<![\w#])([DM])(\d{1,3})[a-z]?\s*[-–—]\s*(?:[DM])?(\d{1,3})[a-z]?\b/g;

/**
 * Fences whose info string marks them as tflw's own output, reproduced verbatim. A citation inside
 * one is not a citation — `# emitted by tflw M137d — sec/error-detail-disclosure` is a line tflw
 * prints, quoted so a reader can recognise it (D673). Two exist today, both in the docs site.
 *
 * Every *other* fence counts, and that distinction is load-bearing: 89 of `GRAMMAR.md`'s citations
 * live in comments inside its untagged EBNF fences (`# D105-D107, §4.5`). Those are authored prose
 * addressed to a reader, and a blanket fence exclusion would have dropped them — 99 citations
 * silently, in the milestone whose subject is citations nobody can follow.
 */
export const PRODUCT_FENCE_INFO = new Set(['tflw', 'console']);

/** @param {string} text @returns {{line: number, inProductFence: boolean, text: string}[]} */
export function scanLines(text) {
  const out = [];
  let fenceChar = null;
  let info = '';
  text.split('\n').forEach((raw, i) => {
    const open = /^\s*(```+|~~~+)\s*(\S*)/.exec(raw);
    if (open) {
      if (fenceChar === null) {
        fenceChar = open[1][0];
        info = (open[2] || '').toLowerCase();
      } else {
        fenceChar = null;
        info = '';
      }
      return;
    }
    out.push({ line: i + 1, inProductFence: fenceChar !== null && PRODUCT_FENCE_INFO.has(info), text: raw });
  });
  return out;
}

/**
 * Every identifier tracked prose cites, with where. `DECISIONS.md` itself is excluded — it is the
 * answer, not a question, and counting its own headings as citations would let it satisfy D675's
 * conformance gate by existing.
 *
 * @param {{path: string, text: string}[]} files
 * @returns {Map<string, {sites: {file: string, line: number}[], viaRange: boolean}>}
 */
export function collectCitations(files) {
  /** @type {Map<string, {sites: {file: string, line: number}[], viaRange: boolean}>} */
  const cited = new Map();
  const note = (id, site, viaRange) => {
    const e = cited.get(id) ?? { sites: [], viaRange: true };
    if (site) e.sites.push(site);
    if (!viaRange) e.viaRange = false;
    cited.set(id, e);
  };
  for (const { path, text } of files) {
    if (path === OUTPUT) continue;
    for (const { line, inProductFence, text: ln } of scanLines(text)) {
      if (inProductFence) continue;
      for (const m of ln.matchAll(CITATION)) note(m[1], { file: path, line }, false);
      for (const m of ln.matchAll(RANGE)) {
        const [, kind, a, b] = m;
        if (Number(b) <= Number(a)) continue;
        for (let n = Number(a) + 1; n < Number(b); n++) note(`${kind}${n}`, null, true);
      }
    }
  }
  return cited;
}

// ---------------------------------------------------------------------------------------------
// Anchors — where the private records define an identifier
// ---------------------------------------------------------------------------------------------

/**
 * `PLAN_DOCS_REFRESH.md` numbers its own milestones `M1`-`M6` and `PLAN_CODE_THEME.md` numbers its
 * own `M1`-`M5`. Neither is the global sequence: `PLAN_LOG.md:53` names them `DR-M1-M6` and
 * `CT-M1-M5` precisely because they collide. `SPEC.md`'s `M1` is the API vertical slice
 * (`PLAN.md:2150`), and an extractor that took the nearest heading would have published "Full-site
 * content & messaging audit" as its meaning — a confident falsehood, which is worse than the dead
 * pointer it replaced (R1). These files are not sources for a bare `M<n>`.
 */
export const LOCAL_M_NAMESPACE = new Set(['PLAN_DOCS_REFRESH.md', 'PLAN_CODE_THEME.md', 'PLAN_BRAND_MARK.md']);

/**
 * The seven forms a private record uses to define an identifier. Ordered by how strongly each says
 * "this block *is* the definition" rather than "this block mentions it" — `pickAnchor` reads the
 * order as precedence (D682).
 *
 * `roadmap` is first and applies only to `PLAN.md`: its `- **M1 — API vertical slice.**` list is
 * where the global milestone sequence is actually defined, and nothing else defines it at all.
 *
 * `decisionsTaken` is last-written but not weakest — `**Decisions taken:** \`D647\` — …` is the only
 * anchor `D647` has anywhere, which is why `§1.8`'s "265 of 266" was a property of that
 * measurement's pattern set and not of the records (D684).
 */
const ANCHORS = [
  { kind: 'roadmap', only: 'PLAN.md', re: /^\s*[-*]\s+\*\*`?(M\d{1,3}[a-z]?\d?)`?\s*[—:-]/ },
  // `PLAN.md`'s ordered list sometimes titles an item with the milestone it covers —
  // `109. **M15 — Docs site polish…**`. So `P#109` and `M15` name the same block, in the two
  // namespaces at once: the collision of §1.2 seen from the inside.
  { kind: 'roadmapTitle', only: 'PLAN.md', re: /^\d{1,3}\.\s+\*\*`?(M\d{1,3}[a-z]?\d?)`?\s*[—:-]/ },
  { kind: 'h1', re: /^#\s+.*?`?(D\d{1,3}[a-z]?|M\d{1,3}[a-z]?\d?)`?\s*[—:-]/ },
  { kind: 'heading', re: /^#{1,5}\s+(?:\d+\.\s*)?`?(D\d{1,3}[a-z]?|M\d{1,3}[a-z]?\d?)`?\s*[—.:-]/ },
  // `## M50 shipped 2026-08-02 — collapse `scenario` into `test``: a heading whose id is followed by
  // a word rather than a dash. It has to outrank `headingMid`, because that same line ends
  // `(D127, PLAN_DISCOVERY_EXCLUDE.md)` and a weaker rule reading the parenthetical first would
  // resolve the heading to the decision it *cites* instead of the milestone it *is*.
  { kind: 'headingLoose', re: /^#{1,5}\s+`?(M\d{1,3}[a-z]?\d?)`?\s+\w/ },
  { kind: 'boldLead', re: /^\*\*`?(D\d{1,3}[a-z]?|M\d{1,3}[a-z]?\d?)`?\s*[—.:-]/ },
  { kind: 'decisionsTaken', re: /^\*\*Decisions? taken:?\*\*\s*`?(D\d{1,3}[a-z]?)`?\s*[—-]/ },
  { kind: 'listBold', re: /^\s*[-*]\s+\*\*`?(D\d{1,3}[a-z]?|M\d{1,3}[a-z]?\d?)`?\*{0,2}\s*[—.:-]/ },
  // `PROGRESS.md`'s commit table: `| `b017c9b` | **M71** — … |`, and its milestone status table:
  // `| M20 — test-coverage audit follow-up: … | ✅ | … |`. Both are already one-sentence statements
  // of what a milestone shipped, written when it shipped — which is the shape `D670` wants, found
  // rather than reconstructed.
  { kind: 'progressTable', re: /^\|\s*`?[0-9a-f]{6,10}`?\s*\|\s*\*{0,2}`?(M\d{1,3}[a-z]?\d?)`?\*{0,2}\s*[—-]/ },
  // A heading naming an id parenthetically — `### 1.1 Driver boundary (D5)` — is the section that
  // *takes* the decision under `PLAN_BROWSER_PERF_SECURITY.md`'s own numbering, and it outranks the
  // two generic table kinds: a cell in a scope or index table only *names* an id, and letting a name
  // beat a definition sent `D5`, `D6`, `D9`, `D14` and 30 others to a row of this milestone's own
  // proofing list the moment that list was written.
  //
  // It stays **below** `progressTable`, and that boundary was measured rather than guessed:
  // `progressTable` requires a commit sha in the first cell, so it is `PROGRESS.md` recording what
  // shipped — a written statement, which is what `D670` wants. Ranking the heading above it moved
  // `M69` to a *plan* heading mentioning it in passing and `M77` to a review cluster's title, both
  // of which are about the milestone rather than the milestone's own account of itself. And it stays
  // below `boldLead`, which is what keeps `M50`'s `### M50 shipped … (D127, …)` from resolving
  // `D127` to the milestone that cites it.
  { kind: 'headingMid', re: /^#{1,5}\s+.*?[(`]`?(D\d{1,3}[a-z]?|M\d{1,3}[a-z]?\d?)`?[),`]/ },
  { kind: 'tableLead', re: /^\|\s*\*{0,2}`?(D\d{1,3}[a-z]?|M\d{1,3}[a-z]?\d?)`?\*{0,2}\s*[—:-]\s/ },
  { kind: 'tableRow', re: /^\|\s*\*{0,2}`?(D\d{1,3}[a-z]?|M\d{1,3}[a-z]?\d?)`?\*{0,2}\s*\|/ },
];
const RANK = Object.fromEntries(ANCHORS.map((a, i) => [a.kind, i]));

/**
 * @param {{path: string, text: string}[]} records
 * @returns {Map<string, {file: string, line: number, kind: string, headingLevel: number}[]>}
 */
export function collectAnchors(records) {
  /** @type {Map<string, any[]>} */
  const found = new Map();
  for (const { path, text } of records) {
    const name = basename(path);
    const lines = text.split('\n');
    lines.forEach((ln, i) => {
      for (const a of ANCHORS) {
        if (a.only && name !== a.only) continue;
        const m = a.re.exec(ln);
        if (!m) continue;
        const id = m[1];
        if (id[0] === 'M' && LOCAL_M_NAMESPACE.has(name)) continue;
        const level = /^(#{1,6})\s/.exec(ln)?.[1].length ?? 0;
        const list = found.get(id) ?? [];
        list.push({ file: path, line: i + 1, kind: a.kind, headingLevel: level });
        found.set(id, list);
        break;
      }
    });
  }
  return found;
}

/**
 * Overrides for identifiers whose defining block precedence picks wrong (D682). Each carries the
 * reason, because an override with no reason is indistinguishable from a mistake nobody caught.
 *
 * This map selects *which* block is published. It never says what a block contains — that stays in
 * the private record, which is what keeps D669 true and `--check` meaningful.
 *
 * @type {Record<string, {file: string, why: string}>}
 */
export const PICK = {};

/**
 * Which record defines an identifier, when several anchor it. 92 of the cited identifiers are
 * anchored in more than one file — typically the plan that took the decision and `PROGRESS.md`'s
 * log of it, which restates it in the past tense.
 *
 * Filename affinity outranks form: `PLAN_M137_PENTEST_TIER4.md` is where `M137d` is decided, and a
 * `### \`M137d\`` heading in a *later* plan reviewing it is a citation wearing a heading.
 */
export function pickAnchor(id, anchors) {
  if (PICK[id]) {
    const forced = anchors.find((a) => basename(a.file) === PICK[id].file);
    if (forced) return forced;
  }
  // Affinity is two-tier, because the letter is part of the milestone's name and not decoration.
  // `M130b` has its own record, `PLAN_M130B_AUTHZ_ENGINE.md`, and a number-only rule could not see
  // it: after `PLAN_M130` comes `B`, not a separator, so the file scored as unrelated and `M130b`
  // was lifted from a caption inside its *parent* plan instead — a title over four numbered items,
  // published without them. The suffixed filename is tried first and the number-only one second.
  const stem = /^([DM])(\d{1,3})([a-z]?)/.exec(id);
  const affine = (a) => {
    if (!stem || stem[1] !== 'M') return 2;
    const file = basename(a.file);
    if (stem[3] && new RegExp(`^PLAN_M${stem[2]}${stem[3].toUpperCase()}[_.]`).test(file)) return 0;
    return new RegExp(`^PLAN_M${stem[2]}[_.]`).test(file) ? 1 : 2;
  };
  return [...anchors].sort(
    (x, y) => affine(x) - affine(y) || RANK[x.kind] - RANK[y.kind] || x.file.localeCompare(y.file) || x.line - y.line,
  )[0];
}

// ---------------------------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------------------------

/**
 * One block from `start`: everything up to the next blank line or heading, except that blank lines
 * inside a fenced code block are content. Ending a block at the first blank line inside a fence cut
 * the fence open, and an unterminated fence in a generated file renders every entry after it as
 * code (`D314`, `D330`).
 *
 * @param {string[]} lines @param {number} start @returns {number} the line after the block
 */
function takeBlock(lines, start) {
  let j = start;
  let fence = null;
  while (j < lines.length) {
    const f = /^\s*(```+|~~~+)/.exec(lines[j]);
    if (fence) {
      if (f && f[1].startsWith(fence)) fence = null;
      j++;
      continue;
    }
    if (f) { fence = f[1]; j++; continue; }
    if (lines[j].trim() === '' || /^#{1,6}\s/.test(lines[j])) break;
    j++;
  }
  return j;
}

/**
 * Is the paragraph beginning at `i` nothing but HTML comments?
 *
 * `plan:closes` and `plan:closes-at` are `verify-ledger.mjs`'s markers (`D610`) and they live in the
 * record because a script reads them there. They are addressed to that script and to nobody else, so
 * they are stepped over when the statement is located rather than published as one.
 *
 * Whole lines only, and the whole paragraph: a comment that shares a line with prose is part of that
 * prose's bytes, and `D668` does not let the extractor edit a line it publishes.
 *
 * @param {string[]} lines @param {number} i @returns {boolean}
 */
function isCommentOnly(lines, i) {
  const block = lines.slice(i, takeBlock(lines, i));
  return block.length > 0 && block.every((ln) => /^\s*<!--.*-->\s*$/.test(ln));
}

/**
 * A top-level list marker. Indented markers are continuations of the item above and are matched by
 * the indent rule instead, so this is deliberately anchored at column zero.
 */
const LIST_ITEM = /^([-*+]|\d+[.)])\s/;

/**
 * The enumeration beginning at `k`, or `-1` if what begins there is not one.
 *
 * A table or a fence is one block. A **list is not**: a loose list puts a blank line between its
 * items, and `takeBlock` stops at the first of them. `D293` and `D317` are both loose, so a
 * blank-line rule would have published item 1 and the opening two lines of item 2, cut off at its
 * own colon — a truncated list is worse than the teaser it replaced, because it looks complete. A
 * list therefore runs until a line that is neither blank, nor a marker, nor indented under one.
 *
 * @param {string[]} lines @param {number} k @returns {number} the line after it, or -1
 */
function takeEnumeration(lines, k) {
  const first = lines[k] ?? '';
  if (/^\s*(```+|~~~+)/.test(first) || /^\s*\|/.test(first)) return takeBlock(lines, k);
  if (!LIST_ITEM.test(first)) return -1;
  let j = k;
  let end = k;
  while (j < lines.length) {
    if (/^#{1,6}\s/.test(lines[j])) break;
    if (lines[j].trim() === '') { j++; continue; }
    if (!LIST_ITEM.test(lines[j]) && !/^\s/.test(lines[j])) break;
    j = takeBlock(lines, j);
    end = j;
  }
  return end;
}

/**
 * The statement. One block, except in the two places where a block ends mid-thought.
 *
 * A **fence** is an illustration and never a statement on its own, so the sentence after it is
 * taken too.
 *
 * A **colon** ends a sentence whose object is the block below it. `Three clauses:` with the three
 * clauses withheld is not the statement, it is the statement with its object removed — and the
 * object is already in the record, one blank line down, in the record's own bytes. So the
 * enumeration a colon introduces is taken: a list, a table, or a fence.
 *
 * A **paragraph** after a colon is not taken, and that is the whole of the narrowing. Extending
 * across a colon was tried once before and reverted, because the blanket form pulled in whatever
 * came next and `M54` grew to 3.6 KB of progress log. The distinction that survives the revert is
 * grammatical rather than dimensional: an enumeration is what the sentence promised, a paragraph is
 * the next thought. Where an enumeration really is the section — `M54` again — the colon comes out
 * of the record instead, which is where `D669` puts that repair.
 *
 * One step only. `D293`'s list ends on a colon of its own, introducing a fence nested inside it;
 * chaining would walk the whole section an item at a time.
 *
 * @param {string[]} lines @param {number} i @returns {number} the line after the statement
 */
function takeStatement(lines, i) {
  let j = takeBlock(lines, i);
  if (/^\s*(```+|~~~+)/.test(lines[i] ?? '')) {
    const k = skipBlank(lines, j);
    if (k >= lines.length || /^#{1,6}\s/.test(lines[k])) return j;
    j = takeBlock(lines, k);
  }
  if (!(lines[j - 1] ?? '').trimEnd().endsWith(':')) return j;
  const k = skipBlank(lines, j);
  if (k >= lines.length || /^#{1,6}\s/.test(lines[k])) return j;
  const end = takeEnumeration(lines, k);
  return end > k ? end : j;
}

/** @param {string[]} lines @param {number} j @returns {number} the next line that is not blank */
function skipBlank(lines, j) {
  let k = j;
  while (k < lines.length && lines[k].trim() === '') k++;
  return k;
}

/**
 * The block an anchor names. A heading takes everything down to the next heading of the same or a
 * higher level; every other form takes its own paragraph. Nothing is reflowed, reworded or joined:
 * the output is the record's own bytes, which is the property that makes the index trustworthy
 * without anyone having to trust the extractor's judgement (D668).
 *
 * @param {string} text @param {{line: number, kind: string, headingLevel: number}} anchor
 */
export function extractBlock(text, anchor) {
  const lines = text.split('\n');
  const start = anchor.line - 1;
  let body;
  if (anchor.headingLevel > 0) {
    // A heading's *section* is not its statement. `PLAN_M13_LSP.md`'s `# M13` section is 37 KB of
    // task tables, verification steps and review notes; publishing it would be the mistake `D670`
    // names for milestones, arriving through decisions instead. Take the heading and the paragraph
    // under it: the heading carries the title, the first paragraph carries what was decided, and
    // everything after it is how the work went.
    //
    // "The paragraph under it" is `takeStatement`'s job, not a blank-line scan's: a fence and a
    // colon both end a block mid-thought.
    //
    // A comment-only paragraph is stepped over rather than taken. Four plans open with
    // `<!-- plan:closes-at M128c -->` directly under the title — `verify-ledger.mjs`'s marker, which
    // it reads from anywhere in the file and which by convention sits at the top. It is a paragraph
    // by every blank-line rule, so it was winning the statement slot and the four entries published
    // a title, a marker addressed to a script, and none of the opening paragraph sitting right
    // below it. The marker has to stay in the record; it just is not what anybody asked this file
    // for.
    let i = start + 1;
    while (i < lines.length && (lines[i].trim() === '' || isCommentOnly(lines, i))) {
      i = lines[i].trim() === '' ? i + 1 : takeBlock(lines, i);
    }
    const j = takeStatement(lines, i);
    // The heading line is demoted to bold: the identifier is already this entry's own heading, and
    // a second `#` inside an entry would put fake structure in the published document's outline.
    //
    // Emphasis *inside* the heading is dropped rather than carried, because bold does not nest: 38
    // headings emphasise a word against the rest of the title, and wrapping one produced
    // `**a — **b** c**`, which renders as bold "a — ", plain "b", and a literal `c**`. The contrast
    // that emphasis drew has no meaning once the whole line is bold anyway.
    //
    // The section number goes with it, for the same reason. 33 headings open with the record's own
    // numbering — `### 1.1 Driver boundary (D5)`, `## 3. M98b — …` — which addresses a table of
    // contents the reader of this file does not have. It is not even unique across the corpus:
    // `M98b` is section 3 of one plan and `M99b` is section 3 of another, so published side by side
    // the numbers read as a contradiction rather than as a location.
    const title = lines[start]
      .replace(/^#{1,6}\s+/, '')
      .replace(/^\d+(?:\.\d+)*\.?\s+/, '')
      .replace(/\s*[✅🔧🔮⏸]+\s*$/u, '')
      .replace(/\*\*/g, '')
      .trim();
    body = [`**${title}**`, '', ...lines.slice(i, j)].join('\n');
  } else if (anchor.kind === 'progressTable' || anchor.kind === 'tableRow' || anchor.kind === 'tableLead') {
    // A row, with the header it is a row of. On its own a `| a | b |` line is not a table to any
    // markdown renderer — no delimiter row, so it renders as literal pipes, which is how 45 entries
    // published a milestone as `| M18 — … | ✅ | 2026-07-23 | 2026-07-23 |`. Walking up to the
    // delimiter and taking the header above it costs two lines of the record's own bytes and makes
    // the row render as what it is, with its columns named instead of guessed at.
    let head = start;
    while (head > 0 && /^\s*\|/.test(lines[head - 1])) head--;
    const delim = lines.slice(head, start).findIndex((ln) => /^\s*\|[\s|:-]+\|\s*$/.test(ln));
    body = delim >= 0 ? [...lines.slice(head, head + delim + 1), lines[start]].join('\n') : lines[start];
  } else if (/^\s*[-*]\s/.test(lines[start])) {
    // A list item ends at its next sibling, not at the next blank line. `PLAN.md`'s milestone
    // roadmap is one unbroken list, so a blank-line rule read `M1`'s entry as everything from the
    // API vertical slice to the end of the roadmap — 20 KB, and the same 20 KB again under `M2`.
    const indent = /^(\s*)/.exec(lines[start])[1].length;
    let j = start + 1;
    while (j < lines.length) {
      const item = /^(\s*)[-*]\s/.exec(lines[j]);
      if (item && item[1].length <= indent) break;
      if (/^#{1,6}\s/.test(lines[j])) break;
      if (lines[j].trim() === '' && (j + 1 >= lines.length || !/^\s+\S/.test(lines[j + 1]))) break;
      j++;
    }
    body = lines.slice(start, j).join('\n');
  } else {
    // A bold lead or a numbered roadmap item: its own block, and the sentence after it when that
    // block is a fence.
    body = lines.slice(start, takeStatement(lines, start)).join('\n');
  }
  return body.replace(/\s+$/, '');
}

// ---------------------------------------------------------------------------------------------
// `P#n` — the legacy sequence
// ---------------------------------------------------------------------------------------------

/**
 * `P#n` indexes `PLAN.md`'s ordered markdown list, which runs 1-114 with 95, 97 and 98 unused. It
 * is not a scheme anyone invented for this milestone: it already appears 130 times across `SPEC.md`
 * and `GRAMMAR.md`, and `P#43` and `PLAN decision 43` are the same item spelled two ways (D671).
 *
 * `P#99b` is the one suffixed citation — item 99 has lettered sub-features, and `**(b) …**` is its
 * anchor. `M99b` is a different thing entirely, in the other namespace, which is the collision this
 * milestone exists to stop being invisible.
 *
 * @param {string} planText @returns {Map<string, string>}
 */
export function collectLegacy(planText) {
  const lines = planText.split('\n');
  /** @type {Map<string, {start: number, end: number}>} */
  const spans = new Map();
  let open = null;
  lines.forEach((ln, i) => {
    // A section heading ends the item above it. The list is interrupted by `### Round N` headings
    // marking the sessions the decisions were taken in, and a span that ran only to the *next
    // numbered item* carried the heading along with it — putting five headings named after dates
    // into the published outline, each looking like an entry with no body.
    if (/^#{1,6}\s/.test(ln)) {
      if (open) spans.get(open).end = i;
      open = null;
      return;
    }
    const m = /^(\d{1,3})\.\s+\S/.exec(ln);
    if (!m) return;
    if (open) spans.get(open).end = i;
    open = m[1];
    spans.set(open, { start: i, end: lines.length });
  });
  const out = new Map();
  for (const [n, { start, end }] of spans) {
    const body = lines.slice(start, end);
    out.set(n, body.join('\n').replace(/\s+$/, ''));
    for (const [j, ln] of body.entries()) {
      const sub = /^\s*\*\*\(([a-z])\)\s/.exec(ln);
      if (!sub) continue;
      let k = j + 1;
      while (k < body.length && body[k].trim() !== '') k++;
      out.set(`${n}${sub[1]}`, body.slice(j, k).join('\n').replace(/\s+$/, ''));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The scrub gate (D676)
// ---------------------------------------------------------------------------------------------

/**
 * What must never reach a public commit, failing on the containers' measured contents rather than
 * on someone having read it. `§1.7` scanned all 66 records: no keys and no real credentials, but
 * one personal email that is not this repository's, and 42 mentions of the internal build host.
 * A public commit is irreversible, so this is a gate and not a review step.
 *
 * The email pattern allows the repo's own address — it appears legitimately in `CONTRIBUTING.md`
 * and in git trailers, and a rule that fired on it would be turned off within a week.
 */
export const SCRUB = [
  { name: 'a personal email that is not this repository\'s', re: /\b[\w.+-]+@(?!tflw\.dev\b)[\w-]+\.[\w.]{2,}\b/g, allow: /@example\.(com|org)\b|@tflw\.dev\b/ },
  { name: 'the internal build host', re: /\bfedora[-.]?(?:box|local)\b/gi },
  { name: 'an absolute home path', re: /\/(?:Users|home)\/[a-z][\w.-]*\//gi },
];

/** @param {string} text @returns {{name: string, hit: string, line: number}[]} */
export function scrub(text) {
  const out = [];
  text.split('\n').forEach((ln, i) => {
    for (const rule of SCRUB) {
      for (const m of ln.matchAll(rule.re)) {
        if (rule.allow && rule.allow.test(m[0])) continue;
        out.push({ name: rule.name, hit: m[0], line: i + 1 });
      }
    }
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------

const START = '<!-- GENERATED:decisions:start -->';
const END = '<!-- GENERATED:decisions:end -->';

const sortKey = (id) => {
  const m = /^(P#|D|M)(\d+)([a-z]?)(\d?)$/.exec(id);
  return m ? [{ 'P#': 0, D: 1, M: 2 }[m[1]], Number(m[2]), m[3], m[4]] : [9, 0, '', ''];
};
export const byId = (a, b) => {
  const x = sortKey(a), y = sortKey(b);
  return x[0] - y[0] || x[1] - y[1] || String(x[2]).localeCompare(String(y[2])) || String(x[3]).localeCompare(String(y[3]));
};

/**
 * One entry. The provenance line names files — which tracked prose cites the identifier, and which
 * record the block was lifted from — and deliberately not the lines within them (D686). A line
 * number made this tracked file churn every time an *untracked* one was edited, which is every
 * milestone: 386 of 439 entries moved for reasons no reader of the diff could see. The line-level
 * detail a proofing pass needs is served better by `--provenance`, which is not published and can
 * therefore also show the anchors that lost the ranking (D682).
 */
export function renderEntry(id, entry) {
  const files = [...new Set(entry.sites.map((s) => s.file))];
  const cites = files.slice(0, 3);
  const more = files.length > cites.length ? ` +${files.length - cites.length} more` : '';
  const where = files.length ? `cited from ${cites.join(', ')}${more}` : 'cited inside a range only';
  return [
    `### ${id}`, '',
    `<sub>${where} · lifted from \`${entry.from}\`</sub>`, '',
    entry.body, '',
  ].join('\n');
}

/** The document's own prose. Written here, not in `DECISIONS.md`, because the file is generated. */
export const PREAMBLE = `# Decisions and milestones

tflw is built against a design record — plan documents, a progress log and a review ledger — that is
not in this repository. That is deliberate: the records carry working notes, host names and a
personal address, and none of that belongs in a public commit. But the code, \`SPEC.md\`,
\`GRAMMAR.md\`, \`CHANGELOG.md\` and the READMEs cite them constantly, in a notation that was only
ever addressed to someone who had them open.

This file is the resolution target for that notation. Every identifier cited anywhere in tracked
prose has an entry below, **lifted verbatim** from the record that defines it. Nothing here is a
summary: if a block reads oddly out of context the fix is written into the record and this file is
regenerated, so the two can never say different things.

## The notation

| spelling | means |
| --- | --- |
| \`P#43\` | item 43 of the original plan's numbered list — the language's founding decisions |
| \`D318\` | decision 318 of the later sequence, which runs past 665 |
| \`M137d\` | a milestone: a slice of work that shipped as one pull request |

**\`P#n\` and \`D<n>\` are different sequences that collide on the number.** \`P#43\` is the
publishable-bundle decision; \`D43\` is a browser-arc concurrency probe. The prefix reads as
*principle* over a list that is mostly decisions, which is a wart — it is kept because it was
already the spelling in 130 places and churning those to fix a letter would have been the larger
change.

A milestone entry is a one-line statement of what it shipped. A decision entry is the decision
itself, at whatever length it was taken.

## Citations inside an entry

Entries are lifted verbatim, so they cite each other in whatever spelling the record used at the
time. Three of those spellings are not the ones above, and one names a sequence this file does not
index.

| in an entry | means |
| --- | --- |
| \`decision 43\`, \`#43\` | \`P#43\` — the founding list, in the two spellings that predate \`P#n\` |
| \`enterprise decision 3a\` | item 3a of the enterprise arc's own list, which has no entries here |
| \`gap #9\` | an item of a backlog file that no longer exists in any form |

**Read the sentence, not the number.** The founding list runs to 112 and the enterprise list to 22,
so a bare \`decision n\` at or below 22 does not say which one it means. Eleven citations sit in that
band and four of them mean the enterprise list — \`M12\`'s "decision 16" is the docs-site cluster, and
\`P#16\` above it is soft assertions. Every one of the four is recoverable from the sentence around
it, which is also why no rule keyed on the digits can be trusted to do it for you.

Not every \`#n\` is a citation at all: \`D147\`, \`M92\` and \`M148\` number pull requests with it, and
\`M130\` numbers an OWASP category.

<sub>Generated by \`scripts/gen-decisions.mjs\`. Do not edit between the markers.</sub>
`;

/**
 * Every design record, this milestone's own included. It was briefly excluded — an unexplained
 * filter, which made `D666`-`D686` the one family of decisions that could not be cited from tracked
 * prose, in the generator built so that every citation resolves. Records are anchor *sources*, not
 * citation surfaces, so a plan discussing the notation contributes its own headings and nothing
 * else.
 *
 * @returns {{path: string, text: string}[]}
 */
function readRecords(root) {
  const names = readdirSync(root).filter((f) => /^PLAN.*\.md$/.test(f) || f === 'PROGRESS.md' || f === 'REVIEW_FINDINGS.md');
  return names.sort().map((f) => ({ path: f, text: readFileSync(join(root, f), 'utf8') }));
}

/**
 * The tracked markdown, which is the question this index answers. Read through `git ls-files`
 * rather than a directory walk, because "tracked" is the whole point: an untracked scratch file is
 * not a surface anyone reads, and the records themselves are excluded precisely by being untracked.
 *
 * A tree with no `.git` therefore cannot be checked here at all, and this says so instead of
 * dying in a stack trace. It is a real configuration: `scripts/exec.mjs` rsyncs this repo to the
 * box **without** `.git/`, so the gate cannot run through the offload driver the way the suite and
 * the typecheck can. It fails rather than skipping — a check that cannot see its input is not a
 * check that passed (`M131-03`).
 *
 * @returns {{path: string, text: string}[]}
 */
function readTracked(root) {
  let out;
  try {
    out = execFileSync('git', ['ls-files', '*.md'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const why = String(e.stderr ?? e.message).trim().split('\n')[0];
    throw new Error(
      `cannot list the tracked files: ${why}\n` +
      `  This gate compares tracked prose against ${OUTPUT}, so it needs the index to know which\n` +
      `  files are tracked. A tree with no \`.git\` cannot answer that — \`scripts/exec.mjs\` syncs\n` +
      `  the box copy without it, so run this one here rather than through the offload driver.`,
    );
  }
  return out
    .split('\n')
    .filter(Boolean)
    .map((p) => ({ path: p, text: readFileSync(join(root, p), 'utf8') }));
}

/**
 * Builds every entry the tracked prose asks for. Returns the unresolved ones rather than throwing:
 * an identifier with no anchor is a finding about the records, and the caller decides whether that
 * is a build failure or a line in a report.
 */
export function build(records, tracked) {
  const cited = collectCitations(tracked);
  const anchors = collectAnchors(records);
  const legacy = collectLegacy(records.find((r) => r.path === 'PLAN.md')?.text ?? '');
  const byPath = new Map(records.map((r) => [r.path, r.text]));

  const entries = new Map();
  const unresolved = [];
  for (const [id, meta] of [...cited.entries()].sort((a, b) => byId(a[0], b[0]))) {
    if (id.startsWith('P#')) {
      const body = legacy.get(id.slice(2));
      if (!body) { unresolved.push(id); continue; }
      entries.set(id, { ...meta, from: 'PLAN.md', anchor: null, candidates: [], body });
      continue;
    }
    const found = anchors.get(id);
    if (!found?.length) { unresolved.push(id); continue; }
    const a = pickAnchor(id, found);
    entries.set(id, { ...meta, from: a.file, anchor: a, candidates: found, body: extractBlock(byPath.get(a.file), a) });
  }
  return { entries, unresolved, cited };
}

export function render(entries) {
  const body = [...entries.entries()].map(([id, e]) => renderEntry(id, e)).join('\n');
  return `${PREAMBLE}\n${START}\n\n${body}\n${END}\n`;
}

/**
 * The proofing report (D686). Everything the published provenance line used to carry, and the one
 * thing it never could: for each identifier anchored in more than one record, the anchors that
 * *lost* the precedence ranking. That is the artefact `D682`'s picks are reviewed from — 92 of them
 * took the default ranking unreviewed — and printing it on demand rather than publishing it is what
 * lets `DECISIONS.md` stop moving when a gitignored record does.
 */
export function provenance(entries) {
  const out = [];
  for (const [id, e] of entries) {
    out.push(e.anchor ? `${id}\t${e.anchor.file}:${e.anchor.line} (${e.anchor.kind})`
                      : `${id}\t${e.from} (the legacy numbered list)`);
    for (const c of (e.candidates ?? [])) {
      if (c !== e.anchor) out.push(`\t  not picked  ${c.file}:${c.line} (${c.kind})`);
    }
    if (!e.sites.length) out.push('\t  cited inside a range only');
    for (const site of e.sites) out.push(`\t  cited at    ${site.file}:${site.line}`);
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------------------------
// The two check tiers (D683)
// ---------------------------------------------------------------------------------------------

/**
 * Conformance, both directions (D675). Every cited identifier must have an entry, or the citation
 * is a link to nothing wearing a link's clothes. Every entry must be cited, or the file has become
 * an unreviewed publication surface that grows on its own.
 *
 * Both sides are tracked, so this runs on a CI runner with no access to the records.
 */
export function conformance(citedIds, publishedIds) {
  return {
    missing: [...citedIds].filter((id) => !publishedIds.has(id)).sort(byId),
    orphan: [...publishedIds].filter((id) => !citedIds.has(id)).sort(byId),
  };
}

/** Reads the ids `DECISIONS.md` actually publishes, from its own headings. */
export function publishedIds(text) {
  const inner = text.slice(text.indexOf(START), text.indexOf(END));
  return new Set([...inner.matchAll(/^### (P#\d{1,3}[a-z]?|D\d{1,3}[a-z]?|M\d{1,3}[a-z]?\d?)$/gm)].map((m) => m[1]));
}

function main() {
  const argv = process.argv.slice(2);
  const checking = argv.includes('--check');
  const reporting = argv.includes('--provenance');
  const tracked = readTracked(ROOT);
  const outPath = join(ROOT, OUTPUT);

  const haveRecords = existsSync(join(ROOT, 'PLAN.md'));
  const citedIds = new Set([...collectCitations(tracked).keys()]);
  const noRecords = (verb) =>
    `✗ cannot ${verb}: the design records are not in this tree.\n` +
    `  They are gitignored by design (D668). Generation runs where they exist; CI verifies the\n` +
    `  half that does not need them (D683).`;

  if (reporting) {
    if (!haveRecords) { console.error(noRecords(`report on ${OUTPUT}`)); return 1; }
    const { entries, unresolved } = build(readRecords(ROOT), tracked);
    console.log(provenance(entries));
    if (unresolved.length) console.error(`\n✗ ${unresolved.length} unresolved: ${unresolved.join(' ')}`);
    return unresolved.length ? 1 : 0;
  }

  if (!checking) {
    if (!haveRecords) {
      console.error(noRecords(`generate ${OUTPUT}`));
      return 1;
    }
    const { entries, unresolved } = build(readRecords(ROOT), tracked);
    writeFileSync(outPath, render(entries), 'utf8');
    const kinds = { 'P#': 0, D: 0, M: 0 };
    for (const id of entries.keys()) kinds[id.startsWith('P#') ? 'P#' : id[0]]++;
    console.log(`gen-decisions: wrote ${entries.size} entries to ${OUTPUT} — ${kinds['P#']} P#, ${kinds.D} D, ${kinds.M} M`);
    if (unresolved.length) {
      console.error(`✗ ${unresolved.length} cited identifiers have no anchor in the records and were not written:\n` +
        `    ${unresolved.join(' ')}\n` +
        `  Each is either a typo in the citing prose or a decision that was never written down.\n` +
        `  Both are findings; neither is silently omittable, because D675's gate will demand them.`);
      return 1;
    }
    return 0;
  }

  // --- tier 1: runs anywhere, because both sides are tracked ---
  if (!existsSync(outPath)) {
    console.error(`✗ ${OUTPUT} does not exist, and ${citedIds.size} citations in tracked prose point at it.`);
    return 1;
  }
  const text = readFileSync(outPath, 'utf8');
  const published = publishedIds(text);
  const { missing, orphan } = conformance(citedIds, published);
  const dirt = scrub(text.slice(text.indexOf(START)));
  let failed = false;

  if (missing.length) {
    failed = true;
    console.error(`✗ ${missing.length} identifiers are cited in tracked prose with no entry in ${OUTPUT}:\n` +
      `    ${missing.join(' ')}\n` +
      `  A reader following one of those gets nothing. Run \`npm run docs:decisions\` where the design\n` +
      `  records are, and commit the result.`);
  }
  if (orphan.length) {
    failed = true;
    console.error(`✗ ${orphan.length} entries in ${OUTPUT} are cited by nothing:\n` +
      `    ${orphan.join(' ')}\n` +
      `  The index publishes what the repository asks for and nothing else (D675). An entry no prose\n` +
      `  references is design-record text that was never reviewed for publication.`);
  }
  if (dirt.length) {
    failed = true;
    const shown = dirt.slice(0, 8).map((d) => `    line ${d.line}: ${d.name} — ${JSON.stringify(d.hit)}`);
    console.error(`✗ ${OUTPUT} carries ${dirt.length} thing(s) that must not be published:\n${shown.join('\n')}\n` +
      `  Fix the block in the design record it was lifted from, then regenerate (D669). Editing\n` +
      `  ${OUTPUT} by hand puts the leak back on the next run.`);
  }
  if (failed) return 1;

  // --- tier 2: needs the records, and says so when it cannot run ---
  if (!haveRecords) {
    console.log(
      `gen-decisions --check: ${published.size} entries, ${citedIds.size} cited identifiers — conformance and scrub pass.\n` +
      `  NOT CHECKED HERE: that each entry still matches the record it was lifted from. The design\n` +
      `  records are gitignored (D668), so no CI runner can compare them. That half is checked on a\n` +
      `  developer machine and by review — not by this run, which is why this line exists (D683).`);
    return 0;
  }
  const { entries, unresolved } = build(readRecords(ROOT), tracked);
  const want = render(entries);
  if (unresolved.length) {
    console.error(`✗ ${unresolved.length} cited identifiers have no anchor in the records: ${unresolved.join(' ')}`);
    return 1;
  }
  if (want !== text) {
    const w = want.split('\n'), h = text.split('\n');
    const first = h.findIndex((l, i) => l !== w[i]);
    console.error(`✗ ${OUTPUT} is not what the design records produce — first difference at line ${first + 1}.\n` +
      `    committed: ${JSON.stringify((h[first] ?? '').slice(0, 110))}\n` +
      `    generated: ${JSON.stringify((w[first] ?? '').slice(0, 110))}\n\n` +
      `  A generated block is not a place to edit. If the change you want is prose, it belongs in the\n` +
      `  design record the block was lifted from (D669); then run \`npm run docs:decisions\`.`);
    return 1;
  }
  console.log(`gen-decisions --check: ${published.size} entries match the design records; ${citedIds.size} cited identifiers all resolve; scrub clean.`);
  return 0;
}

// Run only when invoked directly, and compare REALPATHS. `process.argv[1]` is the path as typed;
// `import.meta.url` has already been resolved through every symlink. On macOS `/tmp` and
// `/var/folders` are symlinks to `/private/...`, so a naive `===` between the two is false for any
// invocation whose path traverses one — and this file's failure mode when the guard is false is to
// exit 0 having done nothing at all. A `--check` that silently no-ops and reports success is the
// exact false green `D527` exists to refuse, arriving in the milestone written to refuse it. Found
// by `gen-decisions.test.mjs`, whose fixtures necessarily live under `/var/folders`.
const invokedDirectly = () => {
  if (!process.argv[1]) return false;
  const self = fileURLToPath(import.meta.url);
  try {
    return realpathSync(process.argv[1]) === self;
  } catch {
    return process.argv[1] === self;
  }
};

if (invokedDirectly()) {
  try {
    process.exit(main());
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }
}
