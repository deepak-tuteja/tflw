// Page scanners for the docs site (M62, review finding OBS-01; extended by M149b/`D657`).
//
// Two scanners, shared by `verify-docs.mjs` and its own tests, with one job between them: make
// *silence impossible*. Every fenced block in every page comes back classified, including the ones
// nothing can check, and every forward-looking claim about tflw comes back either declared or as a
// failure — so a guard can report what it did not cover instead of omitting it.
//
// The old extractor recognised two tags and dropped everything else on the floor without counting
// it — 31 of 89 blocks checked behind a line reading `31/31 … parse cleanly`. See PLAN_DOC_TRUTH.md.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { JSON_RULES as CITATION_RULES } from '../../../scripts/citation-rules.mjs';

/** Fence tags whose contents are `.tflw` source, keyed to how a sample is made checkable. */
export const TFLW_LANGS = new Set(['tflw', 'tflw-config']);

/**
 * Tags declaring a block that no guard here can verify, and *why* it can't — the reason is the
 * point. `console` is a claim about what the tool prints (verifiable only by running it against a
 * live fixture; a follow-on milestone, not smuggled into this one); `text` is notation, not code.
 */
export const DECLARED_UNCHECKED = new Map([
  ['console', 'output the tool prints — verifying it means running the tool'],
  ['text', 'metasyntax, notation, or a file tree — not source'],
  ['sh', 'shell invocation — `tflw …` commands are checked against CLI_FLAGS'],
  ['ts', 'TypeScript helper source for the JS escape hatch'],
  ['json', 'a JSON artifact the tool reads or writes'],
  ['yaml', 'CI configuration'],
  ['xml', 'a junit.xml artifact'],
  ['csv', 'a data-table fixture'],
]);

export function findMarkdownFiles(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    if (name === 'node_modules' || name === '.vitepress' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) findMarkdownFiles(path, out);
    else if (name.endsWith('.md')) out.push(path);
  }
  return out;
}

/**
 * Every fenced block in one markdown document, with its 1-based opening-fence line.
 *
 * Handles what the old `^```(\w*)$` regex did not: an indented fence (inside a list item), a fence
 * opened with more than three backticks to contain one with three, and an info string carrying
 * directives after the language (`tflw fragment binds=orderId`). A block left unclosed at EOF is
 * returned with `unterminated: true` rather than silently swallowing the rest of the file.
 */
export function extractBlocks(text) {
  const lines = text.split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const open = /^(\s*)(`{3,})(.*)$/.exec(lines[i]);
    if (!open) {
      i++;
      continue;
    }
    const [, indent, ticks, infoRaw] = open;
    const startLine = i + 1;
    const body = [];
    let closed = false;
    i++;
    while (i < lines.length) {
      const close = new RegExp(`^\\s*\`{${ticks.length},}\\s*$`).exec(lines[i]);
      if (close) {
        closed = true;
        i++;
        break;
      }
      body.push(lines[i].startsWith(indent) ? lines[i].slice(indent.length) : lines[i]);
      i++;
    }
    blocks.push({ ...parseInfoString(infoRaw), startLine, source: body.join('\n'), unterminated: !closed });
  }
  return blocks;
}

/**
 * `tflw fragment binds=orderId,email` → `{ lang: 'tflw', directives: {fragment: true, binds: [...]} }`.
 *
 * The taxonomy lives in the info string (DT-02) rather than an HTML comment above the block, so the
 * declaration travels with the fence in every diff — and Shiki keys highlighting off the first word
 * alone, so a `tflw fragment` block still highlights as `tflw`.
 */
export function parseInfoString(infoRaw) {
  const words = infoRaw.trim().split(/\s+/).filter(Boolean);
  const lang = words.shift() ?? '';
  const directives = {};
  for (const word of words) {
    const eq = word.indexOf('=');
    if (eq === -1) directives[word] = true;
    else directives[word.slice(0, eq)] = word.slice(eq + 1).split(',').filter(Boolean);
  }
  return { lang, directives };
}

/**
 * Assign one category to a block. `unclassified` is a hard failure, not a skip (DT-01): a new page
 * with an unlabelled sample must break the build, which is exactly what the old extractor's silent
 * `continue` prevented.
 */
export function classify(block) {
  if (block.unterminated) return { kind: 'unclassified', why: 'unterminated fence — no closing ```' };
  if (block.lang === 'tflw') {
    return block.directives.fragment
      ? { kind: 'fragment', binds: block.directives.binds === true ? [] : (block.directives.binds ?? []) }
      : { kind: 'file' };
  }
  if (block.lang === 'tflw-config') return block.directives.fragment ? { kind: 'config-fragment' } : { kind: 'config' };
  if (DECLARED_UNCHECKED.has(block.lang)) return { kind: 'declared', why: DECLARED_UNCHECKED.get(block.lang) };
  return {
    kind: 'unclassified',
    why: block.lang === '' ? 'untagged fence — every block must declare what it is' : `unknown fence tag \`${block.lang}\``,
  };
}

/** Every classified block under `root`, flattened, each carrying `file`/`startLine` for reporting. */
export function census(root) {
  const out = [];
  for (const file of findMarkdownFiles(root)) {
    for (const block of extractBlocks(readFileSync(file, 'utf8'))) {
      out.push({ ...block, ...classify(block), file: relative(root, file) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Roadmap truth (`M149b`, `D657`/`D658`/`D663`/`D664`).
// ---------------------------------------------------------------------------

/**
 * Idioms that place a claim about tflw's own capabilities in the future.
 *
 * The class has now fired twice in this repository. `M135b` fixed it in `README.md` and wrote a
 * changelog section about it; it reappeared on the home page's hero tagline, in a feature card and
 * in a guide chapter, and `M149a` swept five more. Discipline has been tried and did not hold, for
 * the ordinary reason: **the sentence is true when it is written.** It stops being true silently,
 * on a day nobody is editing the page that carries it.
 *
 * `D663` — **`will be` is deliberately not on this list**, though the plan's sketch named it. It is
 * tense, not roadmap: "the report will be written to `report/`" describes a capability that shipped
 * two years of milestones ago. A guard that fires on it needs an exemption for ordinary prose, and
 * an exemption list that grows with sentences nobody is worried about is how a guard gets deleted
 * the first time it blocks someone. The list is idiom-based instead — "next", "not yet"/"not
 * published", "planned"/"roadmap", a narrow set of `will …` verbs, and the release-gated forms —
 * and it is matched case-insensitively against the raw line.
 */
export const ROADMAP_PHRASES = [
  'is next',
  'are next',
  'comes next',
  'coming next',
  'coming soon',
  'not yet built',
  'not yet published',
  'not yet available',
  'not yet implemented',
  'not yet supported',
  'not published',
  'planned for',
  'is planned',
  'are planned',
  'on the roadmap',
  'will ship',
  'will support',
  'will land',
  'will publish',
  'at 1.0',
  'in a future release',
  'in a later milestone',
  'once it ships',
];

/**
 * One forward-looking claim per line of a page, each with the reason it is legitimately future.
 *
 * **The allowlist is the load-bearing half.** There are true future statements on this site — the
 * VS Code extension really is unlisted, and tflw really is unpublished — and a guard with no
 * exception mechanism would be deleted the first time it blocked a true sentence. Modelled on
 * `DECLARED_UNCHECKED` above: same shape, same rationale, an undeclared occurrence is a failure
 * rather than a skip.
 *
 * `D664` — **keyed by a distinctive substring of the line, not by line number and not by phrase.**
 * A line number drifts on every edit above it. A phrase key would exempt a whole file from a whole
 * idiom, which is the opposite of what is wanted. A substring means a *reworded* sentence loses its
 * exemption and has to be re-declared, and that is the pressure that keeps this list honest.
 *
 * Every entry here is also a **publish-time worklist**: when `package.json` comes off
 * `private: true`, these thirteen lines are exactly the sentences that must change, and the
 * unused-entry check below turns finishing that sweep into a green run rather than a memory.
 */
export const DECLARED_ROADMAP = new Map([
  [
    'index.md',
    [
      {
        includes: 'Pre-1.0, not yet published',
        why: 'true: `package.json` is `private: true` and nothing has been published to npm',
      },
    ],
  ],
  [
    'editor.md',
    [
      {
        includes: 'a listing is planned for later',
        why: 'true: the VS Code extension is not on the Marketplace, and telling a reader otherwise is the defect',
      },
      {
        includes: 'once it ships',
        why: 'the same sentence continued — this section shrinks to one `ext install` line when the listing lands',
      },
    ],
  ],
  [
    'getting-started.md',
    [
      {
        includes: '**not published to npm yet**',
        why: '`D652`: the checkout install leads because it is the one that works today',
      },
      { includes: 'At 1.0 that becomes one line', why: '`D652`: labels the npm block as what lands at 1.0, not as available' },
      { includes: 'not published — see the two commands above', why: '`D652`: the comment inside the block that does not work yet' },
    ],
  ],
  [
    'README.md',
    [
      { includes: 'Pre-1.0, **not yet published', why: 'true, and the same claim as `index.md`\'s tagline' },
      { includes: '**not published to npm yet**', why: '`D652`, the README half of the install reordering' },
      { includes: 'At 1.0 that becomes one line', why: '`D652`, the README half of the install reordering' },
      { includes: 'not published — see the two commands above', why: '`D652`, the README half of the install reordering' },
      { includes: 'Built so far (internal milestones, not yet published)', why: 'true: the milestone list is explicitly the unpublished-work record' },
    ],
  ],
  [
    'CHANGELOG.md',
    [
      { includes: 'built and verified but not yet published', why: 'the standing preamble — it is what the file is for until `1.0.0` publishes' },
      {
        includes: "`M135b`'s exporter will publish",
        why: 'frozen history: a released entry describing what a later milestone then did, not a claim about today',
      },
    ],
  ],
  /**
   * `M153a`. This file reached the guard for the first time when `D719` made `roadmapFiles()`
   * derive its `@include` set from `INCLUDED_RECORDS` — the grammar shim had been publishing onto
   * the site with the roadmap rule unable to see it, which is what `M152d-01` filed. The claim it
   * found on the first run is real, current, and names its own reason.
   */
  [
    'packages/lang/GRAMMAR.md',
    [
      {
        includes: '`element` aliases are not yet implemented',
        why: 'true, and self-dating: the sentence says no milestone owns them, so the line changes when one does',
      },
    ],
  ],
]);

/**
 * Every undeclared forward-looking claim in `files`, plus every exemption that no longer matches.
 *
 * Pure and injectable so its own behaviour is testable without a corpus on disk — the allowlist is
 * the half that decides what the guard tolerates, and an untested allowlist is the unearned
 * confidence this whole file exists to remove.
 *
 * `files` is `{ key, text }`: `key` is how the line is reported and how an exemption is looked up,
 * `text` is the **raw file contents including YAML frontmatter**. The frontmatter half matters and
 * is stated rather than left as an accident of implementation: `index.md`'s hero tagline — the
 * first sentence a reader ever sees, and the one that carried "Security testing is next" past two
 * sweeps — lives in frontmatter, so a refactor to a markdown-*body* parser would silently drop the
 * single occurrence most worth catching.
 *
 * `checkStale` runs the reverse direction — an exemption that no line matches any more. It is the
 * half that makes the allowlist self-cleaning, and it is **off for a scratch corpus**: `DT-08`'s
 * fixtures name their one page `index.md`, which is also a real page here, so a corpus of three
 * invented lines would otherwise be reported as having deleted the home page's tagline. Skipped and
 * said out loud rather than quietly weakened, the same way command coverage handles the same
 * situation.
 */
export function scanRoadmapClaims(files, { allowlist = DECLARED_ROADMAP, phrases = ROADMAP_PHRASES, checkStale = true } = {}) {
  const problems = [];
  const matched = new Set();
  const seenFiles = new Set();
  let claims = 0;

  for (const { key, text } of files) {
    seenFiles.add(key);
    const exemptions = allowlist.get(key) ?? [];
    text.split('\n').forEach((line, i) => {
      const lower = line.toLowerCase();
      const found = phrases.filter((phrase) => lower.includes(phrase));
      if (found.length === 0) return;
      claims++;
      const exemption = exemptions.find((e) => line.includes(e.includes));
      if (exemption) {
        matched.add(`${key}\u0000${exemption.includes}`);
        return;
      }
      problems.push({
        where: `${key}:${i + 1}`,
        message: `undeclared forward-looking claim: ${found.map((p) => `\`${p}\``).join(', ')}`,
        detail:
          'A statement about what tflw will do goes stale silently, on a day nobody is editing this page.\n' +
          'If it is false now, fix it. If it is legitimately future, add it to DECLARED_ROADMAP in\n' +
          'scripts/doc-blocks.mjs with a distinctive substring of the line and the reason it is true.',
      });
    });
  }

  for (const [key, entries] of checkStale ? allowlist : []) {
    if (!seenFiles.has(key)) continue;
    for (const entry of entries) {
      if (matched.has(`${key}\u0000${entry.includes}`)) continue;
      problems.push({
        where: `DECLARED_ROADMAP ${key}`,
        message: `no line matches the declared exemption \`${entry.includes}\``,
        detail: `the exemption reads: ${entry.why}\nIf the sentence was reworded, update the entry; if it is gone, delete it.`,
      });
    }
  }

  return { problems, claims, files: seenFiles.size };
}

// ---------------------------------------------------------------------------
// Construct coverage (`M149f`, `D659`) — the positive dual of the roadmap denylist.
// ---------------------------------------------------------------------------

/**
 * Shipped constructs that are deliberately not described anywhere on the site, each with the reason
 * that is not a gap — `DECLARED_UNCHECKED`'s shape, for `DECLARED_UNCHECKED`'s reason: an undeclared
 * absence is a failure, never a skip.
 *
 * **Empty, and that is the state to preserve.** It is empty because `M149c`–`M149e` closed the six
 * absences this gate was built from; an entry added here is a decision that a reader may not learn
 * about a construct from the documentation, which is a large thing to assert quietly. The reverse
 * check below deletes an entry that stops being true, the same way `DECLARED_ROADMAP`'s does.
 */
// ---------------------------------------------------------------------------
// The private notation, kept off the pages a user reads (`D673`/`D706`).
// ---------------------------------------------------------------------------

/**
 * The identifier shapes this project uses to name its own design record.
 *
 * `DECISIONS.md` resolves the first three for a reader who finds one in a repo file. **Nothing
 * resolves the fourth** — a review-ledger row id lives in a gitignored document — which makes it
 * strictly the worst of them to leave on a public page, and it is why the list is not just the
 * three `D666` names.
 *
 * **Case-sensitive on purpose, and this is load-bearing.** GitHub's heading anchors are lowercased,
 * so `SPEC.md#…-p2731-` and `#…-d105` are full of these shapes in lower case. `D691` clause 4
 * therefore scoped an exclusion for URL fragments — but measured against the real site that
 * exclusion matches **nothing**, because capitalisation already separates an address from a
 * citation. No exclusion was added: a guard that never fires is a guard nobody can evaluate. The
 * property is pinned by a test instead, so a later widening to `/i` fails and says why.
 */
// `D794`/`D795`. There was a second classifier here — `NOTATION`, five pattern-only regexes with
// no view of context — and `M153a-01` measured what that cost: it caught 4 of 8 real citations at
// zero false positives, missing `M147e`, `(M3a)`, `decision B` and `E4`. `JSON_RULES` resolves all
// four, because it reads the sentence around the token rather than the token's shape alone.
//
// Two classifiers for one notation is the defect, not the pattern gap. Merging them means this
// file's rule now lives in `scripts/verify-citations.mjs`, which is the direction the dependency
// has to run: that script already reads **both repositories** and holds no docs-site knowledge,
// while this file is scoped to one package. The dependency follows the breadth.

/**
 * The two site pages that are not pages: a header plus `<!--@include: …-->` of a repo record.
 *
 * **`D706`. This is the milestone's actual decision and it has to be written, not inherited.**
 * `CHANGELOG.md` and `packages/lang/GRAMMAR.md` render onto the site verbatim, and between them
 * they publish 284 citations — vastly more than the four this guard was scoped for. The rule does
 * not reach them: `D673` objects to an identifier standing in front of a reader with nothing that
 * resolves it, and both records carry a declaration sentence linking `DECISIONS.md`, so their
 * citations are provenance rather than an artifact. Deleting them would remove the thing `M152a`
 * and `M152b` were built to construct.
 *
 * The reason this is a named constant rather than a comment: `findMarkdownFiles` sees these two
 * files as ~230-byte stubs and would skip their bodies **by accident**, producing exactly this
 * scope with none of this reasoning. `roadmapFiles()` in `verify-docs.mjs` faced the same fork for
 * `D657` and went the other way, hand-adding `CHANGELOG.md` so the rule could see through the shim.
 * Two guards in one file reaching opposite conclusions is fine; two guards reaching them silently
 * is not.
 *
 * `assertShim` below keeps this honest: if a page stops being an `@include` stub, its exemption
 * stops describing it and the scan says so rather than continuing to skip a page full of prose.
 */
export const INCLUDED_RECORDS = new Map([
  ['changelog.md', { include: '../../CHANGELOG.md', why: 'CHANGELOG.md, declared and linked to DECISIONS.md at its head' }],
  ['grammar.md', { include: '../lang/GRAMMAR.md', why: 'packages/lang/GRAMMAR.md, declared and linked to DECISIONS.md at its head' }],
]);

/**
 * The file set, explicit because the obvious one is wrong in two ways (`D658`).
 *
 * Every other check here walks `findMarkdownFiles(ROOT)` and nothing else, and for this check that
 * would place the guard where the class has *never* been fully visible:
 *
 *  - **`README.md` is unreachable** from `ROOT`. It sits at the repo root and is `srcExclude`d from
 *    the site. `M135b` — the precedent proving this class recurs — fired *in `README.md`*, and so
 *    did two of the five occurrences `M149a` swept. A guard placed where the class last fired that
 *    cannot see the file it fired in is a guard against the wrong thing.
 *  - **`CHANGELOG.md` is unreachable** too, and for a subtler reason: `changelog.md` on disk is a
 *    header plus `<!--@include: ../../CHANGELOG.md-->`. The body arrives at VitePress build time,
 *    so a scanner reading markdown files sees a 233-byte stub and reports the page as clean.
 *
 * The shims are therefore located relative to `root` rather than to this script, so a scratch
 * corpus gets its own records or none at all instead of silently borrowing the repository's.
 *
 * It lives here rather than in `verify-docs.mjs` because `D719` made it read `INCLUDED_RECORDS`,
 * and a corpus rule belongs beside the corpus it selects — `verify-docs.mjs` runs its whole
 * verification on import, so nothing there can be unit-tested at all.
 */
export function roadmapFiles(root, included = INCLUDED_RECORDS) {
  const repo = join(root, '..', '..');
  const files = findMarkdownFiles(root).map((path) => ({ key: path.slice(root.length + 1), path }));
  // The shims, from the registry rather than by name (`D719`). `D706` already decided that these
  // two guards want opposite answers about an `@include` — that one skips the record's body, this
  // one must read it — and gave the reasoning. What it could not fix from where it sat is that one
  // guard's list was derived and this one's was two string literals, so a third shim would have
  // updated exactly one of them, silently. The verdicts stay opposite; the *set* is now shared.
  for (const { include } of included.values()) {
    const path = join(root, include);
    if (existsSync(path)) files.push({ key: relative(repo, path), path });
  }
  // `README.md` is hand-added and stays that way, because it is a different case wearing the same
  // shape: it is unreachable because the site `srcExclude`s it, not because it is a stub. Nothing
  // in `INCLUDED_RECORDS` describes it, and putting it there to save a line would claim it is an
  // `@include` page — which `assertShim` would then, correctly, deny.
  const readme = join(repo, 'README.md');
  if (existsSync(readme)) files.push({ key: 'README.md', path: readme });
  return files.map(({ key, path }) => ({ key, text: readFileSync(path, 'utf8') }));
}

/** The 1-based line numbers a fenced block occupies, opening and closing fences included. */
function fencedLines(text) {
  const lines = new Set();
  for (const block of extractBlocks(text)) {
    const body = block.source === '' ? 0 : block.source.split('\n').length;
    const last = block.startLine + body + (block.unterminated ? 0 : 1);
    for (let n = block.startLine; n <= last; n++) lines.add(n);
  }
  return lines;
}

/**
 * The 1-based line numbers inside a `<script …>` block.
 *
 * VitePress pages open with `<script setup>` to pull in a generated table, and those blocks carry
 * ordinary source comments. A comment in a Vue SFC is not prose a reader meets — it never renders —
 * so it is excluded for the same reason `D697` excludes a product fence: it is not a citation
 * aimed at anybody.
 */
function scriptLines(text) {
  const lines = new Set();
  let open = false;
  text.split('\n').forEach((line, i) => {
    if (/<script[\s>]/.test(line)) open = true;
    if (open) lines.add(i + 1);
    if (line.includes('</script>')) open = false;
  });
  return lines;
}

/**
 * Every occurrence of the private notation on a hand-written page.
 *
 * Pure and injectable, like `scanRoadmapClaims` above and for the same reason: the part worth
 * testing is what the guard *tolerates*, and that cannot be tested through a corpus on disk.
 *
 * `files` is `{ key, text }` with `text` the raw contents including frontmatter.
 */
export function scanPrivateNotation(files, { included = INCLUDED_RECORDS, patterns = CITATION_RULES } = {}) {
  const problems = [];
  const found = [];
  let scanned = 0;
  const seen = new Set();

  for (const { key, text } of files) {
    seen.add(key);
    const record = included.get(key);
    if (record !== undefined) {
      // The exemption has to keep describing the page. A shim that grew a body is a page this
      // guard would then be skipping for a reason that stopped being true.
      if (!text.includes(`@include: ${record.include}`)) {
        problems.push({
          where: `INCLUDED_RECORDS ${key}`,
          message: `this page no longer includes \`${record.include}\`, so its exemption no longer describes it`,
          detail:
            'INCLUDED_RECORDS in scripts/doc-blocks.mjs exempts this page because it is a stub that\n' +
            'renders a repo record verbatim (D706). If the page now holds its own prose, delete the\n' +
            'entry so the notation rule covers it; if the include moved, update the entry.',
        });
      }
      continue;
    }
    scanned++;
    const fenced = fencedLines(text);
    const script = scriptLines(text);
    text.split('\n').forEach((line, i) => {
      const n = i + 1;
      if (fenced.has(n) || script.has(n)) return;
      for (const { what, re } of patterns) {
        for (const m of line.matchAll(re)) {
          found.push({ key, line: n, token: m[0], what });
          problems.push({
            where: `${key}:${n}`,
            message: `\`${m[0]}\` names ${what} in this project's private design record`,
            detail:
              'A reader of this page is a tflw user with no relationship to that record (D673).\n' +
              'Say what the identifier refers to instead of naming it — "earlier versions", "it was\n' +
              'folded into `run`" — rather than linking it. A fenced block, a <script> block and the\n' +
              'two included records in INCLUDED_RECORDS are already excluded.',
          });
        }
      }
    });
  }

  return { problems, found, scanned };
}

export const DECLARED_UNDOCUMENTED = new Map();

/**
 * A construct's *syntax shape*, compiled from the shape the manifest already publishes (`D792`).
 *
 * This replaces the four ad-hoc sources the gate used to assemble — `STEP_KEYWORDS`,
 * `CONFIG_KEYWORDS`, `WORKLOAD_DIRECTIVES` and `GRAMMAR.md`'s multi-word productions — and it
 * replaces the way they were matched, which mattered more. The old rule was *the leading word of a
 * code string*, and the file said out loud what that costs: `close`, `select`, `run` and `log` are
 * ordinary English, so any span beginning with one satisfied the check. Nothing was ever going to
 * find that, because the gate passes.
 *
 * `specConstructs()` publishes a `syntax` cell per construct — `` `button "<name>"` ``,
 * `` `close tab` ``, `` `log [<level>] "<message>"` `` — and that cell is the matcher. A new
 * manifest row therefore brings its own rule and cannot arrive unmatched, which is the property the
 * hand-written list could not have.
 *
 * The notation is small and every span in it was surveyed before this was written (115 spans, all
 * beginning with a literal word or `@`):
 *
 *  - `<name>` is a placeholder — one run of non-space, or a quoted string when the notation quotes
 *    it. `N`, `M`, `A`, `B` are placeholders too: a bare uppercase letter is never a keyword here.
 *  - `[...]` is optional, and is expanded into both forms rather than made lazy, so `log "hi"` and
 *    `log info "hi"` both match while `console.log(x)` matches neither.
 *  - `|` alternates inside a bracket; `…` is any tail; `{...}` is a literal brace and a tail.
 *  - A `syntax` cell may hold several spans (`` `random number A to B` / `random decimal A to B` ``,
 *    or `` `parallel` or `sequential` ``). All of them are read; any one matching is coverage.
 *
 * Anchored at the start and not at the end: a documented line legitimately carries more after the
 * construct (`check status equals 200` is `check <subject> …`). Being loose to the right costs a
 * construct that is trivially present; being loose to the left is the defect this exists to remove.
 */
// Not anchored at `^`, and this is the correction that measurement forced. A matcher and a
// generator never begin a line — `check status equals 200`, `let id = unique("ORD")` — so an
// anchored rule reported eleven matchers and generators as documented nowhere on a site that
// documents all of them. What the rule actually needs is a **left boundary**: the shape must start
// where a word starts, so `close tab` is the step and `console.log(x)` is not `log`.
const SYNTAX_HEAD = String.raw`(?:^|[^\w-])`;
const SYNTAX_TAIL = String.raw`(?:\s|$|[^\w-])`;

const escapeLiteral = (word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `[a|b]` -> both branches, recursively, so a cell with three optionals yields eight forms. */
function expandOptionals(span, depth = 0) {
  const open = span.indexOf('[');
  if (open === -1 || depth > 4) return [span];
  let level = 0;
  let close = -1;
  for (let i = open; i < span.length; i += 1) {
    if (span[i] === '[') level += 1;
    else if (span[i] === ']') {
      level -= 1;
      if (level === 0) { close = i; break; }
    }
  }
  if (close === -1) return [span];
  const before = span.slice(0, open);
  const inner = span.slice(open + 1, close);
  // `[mask <locator>]*` — the repetition marker is part of the bracket, not a token of its own.
  const after = span.slice(close + 1).replace(/^\*/, '');
  const forms = new Set([`${before}${after}`]);
  for (const branch of inner.split(/[|/]/)) forms.add(`${before}${branch}${after}`);
  return [...forms].flatMap((form) => expandOptionals(form, depth + 1));
}

/**
 * One whitespace-separated token of a syntax cell -> one regex fragment.
 *
 * A placeholder is `.+?` rather than `\S+`, which is the second thing measurement corrected: a
 * `<metric>` is `error rate` and a `<locator>` is `button "Buy"`, both two words. The literals
 * around it still have to appear, in order, so the shape stays strict where it matters.
 */
function tokenToPattern(token) {
  if (token === '*') return null;
  if (token === '…' || token === '...') return String.raw`.*`;
  // `visible/hidden/enabled` — a slash alternates whole words, and only where no placeholder or
  // quoted string is in play (a `<path.tflw>` carries slashes of its own meaning).
  if (token.includes('/') && !token.includes('<') && !token.includes('"')) {
    return `(?:${token.split('/').filter(Boolean).map(escapeLiteral).join('|')})`;
  }
  let out = '';
  let i = 0;
  while (i < token.length) {
    if (token[i] === '<') {
      const close = token.indexOf('>', i);
      if (close !== -1) { out += String.raw`.+?`; i = close + 1; continue; }
    }
    if (token[i] === '"') {
      const close = token.indexOf('"', i + 1);
      if (close !== -1) { out += String.raw`"[^"]*"`; i = close + 1; continue; }
    }
    if (token.startsWith('...', i)) { out += String.raw`.*`; i += 3; continue; }
    if (token[i] === '…') { out += String.raw`.*`; i += 1; continue; }
    // A bare uppercase letter is a placeholder here, never a keyword — `random number A to B`.
    if (/[A-Z]/.test(token[i]) && !/[\w-]/.test(token[i - 1] ?? '') && !/[\w-]/.test(token[i + 1] ?? '')) {
      out += String.raw`.+?`; i += 1; continue;
    }
    out += escapeLiteral(token[i]);
    i += 1;
  }
  return out;
}

/** One expanded form -> one regex source. */
function formToPattern(form) {
  const parts = form.split(/\s+/).filter(Boolean).map(tokenToPattern).filter((part) => part !== null);
  if (parts.length === 0) return null;
  return `${SYNTAX_HEAD}${parts.join(String.raw`\s+`)}${SYNTAX_TAIL}`;
}

/**
 * The spans of a `syntax` cell that are **alternate spellings of this construct**, and not the other
 * constructs its prose happens to name.
 *
 * Reading every backticked span was the obvious rule and it is wrong, which the site's own controls
 * found rather than review. `with-each` publishes:
 *
 *     `with each` + an indented table, or `with each from "<file.csv>"`, above a `test`
 *
 * — three spans, and the third is the declaration a `with each` sits above. Taken as an alternate
 * spelling it compiles to a rule matching every `test "…"` line on the site: 120 hits, always green,
 * checking nothing. That is `D792`'s own failure class arriving through the back door, inside the
 * milestone that exists to remove it.
 *
 * The separator decides. A span is an alternate only when nothing but `/`, `or`, `and` or a comma
 * stands between it and the span before — which is exactly how the manifest writes real alternates
 * (`` `parallel` or `sequential` ``, `` `random number A to B` / `random decimal A to B` ``) and
 * never how it writes prose. Erring here costs an alternate spelling that a page may document
 * alone; it does not cost a check, because the first span always survives.
 */
export function alternateSpellings(syntax) {
  const spans = [...syntax.matchAll(/`([^`]+)`/g)];
  const kept = [];
  for (const [index, span] of spans.entries()) {
    if (index === 0) { kept.push(span[1]); continue; }
    const previous = spans[index - 1];
    const gap = syntax.slice(previous.index + previous[0].length, span.index);
    if (!/^\s*(?:\/|or|and|,)\s*$/.test(gap)) break;
    kept.push(span[1]);
  }
  return kept;
}

/**
 * `D837` — the config family publishes no `syntax`, and its matcher is derived from `slot` + `id`.
 *
 * This is the one place `D792`'s sentence *"the syntax field, which every manifest row already
 * carries"* is not true, and it is not true for 25 of the 112 constructs — measured, not assumed.
 * `ConfigKeywordEntry` carries `id`, `slot` and `summary` and no shape at all.
 *
 * Adding a `syntax` cell to those 25 rows was the other option and is refused here: the cell would
 * be written *for this gate*, by the same hand, with nothing holding it to the parser — a fifth
 * wordlist wearing the manifest's clothes — and it changes the manifest's shape, which
 * `SPEC_MANIFEST_VERSION` exists to make a loud break for every consumer. The slot is already the
 * shape: a `directive` opens a block, a `key` takes a value, a `probe` is a sub-clause. The gate
 * already knew this for one of the three (`probe <id>`) and hand-wrote it inline.
 *
 * Config constructs are matched only against strings read from a `tflw-config` fence or an inline
 * span, never from a `tflw` fence. Eight of the sixteen keys — `log`, `web`, `api`, `key`, `report`,
 * `allow`, `redact`, `timeout` — are words the step dialect also uses, and without the dialect the
 * match is the English coincidence this milestone is removing.
 */
function configPatterns(name, slot) {
  const id = escapeLiteral(name);
  if (slot === 'probe') return [`${SYNTAX_HEAD}probe\\s+${id}${SYNTAX_TAIL}`];
  if (slot === 'directive') return [`${SYNTAX_HEAD}${id}${SYNTAX_TAIL}`];
  return [`${SYNTAX_HEAD}${id}\\s+\\S`];
}

/**
 * Every shipped construct, paired with the regexes that recognise it and the dialect it belongs to.
 * Pure and exported so `doc-blocks.test.mjs` can assert a rule fails, which is the property a gate
 * built out of matchers has to have and the old one structurally could not.
 */
export function constructMatchers(constructs) {
  const matchers = [];
  for (const construct of constructs) {
    if (construct.family === 'diagnostic') continue;
    if (construct.family === 'config') {
      const slot = construct.id.split(':')[1];
      matchers.push({
        id: construct.id,
        family: construct.family,
        dialect: 'config',
        patterns: configPatterns(construct.name, slot).map((p) => new RegExp(p)),
      });
      continue;
    }
    const spans = alternateSpellings(construct.syntax ?? '');
    const sources = new Set();
    for (const span of spans) {
      for (const form of expandOptionals(span)) {
        const pattern = formToPattern(form);
        if (pattern) sources.add(pattern);
      }
    }
    matchers.push({
      id: construct.id,
      family: construct.family,
      dialect: 'tflw',
      patterns: [...sources].map((p) => new RegExp(p)),
    });
  }
  return matchers;
}

/**
 * The strings on a page a reader would read *as tflw*: every line of every `tflw`/`tflw-config`
 * fence, every inline code span, and the rows a page renders through Vue.
 *
 * Three details, each of which was wrong in a draft of this function and none of which announces
 * itself:
 *
 *  - **Fenced regions are blanked before inline spans are scanned.** A fence's own three backticks
 *    shift the pairing of every span after it in the file, which silently turns prose into code
 *    strings and code strings into prose. It reported `body csv` as absent from a page that shows it.
 *  - **An inline span may cross a line break.** `input-handling.md` writes ``a `body\nfrom` file``
 *    and `ci-and-reporting.md` breaks `log destination …` across two lines; a per-line scanner reads
 *    neither, and both look like undocumented constructs.
 *  - **A `v-for` row exists at runtime and in no markdown file.** `reference/matchers.md`,
 *    `generators.md`, `cli.md` and `diagnostics.md` render `spec-data.ts` manifests directly, so the
 *    strings a reader sees there are in no `.md` source. They are added from the manifest the page
 *    imports, and marked `generated` so the caller can tell "documented" from "tabulated".
 */
export function constructCorpus(files, manifests = {}) {
  const corpus = [];
  for (const { key, text } of files) {
    for (const block of extractBlocks(text)) {
      const kind = classify(block).kind;
      if (kind === 'file' || kind === 'fragment' || kind === 'config' || kind === 'config-fragment') {
        // `D837`: which dialect a line was written in is the only thing that separates a config key
        // from the ordinary English word spelling it. `log 5s` inside a `tflw` fence is the step;
        // inside a `tflw-config` fence it is the key. A corpus that forgets the fence cannot tell.
        const dialect = kind === 'config' || kind === 'config-fragment' ? 'config' : 'tflw';
        for (const line of block.source.split('\n')) corpus.push({ key, text: line.trim(), generated: false, dialect });
      }
    }

    for (const m of text.matchAll(/import\s*\{([^}]+)\}\s*from\s*'[^']*spec-data\.ts'/g)) {
      for (const name of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
        if (!new RegExp(`v-for="[^"]+ in ${name}"`).test(text)) continue;
        for (const row of manifests[name] ?? []) {
          for (const value of Object.values(row)) {
            // A generated table row is rendered outside any fence, so it belongs to both dialects —
            // and `onlyGenerated` already reports it as tabulated rather than explained.
            if (typeof value === 'string') corpus.push({ key, text: value, generated: true, dialect: 'any' });
          }
        }
      }
    }

    let inFence = false;
    const prose = text
      .split('\n')
      .map((line) => {
        if (/^\s*`{3,}/.test(line)) {
          inFence = !inFence;
          return '';
        }
        return inFence ? '' : line;
      })
      .join('\n');
    for (const m of prose.matchAll(/`([^`]+)`/gs)) {
      // An inline span carries no fence, so it cannot be attributed to one dialect.
      corpus.push({ key, text: m[1].replace(/\s+/g, ' ').trim(), generated: false, dialect: 'any' });
    }
  }
  return corpus;
}

/**
 * Every shipped construct is mentioned somewhere on the site, or declared as deliberately absent.
 *
 * `D657`'s roadmap scan is a denylist: it catches the sentence that went wrong and has nothing to
 * say about the sentence that was never written — which is the larger half of the class. Three
 * constructs (`probe ciphers`, `csrf from … send as header`, `seed spider`) were fully specified in
 * `SPEC.md` and appeared on no page at all, and no phrase list could ever have found them, because
 * an absent page matches no grep.
 *
 * **One manifest** (`D790`). `specConstructs()` returns all 178 constructs across seven families and
 * `specManifest.test.ts` holds it to `parser.ts`. This function used to assemble its own set out of
 * three of those families plus `GRAMMAR.md`'s multi-word productions, and reached 111 of them —
 * `LOCATORS` (6) and `DECLARATIONS` (12) were named by neither path, because `grammarPhrases` kept a
 * production only at two or more keyword literals and eleven of twelve declaration ids are single
 * words. Nothing failed as a result: the docs cover those families in prose. That is exactly why it
 * needed measuring rather than reasoning about, and why the repair is a derivation and not a fifth
 * wordlist.
 *
 * **Diagnostics are excluded by name** (`D791`), not by omitting a manifest and letting the number
 * come out right. All 66 are already held to the docs by `diagnosticsCoverage.test.ts`, since `M86`
 * — a page that `v-for`s `DIAGNOSTICS` cannot go stale against it. 178 - 66 = 112.
 *
 * `onlyGenerated` is reported rather than failed, and the distinction is the point. A construct that
 * appears solely in a `v-for` reference table **is** on the site — `D659`'s bar is met and failing it
 * would be a bar nobody agreed to — but a table row is a listing, not an explanation. Against the
 * pre-`M149c` site that line named `body bytes` and `matches file`, the two constructs `M149d` went
 * on to write prose for, so it is the next prose pass's worklist and it is printed on every run.
 */
export function scanConstructCoverage({
  files,
  constructs: specConstructs,
  manifests = {},
  allowlist = DECLARED_UNDOCUMENTED,
  checkStale = true,
}) {
  const corpus = constructCorpus(files, manifests);
  const matchers = constructMatchers(specConstructs ?? []);

  const byId = new Map();
  for (const matcher of matchers) {
    // A construct with no derivable shape is reported once, below, as the derivation defect it is.
    // Also calling it absent would be a second repair for one problem, and a wrong one: the gate
    // does not know whether it is on the site — it knows it cannot look.
    if (matcher.patterns.length === 0) continue;
    const hits = corpus.filter(
      (entry) =>
        (entry.dialect === 'any' || entry.dialect === matcher.dialect) &&
        matcher.patterns.some((re) => re.test(entry.text)),
    );
    byId.set(matcher.id, { id: matcher.id, family: matcher.family, hits });
  }

  const problems = [];
  const declared = new Set();
  const onlyGenerated = [];
  const unmatchable = [];
  for (const construct of byId.values()) {
    if (byId.get(construct.id).hits.length === 0) {
      const exemption = allowlist.get(construct.id);
      if (exemption) {
        declared.add(construct.id);
        continue;
      }
      problems.push({
        where: `specConstructs() \`${construct.id}\``,
        message: `a shipped construct that appears on no page: \`${construct.id}\``,
        detail:
          'A reader cannot learn a construct that is documented nowhere, and no phrase list can find\n' +
          'this — an absent page matches no grep. Write it into the chapter that owns its subject, or,\n' +
          'if it is deliberately undocumented, add it to DECLARED_UNDOCUMENTED in scripts/doc-blocks.mjs\n' +
          'with the reason that is not a gap.',
      });
      continue;
    }
    if (construct.hits.every((hit) => hit.generated)) onlyGenerated.push(construct.id);
  }

  // A construct whose `syntax` cell yielded no pattern would be silently *always covered* — the
  // failure class this whole rewrite is about, arriving one level up. It is a problem, not a skip.
  for (const matcher of matchers) {
    if (matcher.patterns.length === 0) {
      unmatchable.push(matcher.id);
      problems.push({
        where: `specConstructs() \`${matcher.id}\``,
        message: `no syntax shape could be derived for \`${matcher.id}\`, so nothing about it is being checked`,
        detail:
          'The manifest row publishes no parseable `syntax` cell. A matcher that cannot fail is not a\n' +
          'check — see D792. Give the row a syntax cell, or teach constructMatchers its shape.',
      });
    }
  }

  for (const [id, why] of checkStale ? allowlist : []) {
    if (declared.has(id)) continue;
    problems.push({
      where: `DECLARED_UNDOCUMENTED \`${id}\``,
      message: `\`${id}\` is documented now, or is no longer a construct`,
      detail: `the exemption reads: ${why}\nDelete the entry — an exemption that exempts nothing is a claim nobody is checking.`,
    });
  }

  return {
    problems,
    constructs: byId.size,
    corpus: corpus.length,
    onlyGenerated: [...new Set(onlyGenerated)].sort(),
    unmatchable,
  };
}
