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
