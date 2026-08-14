// The Tier 3 mutation corpus (M134a, PLAN_M134_PENTEST_TIER3.md D368/D371/D372) — pure data plus
// the two pure functions that read an observed request: *where* can it be mutated, and *what does a
// mutated request look like*. No I/O, no clock, no network. `inputProbe.ts` sends; `inputRules.ts`
// judges; this file only knows what a payload is and where one can go.
//
// ## Fixed and enumerable, and "fuzzing" is retired for it (D368)
//
// Every payload below is applied to every mutable input, in a defined order, with no sampling and no
// RNG. The same suite against the same target produces byte-identical findings. That property is
// load-bearing rather than tidy: Tier 3 is the first thing in this arc that can produce findings in
// **volume**, `M134b`'s `--fail-on` turns findings into build failures, and a gate whose verdict
// depends on a draw is not a gate. The arc plan's word *fuzzing* (§3.1) describes something else and
// is not what ships here.
//
// ## Every payload carries its own invariants, and one with none cannot be constructed (D368)
//
// A payload with no invariant attached is a payload that cannot fail — D291's vacuity shape, one
// tier later. `INPUT_CORPUS` is therefore built through `defineCorpus`, which throws at module load
// rather than letting a silent no-op payload inflate the request count and the cost line while
// contributing nothing an oracle could ever read.

import type { RequestTrace } from './types.js';

/** The four classes D372 names, and the unit the `probe` sub-clauses opt into.
 *
 * `type-confusion` and `injection` are on by default; `oversized` and `traversal` each need their
 * own sibling line under `authorized target`. The split is not by danger-in-the-abstract but by
 * D21 layer 4's own words — *resource exhaustion* and *unauthorized access* are named there, and a
 * megabyte string and a `../../etc/passwd` are those two things respectively. */
export type MutationClass = 'type-confusion' | 'injection' | 'oversized' | 'traversal';

/** D367 — the `sec/` namespace, not `input/`. Measured before choosing: every rule this arc has
 * shipped is `sec/*`, Tier 2's included (`sec/authz-object-leak` sits beside `sec/csp-missing`).
 * The matcher separates the tiers; the namespace does not. */
export const INPUT_RULE_IDS = {
  errorDetailDisclosure: 'sec/error-detail-disclosure',
  reflectedInputUnescaped: 'sec/reflected-input-unescaped',
  pathTraversalRead: 'sec/path-traversal-read',
  oversizedInputAccepted: 'sec/oversized-input-accepted',
} as const;

export type InputRuleId = (typeof INPUT_RULE_IDS)[keyof typeof INPUT_RULE_IDS];

/** Where a payload can be delivered. Not every payload can go everywhere — see `Payload.targets`. */
export type SiteKind = 'path' | 'query' | 'body';

export interface Payload {
  /** Stable across runs and across releases: it names the payload in the report, in the emitted
   * repro and (via the site, not this) in nothing else. Renaming one is a user-visible change. */
  readonly id: string;
  readonly class: MutationClass;
  /** What a reader needs to know to decide whether the finding is real. */
  readonly description: string;
  /** The value as it is delivered. A path segment and a query value can only carry text; a JSON body
   * leaf carries a JSON value, which is the only place a *type* can be confused at all. */
  readonly text?: string;
  readonly json?: unknown;
  /** Which sites this payload can be delivered to. */
  readonly targets: readonly SiteKind[];
  /** The invariants this payload can violate. **Never empty** — `defineCorpus` refuses one that is,
   * because a payload no rule reads is a request sent for nothing. */
  readonly invariants: readonly InputRuleId[];
}

/**
 * The construction-time vacuity check D368 requires.
 *
 * Three properties, all of which a hand-maintained array drifts out of within two edits: every
 * payload declares at least one invariant, every payload can actually be delivered somewhere, and
 * every id is unique (two payloads sharing an id would collapse into one row in the report and one
 * fingerprint in `M134b`'s baseline, silently halving the corpus).
 *
 * Throwing at module load is deliberate. A corpus defect is not a finding and must not be reported
 * as one; it is a bug in tflw, and the loudest possible failure is the correct one.
 */
function defineCorpus(payloads: readonly Payload[]): readonly Payload[] {
  const seen = new Set<string>();
  for (const p of payloads) {
    if (!p.invariants.length) {
      throw new Error(`input corpus: payload "${p.id}" declares no invariant, so nothing could ever read its response (D368)`);
    }
    if (!p.targets.length) {
      throw new Error(`input corpus: payload "${p.id}" declares no target site, so it can never be delivered (D368)`);
    }
    if (p.text === undefined && p.json === undefined) {
      throw new Error(`input corpus: payload "${p.id}" carries neither \`text\` nor \`json\`, so there is nothing to send (D368)`);
    }
    if (p.targets.some((t) => t !== 'body') && p.text === undefined) {
      throw new Error(`input corpus: payload "${p.id}" targets a path or query site but carries no \`text\`; only a body leaf can carry a JSON value (D371)`);
    }
    if (seen.has(p.id)) throw new Error(`input corpus: duplicate payload id "${p.id}" — ids key the report and M134b's baseline`);
    seen.add(p.id);
  }
  return payloads;
}

const { errorDetailDisclosure, reflectedInputUnescaped, pathTraversalRead, oversizedInputAccepted } = INPUT_RULE_IDS;

/** 64 KiB. Big enough to clear any bound a schema plausibly declares (the common ones are 255, 1024
 * and "a few KB"), small enough that walking a corpus over a real suite is a measurable cost rather
 * than a denial of service against the fixture you authorized.
 *
 * D372 puts this class behind `probe oversized` precisely because D21 layer 4 names *resource
 * exhaustion*; the number is chosen so that the opt-in is about the category rather than about this
 * constant, and so that raising it later is a decision somebody makes on evidence. */
const OVERSIZED_BYTES = 64 * 1024;

/**
 * The corpus.
 *
 * **Injection payloads are detection-oriented and never execute anything** — D22's rule, restated
 * here because it is the difference between a scanner and an attack. Each one is chosen to make a
 * *vulnerable* parser complain: a bare quote unbalances an unparameterised SQL string, a trailing
 * semicolon unbalances a shell concatenation, `{{7*7}}` is arithmetic a template engine would
 * evaluate and nothing else would. None of them names a table, a file, a command or a host.
 *
 * **Type confusion is body-only, and that is a narrowing with a reason.** A path segment and a query
 * value are strings by construction — there is no type there to confuse, only a value to make
 * unexpected, which is what the injection and traversal payloads already do. Sending `null` as the
 * text `"null"` in a query string would test the app's string handling while the report claimed it
 * had tested its type handling, which is worse than not testing it.
 */
export const INPUT_CORPUS: readonly Payload[] = defineCorpus([
  // -- type confusion (default on) -------------------------------------------
  {
    id: 'type/null',
    class: 'type-confusion',
    description: 'a JSON null where a scalar was observed',
    json: null,
    targets: ['body'],
    invariants: [errorDetailDisclosure],
  },
  {
    id: 'type/boolean',
    class: 'type-confusion',
    description: 'a JSON boolean where a scalar was observed',
    json: true,
    targets: ['body'],
    invariants: [errorDetailDisclosure],
  },
  {
    id: 'type/number',
    class: 'type-confusion',
    description: 'a JSON number where a scalar was observed',
    json: 1234567890,
    targets: ['body'],
    invariants: [errorDetailDisclosure],
  },
  {
    id: 'type/array',
    class: 'type-confusion',
    description: 'a JSON array where a scalar was observed',
    json: ['tflw'],
    targets: ['body'],
    invariants: [errorDetailDisclosure],
  },
  {
    id: 'type/object',
    class: 'type-confusion',
    description: 'a JSON object where a scalar was observed',
    json: { tflw: 1 },
    targets: ['body'],
    invariants: [errorDetailDisclosure],
  },

  // -- injection strings (default on, detection-oriented) --------------------
  {
    id: 'injection/sql-quote',
    class: 'injection',
    // The classic, and the reason it is first: an unparameterised query concatenating this throws a
    // syntax error the moment it reaches the database, and a server that returns that error's text
    // has told you both that the input reached SQL and that its errors are not handled.
    description: "an unbalanced single quote, which a concatenated SQL string cannot parse",
    text: "tflw'",
    json: "tflw'",
    targets: ['path', 'query', 'body'],
    invariants: [errorDetailDisclosure],
  },
  {
    id: 'injection/sql-double-quote',
    class: 'injection',
    description: 'an unbalanced double quote, for dialects and drivers that quote with it',
    text: 'tflw"',
    json: 'tflw"',
    targets: ['path', 'query', 'body'],
    invariants: [errorDetailDisclosure],
  },
  {
    id: 'injection/shell-metacharacter',
    class: 'injection',
    // A trailing separator and nothing after it. If this value is concatenated into a shell command
    // the shell has a syntax error to complain about and **no command to run** — which is the whole
    // of D22's reveal-without-exercising rule in one payload.
    description: 'a trailing shell command separator with no command after it',
    text: 'tflw;',
    json: 'tflw;',
    targets: ['path', 'query', 'body'],
    invariants: [errorDetailDisclosure],
  },
  {
    id: 'injection/template-expression',
    class: 'injection',
    // Arithmetic only. A template engine that evaluates it produces `49`; nothing else in the stack
    // can be harmed by it. The oracle here reads disclosure and reflection — a `49` in the body is
    // template injection, but naming that is a rule this tier does not ship, so the payload earns
    // its place on the two invariants it does carry.
    description: 'a template expression made of arithmetic, which only a template engine will evaluate',
    text: '{{7*7}}',
    json: '{{7*7}}',
    targets: ['path', 'query', 'body'],
    invariants: [errorDetailDisclosure, reflectedInputUnescaped],
  },
  {
    id: 'injection/html-metacharacters',
    class: 'injection',
    // Not a script. A bare tag with a nonsense name: if it comes back inside an HTML body with its
    // angle brackets intact, the application does not escape what it echoes, which is the finding.
    // An actual `<script>` would be the same evidence plus a live payload in somebody's browser.
    description: 'raw HTML metacharacters around an inert tag name',
    text: '<tflw>',
    json: '<tflw>',
    targets: ['path', 'query', 'body'],
    invariants: [reflectedInputUnescaped, errorDetailDisclosure],
  },

  // -- oversized values (opt-in: `probe oversized`) --------------------------
  {
    id: 'oversized/64kib-string',
    class: 'oversized',
    description: `a ${OVERSIZED_BYTES / 1024} KiB string, far beyond any bound a schema plausibly declares`,
    text: 'A'.repeat(OVERSIZED_BYTES),
    json: 'A'.repeat(OVERSIZED_BYTES),
    targets: ['query', 'body'],
    invariants: [oversizedInputAccepted, errorDetailDisclosure],
  },

  // -- traversal (opt-in: `probe traversal`) ---------------------------------
  {
    id: 'traversal/relative',
    class: 'traversal',
    description: 'a relative path escaping the intended directory',
    text: '../../../../etc/passwd',
    json: '../../../../etc/passwd',
    targets: ['path', 'query', 'body'],
    invariants: [pathTraversalRead, errorDetailDisclosure],
  },
  {
    id: 'traversal/encoded',
    class: 'traversal',
    // The same journey past a filter that rejects a literal `../` and then decodes. Kept separate
    // rather than folded, because an application that stops one and not the other is exactly the
    // application worth telling about, and one payload could not say which happened.
    description: 'a percent-encoded relative path, for filters that reject `../` before decoding',
    text: '..%2f..%2f..%2f..%2fetc%2fpasswd',
    json: '..%2f..%2f..%2f..%2fetc%2fpasswd',
    targets: ['path', 'query', 'body'],
    invariants: [pathTraversalRead, errorDetailDisclosure],
  },
  {
    id: 'traversal/doubled-dot-slash',
    class: 'traversal',
    description: 'a doubled `....//` sequence, which a single-pass `../` stripper turns back into `../`',
    text: '....//....//....//....//etc/passwd',
    json: '....//....//....//....//etc/passwd',
    targets: ['path', 'query', 'body'],
    invariants: [pathTraversalRead, errorDetailDisclosure],
  },
  {
    id: 'traversal/absolute',
    class: 'traversal',
    description: 'an absolute path, for handlers that join without checking',
    text: '/etc/passwd',
    json: '/etc/passwd',
    targets: ['path', 'query', 'body'],
    invariants: [pathTraversalRead, errorDetailDisclosure],
  },
]);

/** The classes that need no opt-in (D372). Kept as data beside the corpus rather than as a condition
 * in the probe, so "which classes are on by default" is answerable by reading one line. */
export const DEFAULT_ON_CLASSES: readonly MutationClass[] = ['type-confusion', 'injection'];

/** Which `probe` sub-clause grants each opt-in class. A total record over the opt-in classes, so a
 * fifth class cannot be added without deciding whether it needs a word. */
export const CLASS_OPT_IN: Readonly<Partial<Record<MutationClass, 'oversized' | 'traversal'>>> = {
  oversized: 'oversized',
  traversal: 'traversal',
};

// ---------------------------------------------------------------------------
// Mutation sites — where an observed request can be mutated (D371)
// ---------------------------------------------------------------------------

export interface MutationSite {
  readonly kind: SiteKind;
  /** Path: the segment index. Query: the parameter name. Body: a dotted path to the leaf. */
  readonly key: string;
  /** How the site reads in a report and in a fingerprint — `path segment 3`, `query \`q\``,
   * `body \`items[0].name\``. Computed once here so the reporter, the failure message and D376's
   * fingerprint cannot drift into three spellings of one location. */
  readonly location: string;
  /** What was observed there. Carried so a rule can tell a reflected *payload* from a reflected
   * *original*, and so the not-applicable listing can say what it found. */
  readonly observed: unknown;
}

/**
 * Whether a path segment is a resource **identifier** rather than a route word.
 *
 * The distinction decides both the mutation surface and D376's templated path, which is why it is
 * one function: mutating `/v1/orders/{id}` at the `{id}` exercises the handler, and mutating it at
 * `orders` exercises the router — a `404` from a route that does not exist is not a finding about
 * input handling, and a corpus that spent a quarter of its requests earning them would make the
 * cost line a lie about what was tested.
 *
 * Deliberately narrow: a UUID, a run of digits, or a long hex string. A slug like `my-first-order`
 * is *not* recognised, and that is the safe direction — an unrecognised identifier costs coverage
 * and says so through the sites listing, while a misrecognised route word costs a wall of 404s.
 */
export function isIdentifierSegment(segment: string): boolean {
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(segment)) return true;
  if (/^\d+$/.test(segment)) return true;
  if (/^[0-9a-fA-F]{24,}$/.test(segment)) return true;
  return false;
}

/**
 * The endpoint as a normalized `METHOD /templated/path` — every identifier segment replaced by
 * `{id}`.
 *
 * D376's fingerprint is built on this so that the same weakness on `/orders/a1` and `/orders/a2`
 * fingerprints identically. A fingerprint keyed on the concrete URL would put one weakness in a
 * baseline under as many entries as the suite has fixtures, which is the churn `--baseline` exists
 * to prevent.
 */
export function templateEndpoint(method: string, url: string): string {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url;
  }
  const templated = path
    .split('/')
    .map((seg) => (isIdentifierSegment(seg) ? '{id}' : seg))
    .join('/');
  return `${method.toUpperCase()} ${templated}`;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isLeafScalar(v: unknown): boolean {
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

/**
 * Every leaf scalar in a parsed JSON body, as a dotted path.
 *
 * **Leaves only, one at a time** (D371). Nested objects and arrays are walked; a whole object is
 * never replaced. Mutating two fields at once makes attribution impossible, and attribution is the
 * first thing a differential oracle loses.
 *
 * `null` is not a leaf here: there is no observed type to confuse and nothing to reflect, so a
 * payload delivered there could only ever be judged as though the field had been absent.
 */
function bodyLeaves(node: unknown, prefix: string, out: MutationSite[]): void {
  if (Array.isArray(node)) {
    node.forEach((el, i) => bodyLeaves(el, `${prefix}[${i}]`, out));
    return;
  }
  if (isPlainObject(node)) {
    for (const k of Object.keys(node)) bodyLeaves(node[k], prefix ? `${prefix}.${k}` : k, out);
    return;
  }
  if (isLeafScalar(node) && prefix) out.push({ kind: 'body', key: prefix, location: `body \`${prefix}\``, observed: node });
}

/**
 * Every place this observed request can be mutated (D371), in a fixed order: path, then query, then
 * body — which is also the order they appear in the request, so a reader walking the report walks
 * the request.
 *
 * Returns an empty array for a request with no identifier segment, no query and no JSON body — and
 * that emptiness is the whole of `TF067`: an input-handling assertion on such a step has no power to
 * fail, and D285 says that is a failure rather than a green.
 */
export function mutationSites(request: RequestTrace): MutationSite[] {
  const sites: MutationSite[] = [];

  let url: URL | undefined;
  try {
    url = new URL(request.url);
  } catch {
    url = undefined;
  }

  if (url) {
    const segments = url.pathname.split('/');
    segments.forEach((seg, i) => {
      if (isIdentifierSegment(seg)) sites.push({ kind: 'path', key: String(i), location: `path segment ${i}`, observed: seg });
    });
    // `searchParams` iterates in the order the query string was written, and a repeated key yields
    // each occurrence — so a repeated parameter gives two sites rather than silently collapsing to
    // the last, which is the shape an app most often gets wrong.
    const seenQuery = new Map<string, number>();
    for (const [name, value] of url.searchParams) {
      const n = (seenQuery.get(name) ?? 0) + 1;
      seenQuery.set(name, n);
      const key = n === 1 ? name : `${name}#${n}`;
      sites.push({ kind: 'query', key, location: `query \`${key}\``, observed: value });
    }
  }

  if (request.body !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(request.body);
    } catch {
      // A body this oracle cannot parse offers no leaves. Not an error: a form post or a binary
      // upload is a perfectly ordinary request, and the sites listing reports what it found.
      parsed = undefined;
    }
    if (parsed !== undefined) bodyLeaves(parsed, '', sites);
  }

  return sites;
}

/** The payloads that may be sent given which classes are enabled, in corpus order. */
export function enabledPayloads(classes: readonly MutationClass[], corpus: readonly Payload[] = INPUT_CORPUS): Payload[] {
  const on = new Set(classes);
  return corpus.filter((p) => on.has(p.class));
}

/** Which payloads can reach a given site — a body leaf takes everything, a path or query site takes
 * only the payloads with a text form (D371's type-confusion narrowing). */
export function payloadsForSite(site: MutationSite, payloads: readonly Payload[]): Payload[] {
  return payloads.filter((p) => p.targets.includes(site.kind));
}

// ---------------------------------------------------------------------------
// Applying one mutation — the request as it will actually be sent
// ---------------------------------------------------------------------------

function setBodyLeaf(node: unknown, path: readonly (string | number)[], value: unknown): unknown {
  if (!path.length) return value;
  const [head, ...rest] = path;
  if (typeof head === 'number' && Array.isArray(node)) {
    const copy = [...node];
    copy[head] = setBodyLeaf(node[head], rest, value);
    return copy;
  }
  if (typeof head === 'string' && isPlainObject(node)) {
    return { ...node, [head]: setBodyLeaf(node[head], rest, value) };
  }
  return node;
}

/** `items[0].name` → `['items', 0, 'name']`. The inverse of what `bodyLeaves` writes, kept beside it
 * so the two spellings of a body path cannot drift. */
export function parseBodyPath(key: string): (string | number)[] {
  const out: (string | number)[] = [];
  for (const part of key.split('.')) {
    const m = /^([^[]*)((?:\[\d+\])*)$/.exec(part);
    if (!m) {
      out.push(part);
      continue;
    }
    if (m[1]) out.push(m[1]);
    for (const idx of m[2]!.matchAll(/\[(\d+)\]/g)) out.push(Number(idx[1]));
  }
  return out;
}

export interface MutatedRequest {
  readonly url: string;
  readonly body?: string;
}

/**
 * The observed request with exactly one site replaced by one payload.
 *
 * **Everything else travels verbatim** — method, every other field, every header including the
 * identity ones. That is the single line separating this tier from Tier 2 (D370/D375): Tier 2
 * strips `Authorization`/`Cookie` and applies a different principal, so a cookie session's own
 * CSRF token no longer matches and the guard refuses before authorization is consulted. Tier 3
 * changes no identity at all, so the observed request's own `X-CSRF-Token` still matches and the
 * mutated payload reaches the code it was sent to test.
 */
export function applyMutation(request: RequestTrace, site: MutationSite, payload: Payload): MutatedRequest {
  if (site.kind === 'body') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(request.body ?? '');
    } catch {
      return { url: request.url, ...(request.body === undefined ? {} : { body: request.body }) };
    }
    // `null !== undefined`, so `type/null` correctly delivers a JSON null here rather than falling
    // through to its (absent) text form. `defineCorpus` guarantees one of the two exists.
    const value = payload.json !== undefined ? payload.json : payload.text;
    const mutated = setBodyLeaf(parsed, parseBodyPath(site.key), value);
    return { url: request.url, body: JSON.stringify(mutated) };
  }

  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return { url: request.url, ...(request.body === undefined ? {} : { body: request.body }) };
  }

  if (site.kind === 'path') {
    const segments = url.pathname.split('/');
    const index = Number(site.key);
    // `encodeURIComponent` rather than raw insertion: a traversal payload must be delivered as a
    // *segment value*, not as extra structure in the URL. Letting `../` through unencoded would have
    // `new URL` normalise it away before the request ever left, so the probe would test nothing and
    // report clean — the quietest possible false negative.
    segments[index] = encodeURIComponent(payload.text ?? '');
    url.pathname = segments.join('/');
    return { url: url.toString(), ...(request.body === undefined ? {} : { body: request.body }) };
  }

  // Rebuilt entry by entry rather than `searchParams.set`, which replaces **every** occurrence of a
  // repeated key with a single one. `mutationSites` deliberately yields one site per occurrence
  // (`q`, `q#2`), so a `set` here would mutate the site it was asked to *and* delete its sibling,
  // changing two inputs in one probe — the exact attribution loss D371 forbids for body leaves.
  const [name, ordinal] = site.key.split('#');
  const wanted = ordinal === undefined ? 1 : Number(ordinal);
  const rebuilt = new URLSearchParams();
  let seen = 0;
  for (const [k, v] of url.searchParams) {
    if (k === name) {
      seen++;
      rebuilt.append(k, seen === wanted ? (payload.text ?? '') : v);
    } else rebuilt.append(k, v);
  }
  url.search = rebuilt.toString();
  return { url: url.toString(), ...(request.body === undefined ? {} : { body: request.body }) };
}
