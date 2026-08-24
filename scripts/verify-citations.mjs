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
import { inCodeSpan, scanLines } from './gen-decisions.mjs';

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
 * The same spelling with a **letter** where the number goes (`D716`). `PLAN_M13_LSP.md` numbers a
 * pair of LSP decisions `A` and `B`, which is a tenth namespace on top of `D687`'s nine and the one
 * `M152c-01` singled out as *"a sixth numbering nothing in this repository indexes"* — and every
 * matcher in this repository missed it, because `BARE` above is digits-only.
 *
 * A **separate regex, without the `i` flag**, rather than widening `BARE`'s character class. That
 * was measured, not assumed: `decisions?\s+[0-9A-Za-z]+` — the form the scoping proposed — finds 36
 * phrases in tracked markdown and 33 are ordinary English (`decision the`, `decision rather`,
 * `decision was`). Keeping `i` and matching one letter still reads `a decision a human recorded`
 * (`SPEC.md:3058`) as a citation. One **uppercase** letter, case-sensitively, finds three phrases in
 * the whole corpus and all three are real.
 *
 * No exemption ships with it, per `D708`: an exemption that exempts nothing does not get built. Two
 * shapes are foreseeable and neither occurs — `decision I` (the pronoun) and `decision N` (the
 * notation quoted rather than used, which `inCodeSpan` already covers everywhere it appears).
 */
export const BARE_LETTER = /(?<![\w])(?:[Dd]esign\s+)?[Dd]ecisions?\s+(?:no\.\s*)?[A-Z]\b/g;

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

/**
 * The words that mark a `#n` as belonging to somebody else's numbering.
 *
 * `steps?` and `predictions?` were added by `M152e`, when the index started publishing the blocks
 * `testFlow-tests` cites and two of them turned out to number something that is not a decision:
 * `ci.yml` step #21 is a position in a workflow file, and prediction #4 is one of `D494`'s scored
 * predictions, a sequence per plan rather than per repository. Both are real occurrences — `D708`'s
 * rule holds, an exemption that exempts nothing does not get built — and rewriting either would
 * have made a true sentence false, which `§1.2` ranks below the dead pointer.
 */
const FOREIGN_HASH = /(gaps?|PRs?|issues?|steps?|predictions?|API|UTS|RFC|ADR|§)\s*$/i;

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
      const hits = [...probe.matchAll(BARE), ...probe.matchAll(BARE_LETTER), ...probe.matchAll(BARE_HASH)]
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

/**
 * The notation as it appears in `package.json`, where every rule above changes meaning (`D715`).
 *
 * Two differences drive this, and both run the opposite way to the prose corpus:
 *
 * 1. **Naming the record is the defect, not the repair.** In tracked prose, `PLAN_ENTERPRISE.md
 *    decision 17` is as resolvable as that sequence gets, so `NAMES_RECORD` exempts it. Shipped
 *    metadata has no such reader: every `PLAN*.md` in this repository is gitignored and none of
 *    them has ever left it, so the filename resolves to nothing at all for the person reading
 *    `npm view tflw`. Here the record name is a **positive** signal.
 * 2. **There is no line, so there is a path.** A finding names
 *    `.contributes.configuration.properties.tflw.env.description`, because a line number in a file
 *    that is regenerated by tooling points at nothing a reader can act on.
 *
 * `webV2-1` (`testFlow-tests/webV2/admin`) is **knowingly** outside all of this — `D718`. It is a
 * record-local sequence with no record name in front of it, and the only rule broad enough to catch
 * it would flag every hyphenated token in every description. It is repaired by hand; the gate is
 * documented as unable to see its shape, so the next one gets through knowingly rather than
 * silently. A wordlist of record-local prefixes is refused for `D659`'s reason: this repository's
 * guards do not maintain wordlists, and a stale one fails without saying so.
 */
export const JSON_RULES = [
  { what: 'a bare decision citation', re: BARE },
  { what: 'a lettered decision citation', re: BARE_LETTER },
  { what: "the founding list's oldest spelling", re: BARE_HASH },
  /**
   * `M147e`, `(M3a)`. Label form carries no record name, so `NAMES_RECORD` provably cannot reach
   * it — it is how the two sites this gate was widened for are written, and it measured **zero**
   * false positives across every string in every tracked `package.json` in both repositories
   * (`D717`).
   */
  { what: 'a milestone label', re: /(?<![\w#])M\d{1,3}[a-z]?\d?\b/g },
  /** A review-ledger row: `M147-10`, `DT-4`, `FU-11`. Same evidence as the labels. */
  { what: 'a review-ledger row', re: /(?<![\w#])(?:[A-Z]{1,3}\d+|DT|FU)-\d+\b/g },
  /**
   * A private design record named outright. Only the filename forms: `NAMES_RECORD`'s bare `PLAN`
   * and bare `enterprise` are dropped here, because in a product blurb they are ordinary English
   * and the citations that carry them are caught by their number anyway.
   */
  { what: 'a record this reader cannot open', re: /\b(?:PLAN[A-Za-z0-9_]*|PROGRESS|REVIEW_[A-Z_]+)\.md\b/g },
];

/**
 * Tracked `package.json`, every string value, keyed by its JSON path.
 *
 * Recursive descent over the parsed document rather than a line scan, so a citation is found
 * wherever it is written — `M152c-01` swept this corpus by walking strings too, but classified them
 * with a `decision N` rule, and so reported a complete census that had missed `(M3a)` in a
 * `description` field (`§1.2`). Values only: a key is a name, not prose.
 */
export function packageStrings(root) {
  let listed;
  try {
    listed = execFileSync('git', ['ls-files', '*package.json'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const why = String(e.stderr ?? e.message).trim().split('\n')[0];
    throw new Error(`cannot list the tracked files: ${why}`);
  }
  const out = [];
  for (const file of listed.split('\n').filter(Boolean)) {
    const doc = JSON.parse(readFileSync(join(root, file), 'utf8'));
    const walk = (node, path) => {
      if (typeof node === 'string') out.push({ file, path, value: node });
      else if (Array.isArray(node)) node.forEach((v, i) => walk(v, `${path}[${i}]`));
      else if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) walk(v, `${path}.${/^[A-Za-z_][\w-]*$/.test(k) ? k : JSON.stringify(k)}`);
      }
    };
    walk(doc, '');
  }
  return out;
}

/**
 * Every citation in the metadata corpus.
 *
 * @param {{file: string, path: string, value: string}[]} strings
 * @returns {{file: string, path: string, phrase: string, what: string, excerpt: string}[]}
 */
export function findInPackages(strings) {
  const out = [];
  for (const { file, path, value } of strings) {
    /** Every rule's every match, with its span, before the shorter readings are dropped. */
    const spans = [];
    for (const { what, re } of JSON_RULES) {
      for (const m of value.matchAll(new RegExp(re.source, re.flags))) {
        spans.push({ what, text: m[0], start: m.index, end: m.index + m[0].length });
      }
    }
    // One identifier, one finding. The rules deliberately overlap — `M147-10` is a ledger row to
    // one and an `M147` label to another — and reporting both asks for a repair to be made twice.
    // The longer reading wins, which is also the correct one: the row is what was cited.
    const kept = spans.filter((a) => !spans.some((b) => b !== a && b.start <= a.start && b.end >= a.end && (b.end - b.start) > (a.end - a.start)));
    for (const k of kept.sort((a, b) => a.start - b.start)) {
      out.push({
        file, path, what: k.what,
        phrase: k.text.replace(/\s+/g, ' ').trim(),
        excerpt: value.slice(Math.max(0, k.start - 45), k.end + 30).replace(/\s+/g, ' ').trim(),
      });
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file) || a.path.localeCompare(b.path));
}

const invokedDirectly = () => {
  try { return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]; } catch { return false; }
};

if (invokedDirectly()) {
  const findings = findBare(trackedMarkdown(ROOT));
  const metadata = findInPackages(packageStrings(ROOT));
  if (!findings.length && !metadata.length) {
    console.log('✓ no bare decision citations in tracked prose or package metadata');
    process.exit(0);
  }
  if (findings.length) {
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
      'record it belongs to if that sequence publishes no identifier.\n',
    );
  }
  if (metadata.length) {
    const byFile = new Map();
    for (const f of metadata) byFile.set(f.file, [...(byFile.get(f.file) ?? []), f]);
    console.error(`✗ ${metadata.length} citation${metadata.length === 1 ? '' : 's'} in tracked package metadata\n`);
    for (const [file, rows] of [...byFile].sort((a, b) => b[1].length - a[1].length)) {
      console.error(`  ${file}  (${rows.length})`);
      for (const r of rows) console.error(`    ${r.path}\n      ${r.phrase}  — ${r.what}\n      …${r.excerpt}…`);
      console.error('');
    }
    console.error(
      'These reach a reader who has never seen this repository — npm ships `package.json` whole,\n' +
      'regardless of `files` (`D713`). Name the sequence and you have still named nothing they can\n' +
      'open: every `PLAN*.md` here is gitignored. **Delete the identifier** (`D714`) — a description\n' +
      'is a product blurb, and the sentence reads the same without it.',
    );
  }
  process.exit(1);
}
