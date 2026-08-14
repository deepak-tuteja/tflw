// The seeded mutation layer (M134b, PLAN_M134_PENTEST_TIER3.md D369/D388) — `n` generated payloads
// per already-granted class, drawn from the run seed, appended to the fixed corpus.
//
// ## Why this is a separate file from `inputCorpus.ts`
//
// The corpus is a *constant*: it is reviewed, its ids are user-visible, and `defineCorpus` refuses a
// payload no rule can read. This file produces payloads that nobody reviewed, under ids nobody
// promised to keep. Keeping them in one module would make the constant look derived and the derived
// look constant, and the whole point of D369 is that the two halves have different standing — one
// gates a build, the other cannot.
//
// ## The layer grants nothing (D388)
//
// `seededPayloads` takes the classes the target **already** granted and generates within them. It is
// never handed the full class list. Seeding is a capability of the run; a safety class is a claim in
// the config; a command-line flag that widened the second by asking more of the first would undo
// D372 through the back door. That is D21 layer 4's rule restated, not a new one.
//
// **This is the third gate, not the control — measured, not assumed.** `M134b`'s mutation sweep
// applied the obvious defect here (hand this function every class instead of the granted ones) and
// it **SURVIVED**: `planProbes` filters the corpus through `enabledPayloads(classes, …)`, and
// `InputProber` refuses each probe's class again before it sends. So a generated traversal payload
// on an ungranted target is built, then dropped at planning, then would be refused at sending — no
// request leaves the process, and the mutation is equivalent code rather than a hole.
//
// It stays anyway, and the reason is worth stating rather than leaving as taste: the two gates that
// actually carry the property are downstream of a *filter*, and a filter is the kind of thing a
// later refactor removes as redundant once the caller "already" restricts. Narrowing at the source
// costs one parameter and means the generated set is never wrong in the first place. What changed is
// the claim in this comment — the sweep is the reason this file no longer says the signature is what
// enforces D388. `input-class-optin-ignored` (m134a) is the mutation that covers the real control.
//
// ## Why the payloads are *mutations of corpus shapes* rather than random bytes
//
// A random string finds nothing: the rules read for a stack frame, an SQL error, a reflected value,
// a file's contents. A payload that cannot violate any invariant is a request sent for nothing —
// which is exactly what `defineCorpus`'s vacuity guard refuses in the reviewed half, and the same
// standard applies here even though nothing can throw. So each generated payload is built from the
// same grammar the corpus draws on (quoting characters, traversal depths, encodings, type shapes)
// with the specific choices drawn from the seed. The layer explores *around* the corpus, which is
// also what makes "promote this payload" a sentence somebody can act on: the promoted payload looks
// like the ones already there.

import { INPUT_RULE_IDS, type MutationClass, type Payload, type SiteKind } from './inputCorpus.js';
import { mulberry32, subSeed } from './seed.js';

const { errorDetailDisclosure, reflectedInputUnescaped, pathTraversalRead, oversizedInputAccepted } = INPUT_RULE_IDS;

/** The prefix every generated payload id carries. The interpreter recognises a seeded finding by
 * looking its payload up in the run's generated set — **not** by this prefix, because an id is a
 * display string and matching on one would make a corpus payload named `seeded/...` non-gating.
 * It exists so a report reads unambiguously. */
export const SEEDED_ID_PREFIX = 'seeded/';

/** Upper bound on `--probe-seeded <n>`.
 *
 * Not a safety control — the class gates are, and this layer cannot widen them. It is a bound on the
 * one thing D381 asked to be kept true: probes stay sequential and one in flight, so the corpus's
 * size is directly a wall-clock cost carried by a single assertion. 64 per class against the four
 * classes is already several hundred extra requests per mutable site; past that the honest answer is
 * a narrower `--tags` run, not a bigger number. Refused loudly rather than clamped, because a clamp
 * makes a run quieter than the flag the operator typed. */
export const MAX_SEEDED_PER_CLASS = 64;

/** Characters that unbalance a parser that is concatenating rather than parameterising. The corpus
 * ships the four commonest; these are the same family, and none of them names a table, a file, a
 * command or a host — D22's detection-not-execution rule applies to the generated half unchanged. */
const QUOTING = ["'", '"', '`', '\\', ';', '--', '/*', '*/', '${', '}}', '{{', '#'];

const TEMPLATE_EXPRESSIONS = ['{{7*7}}', '${7*7}', '<%= 7*7 %>', '#{7*7}'];

const TRAVERSAL_PREFIXES = ['../', '..\\', '%2e%2e%2f', '..%2f', '....//'];

const TRAVERSAL_TARGETS = ['etc/passwd', 'etc/hosts', 'proc/self/environ', 'windows/win.ini'];

/** Body-only, and for `inputCorpus.ts`'s stated reason: a path segment and a query value are strings
 * by construction, so there is no type there to confuse. */
const TYPE_SHAPES: readonly unknown[] = [null, true, false, 0, -1, 1.5, [], {}, [null], { tflw: null }, '', ' '];

function pick<T>(rng: () => number, xs: readonly T[]): T {
  return xs[Math.floor(rng() * xs.length) % xs.length]!;
}

function intBetween(rng: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/**
 * Draw `n` payloads for one class.
 *
 * Deterministic in `(seed, klass, n)` and in nothing else: the class's own sub-seed is derived from
 * the run seed, so adding a class to a target does not shift the payloads another class draws. A run
 * that reported a seeded finding can be reproduced exactly with `--seed <n> --probe-seeded <n>`,
 * which is the only reason the seed is printed beside the finding at all.
 */
function drawForClass(klass: MutationClass, n: number, seed: number): Payload[] {
  const rng = mulberry32(subSeed(seed, CLASS_INDEX[klass]));
  const out: Payload[] = [];
  for (let i = 0; i < n; i++) out.push(DRAW[klass](rng, i));
  return out;
}

/** Fixed per class so one class's stream never depends on which other classes were granted. */
const CLASS_INDEX: Readonly<Record<MutationClass, number>> = {
  'type-confusion': 1,
  injection: 2,
  oversized: 3,
  traversal: 4,
};

const ALL_SITES: readonly SiteKind[] = ['path', 'query', 'body'];

const DRAW: Readonly<Record<MutationClass, (rng: () => number, i: number) => Payload>> = {
  'type-confusion': (rng, i) => ({
    id: `${SEEDED_ID_PREFIX}type/${i}`,
    class: 'type-confusion',
    description: 'a generated JSON shape where a scalar was observed',
    json: pick(rng, TYPE_SHAPES),
    targets: ['body'],
    invariants: [errorDetailDisclosure],
  }),

  injection: (rng, i) => {
    // Half the draws are a quoting character wrapped around the corpus's marker token, half are a
    // template expression: the two invariants this class can violate are read by different detectors
    // (a parser complaining, and a value coming back evaluated), and a stream that only ever produced
    // one shape would leave the other rule permanently not-applicable in the seeded half.
    const template = rng() < 0.5;
    const text = template ? pick(rng, TEMPLATE_EXPRESSIONS) : `tflw${pick(rng, QUOTING)}${pick(rng, QUOTING)}`;
    return {
      id: `${SEEDED_ID_PREFIX}injection/${i}`,
      class: 'injection',
      description: template ? 'a generated template expression' : 'generated unbalanced quoting around a marker',
      text,
      targets: ALL_SITES,
      invariants: [errorDetailDisclosure, reflectedInputUnescaped],
    };
  },

  oversized: (rng, i) => {
    // Kept strictly under the corpus's own 64 KiB: the reviewed payload is the one that clears any
    // bound a schema plausibly declares, and a generated payload has no business being the largest
    // thing the suite sends. The interesting sizes are the ones *near* a declared bound anyway —
    // 255, 1024, a few KB — which is what this range walks.
    const size = intBetween(rng, 256, 32 * 1024);
    return {
      id: `${SEEDED_ID_PREFIX}oversized/${i}`,
      class: 'oversized',
      description: `a generated ${size}-character value`,
      text: 'A'.repeat(size),
      targets: ALL_SITES,
      invariants: [oversizedInputAccepted, errorDetailDisclosure],
    };
  },

  traversal: (rng, i) => {
    const depth = intBetween(rng, 1, 6);
    const text = pick(rng, TRAVERSAL_PREFIXES).repeat(depth) + pick(rng, TRAVERSAL_TARGETS);
    return {
      id: `${SEEDED_ID_PREFIX}traversal/${i}`,
      class: 'traversal',
      description: `a generated traversal ${depth} level${depth === 1 ? '' : 's'} deep`,
      text,
      targets: ALL_SITES,
      invariants: [pathTraversalRead, errorDetailDisclosure],
    };
  },
};

/**
 * The layer.
 *
 * `granted` is what `authorized target` permitted for this origin — nothing here consults the config
 * or widens it. `n` is `--probe-seeded`'s value; `0` (the default) returns an empty array, so a run
 * that did not ask for the layer sends byte-for-byte the requests it sent before this milestone.
 *
 * Throws on a value outside the bound, which is the same standing `defineCorpus` gives a corpus
 * defect: this is a mistake in an invocation, not a finding, and the loudest failure is the correct
 * one.
 */
export function seededPayloads(granted: readonly MutationClass[], n: number, seed: number): Payload[] {
  if (n === 0) return [];
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`--probe-seeded expects a whole number of payloads per class, got ${n}`);
  }
  if (n > MAX_SEEDED_PER_CLASS) {
    throw new Error(
      `--probe-seeded ${n} exceeds the ${MAX_SEEDED_PER_CLASS}-per-class bound; probes are strictly sequential (D381), ` +
        'so this is wall-clock a single assertion pays — narrow the run with `--tags` instead of widening the corpus',
    );
  }
  // Corpus class order, not `granted`'s order, so two targets granting the same classes in a
  // different order produce the same payloads in the same positions.
  const order: MutationClass[] = ['type-confusion', 'injection', 'oversized', 'traversal'];
  const out: Payload[] = [];
  for (const klass of order) {
    if (granted.includes(klass)) out.push(...drawForClass(klass, n, seed));
  }
  return out;
}

/**
 * The set of payload ids this run generated, for the boundary that has to decide whether a finding
 * gates.
 *
 * A `Set` of ids rather than the prefix, so a corpus payload someone names `seeded/...` is still
 * fingerprinted and still gates. The identity of the seeded half is *"this run drew it"*, which is a
 * fact the run holds, not a fact about the string.
 */
export function seededIds(payloads: readonly Payload[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of payloads) m.set(p.id, p.text ?? JSON.stringify(p.json));
  return m;
}
