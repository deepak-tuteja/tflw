/**
 * The one element a case must produce, asserted and returned in one step (`M173b`).
 *
 * `M155-01`: nothing typechecked these files, so `diags[0].message` read as ordinary code while the
 * compiler would have said `Object is possibly 'undefined'` — 17 of `@tflw/lang`'s 34 errors are
 * that shape, and `packages/runtime` carries far more of it.
 *
 * The obvious repairs are `diags[0]!` and a bare `assert.equal(diags.length, 1)` on the line above.
 * Both are refused for the same reason: they put the claim and the access in two places, so the
 * assertion can be deleted, weakened, or moved past a later edit while the index goes on reading
 * position zero — the two-copies-of-one-fact shape this repository keeps filing. Here the assertion
 * IS the access, and neither can be had without the other.
 *
 * It also buys a better failure. `diags[0].message` on an empty array throws *"Cannot read
 * properties of undefined (reading 'message')"*, which says nothing about the case; this says how
 * many the checker actually produced, which is the number the reader wants.
 */
import assert from 'node:assert/strict';

export function only<T>(xs: readonly T[], what = 'diagnostic'): T {
  assert.equal(xs.length, 1, `expected exactly one ${what}, got ${xs.length}`);
  return xs[0] as T;
}

/** The first of several, where the case is deliberately about more than one. */
export function first<T>(xs: readonly T[], what = 'diagnostic'): T {
  assert.ok(xs.length > 0, `expected at least one ${what}, got none`);
  return xs[0] as T;
}

/**
 * The AST node a case is about, narrowed to its real member type (`M173b`).
 *
 * The shape this replaces is `firstStep(src) as { type: string; path: { value: string } }` — a cast
 * to a structural shape the *test* invented. Twelve of `@tflw/lang`'s 34 errors are that, reported
 * as `TS2352` because `Step` and the ad-hoc object do not sufficiently overlap.
 *
 * `as unknown as { … }` would silence every one of them and is refused, because the ad-hoc shape is
 * the defect and not the diagnostic. A test asserting against a shape it made up cannot notice the
 * AST changing underneath it — which is exactly the guarantee `M155-01` says is enforced over `src`
 * only. Narrowing to `Extract<Step, { type: K }>` checks the test against the node the parser
 * actually builds, so renaming a field in `ast.ts` reddens the test instead of passing it.
 *
 * `assert.equal(step.type, 'OpenStmt')` on the line above does not narrow — `assert.equal` is not a
 * type guard — so the assertion and the narrowing are the same call here, for `only`'s reason.
 */
export function asNode<T extends { type: string }, K extends T['type']>(node: T, type: K): Extract<T, { type: K }> {
  assert.equal(node.type, type, `expected a ${String(type)} node, got ${node.type}`);
  return node as Extract<T, { type: K }>;
}
