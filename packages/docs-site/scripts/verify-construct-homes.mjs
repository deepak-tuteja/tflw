#!/usr/bin/env node
// A construct is documented in the chapter that owns it (`M233` `E`, `D1279`).
//
// `verify-docs.mjs` asks *is this documented anywhere on the site*. This asks *is it documented
// where a reader would look*. The difference is `M201`'s carry — **a floor is blind in exactly one
// direction** — and the concept is already named in this repository: `verify-docs.mjs`'s own
// failure text describes "a construct with a chapter that owns it and no sentence in it", applied
// there to one narrow subset. This generalises the rule that script already knows how to say.
//
// THE OWNER IS DECLARED, THE PRESENCE IS MEASURED. `construct-homes.mjs` says which chapters own a
// construct, chosen from what the construct *is*; this script asks whether one of them actually
// documents it, using the same corpus and the same syntax-shape matching `verify-docs.mjs` uses —
// never a phrase list, because an ordinary English word is not coverage.
//
// WHAT THIS DELIBERATELY DOES NOT CHECK. That a construct appears *only* in its owning chapter.
// Cross-references are how a guide works: think-time in a load test is a real use of a browser
// step, and a rule forbidding it would make the site worse to read. The claim is a floor in the
// other direction — the owning chapter must not be silent.
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { constructCorpus, constructMatchers, findMarkdownFiles } from './doc-blocks.mjs';
import { CONSTRUCT_HOMES, homesAreComplete } from './construct-homes.mjs';
import * as manifests from '@tflw/lang';

const ROOT = process.env.TFLW_DOCS_ROOT ?? fileURLToPath(new URL('..', import.meta.url));

export function scanConstructHomes({ files, constructs, manifests: mans, homes = CONSTRUCT_HOMES }) {
  const corpus = constructCorpus(files, mans);
  const matchers = constructMatchers(constructs);
  const problems = [];
  const unmatchable = [];
  let checked = 0;
  for (const m of matchers) {
    // A construct with no derivable shape is `verify-docs.mjs`'s problem and is reported there;
    // calling it homeless here would be a second repair for one defect, and a wrong one.
    if (m.patterns.length === 0) {
      unmatchable.push(m.id);
      continue;
    }
    const owners = homes.get(m.id);
    if (owners === undefined) continue; // completeness is `homesAreComplete`'s job, not this loop's
    checked++;
    const inOwner = corpus.some(
      (e) =>
        !e.generated &&
        owners.some((chapter) => e.key === `guide/${chapter}.md`) &&
        (e.dialect === 'any' || e.dialect === m.dialect) &&
        m.patterns.some((re) => re.test(e.text)),
    );
    if (inOwner) continue;
    const elsewhere = [
      ...new Set(
        corpus
          .filter((e) => !e.generated && e.key.startsWith('guide/') && (e.dialect === 'any' || e.dialect === m.dialect) && m.patterns.some((re) => re.test(e.text)))
          .map((e) => e.key),
      ),
    ].sort();
    problems.push({
      id: m.id,
      owners,
      elsewhere,
      message:
        elsewhere.length === 0
          ? `\`${m.id}\` is documented in no guide chapter at all; it is owned by ${owners.map((o) => `\`${o}\``).join(' or ')}`
          : `\`${m.id}\` is owned by ${owners.map((o) => `\`${o}\``).join(' or ')} and appears only in ${elsewhere.map((e) => `\`${e}\``).join(', ')}`,
    });
  }
  return { problems, checked, unmatchable };
}

// ── run ──────────────────────────────────────────────────────────────────────────────────────
const files = findMarkdownFiles(ROOT).map((path) => ({ key: relative(ROOT, path), text: readFileSync(path, 'utf8') }));
const constructs = manifests.specConstructs();
const missing = homesAreComplete(constructs);
const { problems, checked, unmatchable } = scanConstructHomes({ files, constructs, manifests });

if (missing.length > 0 || problems.length > 0) {
  console.error('verify-construct-homes: the site documents a construct away from the chapter that owns it.\n');
  for (const m of missing) console.error(`  · ${m}`);
  for (const p of problems) console.error(`  · ${p.message}`);
  console.error(
    '\n  The repair is a sentence in the owning chapter — not a table row, and not a move: a construct\n' +
      '  may legitimately appear in several chapters, and this rule only says the owner cannot be silent.\n' +
      '  If the owner itself is wrong, change it in scripts/construct-homes.mjs and say why there.',
  );
  process.exit(1);
}

console.log(`${checked} shipped constructs each documented in the chapter that owns it (${CONSTRUCT_HOMES.size} homes declared over ${new Set([...CONSTRUCT_HOMES.values()].flat()).size} chapters)`);
if (unmatchable.length > 0) console.log(`${unmatchable.length} skipped: no syntax shape — reported by verify-docs.mjs, not here`);
