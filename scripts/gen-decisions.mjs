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
  { kind: 'tableLead', re: /^\|\s*\*{0,2}`?(D\d{1,3}[a-z]?|M\d{1,3}[a-z]?\d?)`?\*{0,2}\s*[—:-]\s/ },
  { kind: 'tableRow', re: /^\|\s*\*{0,2}`?(D\d{1,3}[a-z]?|M\d{1,3}[a-z]?\d?)`?\*{0,2}\s*\|/ },
  { kind: 'headingMid', re: /^#{1,5}\s+.*?[(`]`?(D\d{1,3}[a-z]?|M\d{1,3}[a-z]?\d?)`?[),`]/ },
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
  const stem = /^([DM])(\d{1,3})/.exec(id);
  const affine = (a) => (stem && stem[1] === 'M' && new RegExp(`^PLAN_M${stem[2]}[_.]`).test(basename(a.file)) ? 0 : 1);
  return [...anchors].sort(
    (x, y) => affine(x) - affine(y) || RANK[x.kind] - RANK[y.kind] || x.file.localeCompare(y.file) || x.line - y.line,
  )[0];
}

// ---------------------------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------------------------

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
    let i = start + 1;
    while (i < lines.length && lines[i].trim() === '') i++;
    let j = i;
    while (j < lines.length && lines[j].trim() !== '' && !/^#{1,6}\s/.test(lines[j])) j++;
    // The heading line is demoted to bold: the identifier is already this entry's own heading, and
    // a second `#` inside an entry would put fake structure in the published document's outline.
    const title = lines[start].replace(/^#{1,6}\s+/, '').replace(/\s*[✅🔧🔮⏸]+\s*$/u, '').trim();
    body = [`**${title}**`, '', ...lines.slice(i, j)].join('\n');
  } else if (anchor.kind === 'progressTable' || anchor.kind === 'tableRow' || anchor.kind === 'tableLead') {
    body = lines[start];
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
    let j = start + 1;
    while (j < lines.length && lines[j].trim() !== '') j++;
    body = lines.slice(start, j).join('\n');
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
 * One entry. The provenance line names the record and the line the block was lifted from — not so a
 * reader can open it (they cannot; that is the whole premise) but so that a wrong pick is visible
 * during the proofing pass instead of having to be inferred from the text reading oddly (D682).
 */
export function renderEntry(id, entry) {
  const cites = entry.sites.slice(0, 3).map((s) => `${s.file}:${s.line}`);
  const more = entry.sites.length > cites.length ? ` +${entry.sites.length - cites.length} more` : '';
  const where = entry.sites.length ? `cited from ${cites.join(', ')}${more}` : 'cited inside a range only';
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
publishable-bundle decision; \`D43\` is a browser-arc concurrency probe. Older prose sometimes wrote
\`P#43\` as "PLAN decision 43"; that spelling is gone, and \`P#n\` is the only one. The prefix reads
as *principle* over a list that is mostly decisions, which is a wart — it is kept because it was
already the spelling in 130 places and churning those to fix a letter would have been the larger
change.

A milestone entry is a one-line statement of what it shipped. A decision entry is the decision
itself, at whatever length it was taken.

<sub>Generated by \`scripts/gen-decisions.mjs\`. Do not edit between the markers.</sub>
`;

/** @returns {{path: string, text: string}[]} */
function readRecords(root) {
  const names = readdirSync(root).filter((f) => /^PLAN.*\.md$/.test(f) || f === 'PROGRESS.md' || f === 'REVIEW_FINDINGS.md');
  return names
    .filter((f) => !/^PLAN_M152_DECISION_PROVENANCE\.md$/.test(f))
    .sort()
    .map((f) => ({ path: f, text: readFileSync(join(root, f), 'utf8') }));
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
      entries.set(id, { ...meta, from: `PLAN.md`, body });
      continue;
    }
    const found = anchors.get(id);
    if (!found?.length) { unresolved.push(id); continue; }
    const a = pickAnchor(id, found);
    entries.set(id, { ...meta, from: `${a.file}:${a.line}`, body: extractBlock(byPath.get(a.file), a) });
  }
  return { entries, unresolved, cited };
}

export function render(entries) {
  const body = [...entries.entries()].map(([id, e]) => renderEntry(id, e)).join('\n');
  return `${PREAMBLE}\n${START}\n\n${body}\n${END}\n`;
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
  const tracked = readTracked(ROOT);
  const outPath = join(ROOT, OUTPUT);

  const haveRecords = existsSync(join(ROOT, 'PLAN.md'));
  const citedIds = new Set([...collectCitations(tracked).keys()]);

  if (!checking) {
    if (!haveRecords) {
      console.error(`✗ cannot generate ${OUTPUT}: the design records are not in this tree.\n` +
        `  They are gitignored by design (D668). Generation runs where they exist; CI verifies the\n` +
        `  half that does not need them (D683).`);
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
