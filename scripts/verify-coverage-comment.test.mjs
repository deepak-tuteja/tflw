// M137a (`M134a-01`) — the CI comment describing the coverage gate, held to the gate itself.
//
// THE ROW. `ci.yml`'s Coverage step said *"informational only, no threshold gate yet"* from `M21`
// (`a5f9638`) until `M137a`. `.c8rc.json` gained `"check-coverage": true` with a real floor in
// `M86` (`5b58ff9`). Two commits, one of which made the other's sentence false, fifty milestones
// apart, and the drift was found only when someone had to debug a red step the comment said could
// not go red.
//
// WHY A TEST AND NOT JUST A REWRITE. `M134a-01` calls this *"the arc's recurring shape, third
// instance"* — after `D1`'s `tflw scan` (a trunk decision describing a mode that never shipped,
// uncorrected through four downstream plans) and `M131-06`'s `timeout-minutes`. Rewriting the
// sentence fixes the instance. It does nothing about the shape, and the shape is what has now cost
// three rows. A prose claim about a machine-readable fact is checkable against that fact, so it
// should be checked; the only reason these three drifted is that nobody had written the comparison
// down.
//
// IT IS TWO-WAY ON PURPOSE. The obvious assertion — "the comment must not say the gate is
// informational" — guards one direction and would go green forever if somebody turned
// `check-coverage` OFF, which is when the *new* comment starts lying instead. So the fixture is the
// pair: whichever of the two changes, the other has to change with it. `D277`'s manifest tests and
// `M136c-01`'s artifact contract are the same idea; this is the cheapest possible instance of it.
//
// AND IT ASSERTS WHAT THE COMMENT SAYS, NOT WHAT IT AVOIDS SAYING — see `GATES_MARKER` below. The
// first draft banned the stale phrase and went red on the corrected tree, because the corrected
// comment quotes the sentence it replaced. That is the third time in two milestones that a check
// written as "the bad string is absent" has been wrong (`M136c-01`'s witness search was the other
// two), and the pattern is worth naming: a substring ban cannot distinguish a claim from a citation,
// so it punishes exactly the comments that document their own history.
//
// WHAT IT DELIBERATELY DOES NOT CHECK: the four threshold numbers. `M134a-01` prescribed copying
// them into `ci.yml`, and that prescription is declined — see the comment in `ci.yml` for why. A
// test asserting three copies agree would make the third copy *load-bearing*, which is the opposite
// of removing it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const c8rc = JSON.parse(readFileSync(join(ROOT, '.c8rc.json'), 'utf8'));
const ci = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');

/** The comment block immediately above the Coverage step — everything from the first `# Coverage`
 *  line down to the `- name: Coverage` that it orients the reader to. Sliced rather than searched
 *  whole-file so a stale phrase somewhere else in the workflow cannot make this pass or fail for
 *  reasons that have nothing to do with the row. */
function coverageComment() {
  const start = ci.indexOf('# Coverage');
  const end = ci.indexOf('- name: Coverage', start);
  assert.ok(start !== -1 && end > start, 'ci.yml no longer has a commented Coverage step — if it was renamed, retarget this test rather than deleting it');
  return ci.slice(start, end);
}

/** The claim `ci.yml`'s comment must make when the gate is on, and must not make when it is off.
 *
 *  It is a POSITIVE marker rather than a ban on the stale wording, and that is a correction made
 *  during this milestone's own build. The first version of this test asserted the comment does not
 *  contain "informational only" — and it went red on the FIXED tree, because the rewritten comment
 *  quotes that exact phrase to record what it replaced. A substring ban cannot tell an assertion
 *  from a quotation, and the fix that removes the quotation to satisfy the test would delete the
 *  most useful sentence in the comment. Asserting what the comment must SAY has neither problem:
 *  history stays quotable, and there is exactly one string to keep in step. */
const GATES_MARKER = 'THIS STEP GATES';

test('the coverage gate is on, and the CI comment says so', () => {
  const comment = coverageComment();

  if (c8rc['check-coverage'] === true) {
    assert.ok(
      comment.includes(GATES_MARKER),
      `.c8rc.json gates coverage, but ci.yml's Coverage comment never says so — it must contain "${GATES_MARKER}". This is M134a-01 exactly: the comment said the opposite for fifty milestones and cost someone a wrong first diagnosis of a red run.`,
    );
    return;
  }

  // The other direction, which is the whole reason this is not a one-line assertion. Turning the
  // gate off is allowed; leaving a comment that promises a gate is not, and that failure would be
  // invisible to any test written only against the drift that has already happened.
  assert.ok(
    !comment.includes(GATES_MARKER),
    `.c8rc.json no longer gates coverage (check-coverage is ${JSON.stringify(c8rc['check-coverage'])}), but ci.yml's Coverage comment still claims "${GATES_MARKER}". Rewrite it in the same commit — a comment promising a gate that is gone is M134a-01 pointed the other way.`,
  );
});

test('the CI comment points at both homes of the floor rather than restating it', () => {
  const comment = coverageComment();
  // The derivation and the do-not-lower rule live in one place each. A reader debugging a red step
  // needs to be able to get to both from here, and a pointer cannot go stale the way a copy can.
  assert.match(comment, /\.c8rc\.json/, "ci.yml's Coverage comment must name where the floor actually lives");
  assert.match(comment, /scripts\/coverage\.mjs/, "ci.yml's Coverage comment must point at the file documenting how the floor was derived");
  assert.match(
    comment,
    /[Dd]o not lower it/,
    "the do-not-lower rule is the one instruction a red-run reader most needs and most wants to ignore; scripts/coverage.mjs carries it and ci.yml must repeat it, because this is where they are standing when they want to",
  );
});

test('the thresholds are still real numbers, so the comment is orienting the reader to something', () => {
  // Not a check that the numbers are *right* — that is coverage.mjs's business and a judgement call.
  // This only refuses the degenerate case where check-coverage stays true over a floor of zero,
  // which would leave every assertion above green while the gate quietly stopped gating.
  for (const key of ['statements', 'lines', 'branches', 'functions']) {
    assert.equal(typeof c8rc[key], 'number', `.c8rc.json is missing a numeric ${key} threshold`);
    assert.ok(c8rc[key] > 0, `.c8rc.json's ${key} floor is ${c8rc[key]}, which gates nothing`);
  }
});
