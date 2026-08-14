// The Tier 3 mutation prober (M134a, PLAN_M134_PENTEST_TIER3.md D370/D372/D374/D381) — every branch
// driven through an injected sender, so nothing here touches a network.
//
// **The tests that matter most are the ones that assert nothing went out.** A safety control whose
// only evidence is its own label is a control that could be sending anyway and nobody would know,
// which is why `sentCount` exists and why every refusal below is asserted against it rather than
// against the outcome text alone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyMutationResponse, grantedClasses, InputProber, planProbes, withheldClasses, type InputProbePolicy, type InputProbeRequest } from '../src/inputProbe.js';
import type { AuthorizedTarget, RequestTrace, ResponseTrace } from '../src/types.js';

function res(over: Partial<ResponseTrace> = {}): ResponseTrace {
  const bodyText = over.bodyText ?? '{"ok":true}';
  return { status: 200, statusText: 'OK', headers: {}, bodyText, bodyBytes: Buffer.from(bodyText), durationMs: 1, finalUrl: 'https://localhost:4001/v1/orders/7', cookieEvents: [], ...over };
}

function req(over: Partial<RequestTrace> = {}): RequestTrace {
  return { method: 'GET', url: 'https://localhost:4001/v1/orders/7?q=shoes', headers: { Accept: 'application/json' }, ...over };
}

function target(over: Partial<AuthorizedTarget> = {}): AuthorizedTarget {
  return { target: 'https://localhost:4001', reason: 'self-hosted test fixture', probeMutating: false, probeOversized: false, probeTraversal: false, ...over };
}

function policy(over: Partial<InputProbePolicy> = {}): InputProbePolicy {
  return { timeoutMs: 1000, insecure: false, probeMutating: false, classes: ['type-confusion', 'injection'], ...over };
}

/** A sender that records what it was asked to send and answers 200 to everything. */
function recorder(answer: (req: InputProbeRequest) => ResponseTrace = () => res()) {
  const sent: InputProbeRequest[] = [];
  return {
    sent,
    send: async (r: InputProbeRequest) => {
      sent.push(r);
      return answer(r);
    },
  };
}

// --- D372: which classes a target grants ------------------------------------------------------

test('the two default-on classes need no opt-in', () => {
  assert.deepEqual(grantedClasses('https://localhost:4001/v1/orders/7', [target()]), ['type-confusion', 'injection']);
});

test('`probe oversized` and `probe traversal` each grant exactly their own class', () => {
  assert.deepEqual(grantedClasses('https://localhost:4001/x', [target({ probeOversized: true })]), ['type-confusion', 'injection', 'oversized']);
  assert.deepEqual(grantedClasses('https://localhost:4001/x', [target({ probeTraversal: true })]), ['type-confusion', 'injection', 'traversal']);
});

test('two declarations for one origin OR their grants — permission does not un-grant by repetition (D330)', () => {
  const granted = grantedClasses('https://localhost:4001/x', [target({ probeOversized: true }), target({ probeTraversal: true })]);
  assert.deepEqual(granted, ['type-confusion', 'injection', 'oversized', 'traversal']);
});

test('a declaration for a different origin grants nothing — origin equality, never a pattern', () => {
  const granted = grantedClasses('https://localhost:4001/x', [target({ target: 'https://localhost:8443', probeTraversal: true })]);
  assert.deepEqual(granted, ['type-confusion', 'injection']);
});

test('an unparseable declaration is not a match — permission is never inferred from something that failed to parse', () => {
  assert.deepEqual(grantedClasses('https://localhost:4001/x', [target({ target: 'not a url', probeTraversal: true })]), ['type-confusion', 'injection']);
});

test('the withheld classes are named by their sub-clause word, for the not-applicable listing', () => {
  assert.deepEqual(withheldClasses(['type-confusion', 'injection']), ['oversized', 'traversal']);
  assert.deepEqual(withheldClasses(['type-confusion', 'injection', 'traversal']), ['oversized']);
});

// --- D368: the plan is fixed and enumerable ----------------------------------------------------

test('the same request and classes plan the same probes, in the same order, every time', () => {
  const a = planProbes(req(), ['injection']);
  const b = planProbes(req(), ['injection']);
  assert.deepEqual(a.map((p) => `${p.site.location}|${p.payload.id}`), b.map((p) => `${p.site.location}|${p.payload.id}`));
  assert.ok(a.length > 0);
});

test('the plan is the full cross product of sites and enabled payloads — no sampling', () => {
  const plan = planProbes(req(), ['injection']);
  const sites = new Set(plan.map((p) => p.site.location));
  const payloads = new Set(plan.map((p) => p.payload.id));
  assert.equal(plan.length, sites.size * payloads.size);
});

// --- what actually goes out ---------------------------------------------------------------------

test('the observed headers travel verbatim, and no identity is stripped (D370/D375)', async () => {
  // The whole of why `M130-01` is not this tier's problem: Tier 2 strips `Authorization`/`Cookie`
  // and the CSRF guard then refuses before authorization is consulted. Here the observed request's
  // own token still matches, so the probe reaches the code it was sent to test.
  const observed = req({ headers: { Authorization: 'Bearer tok', Cookie: 'sid=1', 'X-CSRF-Token': 'abc' } });
  const rec = recorder();
  const prober = new InputProber(rec.send);
  await prober.probeAll(observed, planProbes(observed, ['injection']).slice(0, 1), policy());
  assert.deepEqual(rec.sent[0]!.headers, { Authorization: 'Bearer tok', Cookie: 'sid=1', 'X-CSRF-Token': 'abc' });
  assert.equal(rec.sent[0]!.method, 'GET');
});

test('one probe changes one input — every other part of the request is the observed one', async () => {
  const observed = req({ method: 'POST', url: 'https://localhost:4001/v1/notes', body: JSON.stringify({ title: 'a', text: 'b' }) });
  const rec = recorder();
  const plan = planProbes(observed, ['injection']).filter((p) => p.site.key === 'text').slice(0, 1);
  await new InputProber(rec.send).probeAll(observed, plan, policy({ probeMutating: true }));
  const body = JSON.parse(rec.sent[0]!.body!);
  assert.equal(body.title, 'a', 'the sibling field must be untouched');
  assert.notEqual(body.text, 'b');
});

// --- the refusals, each asserted to have sent NOTHING --------------------------------------------

test('a mutating method with no `probe mutating` sends nothing at all', async () => {
  const observed = req({ method: 'POST', url: 'https://localhost:4001/v1/notes', body: '{"a":"b"}' });
  const rec = recorder();
  const prober = new InputProber(rec.send);
  const out = await prober.probeAll(observed, planProbes(observed, ['injection']), policy({ probeMutating: false }));
  assert.equal(prober.sentCount, 0);
  assert.equal(rec.sent.length, 0);
  assert.ok(out.every((r) => r.outcome.kind === 'not-probed'));
  assert.match((out[0]!.outcome as { reason: string }).reason, /`probe mutating`/);
});

test('a payload whose class is not granted sends nothing, and says which word grants it', async () => {
  const observed = req();
  const rec = recorder();
  const prober = new InputProber(rec.send);
  // Plan the traversal payloads, then run with a policy that does not grant the class — the shape a
  // stale plan or a widened corpus would produce, and the one where a silent send would be worst.
  const plan = planProbes(observed, ['traversal']);
  const out = await prober.probeAll(observed, plan, policy({ classes: ['type-confusion', 'injection'] }));
  assert.equal(prober.sentCount, 0);
  assert.ok(out.every((r) => r.outcome.kind === 'not-probed'));
  assert.match((out[0]!.outcome as { reason: string }).reason, /`probe traversal`/);
});

test('an unaffirmed public target sends nothing — TF065 at run time (D342)', async () => {
  const observed = req({ url: 'https://staging.example.com/v1/orders/7?q=x' });
  const rec = recorder();
  const prober = new InputProber(rec.send);
  const out = await prober.probeAll(observed, planProbes(observed, ['injection']), policy({ allowPublicTargets: [] }));
  assert.equal(prober.sentCount, 0);
  assert.match((out[0]!.outcome as { reason: string }).reason, /TF065/);
});

test('an affirmed public target is probed', async () => {
  const observed = req({ url: 'https://staging.example.com/v1/orders/7?q=x' });
  const rec = recorder();
  const prober = new InputProber(rec.send);
  await prober.probeAll(observed, planProbes(observed, ['injection']).slice(0, 1), policy({ allowPublicTargets: ['https://staging.example.com'] }));
  assert.equal(prober.sentCount, 1);
});

test('a host outside `allow hosts` sends nothing — the allowlist is not this feature\'s to bypass', async () => {
  const observed = req();
  const rec = recorder();
  const prober = new InputProber(rec.send);
  const out = await prober.probeAll(observed, planProbes(observed, ['injection']), policy({ allowHosts: ['other.test'] }));
  assert.equal(prober.sentCount, 0);
  assert.equal(out[0]!.outcome.kind, 'not-probed');
});

test('a transport failure is an outcome, not a throw — three rules still have work to do', async () => {
  const observed = req();
  const prober = new InputProber(async () => {
    throw new Error('ECONNRESET');
  });
  const out = await prober.probeAll(observed, planProbes(observed, ['injection']).slice(0, 2), policy());
  assert.equal(out.length, 2);
  assert.ok(out.every((r) => r.outcome.kind === 'not-probed'));
  assert.match((out[0]!.outcome as { reason: string }).reason, /ECONNRESET/);
});

// --- D381: sequential, one in flight ---------------------------------------------------------------

test('probes are strictly sequential — one in flight, which is why `probe rate` does not come due', async () => {
  // Layer 5 shipped as an *asserted bound rather than a declared pace*, and this is the assertion.
  // Its deferral condition is "the first change that permits two probes in flight simultaneously";
  // if this test ever has to be relaxed, that condition has been met and `probe rate` comes due.
  let inFlight = 0;
  let peak = 0;
  const prober = new InputProber(async () => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 1));
    inFlight--;
    return res();
  });
  const observed = req();
  await prober.probeAll(observed, planProbes(observed, ['injection']), policy());
  assert.equal(peak, 1, 'two probes in flight is layer 5\'s named deferral condition, not an optimisation');
});

// --- classification ---------------------------------------------------------------------------------

test('a 5xx is answered — the application processed the payload, and its body is the evidence', () => {
  assert.deepEqual(classifyMutationResponse(res({ status: 500 })), { kind: 'answered', status: 500 });
  assert.deepEqual(classifyMutationResponse(res({ status: 400 })), { kind: 'answered', status: 400 });
});

test('a 429 is inconclusive — the app never processed the payload at all', () => {
  const outcome = classifyMutationResponse(res({ status: 429 }));
  assert.equal(outcome.kind, 'inconclusive');
});
