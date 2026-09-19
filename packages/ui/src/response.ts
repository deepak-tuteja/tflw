// Ticking a response into an assertion — `M213` `S2`, `D1100`.
//
// WHAT THIS REPLACES. The API door's way to assert on a body was: read the response in the Run
// tab, remember a path, come back to Compose, add an `expect`, type the path, type the value.
// Five steps across two tabs, and the two halves that have to agree — the path and the value —
// are both retyped from memory. `D1100`'s answer is that the response is already on screen with
// every path and every value in it, so the gesture is to **point at the ones that matter**.
//
// ONE TICK IS A PATH ASSERTION, SEVERAL ARE ONE SUBSET. That is the whole rule, and it is not an
// optimisation — the two say different things. `expect body.user.id equals 4021` asserts about one
// leaf; `expect body matches subset { user: { id: 4021, status: "active" } }` asserts about a
// shape. Writing three path assertions instead would be three failures to read on one wrong
// response, and writing one subset for a single leaf would name a shape where a value was meant.
//
// **AND A SUBSET IGNORES WHAT YOU DID NOT TICK**, which is the property that makes this safe to
// generate: a test written this way does not break when the API gains a field, and the
// volatile-token problem stops being a matcher problem — you do not assert that a token exists,
// you simply do not tick it. No ranked chooser, no heuristics, no volatility detection.
//
// **THE ARRAY RULE IS A MEASURED CONSTRAINT AND NOT A STYLE CHOICE.** `subsetMatch` in
// `matcher.ts` recurses into plain objects and compares everything else with `deepEqual` — so a
// ticked leaf under an array index cannot join a subset without silently turning
// *"`items[0].id` is 4"* into *"`items` is exactly this one-element array"*. That is a strictly
// stronger claim than the author made, it fails the first time the list grows, and nothing on the
// page would have said so. So a leaf whose path crosses an index is offered as a **path assertion
// only**, and `subsetable` below is what says which leaves those are.

import type { CaptureSpec, ExpectSpec } from '@tflw/lang';

/** One tickable value in a response body: where it is, what it says, and whether it can be part
 *  of a subset. */
export interface Leaf {
  /** The path under `body`, in the language's own spelling — `user.id`, `items[0].name`. */
  readonly path: string;
  /** The value as the language writes it: `4021`, `"active"`, `true`, `null`. */
  readonly valueText: string;
  /** False when the path crosses an array index — see the array rule above. */
  readonly subsetable: boolean;
}

/** How many leaves are listed before the walk stops.
 *
 *  A response is whatever the service sent, and this page has met a 4 MB one. The cap is on the
 *  **list**, not on the body: the body is still shown in full below the list, so nothing is hidden
 *  — what is bounded is the number of checkboxes, because a tick list nobody can scroll is not a
 *  gesture. The pane says when it stopped and at what. */
export const LEAF_CAP = 200;

/** What a response body offers to ticking. `skipped` is the count of scalars the **language**
 *  cannot address — see `unaddressable` below — and it is reported rather than silently dropped,
 *  because a list that quietly omits half a response is a list that lies about the response. */
export interface Tickable {
  readonly leaves: readonly Leaf[];
  readonly skipped: number;
  /** True when the walk stopped at `LEAF_CAP` — there are more leaves than are listed. */
  readonly capped: boolean;
}

/**
 * A path the language's `body.<path>` grammar cannot spell (`M213-18`).
 *
 * `build.ts`'s `bodyPath` takes a bare word per segment and optional `[n]` indexes, which is what
 * `parseBodyPath` will demand when the file is read back — so `body.content-type` and `body.0`
 * are not paths, and a real response carries both (a JSON object keyed by id, a header map
 * inlined into a body). This is a **language gap**, not a defect in this module, and `D1101` bars
 * closing it this round; what this module owes is to not offer a tick that cannot be written.
 */
function unaddressable(path: string): boolean {
  if (path === '') return false;
  return path.split('.').some((piece) => !/^[A-Za-z_]\w*(?:\[\d+\])*$/.test(piece));
}

/** The language's own text for a JSON scalar. `undefined` never occurs in parsed JSON. */
function valueText(value: unknown): string {
  return JSON.stringify(value) ?? 'null';
}

/**
 * Every scalar in a parsed response body, as a tickable leaf.
 *
 * An **empty object or array is itself a leaf**, and deliberately: `{}` and `[]` are things an
 * author asserts about, and a walk that only yielded scalars would offer no way to say *"`errors`
 * is empty"* at all. Its `valueText` is the literal, which `equals` compares structurally.
 */
export function leaves(bodyText: string): Tickable {
  let root: unknown;
  try {
    root = JSON.parse(bodyText);
  } catch {
    // Not JSON — no paths, no ticks. The body is still shown; there is simply nothing to point at.
    return { leaves: [], skipped: 0, capped: false };
  }
  const out: Leaf[] = [];
  let skipped = 0;
  let capped = false;
  const keep = (leaf: Leaf): void => {
    if (unaddressable(leaf.path)) {
      skipped += 1;
      return;
    }
    out.push(leaf);
  };
  const walk = (node: unknown, path: string, crossedArray: boolean): void => {
    if (out.length >= LEAF_CAP) {
      capped = true;
      return;
    }
    if (Array.isArray(node)) {
      if (node.length === 0) {
        keep({ path, valueText: '[]', subsetable: !crossedArray && path !== '' });
        return;
      }
      for (const [i, item] of node.entries()) walk(item, `${path}[${i}]`, true);
      return;
    }
    if (node !== null && typeof node === 'object') {
      const keys = Object.keys(node as Record<string, unknown>);
      if (keys.length === 0) {
        keep({ path, valueText: '{}', subsetable: !crossedArray && path !== '' });
        return;
      }
      for (const key of keys) {
        walk((node as Record<string, unknown>)[key], path === '' ? key : `${path}.${key}`, crossedArray);
      }
      return;
    }
    keep({ path, valueText: valueText(node), subsetable: !crossedArray && path !== '' });
  };
  walk(root, '', false);
  return { leaves: out, skipped, capped };
}

/**
 * The ticked leaves, nested back into an object literal — the operand of `matches subset`.
 *
 * **It rebuilds the shape rather than flattening it**, because that is what the matcher walks: a
 * subset's nesting has to mirror the response's, and `{ "user.id": 4021 }` would assert that the
 * response has a top-level key spelled with a dot in it. `D1100`'s own example is the nested form.
 *
 * Keys are quoted unconditionally. The grammar admits bare identifiers, and quoting every key is
 * one rule instead of two plus a spelling test — and it is what `print` emits for a key that needs
 * it, so a file written here and a file formatted later agree.
 */
export function subsetText(ticked: readonly Leaf[]): string {
  interface Node { readonly children: Map<string, Node>; value: string | null }
  const root: Node = { children: new Map(), value: null };
  for (const leaf of ticked) {
    const segments = leaf.path.split('.');
    let at = root;
    for (const segment of segments.slice(0, -1)) {
      let next = at.children.get(segment);
      if (!next) {
        next = { children: new Map(), value: null };
        at.children.set(segment, next);
      }
      at = next;
    }
    const last = segments[segments.length - 1]!;
    at.children.set(last, { children: new Map(), value: leaf.valueText });
  }
  const render = (node: Node): string => {
    if (node.value !== null) return node.value;
    const parts = [...node.children.entries()].map(([key, child]) => `${JSON.stringify(key)}: ${render(child)}`);
    return `{ ${parts.join(', ')} }`;
  };
  return render(root);
}

/**
 * What ticking these leaves builds — the one place the *one versus several* rule lives.
 *
 * `null` for an empty tick list, which is not an error: it is the state the button is disabled in,
 * and a caller that asked anyway gets nothing rather than `expect body matches subset { }`, which
 * parses, runs and asserts nothing at all.
 *
 * Several leaves of which any is not `subsetable` is **also** refused, with the reason, rather than
 * quietly dropping them or quietly widening the claim — see the array rule at the top.
 */
export function verifySpec(ticked: readonly Leaf[]): { ok: true; spec: ExpectSpec } | { ok: false; reason: string } | null {
  if (ticked.length === 0) return null;
  if (ticked.length === 1) {
    const only = ticked[0]!;
    return {
      ok: true,
      spec: {
        soft: false,
        quantifier: null,
        /** `path: ''` is the whole body, which `bodyPath` returns as no segments and the printer
         *  writes as a bare `body`. **Not `bodyText`** — that subject is the raw string, so a
         *  response that is the single scalar `42` would be compared against `"42"` and fail. */
        subject: { kind: 'body', path: only.path },
        matcher: 'equals',
        operand: only.valueText,
      },
    };
  }
  const barred = ticked.filter((l) => !l.subsetable);
  if (barred.length > 0) {
    return {
      ok: false,
      reason: `${barred.map((l) => `\`${l.path}\``).join(', ')} ${barred.length === 1 ? 'is' : 'are'} inside a list — \`matches subset\` compares a list exactly, so ticking one of these with anything else would assert the whole list. Tick it on its own for \`equals\`.`,
    };
  }
  return {
    ok: true,
    spec: {
      soft: false,
      quantifier: null,
      subject: { kind: 'body', path: '' },
      matcher: 'matchesSubset',
      operand: subsetText(ticked),
    },
  };
}

/**
 * The name a ticked path binds when it becomes a `capture` — `M213` `S3` (`D1102`).
 *
 * The last segment of the path, which is what the author already calls the thing: `body.user.id`
 * binds `id`, `body.data.orderId` binds `orderId`. **Not the whole dotted path flattened**, which
 * would give `userId` for one shape and `dataOrderId` for another and read like neither.
 *
 * A segment carrying an index loses it (`items[0].id` → `id`), because `[` is not a name
 * character and a bound name is a bare word. Every leaf offered by `leaves` is already
 * addressable, so the segment that survives is a legal identifier by construction — but the
 * builder is still the thing that decides, and it refuses a name it cannot print rather than
 * trusting this.
 */
export function captureName(path: string): string {
  const last = path.split('.').pop() ?? '';
  return last.replace(/\[\d+\]/g, '');
}

/**
 * The ticked leaves as `capture` statements — one per tick, `D1102`'s *capture the token*.
 *
 * **One per tick and not one combined statement**, which is the opposite of `verifySpec`'s rule
 * one construct over, and the difference is in the language rather than in taste: an `expect` can
 * assert about a whole shape (`matches subset`), so several ticks have a single sentence that
 * means what the author meant. A `capture` binds **one** name to **one** value; there is no
 * n-ary form, and inventing one by binding an object would change what the following requests can
 * interpolate. So N ticks are N statements, inserted as **one edit** — `stepsAfter` takes a list —
 * because a file between two writes whose second capture is missing is a file that does not run.
 *
 * An array leaf is fine here, unlike in a subset: `capture body.items[0].id as id` reads exactly
 * one value and claims nothing about the list. The array rule is `matches subset`'s, not ticking's.
 */
export function captureSpecs(ticked: readonly Leaf[]): readonly CaptureSpec[] {
  return ticked.map((leaf) => ({ subject: { kind: 'body', path: leaf.path }, name: captureName(leaf.path) }));
}
