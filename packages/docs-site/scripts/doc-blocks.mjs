// Page scanners for the docs site (M62, review finding OBS-01; extended by M149b/`D657`).
//
// Two scanners, shared by `verify-docs.mjs` and its own tests, with one job between them: make
// *silence impossible*. Every fenced block in every page comes back classified, including the ones
// nothing can check, and every forward-looking claim about tflw comes back either declared or as a
// failure — so a guard can report what it did not cover instead of omitting it.
//
// The old extractor recognised two tags and dropped everything else on the floor without counting
// it — 31 of 89 blocks checked behind a line reading `31/31 … parse cleanly`. See PLAN_DOC_TRUTH.md.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

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
export const NOTATION = [
  { what: 'a milestone', re: /\bM\d{1,3}[a-z]?\d*\b/g },
  { what: 'a decision', re: /\bD\d{2,3}\b/g },
  { what: 'a plan item', re: /\bP#\d+[a-z]?\b/g },
  { what: 'a bare decision citation', re: /\bdecisions?\s+\d+/g },
  { what: 'a review-ledger row', re: /\b(?:[A-Z]{1,3}\d+|DT|FU)-\d+\b/g },
];

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
export function scanPrivateNotation(files, { included = INCLUDED_RECORDS, patterns = NOTATION } = {}) {
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
 * Every multi-word construct the grammar spells out, read from `packages/lang/GRAMMAR.md`.
 *
 * The source matters more than the extraction. `GRAMMAR.md` is not prose that happens to list the
 * language — `grammarCoverage.test.ts` holds it to the parser: every keyword literal `parser.ts`
 * dispatches on must appear in a production there, or be exempted by name with a reason. So a
 * clause family cannot enter the language without passing through this file, which is what makes it
 * a manifest rather than a fifth hand-maintained wordlist (`B5-09`, four arcs running).
 *
 * This reads the **leading run of quoted literals** on a production's right-hand side — `'seed'
 * 'spider'`, `'csrf' 'from'`, `'probe' 'ciphers'` — and keeps the ones two words or longer. The
 * single-word half is covered by `spec-data.ts`'s own manifests, which carry a summary per entry;
 * the multi-word half has no manifest anywhere else, and it is where every construct `M149a`'s
 * truth pass found had been hiding. Measured against the pre-`M149c` site, this list alone names
 * four of the six absences that pass found by hand.
 *
 * A production whose leading literals are optional or alternated is read as far as the literals run
 * and no further; the phrase is a *search key*, not a re-statement of the grammar. Being wrong in
 * that direction costs a phrase that is trivially present, never a false failure.
 */
export function grammarPhrases(grammarText) {
  const phrases = new Set();
  for (const raw of grammarText.split('\n')) {
    const production = /^(?:[A-Za-z]\w*\s*:=|\|)\s*(.*)$/.exec(raw.trim());
    if (!production) continue;
    const lead = /^((?:'[a-z][a-z0-9]*'\s*)+)/.exec(production[1].split('#')[0]);
    if (!lead) continue;
    const words = [...lead[1].matchAll(/'([a-z][a-z0-9]*)'/g)].map((m) => m[1]);
    if (words.length >= 2) phrases.add(words.join(' '));
  }
  return [...phrases].sort();
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
        for (const line of block.source.split('\n')) corpus.push({ key, text: line.trim(), generated: false });
      }
    }

    for (const m of text.matchAll(/import\s*\{([^}]+)\}\s*from\s*'[^']*spec-data\.ts'/g)) {
      for (const name of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
        if (!new RegExp(`v-for="[^"]+ in ${name}"`).test(text)) continue;
        for (const row of manifests[name] ?? []) {
          for (const value of Object.values(row)) {
            if (typeof value === 'string') corpus.push({ key, text: value, generated: true });
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
      corpus.push({ key, text: m[1].replace(/\s+/g, ' ').trim(), generated: false });
    }
  }
  return corpus;
}

const leadingWord = (text) => (/^([a-z]+)\b/.exec(text) ?? [])[1];

/**
 * Every shipped construct is mentioned somewhere on the site, or declared as deliberately absent.
 *
 * `D657`'s roadmap scan is a denylist: it catches the sentence that went wrong and has nothing to
 * say about the sentence that was never written — which is the larger half of the class. Three
 * constructs (`probe ciphers`, `csrf from … send as header`, `seed spider`) were fully specified in
 * `SPEC.md` and appeared on no page at all, and no phrase list could ever have found them, because
 * an absent page matches no grep.
 *
 * Two manifests, because one construct set does not exist in one place:
 *
 *  - **`spec-data.ts`'s curated tables** — `STEP_KEYWORDS`, `CONFIG_KEYWORDS`, `WORKLOAD_DIRECTIVES`
 *    — held to `parser.ts` by `stepKeywords.test.ts`'s two-way parity. Single words, matched as the
 *    leading word of a code string. The weak half: `close`, `select`, `run` and `log` are ordinary
 *    English, so a code span that merely contains one satisfies the check. That is why the second
 *    manifest exists and is the sharper of the two.
 *  - **`GRAMMAR.md`'s multi-word productions** (see `grammarPhrases`) — held to `parser.ts` by
 *    `grammarCoverage.test.ts`. No word here is ordinary English by accident: a phrase is two or
 *    more keyword literals in sequence.
 *
 * `onlyGenerated` is reported rather than failed, and the distinction is the point. A construct that
 * appears solely in a `v-for` reference table **is** on the site — `D659`'s bar is met and failing it
 * would be a bar nobody agreed to — but a table row is a listing, not an explanation. Against the
 * pre-`M149c` site that line named `body bytes` and `matches file`, the two constructs `M149d` went
 * on to write prose for, so it is the next prose pass's worklist and it is printed on every run.
 */
export function scanConstructCoverage({
  files,
  grammarText,
  manifests = {},
  allowlist = DECLARED_UNDOCUMENTED,
  checkStale = true,
}) {
  const corpus = constructCorpus(files, manifests);
  const byLeadingWord = new Map();
  for (const entry of corpus) {
    const word = leadingWord(entry.text);
    if (!word) continue;
    if (!byLeadingWord.has(word)) byLeadingWord.set(word, []);
    byLeadingWord.get(word).push(entry);
  }

  const constructs = [];
  for (const entry of manifests.STEP_KEYWORDS ?? []) {
    constructs.push({ id: entry.id, manifest: 'STEP_KEYWORDS', hits: byLeadingWord.get(entry.id) ?? [] });
  }
  for (const entry of manifests.CONFIG_KEYWORDS ?? []) {
    // A `probe` sub-clause is never the leading word of anything — it is the second word of
    // `probe ciphers`, under an `authorized target`. Matched as the phrase a reader would type.
    const id = entry.slot === 'probe' ? `probe ${entry.id}` : entry.id;
    const hits = entry.slot === 'probe'
      ? corpus.filter((c) => c.text.includes(id))
      : (byLeadingWord.get(entry.id) ?? []);
    constructs.push({ id, manifest: `CONFIG_KEYWORDS (${entry.slot})`, hits });
  }
  for (const directive of manifests.WORKLOAD_DIRECTIVES ?? []) {
    constructs.push({ id: directive, manifest: 'WORKLOAD_DIRECTIVES', hits: byLeadingWord.get(directive) ?? [] });
  }
  for (const phrase of grammarPhrases(grammarText)) {
    constructs.push({ id: phrase, manifest: 'GRAMMAR.md', hits: corpus.filter((c) => c.text.includes(phrase)) });
  }

  // One construct, one problem. `probe ciphers` is in `CONFIG_KEYWORDS` *and* in `GRAMMAR.md`, and
  // two manifests agreeing it is absent is one absence — reporting it twice reads as two repairs.
  const byId = new Map();
  for (const construct of constructs) {
    const seen = byId.get(construct.id);
    if (seen) {
      seen.manifests.push(construct.manifest);
      seen.hits.push(...construct.hits);
    } else {
      byId.set(construct.id, { id: construct.id, manifests: [construct.manifest], hits: [...construct.hits] });
    }
  }

  const problems = [];
  const declared = new Set();
  const onlyGenerated = [];
  for (const construct of byId.values()) {
    if (construct.hits.length === 0) {
      const exemption = allowlist.get(construct.id);
      if (exemption) {
        declared.add(construct.id);
        continue;
      }
      problems.push({
        where: `${construct.manifests.join(' + ')} \`${construct.id}\``,
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

  for (const [id, why] of checkStale ? allowlist : []) {
    if (declared.has(id)) continue;
    problems.push({
      where: `DECLARED_UNDOCUMENTED \`${id}\``,
      message: `\`${id}\` is documented now, or is no longer a construct`,
      detail: `the exemption reads: ${why}\nDelete the entry — an exemption that exempts nothing is a claim nobody is checking.`,
    });
  }

  return { problems, constructs: byId.size, corpus: corpus.length, onlyGenerated: [...new Set(onlyGenerated)].sort() };
}
