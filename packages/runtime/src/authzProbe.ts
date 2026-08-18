// The authorization probe (M130b1, PLAN_M130B_AUTHZ_ENGINE.md D323–D326) — the I/O half of Tier 2,
// kept in its own file for exactly the reason `tlsProbe.ts` is: `authzRules.ts` must stay pure, and
// a rule that sent a request would end that. The sender is injected, so every branch below is
// exercisable without a network, and `interpreter.ts` does not grow a fifth request path.
//
// ## It rebuilds the request; it does not re-run the step (D323)
//
// The probe is built from the **observed `RequestTrace`** — the method, URL and body that actually
// went out — and not from the `ApiRequestSpec` that produced them. Re-issuing through `execApi` with
// a per-principal context would inherit redirect policy, `retry honoring Retry-After` and mTLS for
// free, and it would also **re-interpolate the path and re-evaluate the body**: `unique(…)`,
// `random(…)` and every `{var}` would resolve a second time, and the probe would ask about a
// resource the owner never touched. That does not implement D303's premise — *the unit of input is a
// request the run actually made* — it falsifies it.
//
// ## A leak requires the resource to have been SERVED (a refinement D324 did not anticipate)
//
// Containment runs on **success statuses only**. The plan's table reads *`401`/`403`/`404`, carrying
// no owner id* → refused, which implies checking a refusal's body for the owner's id. Measured
// against the dogfood target, that is a false-positive machine: the probe re-issues the owner's own
// URL, so the owner's id is *in the request*, and APIs routinely echo it back in the error.
// `categories.service.ts:44` throws ``category ${id} not found``; `cart.service.ts:47` does the same
// for a product. A containment check over those bodies reports a **critical BOLA finding on a
// correctly-refusing endpoint**, and Tier 2's stated bar is zero false positives.
//
// So the semantics are: a leak means the resource was *served*, and a non-2xx did not serve it. What
// this gives up is the rare app that returns a full resource body alongside a 403 — recorded here as
// a known gap rather than traded for a rule that fires on every correct 404.
//
// ## Sequential, and in a fixed order (D326)
//
// Declared order, `anonymous` last. The report reads identically on every run without a sort step,
// the target never sees a simultaneous burst of cross-identity requests from one assertion, and a
// self-inflicted `429` becomes unlikely rather than merely well-classified. The cost is roughly one
// step's latency per principal per assertion site, which D319 commits to recording as a number.

import { classifyAddress, RESERVED_PRINCIPAL } from '@tflw/lang';
import { allowHostsRefusal, isHostAllowed } from './allowHosts.js';
import { containsAnyId, type ProbeOutcome, type ProbeResult } from './authzRules.js';
import type { CookieJar } from './cookieJar.js';
import type { AuthorizedTarget, RequestTrace, ResponseTrace } from './types.js';

/** D306's built-in principal, and D333's reserved name — `session anonymous` is a checker error, so
 * this string can never collide with a declared session.
 *
 * Re-exported from `@tflw/lang` rather than spelled again here. The checker reserves the name and
 * this file uses it, and two string literals for one reserved word is how a checker comes to refuse
 * a name the runtime never actually probes with. */
export const ANONYMOUS: string = RESERVED_PRINCIPAL;

/** The methods that do not change state, and therefore need no opt-in to probe.
 *
 * An allowlist rather than a denylist of `POST|PUT|PATCH|DELETE`: an unrecognised or custom method
 * must count as mutating, because the failure directions are not symmetric. Treating a mutating
 * method as safe sends an unrequested write to somebody's server; treating a safe one as mutating
 * costs a `not probed` line that says exactly what happened. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method.toUpperCase());
}

/**
 * Whether `authorized target`'s `probe mutating` sub-clause (D330) covers the origin this request
 * went to.
 *
 * **ORs across every matching declaration**, which is where D330's repetition rule is actually
 * implemented: `resolve.ts` keeps accumulating rows so each declaration travels to the report with
 * its own reason, so one origin can legitimately arrive as two rows. If either grants the opt-in,
 * the opt-in holds — the clause is a claim about permission, and permission does not un-grant by
 * being written down twice. Resolving it here rather than by folding rows at resolve time also
 * means the *first* row found can never silently decide it.
 *
 * Origin equality, the same call `authorizedFor` and `checkAuthorizedTargets` make, and for D291's
 * reason: a declaration is an affirmation about one named target, and matching it loosely would make
 * the affirmation cover hosts its author never wrote down. An unparseable URL on either side is not
 * a match — permission is never inferred from something that failed to parse.
 */
export function mayProbeMutating(requestUrl: string, targets: readonly AuthorizedTarget[]): boolean {
  return grantedAtOrigin(requestUrl, targets, (t) => t.probeMutating);
}

/**
 * `probe ciphers` (`M137g`, `D485`) — may the TLS probe enumerate this origin's offered suites?
 *
 * Lives beside `mayProbeMutating` rather than in `tlsProbe.ts` because it is **policy, not I/O**,
 * and because putting it here is what let the origin match stay singular: this file already held
 * one copy of it, `inputProbe.ts`'s `grantedClasses` holds a second, and a fourth clause writing a
 * third would be the same drift `M137a` found in a shard count written three times in one file.
 * The two callers now share `grantedAtOrigin`; `grantedClasses` is left alone because it accumulates
 * a set rather than answering yes or no, and folding it in would trade a copy for a worse shape.
 */
export function mayProbeCiphers(requestUrl: string, targets: readonly AuthorizedTarget[]): boolean {
  return grantedAtOrigin(requestUrl, targets, (t) => t.probeCiphers);
}

/** Does any `authorized target` for this exact origin grant the clause `pick` reads?
 *
 * **Origin, never host.** `https://api.example.com` and `http://api.example.com:8080` are different
 * targets and an affirmation of one is not an affirmation of the other — the `D291` declaration is a
 * claim about a specific place somebody checked. An unparseable URL on either side is a no: a
 * permission that cannot be located is a permission that was not given. */
function grantedAtOrigin(requestUrl: string, targets: readonly AuthorizedTarget[], pick: (t: AuthorizedTarget) => boolean): boolean {
  let origin: string;
  try {
    origin = new URL(requestUrl).origin;
  } catch {
    return false;
  }
  return targets.some((t) => {
    if (!pick(t)) return false;
    try {
      return new URL(t.target).origin === origin;
    } catch {
      return false;
    }
  });
}

/**
 * One identity a probe can be sent as.
 *
 * Resolved by the caller (the interpreter, through `SessionCache`) rather than looked up here — this
 * file establishes nothing, which is what keeps it testable without a network and keeps D312's lazy
 * establishment in one place.
 */
export interface ProbePrincipal {
  /** A declared session name, or `ANONYMOUS`. */
  readonly name: string;
  /** What this session's own `header` steps captured. Empty for `anonymous`. */
  readonly headers: Readonly<Record<string, string>>;
  /** M137b (D433) — what its `csrf from` clause captured, applied to **mutating** probes only.
   *  Absent for a session that declares no clause, and for `anonymous`. */
  readonly csrfHeaders?: Readonly<Record<string, string>>;
  /** M137b (D434/D457) — set on a principal the *engine* derived rather than one the author declared:
   *  the name of the session it was derived from. `sec/csrf-not-enforced`'s subject is
   *  `<owner> (csrf token withheld)`, which is the owner's own credential with `csrfHeaders` emptied,
   *  and a reader who saw that name in a counts line would otherwise go looking for a `session` block
   *  that does not exist. */
  readonly derivedFrom?: string;
  /** This session's jar. Absent for `anonymous`, which applies no identity at all. */
  readonly cookieJar?: CookieJar;
  /** Set when the session would not establish (D312). The probe is then `not probed` with this
   * reason, rather than sent as a half-identity that would read as an anonymous probe. */
  readonly unavailable?: string;
}

export interface ProbePolicy {
  /** The step's own budget. A probe is a request to the host the step just talked to, so the step's
   * patience is already the number describing how long this suite waits on that host — the same
   * reasoning `probeTlsFor` uses rather than a second timeout knob. */
  readonly timeoutMs: number;
  readonly allowHosts?: readonly string[] | null;
  readonly insecure: boolean;
  /** D330's per-`authorized target` opt-in, already resolved for this request's origin. */
  readonly probeMutating: boolean;
  /** M137b (D433) — every CSRF header name in play for this assertion: the union of the owner's and
   *  every probe principal's. Treated as identity by `withoutIdentityHeaders`, so the owner's token
   *  never travels under another principal's cookie. `[]`/absent when no session declares a clause. */
  readonly csrfHeaderNames?: readonly string[];
  /** `--allow-public-target` values this invocation carried (M131a, D340/D342) — D21 §3.2(3).
   *
   * **This is the load-bearing half of `TF065`, not a belt to the checker's braces.** The static
   * pass sees the env's declared base URLs, already interpolation-resolved *against the machine
   * running `tflw check`* — so `API_HOST` on a laptop and `API_HOST` in CI can classify
   * differently, and a suite can pass the check on one and be refused on the other. Only this side
   * sees the origin the packet is actually going to. Anything the static pass could not model
   * arrives here anyway. */
  readonly allowPublicTargets?: readonly string[];
}

export interface ProbeRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly timeoutMs: number;
  readonly insecure: boolean;
}

/** The seam. `interpreter.ts` supplies the real one in `M130b2`; the tests supply one that returns
 * hand-built responses, which is how every branch of D324 is reachable without a server. */
export type ProbeSender = (req: ProbeRequest) => Promise<ResponseTrace>;

/**
 * `TF065` at run time (M131a, D342/D344) — `null` when the probe may proceed, or the reason it may
 * not.
 *
 * **Reuses the checker's code rather than minting its own**, exactly as `execAuthzExpect` repeats
 * `TF062`/`TF063`'s judgements at run time: the repair a reader has to make is identical (add the
 * flag), and this codebase's splitting rule is one code per repair, not one per door.
 *
 * A URL that will not parse is refused too. Permission is never inferred from something that failed
 * to parse — the rule `mayProbeMutating` states two functions up, and the direction that costs a
 * `not probed` line rather than an unauthorized packet.
 *
 * **`scan` names the caller's tier (M134a).** The code, the judgement and the repair are shared —
 * which is exactly why the *sentence* must not be, since a Tier 3 refusal that read "an
 * authorization scan originates requests your suite did not write" would name a tier the reader is
 * not using and send them looking for a `session` they never declared. This is the same shape
 * `SCAN_LABELS` fixed in the checker one milestone after `TF060` grew a second tenant.
 */
export function publicTargetRefusal(url: string, allowPublicTargets: readonly string[], scan = 'an authorization scan'): string | null {
  const klass = classifyAddress(url);
  if (klass === 'exempt') return null;
  const origin = originOf(url);
  if (klass === 'invalid' || origin === undefined) {
    return `\`TF065\`: the origin of "${url}" could not be read, so nothing can affirm it — ${scan} may only originate requests against an address this run has named`;
  }
  if (allowPublicTargets.some((t) => originOf(t) === origin)) return null;
  return (
    `\`TF065\`: ${origin} is outside the private address ranges and no \`--allow-public-target ${origin}\` was given — ` +
    `${scan} originates requests your suite did not write, so D21 requires that affirmation on the command line, ` +
    'where a committed `tflw.config` cannot supply it (SPEC §3.10)'
  );
}

function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/** Case-insensitive lookup, because a header map preserves the case its author typed — the exact
 * assumption `sec/authenticated-response-cacheable` got wrong in `M128`, where a lowercase key was
 * read against a map that had never lowercased, so the rule fired for nobody while its unit tests
 * passed. Not repeating it costs three lines. */
function headerValue(headers: Readonly<Record<string, string>>, name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() === wanted) return v;
  return undefined;
}

/**
 * `csrfNames` (M137b, D433) — the CSRF header names in play for this assertion, which are stripped
 * here **as identity**, alongside `Authorization` and `Cookie`.
 *
 * They have to be. The observed request was made by the owner, so it carries the *owner's* token; a
 * token is bound to the session that was issued it. Left in place, every probe would re-send the
 * owner's token under somebody else's cookie, the app would reject the mismatch, and the probe would
 * come back refused — `M130-01`'s exact failure shape, reintroduced by the milestone that fixes it,
 * and green because a refusal reads as clean.
 *
 * Empty for any assertion where no session declares a clause, which is every suite that has not
 * adopted one — so those probes are byte-identical to what they were before this milestone.
 */
function withoutIdentityHeaders(headers: Readonly<Record<string, string>>, csrfNames: readonly string[]): Record<string, string> {
  const stripped = new Set(csrfNames.map((n) => n.toLowerCase()));
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase();
    if (lower === 'authorization' || lower === 'cookie' || stripped.has(lower)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Whether this principal's identity is carried by the jar alone — no `Authorization` of its own, but
 * cookies that would be sent to this origin.
 *
 * Read off the principal's own establishment outcome, which makes it a fact about the session rather
 * than a guess about the server. It is the precondition for D325's CSRF classification.
 */
export function isCookieBorne(principal: ProbePrincipal, origin: string | undefined): boolean {
  if (headerValue(principal.headers, 'authorization') !== undefined) return false;
  if (!principal.cookieJar || origin === undefined) return false;
  const cookies = principal.cookieJar.serialize(origin);
  return cookies !== undefined && cookies.length > 0;
}

/**
 * The probe request for one principal.
 *
 * Method, URL and body travel **verbatim**. Every other header the observed request carried
 * (`Content-Type`, custom headers) travels unchanged, because they are part of what makes the
 * request the one that was actually made. Only the identity is replaced: `Authorization` and
 * `Cookie` are stripped, then the principal's own are applied. `anonymous` applies neither, which is
 * what makes it a real anonymous request rather than a request with somebody's cookies missing.
 */
export function buildProbeRequest(observed: RequestTrace, principal: ProbePrincipal, policy: ProbePolicy): ProbeRequest {
  const headers = withoutIdentityHeaders(observed.headers, policy.csrfHeaderNames ?? []);
  for (const [k, v] of Object.entries(principal.headers)) headers[k] = v;
  // M137b (D433) — this principal's own CSRF token, on a mutating probe only, mirroring `execApi`'s
  // rule so a probe and the request it derives from never disagree about whether a token belongs.
  // The derived withheld-token principal (D434) is precisely this map being empty, which is why the
  // subtraction needs no code of its own here: it is expressed by what the principal carries.
  if (!isSafeMethod(observed.method)) {
    for (const [k, v] of Object.entries(principal.csrfHeaders ?? {})) headers[k] = v;
  }

  const origin = originOf(observed.url);
  if (principal.cookieJar && origin !== undefined) {
    // A throwaway clone per probe (D323). Nothing here writes to a jar today, so the isolation is
    // currently inherent — the clone is the insurance that keeps it true if a later edit starts
    // ingesting the probe's own `Set-Cookie`, which must never reach the owning test's jar.
    const cookies = principal.cookieJar.clone().serialize(origin);
    if (cookies) headers['Cookie'] = cookies;
  }

  return {
    method: observed.method,
    url: observed.url,
    headers,
    ...(observed.body === undefined ? {} : { body: observed.body }),
    timeoutMs: policy.timeoutMs,
    insecure: policy.insecure,
  };
}

/**
 * D324's taxonomy, applied to one response.
 *
 * Exported so the tests can drive every branch directly, and so the interpreter cannot grow a second
 * opinion about what a `429` means.
 */
export function classifyResponse(
  response: ResponseTrace,
  ownerIds: readonly string[],
  ctx: { readonly method: string; readonly cookieBorne: boolean; readonly suppliedCsrf?: boolean },
): ProbeOutcome {
  const status = response.status;

  // Both of these answered without answering the question: the probe demonstrably did not get the
  // resource *and* demonstrably never reached an authorization check. Scoring a rate limiter's
  // refusal as an authorization boundary would let a suite that trips its own throttle report the
  // throttle as a green authorization result.
  if (status === 429) {
    return { kind: 'inconclusive', reason: 'the host answered 429 (rate limited), so the probe never reached an authorization decision' };
  }
  if (status >= 500) {
    return { kind: 'inconclusive', reason: `the host answered ${status}, so the probe never reached an authorization decision` };
  }

  if (status >= 200 && status < 300) {
    if (response.json === undefined) {
      return {
        kind: 'inconclusive',
        reason: `the host answered ${status} with a body that is not JSON, so it cannot be confirmed free of the owner's resource ids`,
      };
    }
    const ids = containsAnyId(response.json, ownerIds);
    if (ids.length) return { kind: 'leaked', ids };
    return { kind: 'served-different', status };
  }

  // D325 / `M130-01`. apiV2's `AnyAuthGuard` requires an `X-CSRF-Token` on every mutating request
  // made with a cookie, and a `session` block does not expose that token — so a cookie-borne
  // principal is refused *before* authorization is consulted, and a differential oracle would score
  // that refusal clean. This is a constraint on the engine, not a bug in the target.
  //
  // The probe is still SENT rather than skipped, which is the whole point: cookie auth with no CSRF
  // defence at all answers 2xx, leaks, and is caught above. A structural pre-flight skip would
  // decline to probe exactly the app most worth catching.
  //
  // **M137b (D433) closes this for any principal that supplied a token.** `suppliedCsrf` means the
  // probe carried this principal's own `csrf from` capture, so the ambiguity the branch exists to
  // report is gone: a `4xx` after a valid token is an authorization refusal, and scoring it
  // `inconclusive` would now be the false negative. The branch stays for the principal that declares
  // no clause — the ambiguity is real there, and `M137b` deliberately keeps that path live and
  // observable by declaring `shopperNoCsrf` in the corpus (D455), so the fix does not erase its own
  // evidence. A withheld-token probe (D434) also lands here with `suppliedCsrf: false`, which is
  // correct on its own terms and irrelevant in practice: `D457` routes it to `csrfProbes`, where the
  // rule reads the status directly rather than this taxonomy.
  if (ctx.cookieBorne && !ctx.suppliedCsrf && !isSafeMethod(ctx.method) && status >= 400 && status < 500) {
    return {
      kind: 'inconclusive',
      reason:
        `a cookie-borne principal was refused on a ${ctx.method.toUpperCase()} (${status}); this may be CSRF rather than authorization, ` +
        'since a cookie session cannot supply the CSRF token a mutating request needs. Give it a bearer session to judge it, ' +
        'or a `csrf from` clause so it can supply one',
    };
  }

  // 404 sits with the refusals deliberately: answering 404 rather than 403, so as not to disclose
  // that a resource exists, is the *more* careful of two correct implementations, and a tier that
  // scored it as suspicious would fire on the better one.
  if (status === 401 || status === 403 || status === 404) return { kind: 'refused', status };

  // A 400, a 405, a 3xx the sender surfaced: the probe was answered, but not with an authorization
  // decision. `clean` has to be earned, so this is not one.
  return { kind: 'inconclusive', reason: `the host answered ${status}, which is not an authorization decision` };
}

/** Declared order, `anonymous` last (D326). Enforced here rather than trusted from the caller, so
 * the invariant has one home and the report cannot depend on how the probe set was assembled. */
export function probeOrder(principals: readonly ProbePrincipal[]): ProbePrincipal[] {
  return [...principals.filter((p) => p.name !== ANONYMOUS), ...principals.filter((p) => p.name === ANONYMOUS)];
}

export class AuthzProber {
  readonly #send: ProbeSender;

  /** How many requests this prober actually put on the wire. Exposed for the tests that assert a
   * `not probed` principal really sent nothing — a skip whose only evidence is its own label is a
   * skip that could be probing anyway and nobody would know. */
  #sent = 0;

  get sentCount(): number {
    return this.#sent;
  }

  constructor(send: ProbeSender) {
    this.#send = send;
  }

  /**
   * Probes every principal, sequentially, and never throws.
   *
   * Every failure path — a refused host, a session that would not establish, a socket error — comes
   * back as a `ProbeOutcome`, because a probe that could not run is *not applicable* rather than an
   * error. Throwing would fail an assertion that still had a second rule to judge, and would report
   * a network hiccup as an authorization verdict.
   */
  async probeAll(
    observed: RequestTrace,
    ownerIds: readonly string[],
    principals: readonly ProbePrincipal[],
    policy: ProbePolicy,
  ): Promise<ProbeResult[]> {
    const results: ProbeResult[] = [];
    const origin = originOf(observed.url);
    const mutating = !isSafeMethod(observed.method);
    // D342's runtime door, judged **once per assertion and before the first probe**, against the
    // origin the packet is actually going to rather than against anything a config predicted.
    const unaffirmedPublic = publicTargetRefusal(observed.url, policy.allowPublicTargets ?? []);

    for (const principal of probeOrder(principals)) {
      results.push(await this.#probeOne(observed, ownerIds, principal, policy, { origin, mutating, unaffirmedPublic }));
    }
    return results;
  }

  async #probeOne(
    observed: RequestTrace,
    ownerIds: readonly string[],
    principal: ProbePrincipal,
    policy: ProbePolicy,
    ctx: { readonly origin: string | undefined; readonly mutating: boolean; readonly unaffirmedPublic: string | null },
  ): Promise<ProbeResult> {
    const notProbed = (reason: string): ProbeResult => ({ principal: principal.name, outcome: { kind: 'not-probed', reason } });

    // **First, before the mutating opt-in and before any session is established.** D21 §3.2(3) is
    // about whether this run may talk to that host at all, so it is answered before anything about
    // *what* would be sent.
    //
    // A refusal is an outcome rather than a `throw`, following `probeAll`'s own rule that a probe
    // which could not run is `not applicable` rather than an error — and it is still **fail-closed**
    // rather than a silent pass, because of D285: with every principal refused, no rule applies,
    // and `describeAuthzOutcome` reports "this assertion had no power to fail" as a *failure*. The
    // gate refuses the packets and the assertion goes red, which is both halves of what a safety
    // control has to do.
    if (ctx.unaffirmedPublic !== null) return notProbed(ctx.unaffirmedPublic);

    // Safe methods by default; a write needs the per-target affirmation D311 attaches to the host,
    // not a global flag. Checked before anything else, so an un-opted-in mutating step costs no
    // session establishment either.
    if (ctx.mutating && !policy.probeMutating) {
      return notProbed(
        `${observed.method.toUpperCase()} changes state, and no \`probe mutating\` covers ${ctx.origin ?? observed.url} — ` +
          'add it under that `authorized target` to probe writes',
      );
    }

    if (principal.unavailable !== undefined) {
      return notProbed(`session "${principal.name}" could not be established: ${principal.unavailable}`);
    }

    // The allowlist is not a security control this feature is entitled to bypass. In practice the
    // observed request already passed it against this same URL, so this is the belt to that's
    // braces — but a guardrail that is only correct because of something another file did is one
    // edit away from not being.
    if (!isHostAllowed(observed.url, policy.allowHosts)) {
      return notProbed(allowHostsRefusal(observed.url, policy.allowHosts!, { kind: 'authz-probe', principal: principal.name }));
    }

    const request = buildProbeRequest(observed, principal, policy);
    let response: ResponseTrace;
    try {
      this.#sent++;
      response = await this.#send(request);
    } catch (err) {
      return notProbed(`the probe request failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    return {
      principal: principal.name,
      outcome: classifyResponse(response, ownerIds, {
        method: observed.method,
        cookieBorne: isCookieBorne(principal, ctx.origin),
        // M137b (D433) — true only when this probe actually carried a token, which mirrors
        // `buildProbeRequest`'s own condition (a token is attached to mutating probes only). Derived
        // from the principal rather than from the built request so the two cannot drift.
        suppliedCsrf: !isSafeMethod(observed.method) && Object.keys(principal.csrfHeaders ?? {}).length > 0,
      }),
      response,
    };
  }
}
