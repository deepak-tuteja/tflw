// The Tier 1 hygiene rule pack (M128b, PLAN_M128_PENTEST_TIER1.md D283/D284/D289) — the security
// arc's answer to `a11y.ts`, and deliberately its exact shape: **this is the only file that knows
// what a hygiene rule is**, and it produces `finding.ts`'s generic `Finding[]` rather than a second
// severity vocabulary. `finding.ts` was written for this arc three milestones early (SPEC §9.8's
// scan-arc-reuse note); this is the file that collects on it.
//
// Pure. No interpreter import, no I/O, no clock. Everything a rule can see arrives in one
// `Observation`, which is why the whole pack is unit-testable against hand-built responses and why
// `M128c`'s TLS rules can join it by adding an optional field rather than a second mechanism.
//
// ## Applicability is a third state, not a pass (D284)
//
// Every rule declares a precondition. A rule whose precondition is unmet is **not applicable** —
// never a violation, and never a silent pass, because those two are the only states a boolean
// offers and neither is true. Tier 1's stated bar is zero false positives and it is unreachable
// without this: over `http://localhost:4001`, `hsts-missing` and `cookie-not-secure` would fire on
// every response in the suite, and both would be nonsense (HSTS over plaintext is ignored by
// browsers, and a `Secure` cookie is unsettable there at all).
//
// The counts this produces are all three, and `ScanResult` has no field that collapses them.

import type { Finding, Severity } from './finding.js';
import { SEVERITY_RANK } from './finding.js';

/** What a rule is allowed to look at. One observed request/response pair, flattened — a rule never
 * reaches back into a `ResponseTrace`, a cookie jar or the interpreter's context, so `securityRules`
 * can be exercised without any of them.
 *
 * `setCookie` is **one entry per header line**, not the `\n`-joined form `headers['set-cookie']`
 * carries. A response that sets three cookies is three findings or none, and the joined string
 * cannot express that. `ResponseTrace.cookieEvents` is where the interpreter gets the split form. */
export interface Observation {
  /** Where the response actually came from — the end of the redirect chain, not the URL the step
   * named. `scheme` is read off this, so a step that started on http and ended on https is judged
   * as the https response it is. */
  readonly url: string;
  /** Response headers, **lowercased keys** (the runtime's `ResponseTrace.headers` already is). */
  readonly headers: Readonly<Record<string, string>>;
  /** Every `Set-Cookie` line this response carried, unjoined and unparsed. */
  readonly setCookie: readonly string[];
  /** Request headers, lowercased — read only by `authenticated-response-cacheable`, which needs to
   * know whether the request carried credentials. */
  readonly requestHeaders: Readonly<Record<string, string>>;
  /** What the TLS handshake to this host reported, or why it could not be read (M128c, D288).
   *
   * **Three states, deliberately, and `undefined` is one of them.** Absent means *nobody looked* —
   * a plaintext response, or a hand-built observation in a unit test — and is the same
   * `undefined`-vs-empty distinction `ProgramCheckOptions` draws elsewhere in this codebase. A
   * present `ok: false` means the probe ran and could not answer, which is a different fact and
   * gets a different sentence in the not-applicable listing.
   *
   * Filled by `tlsProbe.ts`, which is the only file here that opens a socket. This field is the
   * whole seam: the pack stays pure, and the two TLS rules read a value rather than perform I/O. */
  readonly tls?: TlsObservation;
}

/**
 * The result of one TLS handshake, as the rules see it.
 *
 * Lives here rather than in `tlsProbe.ts` so that `securityRules.ts` keeps importing nothing but
 * `finding.ts` — the direction of the dependency is what makes the pack testable without a network,
 * and inverting it for one type would quietly undo that.
 *
 * **What these facts are, stated precisely, because both rules over-claim if it is not** (D288/D299):
 * they describe *one fresh connection this run made*, using this run's own client parameters.
 *
 * - Not the observed request. The probe is a second connection, so behind a load balancer with
 *   heterogeneous nodes the two can genuinely differ. Only an `undici` runtime dependency would
 *   close that, and decision 43 declined it.
 * - Not the server's whole offer. A host that supports RC4 *and* AES-GCM negotiates AES-GCM with a
 *   current client and is silent here — correctly, since that is what its callers get. Enumerating
 *   everything a server would accept takes one handshake per suite (what `sslyze`/`testssl.sh` do)
 *   and belongs to Tier 3's `tflw scan`, not to a per-response assertion.
 *
 * So the question both rules answer is **"what does this host give a current client?"** Each says so
 * in its own failure detail rather than leaving it to the docs.
 */
export type TlsObservation =
  | {
      readonly ok: true;
      /** Node's `TLSSocket.getProtocol()` — `'TLSv1.3'`, `'TLSv1.2'`, `'TLSv1.1'`, `'TLSv1'`, `'SSLv3'`. */
      readonly protocol: string;
      /** OpenSSL's name for the negotiated suite, e.g. `ECDHE-RSA-AES128-GCM-SHA256`. */
      readonly cipherName: string;
      /** The IANA spelling, e.g. `TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256`. Node reports it for
       * TLS 1.2+ and omits it for older handshakes, so it is optional rather than assumed. */
      readonly cipherStandardName?: string;
    }
  | { readonly ok: false; readonly reason: string };

/** A rule's verdict about one observation. `applicable: false` means the precondition was unmet;
 * `findings` is then always empty and carries no information either way. */
export interface RuleOutcome {
  readonly applicable: boolean;
  readonly findings: readonly Finding[];
  /** Replaces the rule's static `appliesWhen` in the not-applicable listing, for the case where
   * *which* half of the precondition failed is itself worth reading (M128c).
   *
   * Only the TLS rules use it, and they need it: "the scheme is https and the TLS probe succeeded"
   * is true of a plaintext response and of a refused handshake in exactly the same words, and those
   * are not the same situation. A reader who is told only the static text on a connection that was
   * refused will go looking for a scheme problem that does not exist. Optional rather than required
   * so the other ten rules, whose preconditions have one way to fail, say nothing extra. */
  readonly because?: string;
}

export interface SecurityRule {
  /** `sec/`-prefixed so a finding's origin is legible next to an axe-core rule id in the same
   * report — axe's ids are bare (`color-contrast`), and once two scanners share `Finding` the
   * unprefixed form stops being self-describing. */
  readonly id: string;
  readonly severity: Severity;
  readonly description: string;
  /** The precondition, in the words D284 states it in — printed in the not-applicable listing, so a
   * reader learns *why* a rule stood down rather than only that it did. */
  readonly appliesWhen: string;
  readonly evaluate: (o: Observation) => RuleOutcome;
}

// ---------------------------------------------------------------------------
// Small header/cookie helpers. Deliberately local: none of these is a general-purpose parser, and
// the runtime already has a real cookie jar (`cookieJar.ts`) whose job is different — it decides
// what to *send*, which requires domain/path scoping this pack has no use for.
// ---------------------------------------------------------------------------

function header(o: Observation, name: string): string | undefined {
  return o.headers[name.toLowerCase()];
}

function schemeOf(url: string): string {
  try {
    return new URL(url).protocol.replace(':', '').toLowerCase();
  } catch {
    // A trace whose `finalUrl` doesn't parse is a runtime bug, not a security finding. Returning a
    // scheme that matches nothing makes the https-conditional rules stand down rather than fire.
    return '';
  }
}

function isHttps(o: Observation): boolean {
  return schemeOf(o.url) === 'https';
}

/** Whether the response is a *document* — the precondition `csp-missing` and `x-frame-options`
 * share. `text/html` only: those two headers govern how a browser frames and scripts a page, and
 * neither means anything on a JSON body. A `+html`-suffixed type doesn't exist in practice, so the
 * check stays literal rather than clever. */
function isDocument(o: Observation): boolean {
  const ct = header(o, 'content-type');
  return ct !== undefined && ct.split(';')[0]!.trim().toLowerCase() === 'text/html';
}

interface ParsedCookie {
  readonly name: string;
  readonly attrs: ReadonlyMap<string, string>;
}

/** Splits one `Set-Cookie` line into its name and its attribute map, lowercased keys.
 *
 * **The value is dropped on the floor and never returned.** A cookie value is a live credential —
 * the whole reason `ResponseTrace.cookieEvents` is stripped from the report copy at every evidence
 * level. A rule that reports "cookie `session` is missing `HttpOnly`" needs the name and the flag
 * and nothing else, so the value never enters a `Finding` and cannot leak through a failure
 * message into `report.html`, `results.json` or a CI log. The interpreter redacts findings again on
 * the way out; this is the half that makes that belt-and-braces rather than load-bearing. */
function parseSetCookie(line: string): ParsedCookie | null {
  const parts = line.split(';');
  const first = parts[0];
  if (first === undefined) return null;
  const eq = first.indexOf('=');
  if (eq <= 0) return null; // no name, or a leading `=` — not a cookie this pack can name
  const name = first.slice(0, eq).trim();
  if (name === '') return null;
  const attrs = new Map<string, string>();
  for (const raw of parts.slice(1)) {
    const seg = raw.trim();
    if (seg === '') continue;
    const i = seg.indexOf('=');
    if (i === -1) attrs.set(seg.toLowerCase(), '');
    else attrs.set(seg.slice(0, i).trim().toLowerCase(), seg.slice(i + 1).trim());
  }
  return { name, attrs };
}

function cookies(o: Observation): ParsedCookie[] {
  return o.setCookie.map(parseSetCookie).filter((c): c is ParsedCookie => c !== null);
}

/** A rule with no precondition — applicable against every response there is. */
function always(id: string, severity: Severity, description: string, check: (o: Observation) => Finding[]): SecurityRule {
  return { id, severity, description, appliesWhen: 'always', evaluate: (o) => ({ applicable: true, findings: check(o) }) };
}

function gated(
  id: string,
  severity: Severity,
  description: string,
  appliesWhen: string,
  applicable: (o: Observation) => boolean,
  check: (o: Observation) => Finding[],
): SecurityRule {
  return {
    id,
    severity,
    description,
    appliesWhen,
    evaluate: (o) => (applicable(o) ? { applicable: true, findings: check(o) } : { applicable: false, findings: [] }),
  };
}

function finding(rule: { id: string; severity: Severity; description: string }, detail: string): Finding {
  return { id: rule.id, severity: rule.severity, description: rule.description, detail };
}

// ---------------------------------------------------------------------------
// The pack. Order is severity-descending, matching D289's table, because that is the order the
// failure listing prints in and a stable pack order makes a diff of two runs readable.
// ---------------------------------------------------------------------------

const COOKIE_SETS = 'the response sets a cookie';

const cookieNotHttpOnly = gated(
  'sec/cookie-not-httponly',
  'critical',
  'cookie is readable by JavaScript (no HttpOnly)',
  COOKIE_SETS,
  (o) => o.setCookie.length > 0,
  (o) =>
    cookies(o)
      .filter((c) => !c.attrs.has('httponly'))
      .map((c) => finding(cookieNotHttpOnly, `cookie \`${c.name}\` — any XSS on this origin can read it`)),
);

const cookieNotSecure = gated(
  'sec/cookie-not-secure',
  'critical',
  'cookie may be sent over plaintext (no Secure)',
  'the scheme is https AND the response sets a cookie',
  // Both halves matter. Over http the flag is not merely unset, it is *unsettable* — a `Secure`
  // cookie would not be stored by a browser at all — so firing there would tell an author to make
  // a change that breaks their own plaintext suite. That is the false positive D284 exists for,
  // and it is the exact defect `M128a` had to fix conditionally in `auth.service.ts` for the same
  // reason.
  (o) => isHttps(o) && o.setCookie.length > 0,
  (o) =>
    cookies(o)
      .filter((c) => !c.attrs.has('secure'))
      .map((c) => finding(cookieNotSecure, `cookie \`${c.name}\` — a later plaintext request to this host would send it in the clear`)),
);

const corsWildcardWithCredentials = gated(
  'sec/cors-wildcard-with-credentials',
  'critical',
  'CORS allows any origin while also allowing credentials',
  'the response carries Access-Control-Allow-Origin',
  (o) => header(o, 'access-control-allow-origin') !== undefined,
  (o) => {
    const origin = header(o, 'access-control-allow-origin')!.trim();
    const creds = (header(o, 'access-control-allow-credentials') ?? '').trim().toLowerCase();
    if (origin !== '*' || creds !== 'true') return [];
    // Worth stating in the detail rather than only in the description: this combination is one a
    // browser *refuses to honour*, so finding it in the wild almost always means somebody wanted
    // permissive CORS, hit the console error, and reached for the wildcard instead of an origin
    // list — which is why it is critical rather than a lint.
    return [finding(corsWildcardWithCredentials, '`Access-Control-Allow-Origin: *` with `Access-Control-Allow-Credentials: true` — no browser honours this pair; name the origins instead')];
  },
);

const hstsMissing = gated(
  'sec/hsts-missing',
  'serious',
  'no Strict-Transport-Security header',
  'the scheme is https',
  isHttps,
  (o) => (header(o, 'strict-transport-security') === undefined ? [finding(hstsMissing, 'a first request to this host can still be downgraded to http')] : []),
);

const cspMissing = gated(
  'sec/csp-missing',
  'serious',
  'no Content-Security-Policy header',
  'the response is a document (Content-Type: text/html)',
  isDocument,
  (o) => (header(o, 'content-security-policy') === undefined ? [finding(cspMissing, 'nothing constrains where this document may load script from')] : []),
);

const xFrameOptions = gated(
  'sec/x-frame-options',
  'moderate',
  'document can be framed by any origin',
  'the response is a document (Content-Type: text/html)',
  isDocument,
  (o) => {
    if (header(o, 'x-frame-options') !== undefined) return [];
    // A CSP `frame-ancestors` directive is the modern, strictly more expressive spelling of the
    // same control, and browsers prefer it where both are present. Treating it as satisfying this
    // rule is not leniency: a CSP-only app is correctly defended, and firing on it would be a false
    // positive against a policy that is *better* than the header being asked for.
    const csp = header(o, 'content-security-policy');
    if (csp !== undefined && /(^|;)\s*frame-ancestors\s/i.test(csp)) return [];
    return [finding(xFrameOptions, 'no `X-Frame-Options` and no CSP `frame-ancestors` — clickjacking is unconstrained')];
  },
);

const cookieSameSiteNone = gated(
  'sec/cookie-samesite-none',
  'moderate',
  'cookie is sent on cross-site requests (SameSite=None)',
  COOKIE_SETS,
  (o) => o.setCookie.length > 0,
  (o) =>
    cookies(o)
      .filter((c) => (c.attrs.get('samesite') ?? '').toLowerCase() === 'none')
      // **Explicit `None` only — an absent `SameSite` is not a finding.** Every current browser
      // defaults an unspecified cookie to `Lax`, so reporting absence would fire on the majority of
      // correctly-behaving cookies on the internet, which is the zero-false-positive bar failing on
      // the pack's own most common input. The rule is named for the value it looks for.
      .map((c) => finding(cookieSameSiteNone, `cookie \`${c.name}\` is \`SameSite=None\` — it rides along on cross-site requests`)),
);

const nosniffMissing = always('sec/nosniff-missing', 'moderate', 'no X-Content-Type-Options: nosniff', (o) => {
  const v = (header(o, 'x-content-type-options') ?? '').trim().toLowerCase();
  return v === 'nosniff' ? [] : [finding(nosniffMissing, v === '' ? 'header absent — a browser may MIME-sniff this body into something executable' : `header is \`${v}\`, not \`nosniff\``)];
});

const authenticatedResponseCacheable = gated(
  'sec/authenticated-response-cacheable',
  'moderate',
  'authenticated response has no Cache-Control',
  'the request carried session or bearer credentials',
  (o) => o.requestHeaders['authorization'] !== undefined || o.requestHeaders['cookie'] !== undefined,
  (o) =>
    // Deliberately the narrowest form of this rule: *no* `Cache-Control` at all, not "a
    // `Cache-Control` I judge insufficient". The plan (§3) flags this predicate as the softest of
    // the ten — "the request carried credentials" is knowable, "this response is sensitive" is not
    // — so anything beyond total absence would be the pack guessing at sensitivity. An author who
    // deliberately serves a public authenticated endpoint sets `Cache-Control: public` and this
    // stays silent.
    header(o, 'cache-control') === undefined ? [finding(authenticatedResponseCacheable, 'no `Cache-Control` — a shared proxy may store and re-serve this to another user')] : [],
);

/** Matches a version-ish token: a digit-led dotted or bare number inside the header value. */
const VERSION_TOKEN = /\d+(\.\d+)*/;

const serverVersionDisclosure = always('sec/server-version-disclosure', 'minor', 'response advertises a software version', (o) => {
  const out: Finding[] = [];
  for (const name of ['server', 'x-powered-by'] as const) {
    const v = header(o, name);
    // **A version, not a product name.** `Server: nginx/1.27.5` names a build with a CVE list;
    // `X-Powered-By: Express` names a framework anyone could infer from the 404 body. Firing on the
    // second would make this rule the noisiest in the pack against the very target it is pointed
    // at, and the rule id says *version*. This resolves the caveat `testFlow-tests/VULNS.md` left
    // open for this milestone: bare `X-Powered-By: Express` is a genuine negative case, not an
    // unreported positive.
    if (v !== undefined && VERSION_TOKEN.test(v)) out.push(finding(serverVersionDisclosure, `\`${name}: ${v}\` — names a specific build to look up known vulnerabilities for`));
  }
  return out;
});

// ---------------------------------------------------------------------------
// The two TLS rules (M128c). Both read `o.tls`, which `tlsProbe.ts` fills in from a second
// connection; neither performs I/O, so the whole pack stays as unit-testable as it was.
// ---------------------------------------------------------------------------

const TLS_PROBED = 'the scheme is https and the TLS probe succeeded';

/**
 * Shared shape for both TLS rules, because their precondition is identical and stating it twice is
 * how the two would drift apart.
 *
 * The dynamic `because` is the point. `o.tls === undefined` and `o.tls.ok === false` both mean "not
 * applicable", but the first is a plaintext response (nothing was even attempted) and the second is
 * a handshake that was tried and failed — a refused connection, a timeout, a certificate this run
 * declined to trust. Reporting the second in the first's words would send a reader looking for a
 * scheme problem on a response whose scheme was fine.
 */
function tlsRule(id: string, severity: Severity, description: string, check: (tls: Extract<TlsObservation, { ok: true }>) => Finding[]): SecurityRule {
  const rule: SecurityRule = {
    id,
    severity,
    description,
    appliesWhen: TLS_PROBED,
    evaluate: (o) => {
      if (o.tls === undefined) return { applicable: false, findings: [] };
      if (!o.tls.ok) return { applicable: false, findings: [], because: `${TLS_PROBED} — it did not: ${o.tls.reason}` };
      return { applicable: true, findings: check(o.tls) };
    },
  };
  return rule;
}

/** Everything below TLS 1.2, which is exactly RFC 8996's deprecation line. Not a version-compare:
 * the set is closed, Node reports one of five strings, and a literal set cannot mis-order a name it
 * has never seen the way a hand-rolled comparator can. An unrecognized protocol string is therefore
 * *not* a finding — this rule names the four it knows are dead. */
const DEAD_PROTOCOLS = new Set(['SSLv2', 'SSLv3', 'TLSv1', 'TLSv1.1']);

const tlsVersionOld = tlsRule('sec/tls-version-old', 'serious', 'connection negotiated a deprecated TLS version', (tls) =>
  DEAD_PROTOCOLS.has(tls.protocol)
    ? [
        finding(
          tlsVersionOld,
          `a fresh connection to this host negotiated \`${tls.protocol}\` — deprecated by RFC 8996. That is what this host gives a current client, so unless it sits behind a load balancer with unlike nodes, it is what the asserted request got too`,
        ),
      ]
    : [],
);

/** Tokens that mean the suite is **broken**, not merely dated — no encryption (`NULL`), no peer
 * authentication (`ADH`/`AECDH`/`ANON`), deliberately crippled key sizes (`EXP`/`EXPORT`), a
 * practically-broken keystream (`RC4`/`RC2`), a 64-bit block cipher (`DES`/`3DES`, Sweet32) or a
 * broken MAC (`MD5`).
 *
 * **Narrow on purpose**, the same discipline `cookie-samesite-none` applies to an absent
 * `SameSite`: a list that also flagged CBC-mode AES or SHA-1 handshake signatures would fire on a
 * large share of correctly-configured TLS 1.2 servers, and the pack's stated bar is zero false
 * positives. Everything here is disabled by default in every current TLS stack, so a negotiation
 * that lands on one is a deliberate configuration, not a default. */
const BROKEN_CIPHER_TOKENS = new Set(['NULL', 'EXP', 'EXPORT', 'RC4', 'RC2', 'DES', '3DES', 'MD5', 'ADH', 'AECDH', 'ANON']);

/** Suite names are `-`/`_`-delimited token lists in both spellings OpenSSL and IANA use
 * (`ECDHE-RSA-DES-CBC3-SHA`, `TLS_RSA_WITH_NULL_SHA256`), so tokenizing is exact where a substring
 * search is not: `DES` as a token catches `DES-CBC3-SHA` and never matches inside a longer word. */
function cipherTokens(name: string): string[] {
  return name.toUpperCase().split(/[-_]/);
}

/**
 * **What this rule can and cannot catch, measured rather than assumed (D299).**
 *
 * It fires when the host gives *this run's own client* a broken suite — which means it cannot see a
 * server that merely still offers one alongside something modern, because such a server negotiates
 * the modern one and its callers are fine. That is the right answer for a per-response assertion and
 * the wrong tool for an audit; the audit is cipher enumeration, and it is Tier 3's.
 *
 * The practical reach today is therefore small, and saying so is better than implying otherwise:
 * on OpenSSL 3.x, RC4 and 3DES are not in the default provider and `NULL` is excluded from Node's
 * `DEFAULT_CIPHERS` by `!eNULL`, so a handshake that lands on one of these needs a peer running an
 * older stack. It ships anyway because that peer exists — appliances and long-lived internal
 * services are exactly what a QA suite gets pointed at — and because a pack that silently declined
 * to ask the question would read as having asked it and found nothing.
 */
const tlsWeakCipher = tlsRule('sec/tls-weak-cipher', 'serious', 'connection negotiated a broken cipher suite', (tls) => {
  // Both spellings are searched because Node reports `standardName` only for TLS 1.2+, and it is
  // precisely the old handshakes — the ones most likely to land on a broken suite — where it is
  // absent and `cipherName` is the only name there is.
  const tokens = new Set([...cipherTokens(tls.cipherName), ...(tls.cipherStandardName ? cipherTokens(tls.cipherStandardName) : [])]);
  const hits = [...BROKEN_CIPHER_TOKENS].filter((t) => tokens.has(t));
  if (hits.length === 0) return [];
  return [
    finding(
      tlsWeakCipher,
      `a fresh connection to this host negotiated \`${tls.cipherName}\` (${hits.join(', ')}) — a suite with no usable security margin. That is what this host gives a current client, so unless it sits behind a load balancer with unlike nodes, it is what the asserted request got too`,
    ),
  ];
});

/** D289's ten rules plus `M128c`'s two from the TLS probe. Order is severity-descending. */
export const SECURITY_RULES: readonly SecurityRule[] = [
  cookieNotHttpOnly,
  cookieNotSecure,
  corsWildcardWithCredentials,
  hstsMissing,
  cspMissing,
  tlsVersionOld,
  tlsWeakCipher,
  xFrameOptions,
  cookieSameSiteNone,
  nosniffMissing,
  authenticatedResponseCacheable,
  serverVersionDisclosure,
];

/** A rule that stood down, and why. Carried as a pair rather than as a bare `SecurityRule` so the
 * listing can print a reason the rule computed at evaluation time. */
export interface NotApplicable {
  readonly rule: SecurityRule;
  readonly because: string;
}

/** What one scan produced. All three of D284's states, side by side and uncollapsed — `considered`
 * is the denominator M126 requires on the same line as the counts. */
export interface ScanResult {
  readonly findings: readonly Finding[];
  /** Rules whose precondition held, whether or not they found anything. */
  readonly applicable: readonly SecurityRule[];
  /** Rules whose precondition did not hold, each paired with the sentence explaining it — the
   * rule's static `appliesWhen` unless the rule returned a more specific `because` (M128c). */
  readonly notApplicable: readonly NotApplicable[];
  /** How many rules were in play at all — `applicable.length + notApplicable.length`, and *not*
   * necessarily the whole pack, because a severity floor narrows it first (see `runSecurityScan`). */
  readonly considered: number;
}

/**
 * Runs the pack against one observation.
 *
 * **The floor narrows the pack before applicability is evaluated, not the findings afterwards.**
 * This is the one thing D283/D284 left open and it has to be decided somewhere, so it is decided
 * here and recorded as **D296** in the plan. Filtering findings afterwards would make
 * `expect response has no critical security violations` report ten rules considered and then judge
 * three of them, so the printed denominator would describe work the assertion did not do. Worse, it
 * would make D285 unreachable through the floor: a critical-floor assertion against a plain JSON
 * GET with no cookies and no CORS headers engages *nothing*, and that is precisely the "assertion
 * with no power to fail" D285 exists to catch. Narrowing first makes the floor mean the same thing
 * to the counts, to D285 and to the reader.
 *
 * `filterBySeverity` is not reused for this: it filters `Finding`s, and this filters `SecurityRule`s
 * before any finding exists. Both read `SEVERITY_RANK`, which is the shared part that matters.
 */
export function runSecurityScan(o: Observation, floor: Severity | null = null, pack: readonly SecurityRule[] = SECURITY_RULES): ScanResult {
  const inPlay = floor ? pack.filter((r) => SEVERITY_RANK[r.severity] >= SEVERITY_RANK[floor]) : pack;
  const findings: Finding[] = [];
  const applicable: SecurityRule[] = [];
  const notApplicable: NotApplicable[] = [];
  for (const rule of inPlay) {
    const outcome = rule.evaluate(o);
    if (!outcome.applicable) {
      notApplicable.push({ rule, because: outcome.because ?? rule.appliesWhen });
      continue;
    }
    applicable.push(rule);
    findings.push(...outcome.findings);
  }
  return { findings, applicable, notApplicable, considered: inPlay.length };
}
