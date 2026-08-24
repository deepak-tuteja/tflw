#!/usr/bin/env node
/**
 * The bare-citation gate (`M152b`, `D691`).
 *
 * `D666` names the defect: tracked prose cites decisions in a notation the reader cannot resolve.
 * `M152a` built the resolution target — `DECISIONS.md`, generated from the records and tracked — and
 * `D675`'s conformance gate already keeps every *canonical* citation (`P#n`, `D<n>`, `M<n>`) pointed
 * at an entry that exists. This gate closes the other half: the citations written in the older
 * spelling, `decision 57`, which name a number without saying which of the sequences it indexes.
 *
 * A bare number is worse than an unresolvable identifier, because it looks resolvable. There are at
 * least nine numbered sequences in the records (`D687`), and three of them start at 1: `PLAN.md`'s
 * founding list, the modern `D<n>` sequence, and `PLAN_ENTERPRISE.md`'s. Twenty-two numbers publish
 * both a `P#n` and a `D<n>` entry today, on unrelated subjects. So the repair is a reading, never a
 * rule keyed on the digits — `D687` prohibits resolving by magnitude, and `CHANGELOG.md`'s
 * `decisions 97/98/102` is why: they are `D97`/`D98`/`D102` (workload shapes), while `P#102` is an
 * enterprise cluster, so a magnitude rule would land the reader on a published entry about the
 * wrong thing. That is `§1.2`'s *strictly worse than the dead pointer it replaces*.
 *
 * @file
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { scanLines } from './gen-decisions.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * The old spelling. `decision 57`, `decisions 74–83`, `design decision 12`, `Decision 7` — the
 * leading `(?<![\w])` keeps `subdecision 4` out, and the optional `design ` prefix exists because
 * `PLAN_M13_LSP.md` numbers its own sequence that way (`D687`'s ninth namespace).
 *
 * Only the opening number is captured. A phrase carrying several targets (`decisions 93–96, 103`)
 * is one finding, not four: it is one sentence, read once, rewritten once.
 */
export const BARE = /(?<![\w])(?:design\s+)?decisions?\s+(?:no\.\s*)?\d{1,3}[a-z]?/gi;

/**
 * The founding list in its oldest spelling — `#37`, no `P`. Seven survive, all inside entries
 * lifted from `PLAN.md`, and a `decision N` regex does not see them (`D692` counted five; the two
 * it missed are `#35` at `P#41` and `P#49`).
 *
 * The `#n` shape is shared by four namespaces that are not this one, so the preceding word decides.
 * `gap #9` indexes `TFLW-GAPS.md`, which the index's preamble already declares rather than repairs
 * (`D688`); `PR #97` and `PRs #12–#18` are GitHub; `UTS #39` and `OWASP API #1` are external
 * standards. None is a decision citation, and a gate that flagged them would be asking for a
 * rewrite that made each one wrong.
 */
export const BARE_HASH = /(?<![\w)\]#/-])#(\d{1,3})\b/g;

/** The words that mark a `#n` as belonging to somebody else's numbering. */
const FOREIGN_HASH = /(gaps?|PRs?|issues?|API|UTS|RFC|ADR|§)\s*$/i;

/**
 * A number's namespace is established once per paragraph, and a later mention of the *same* number
 * in the same paragraph inherits it. Without this the gate reads the second half of `PRs #12–#18`
 * and of `gaps #5 and #6` as founding-list citations, because only the first of each pair carries
 * the keyword — and it reads `merged before #97` three lines under `pushed as tflw PR #97` the same
 * way. A rewrite of any of those would have made a true sentence false, which is the failure mode
 * `§1.2` ranks below the dead pointer.
 *
 * An enumeration inherits too, and by connective rather than by number: `PRs #12–#18` and
 * `gaps #5 and #6` carry the keyword only on the first member, so the run continues while nothing
 * but a range dash, a comma or an `and` separates one `#n` from the last foreign one.
 */
const PARAGRAPH_BREAK = /^\s*$/;
const STILL_THE_SAME_LIST = /^[\s,/&–—-]*(?:and|or|to|through)?[\s,/&–—-]*$/i;

/**
 * The records a citation can name to say which sequence it means. Naming the record is the whole
 * repair for a sequence that has no identifier at all — `PLAN_ENTERPRISE.md`'s list is numbered and
 * nothing publishes it, so `PLAN_ENTERPRISE.md decisions 1–3` is already as resolvable as it will
 * ever get, and rewriting it would only delete the one word that disambiguates it.
 *
 * `PLAN` without the extension counts, because that is how `SPEC.md` writes it in eight places
 * (`PLAN decision 77`), and so does a bare `enterprise`, which is how the records have named
 * `PLAN_ENTERPRISE.md`'s sequence since it was written — `enterprise decision 3a`, eight times, in
 * the one place where saying *which* list is doing all the work. Both are matched only immediately
 * before the citation, so that a stray `PLAN` elsewhere in a long line does not launder an
 * unrelated bare number.
 */
const NAMES_RECORD = /(`?PLAN[A-Za-z0-9_]*\.md`?|(?<![_A-Za-z])PLAN|(?<![\w])enterprise|PROGRESS\.md|REVIEW_[A-Z_]+\.md|plan_v2\.md)[^.]{0,40}$/i;

/**
 * A link destination, where the characters are an address rather than a citation. This is the
 * exemption `D691` calls load-bearing, and it exists because two of this milestone's own gates
 * fight over the same bytes: `SPEC.md#45-load-testing--workload-bearing-tests-m29m30-m50-m56-d16-`
 * `d19d24ad26d70d93-d122` contains eight strings that read as citations, `M152d`'s prohibition
 * would flag it, and `M152c`'s anchor gate *requires it to resolve*. The fragment wins — it is an
 * address, and no reader reads it as a citation.
 */
const IN_LINK_TARGET = /\]\([^)]*$|<[^>\s]*$|https?:\/\/\S*$|\.md#\S*$/;

/**
 * Whether the position sits inside an inline code span. A citation in backticks is being *quoted*,
 * not made: the preamble's own glossary row reads `` | `decision 43`, `#43` | `P#43` — … | ``, and
 * that row exists to teach the reader the very spelling this gate objects to. Flagging it would be
 * the gate objecting to its own documentation, and rewriting it would delete the glossary.
 *
 * Counting backticks before the match is enough — a span cannot open on one line and close on
 * another, and the only double-backtick spans in the corpus are the ones quoting single backticks.
 */
function inCodeSpan(before) {
  return (before.match(/`/g) ?? []).length % 2 === 1;
}

/** Tracked markdown. Same corpus, and same `.git` requirement, as the generator's own gate. */
function trackedMarkdown(root) {
  let out;
  try {
    out = execFileSync('git', ['ls-files', '*.md'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const why = String(e.stderr ?? e.message).trim().split('\n')[0];
    throw new Error(
      `cannot list the tracked files: ${why}\n` +
      `  This gate reads tracked prose, so it needs the index to know which files are tracked.\n` +
      `  \`scripts/exec.mjs\` syncs the box copy without \`.git\`, so run this one here rather than\n` +
      `  through the offload driver.`,
    );
  }
  return out.split('\n').filter(Boolean).map((p) => ({ path: p, text: readFileSync(join(root, p), 'utf8') }));
}

/**
 * Every bare citation the gate still objects to, with the four exemptions applied.
 *
 * Two of the exemptions are the same shape and `D691` states the general form: **a gate on a
 * notation must be told where the notation is not being used as a notation.** Emitted output,
 * source comments and addresses all contain the characters, and none of them is a citation.
 *
 * The fence exemption is narrower than `D691` first wrote it, and deliberately. `D691` clause 2
 * said *fence contents*; measured against the corpus that exempts ten real defects, eight of them
 * in `GRAMMAR.md`'s EBNF comments (`# inference (decision 22/M19)`). Those comments are authored
 * prose addressed to a reader — they are the citation, not a quotation of one — so this reuses the
 * generator's `PRODUCT_FENCE_INFO` asymmetry instead: a fence is exempt when its info string marks
 * it as tflw's own output, and not otherwise. The generator learned the same lesson first, and its
 * note on `PRODUCT_FENCE_INFO` says why: a blanket fence exclusion would have dropped 99 citations
 * silently, in the milestone whose subject is citations nobody can follow.
 *
 * @param {{path: string, text: string}[]} files
 * @returns {{file: string, line: number, phrase: string, excerpt: string}[]}
 */
export function findBare(files) {
  const out = [];
  for (const { path, text } of files) {
    let inScript = false;
    /** Numbers this paragraph has already shown to belong to another namespace. */
    let foreign = new Set();
    /**
     * The tail of the previous line, which is the same sentence. These records are hard-wrapped at
     * roughly 100 columns, so the word that says which sequence a citation belongs to lands on the
     * line above it often enough to matter: `closes TFLW-GAPS.md gaps` / `#6 and #5`, and
     * `(PLAN` / `decision 62`. Reading only the current line makes a wrap look like a bare citation
     * and asks for a rewrite that would be wrong.
     */
    let prevTail = '';
    const scanned = scanLines(text);
    for (const [idx, { line, inProductFence, text: ln }] of scanned.entries()) {
      if (PARAGRAPH_BREAK.test(ln)) foreign = new Set();
      // `<script setup>` in a VitePress page. The five occurrences are source comments that happen
      // to sit in a `.md` file, never rendered, addressed to a maintainer — the reason `§6` keeps
      // source comments out of this milestone entirely (`D691` clause 3).
      if (/^\s*<script\b/.test(ln)) inScript = true;
      const skipLine = inProductFence || inScript;
      if (/^\s*<\/script>/.test(ln)) inScript = false;
      if (skipLine) continue;

      /** Where the last `#n` that belonged to another namespace ended, on this line. */
      let foreignEnd = null;
      // The phrase itself can be broken BY the wrap — `decision` ending one line and `36 promised`
      // opening the next. Matching line by line cannot see those at all: ten exist in the corpus,
      // and one of them is `P#82`'s, which sits directly under the sentence that cites `P#36`
      // correctly. So each line is matched together with the one below it, and only matches that
      // START on this line are reported — the next line reports its own.
      const nextLine = scanned[idx + 1]?.text ?? '';
      const probe = `${ln}\n${nextLine}`;
      const hits = [...probe.matchAll(BARE), ...probe.matchAll(BARE_HASH)]
        .filter((m) => m.index < ln.length)
        .sort((a, b) => a.index - b.index);
      const tail = prevTail;
      if (ln.trim()) prevTail = ln.slice(-80);
      for (const m of hits) {
        // Near the start of a line the sentence began on the line above, so read both.
        const own = ln.slice(0, m.index);
        const before = m.index < 60 ? `${tail} ${own}` : own;
        if (IN_LINK_TARGET.test(own) || IN_LINK_TARGET.test(before)) continue;
        if (NAMES_RECORD.test(before)) continue;
        if (m[0].startsWith('#')) {
          if (FOREIGN_HASH.test(before)) { foreign.add(m[1]); foreignEnd = m.index + m[0].length; continue; }
          if (foreign.has(m[1])) { foreignEnd = m.index + m[0].length; continue; }
          if (foreignEnd !== null && STILL_THE_SAME_LIST.test(ln.slice(foreignEnd, m.index))) {
            foreign.add(m[1]); foreignEnd = m.index + m[0].length; continue;
          }
        }
        // `own`, never `before`: a code span cannot cross a line, and the wrapped-sentence tail is
        // sliced at a fixed width, so counting backticks across it flips parity on a span the slice
        // cut in half — which silently exempted two real citations until this line was narrowed.
        if (inCodeSpan(own)) continue;
        out.push({
          file: path,
          line,
          phrase: m[0].replace(/\s+/g, ' ').trim(),
          excerpt: probe.slice(Math.max(0, m.index - 60), m.index + m[0].length + 30).replace(/\s+/g, ' ').trim(),
        });
      }
    }
  }
  return out;
}

const invokedDirectly = () => {
  try { return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]; } catch { return false; }
};

if (invokedDirectly()) {
  const findings = findBare(trackedMarkdown(ROOT));
  if (!findings.length) {
    console.log('✓ no bare decision citations in tracked prose');
    process.exit(0);
  }
  const byFile = new Map();
  for (const f of findings) byFile.set(f.file, [...(byFile.get(f.file) ?? []), f]);
  console.error(`✗ ${findings.length} bare citation${findings.length === 1 ? '' : 's'} in tracked prose\n`);
  for (const [file, rows] of [...byFile].sort((a, b) => b[1].length - a[1].length)) {
    console.error(`  ${file}  (${rows.length})`);
    for (const r of rows) console.error(`    :${r.line}  ${r.phrase}   …${r.excerpt}…`);
    console.error('');
  }
  console.error(
    'Each one names a number without saying which sequence indexes it. Rewrite it as `P#n`,\n' +
    '`D<n>` or `M<n>` — read the sentence to decide, never the magnitude (`D687`) — or name the\n' +
    'record it belongs to if that sequence publishes no identifier.',
  );
  process.exit(1);
}
