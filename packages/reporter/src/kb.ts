// M135a (PLAN_M135_SARIF.md D408/D409) — R7's remediation knowledge base: one authored entry per
// rule, saying what the weakness is, why it matters, and how it is repaired.
//
// **Why this is in `@tflw/reporter` and not in the runtime.** `results.json` is
// `JSON.stringify(report)` and stays a raw record of what the run *observed*. Remediation is
// presentation — authored text about a weakness class, not a fact this run measured — and putting it
// in the runtime type would have every finding carry a paragraph of prose it did not measure.
//
// **Why there is no `severity` field here, against R9 saying there should be** (D408). Severity is
// already stated inline in all three rule modules, and `inputRules.ts` states it *twice* per rule —
// once on the descriptor and once on the emitted finding. A KB copy would be the third. Three homes
// for one value is how the rule that fails a build and the rule that appears in a dashboard come to
// disagree, and the disagreement would be invisible: both numbers look authoritative and neither
// cites the other. The SARIF mapping therefore reads severity from the finding and only the fix text
// from here.
//
// **The bar for an entry** (`M135` risk 4). Eighteen entries is eighteen opportunities to write
// plausible advice, and unlike a rule an entry has no test that can be wrong. Every entry cites a
// CWE id and at least one OWASP document, and the citation is the check: a fix that cannot be traced
// to its reference does not belong in the file. `fixNest` exists because the fix a reader can act on
// is a concrete one, and because this tool's own dogfood target is a NestJS application — it is an
// *example*, labelled as one where it renders, never the only way to make the finding go away.

import type { ScanRuleId } from '@tflw/runtime';

export interface KbRef {
  readonly label: string;
  readonly url: string;
}

export interface KbEntry {
  /** A human title for the weakness class — the rule id said as a sentence fragment. */
  readonly title: string;
  /** What the tool observed, stated as the class rather than as this run's instance. */
  readonly what: string;
  /** Why it is worth a repair. The half a reader uses to decide whether to act now. */
  readonly why: string;
  /** The repair in framework-neutral terms. */
  readonly fixGeneric: string;
  /** The same repair, concretely, in NestJS — the dogfood target. An example, not the contract. */
  readonly fixNest: string;
  /** The CWE id, as a number. Rendered as `external/cwe/cwe-N` in `rule.properties.tags` (D407),
   *  which is CodeQL's convention and the one GitHub's UI filters and groups on. */
  readonly cwe: number;
  readonly refs: readonly KbRef[];
}

const OWASP_SESSION: KbRef = {
  label: 'OWASP — Session Management Cheat Sheet',
  url: 'https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html',
};
const OWASP_TLS: KbRef = {
  label: 'OWASP — Transport Layer Security Cheat Sheet',
  url: 'https://cheatsheetseries.owasp.org/cheatsheets/Transport_Layer_Security_Cheat_Sheet.html',
};
const OWASP_HEADERS: KbRef = {
  label: 'OWASP — HTTP Security Response Headers Cheat Sheet',
  url: 'https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html',
};
const OWASP_AUTHZ: KbRef = {
  label: 'OWASP — Authorization Cheat Sheet',
  url: 'https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html',
};
const OWASP_API1: KbRef = {
  label: 'OWASP API Security Top 10 — API1:2023 Broken Object Level Authorization',
  url: 'https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/',
};

function cweRef(id: number, name: string): KbRef {
  return { label: `CWE-${id}: ${name}`, url: `https://cwe.mitre.org/data/definitions/${id}.html` };
}

/**
 * The knowledge base, keyed on the closed union of every rule id in every pack (D409).
 *
 * **A missing entry is a compile error, and that is the feature.** `Record<ScanRuleId, KbEntry>`
 * over a union derived from the packs' own tuples means a nineteenth rule cannot ship with an empty
 * `help`. D409 rejected a conformance test for the job because a test only catches the ids it knows
 * how to enumerate, which is the identical problem this solves once, at build time, for free.
 */
export const REMEDIATION_KB: Readonly<Record<ScanRuleId, KbEntry>> = {
  // ---------------------------------------------------------------------------
  // Tier 1 — response hygiene (`securityRules.ts`)
  // ---------------------------------------------------------------------------

  'sec/cookie-not-httponly': {
    title: 'Cookie readable by JavaScript',
    what: 'A `Set-Cookie` header arrived without the `HttpOnly` attribute, so any script running on this origin can read the cookie through `document.cookie`.',
    why: 'It converts any cross-site scripting flaw anywhere on the origin — including in a third-party script you did not write — into full session theft. `HttpOnly` is what keeps an XSS bug from being an account takeover.',
    fixGeneric: 'Set `HttpOnly` on every cookie no client-side code needs to read. A session or authentication cookie always qualifies; a UI preference cookie that JavaScript genuinely reads is the only common exception, and it should not carry anything sensitive.',
    fixNest: "Pass the flag where the cookie is set — `res.cookie('sid', value, { httpOnly: true, secure: true, sameSite: 'lax' })` — or set `cookie: { httpOnly: true }` in the session middleware's options if a session library issues it.",
    cwe: 1004,
    refs: [OWASP_SESSION, cweRef(1004, "Sensitive Cookie Without 'HttpOnly' Flag")],
  },

  'sec/cookie-not-secure': {
    title: 'Cookie may be sent over plaintext',
    what: 'An https response set a cookie without the `Secure` attribute, so a browser will also send it on a later plain-http request to the same host.',
    why: 'One accidental http link, redirect or hard-coded URL is enough to put the cookie on the wire in the clear, where anyone on the network path can read it. TLS on the endpoint that issued the cookie does not protect the endpoint that later receives it.',
    fixGeneric: 'Set `Secure` on every cookie issued over https, and serve the site over https only. Note the flag is unsettable over plain http — a browser will not store a `Secure` cookie from an insecure origin — so the repair is the pair, not the flag alone.',
    fixNest: "Add `secure: true` to the cookie options, guarded by environment if a local dev server runs on http: `{ httpOnly: true, secure: process.env.NODE_ENV === 'production' }`. Behind a proxy, `app.set('trust proxy', 1)` so the framework knows the external scheme is https.",
    cwe: 614,
    refs: [OWASP_SESSION, cweRef(614, "Sensitive Cookie in HTTPS Session Without 'Secure' Attribute")],
  },

  'sec/cors-wildcard-with-credentials': {
    title: 'CORS allows any origin and credentials together',
    what: 'The response carries `Access-Control-Allow-Origin: *` alongside `Access-Control-Allow-Credentials: true`.',
    why: 'No browser honours this pair, so the configuration does not do what its author wanted — which means it is almost always the second attempt after a console error, and the first attempt was a real origin list. It signals that cross-origin access is being widened by trial rather than by policy, and the next edit in that direction is the one that reflects the request `Origin` back and does grant every site read access to authenticated responses.',
    fixGeneric: 'Name the origins. Echo an `Origin` back only after checking it against an allow-list, and send `Vary: Origin` so a cache cannot serve one origin the response computed for another. Reflecting the request `Origin` unconditionally is the same weakness spelled differently.',
    fixNest: "Give `app.enableCors()` an explicit list — `app.enableCors({ origin: ['https://app.example.com'], credentials: true })`. A function-form `origin` callback must still test against a list, not merely return the input.",
    cwe: 942,
    refs: [
      { label: 'OWASP — Cross-Origin Resource Sharing (Web Security Testing Guide)', url: 'https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/11-Client-side_Testing/07-Testing_Cross_Origin_Resource_Sharing' },
      cweRef(942, 'Permissive Cross-domain Policy with Untrusted Domains'),
    ],
  },

  'sec/hsts-missing': {
    title: 'No Strict-Transport-Security header',
    what: 'An https response arrived with no `Strict-Transport-Security` header, so nothing tells the browser to refuse plaintext to this host next time.',
    why: "A first request typed as a bare hostname, or any http link to the site, is answered over the network before your redirect can run — and that request is where a downgrade attack lives. HSTS is what makes the browser's *second* visit unattackable in that way, and preloading is what covers the first.",
    fixGeneric: 'Send `Strict-Transport-Security: max-age=31536000; includeSubDomains` on https responses. Roll `max-age` up from a short value once you are confident every subdomain is https-capable, since the directive is not easily retracted.',
    fixNest: "Apply the `helmet()` middleware in `main.ts` — its default `strictTransportSecurity` sends exactly this — or set the header yourself in a global interceptor if the app answers only over https at the edge.",
    cwe: 319,
    refs: [
      { label: 'OWASP — HTTP Strict Transport Security Cheat Sheet', url: 'https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Strict_Transport_Security_Cheat_Sheet.html' },
      cweRef(319, 'Cleartext Transmission of Sensitive Information'),
    ],
  },

  'sec/csp-missing': {
    title: 'No Content-Security-Policy on a document response',
    what: 'An HTML document was served with no `Content-Security-Policy` header, so nothing constrains where the page may load or execute script from.',
    why: 'CSP is the control that limits the blast radius of an injection you have not found yet: with a policy, an injected `<script>` from another origin does not run; without one, it does. It is defence in depth rather than a fix for a specific bug, which is why its absence is worth recording even on a page you believe has no injection point.',
    fixGeneric: "Start with a restrictive policy and relax it against real console violations rather than guessing — `default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'`. Prefer nonces or hashes over `'unsafe-inline'`; a policy containing `'unsafe-inline'` for scripts provides very little of what CSP is for.",
    fixNest: "`helmet()` ships a `contentSecurityPolicy` default; override the directives it sets rather than disabling the middleware. For an API that only ever answers JSON, the honest fix is often that the endpoint should not be serving `text/html` at all.",
    cwe: 693,
    refs: [
      { label: 'OWASP — Content Security Policy Cheat Sheet', url: 'https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html' },
      cweRef(693, 'Protection Mechanism Failure'),
    ],
  },

  'sec/tls-version-old': {
    title: 'Connection negotiated a deprecated TLS version',
    what: 'A fresh connection to this host settled on SSLv2, SSLv3, TLS 1.0 or TLS 1.1 — every version RFC 8996 deprecates.',
    why: 'These versions have no remaining security margin: their record protection and handshake constructions are broken in ways that are not configuration-dependent. That the host offered one to a current client means it is what ordinary callers get, not merely something legacy clients can ask for.',
    fixGeneric: 'Set the minimum protocol version to TLS 1.2 at the terminating edge — the load balancer, reverse proxy or CDN, wherever the handshake actually happens — and prefer TLS 1.3. Check the edge rather than the application, since the application usually does not own the handshake.',
    fixNest: "If Node terminates TLS directly, pass `minVersion: 'TLSv1.2'` in the `httpsOptions` given to `NestFactory.create`. Behind nginx, it is `ssl_protocols TLSv1.2 TLSv1.3;` and the application setting has no effect.",
    cwe: 327,
    refs: [OWASP_TLS, { label: 'RFC 8996 — Deprecating TLS 1.0 and TLS 1.1', url: 'https://www.rfc-editor.org/rfc/rfc8996' }, cweRef(327, 'Use of a Broken or Risky Cryptographic Algorithm')],
  },

  'sec/tls-weak-cipher': {
    title: 'Connection negotiated a broken cipher suite',
    what: 'The negotiated suite carries a token that means broken rather than merely dated — no encryption (`NULL`), no peer authentication (`ADH`/`AECDH`), export-grade keys (`EXP`), `RC4`, single or triple `DES`, or an `MD5` MAC.',
    why: 'Every suite in that set is disabled by default in current TLS stacks, so landing on one is a deliberate configuration rather than an accident of age. The traffic it protects should be treated as readable or forgeable by anyone on the path, depending on which token matched.',
    fixGeneric: 'Replace the cipher list with a current recommended set rather than editing tokens out of the existing one; an allow-list that names the suites you want cannot silently retain one you forgot to exclude. Mozilla publishes generated configurations per server and per compatibility level.',
    fixNest: "For Node-terminated TLS, leave `ciphers` unset so the platform default applies — an explicit list copied from an old runbook is the usual source of this finding. At an nginx or Envoy edge, set the suite list there and re-test; the application cannot override it.",
    cwe: 327,
    refs: [OWASP_TLS, { label: 'Mozilla — TLS server configuration generator', url: 'https://ssl-config.mozilla.org/' }, cweRef(327, 'Use of a Broken or Risky Cryptographic Algorithm')],
  },

  'sec/x-frame-options': {
    title: 'Document can be framed by any origin',
    what: 'An HTML document arrived with neither `X-Frame-Options` nor a CSP `frame-ancestors` directive.',
    why: 'Another site can load the page in an invisible frame over its own UI and collect clicks intended for something else — a clickjacked state-changing action is indistinguishable from a real one at the server. It matters most on pages with a one-click destructive or authorising control.',
    fixGeneric: "Send CSP `frame-ancestors 'none'` (or the specific origins that may embed the page). It is the strictly more expressive spelling and browsers prefer it where both are present; `X-Frame-Options: DENY` remains useful only for very old clients.",
    fixNest: "`helmet()` sets `X-Frame-Options: SAMEORIGIN` and a CSP by default. If the app deliberately allows embedding, name the embedding origins in `frame-ancestors` rather than removing the directive.",
    cwe: 1021,
    refs: [
      { label: 'OWASP — Clickjacking Defense Cheat Sheet', url: 'https://cheatsheetseries.owasp.org/cheatsheets/Clickjacking_Defense_Cheat_Sheet.html' },
      cweRef(1021, 'Improper Restriction of Rendered UI Layers or Frames'),
    ],
  },

  'sec/cookie-samesite-none': {
    title: 'Cookie is sent on cross-site requests',
    what: 'A cookie was set with an explicit `SameSite=None`, so the browser attaches it to requests originated by any other site.',
    why: 'It is the precondition for cross-site request forgery: a form or `fetch` on an attacker-controlled page carries the victim\'s session automatically. `SameSite` is not itself a CSRF defence, but `None` removes the one the browser provides for free.',
    fixGeneric: "Use `SameSite=Lax` unless a genuine third-party embedding requires otherwise; `Strict` where the cookie is never needed on an inbound navigation. If `None` is truly required, the endpoint needs its own CSRF defence — an anti-forgery token or a strict `Origin` check on every state-changing request.",
    fixNest: "Set `sameSite: 'lax'` in the cookie options. Where a cookie must stay `None` for an embedded widget, pair it with a CSRF token module and verify the token on every non-idempotent route.",
    cwe: 1275,
    refs: [
      { label: 'OWASP — Cross-Site Request Forgery Prevention Cheat Sheet', url: 'https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html' },
      cweRef(1275, 'Sensitive Cookie with Improper SameSite Attribute'),
    ],
  },

  'sec/nosniff-missing': {
    title: 'No X-Content-Type-Options: nosniff',
    what: 'The response did not carry `X-Content-Type-Options: nosniff`, so a browser may ignore the declared `Content-Type` and infer one from the bytes.',
    why: 'Content sniffing lets a response you consider inert — an uploaded file, a JSON error body, a plain-text export — be treated as HTML or script and executed in your origin. The header is the one-line instruction that the declared type is the type.',
    fixGeneric: 'Send `X-Content-Type-Options: nosniff` on every response, not only on documents, and make sure the declared `Content-Type` is actually correct — the header is a promise the browser will now hold you to.',
    fixNest: '`helmet()` sets it globally. Where responses are written through a raw `Response`, set it in a global interceptor so a handler that bypasses the normal serializer cannot bypass the header too.',
    cwe: 693,
    refs: [OWASP_HEADERS, cweRef(693, 'Protection Mechanism Failure')],
  },

  'sec/authenticated-response-cacheable': {
    title: 'Authenticated response has no Cache-Control',
    what: 'The request carried session or bearer credentials and the response came back with no `Cache-Control` header at all.',
    why: 'With no directive, a shared proxy or CDN may apply its own heuristics, store the body and re-serve it to a different user. The failure is a cross-user data leak that no application log will show, because the second user never reached the application.',
    fixGeneric: 'Send `Cache-Control: no-store` on responses derived from a caller identity. If an authenticated response is genuinely public and cacheable, say so explicitly with `Cache-Control: public` — the finding is about the absence of a decision, not about caching.',
    fixNest: "Set the header in a guard or interceptor on the authenticated routes rather than per-controller, so a route added later inherits it. NestJS's `@CacheControl`-style decorators, where used, must not leave the authenticated paths defaulted.",
    cwe: 525,
    refs: [OWASP_HEADERS, cweRef(525, 'Use of Web Browser Cache Containing Sensitive Information')],
  },

  'sec/server-version-disclosure': {
    title: 'Response advertises a software version',
    what: 'A `Server` or `X-Powered-By` header named a product together with a version number.',
    why: 'It turns "is this host running something with a known CVE?" from a research question into a lookup, and it is the first thing an automated scan collects. On its own it is not exploitable — which is why it is minor — but it lowers the cost of every other attempt.',
    fixGeneric: 'Suppress the version, at the component that emits it. A product name without a version is materially less useful to an attacker and is usually inferable anyway; the version is the part worth removing.',
    fixNest: "Call `app.getHttpAdapter().getInstance().disable('x-powered-by')` (Express) or `app.disable('x-powered-by')`. A `Server` header nearly always comes from the proxy in front, so it is `server_tokens off;` in nginx, not an application change.",
    cwe: 200,
    refs: [
      { label: 'OWASP — Fingerprint Web Server (Web Security Testing Guide)', url: 'https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/01-Information_Gathering/02-Fingerprint_Web_Server' },
      cweRef(200, 'Exposure of Sensitive Information to an Unauthorized Actor'),
    ],
  },

  // ---------------------------------------------------------------------------
  // Tier 2 — authorization (`authzRules.ts`)
  // ---------------------------------------------------------------------------

  'sec/authz-object-leak': {
    title: 'A resource was served to a principal that does not own it',
    what: "A single resource fetched by its owner was re-requested under another declared principal, and that principal received the same resource identity in a 2xx response.",
    why: 'This is broken object level authorization — the most commonly exploited API weakness there is, because it needs no tooling: change an identifier in a URL and read another tenant\'s data. Authentication is working here and that is precisely the point; the caller is who they say they are, and is being served something that is not theirs.',
    fixGeneric: "Authorize on the object, not on the route. Every read of a resource by identifier must check that identifier against the caller's ownership or grant, in the same query that fetches it where possible — a `WHERE id = ? AND owner_id = ?` cannot be forgotten the way a separate check can. Unguessable identifiers are not authorization.",
    fixNest: "Put the check inside the service method that loads the entity, so every controller reaching it inherits it — `this.orders.findOne({ where: { id, customer: { id: user.id } } })` — rather than in a guard that only the routes someone remembered to decorate will run.",
    cwe: 639,
    refs: [OWASP_API1, OWASP_AUTHZ, cweRef(639, 'Authorization Bypass Through User-Controlled Key')],
  },

  'sec/authz-collection-leak': {
    title: "A collection served another principal's resources",
    what: "A collection endpoint returned, to one principal, resource identities that another principal's own response established as theirs.",
    why: "A list endpoint leaks in bulk and leaks quietly: nothing in the request looks hostile, the caller supplied no identifier to tamper with, and the response is a well-formed 2xx. The missing piece is a scoping predicate rather than a bypassed check, which is why it survives reviews that concentrate on the by-id routes.",
    fixGeneric: "Scope the query by the caller at the data layer, never by filtering after the fact in the handler and never by relying on a client-supplied filter parameter. A default-deny repository — one that requires a principal to build a query at all — makes the omission impossible rather than unlikely.",
    fixNest: "Take the principal from the request in the service, not the controller, and put it in the `where` clause of the list query. Where a query builder is used, add the scope before any user-supplied filters so a filter cannot widen it.",
    cwe: 863,
    refs: [OWASP_API1, OWASP_AUTHZ, cweRef(863, 'Incorrect Authorization')],
  },

  // ---------------------------------------------------------------------------
  // Tier 3 — input handling (`inputRules.ts`)
  // ---------------------------------------------------------------------------

  'sec/error-detail-disclosure': {
    title: 'A hostile input made the application disclose its own internals',
    what: 'A mutated input produced a response body containing machinery a well-behaved API cannot emit by accident — a stack frame, a database error grammar, an ORM exception class name, or a server-side filesystem path.',
    why: 'It hands an attacker the map: the framework, the database, the query shape and often a filesystem layout, which is exactly what turns a blind probe into a targeted one. The disclosure is also evidence that an unexpected input reached a layer that was not written to receive it.',
    fixGeneric: 'Serialize errors through one boundary that emits a stable shape — a code, a message written for the caller, and nothing derived from the exception — and log the detail server-side against a correlation id. The rule is that the client gets the id and the operator gets the stack, never the reverse.',
    fixNest: "NestJS's global exception filter does this for anything thrown as an `HttpException`. The finding usually comes from a handler that *catches* a driver error and serializes it — `return { error: e.name, detail: e.message }` — which bypasses the filter entirely. Re-throw instead, and let the filter answer.",
    cwe: 209,
    refs: [
      { label: 'OWASP — Error Handling Cheat Sheet', url: 'https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html' },
      cweRef(209, 'Generation of Error Message Containing Sensitive Information'),
    ],
  },

  'sec/reflected-input-unescaped': {
    title: 'Input was echoed into a markup response without escaping',
    what: 'A payload carrying raw markup metacharacters came back verbatim in an HTML or text body, angle brackets intact.',
    why: 'That is reflected cross-site scripting: a link containing the payload runs attacker script in your origin, with the victim\'s session. The reflection is the whole vulnerability — nothing further needs to be stored or persisted for it to work.',
    fixGeneric: 'Escape on output, contextually, rather than sanitising on input — the correct escaping differs between HTML text, an attribute, a URL and a script context, and only the output site knows which it is. A template engine that escapes by default is the reliable answer; string concatenation into markup is the reliable failure.',
    fixNest: "An endpoint that answers `application/json` is not affected — JSON has no markup semantics — so the first question is whether this route should be serving HTML at all. Where it should, render through a template engine with escaping on rather than building the body with a template literal.",
    cwe: 79,
    refs: [
      { label: 'OWASP — Cross Site Scripting Prevention Cheat Sheet', url: 'https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html' },
      cweRef(79, 'Improper Neutralization of Input During Web Page Generation'),
    ],
  },

  'sec/path-traversal-read': {
    title: 'A traversal payload made the application read a file',
    what: 'A path segment containing `../` hops produced a response body carrying a filesystem signature the ordinary response did not contain — a `passwd`-shaped line, a private key header, or a Windows ini section.',
    why: "The application read a file the caller chose, which is arbitrary file read: configuration, credentials, keys and source are all reachable from wherever the base directory sits. This is judged on the file's *contents* coming back rather than on the path being echoed, so the finding means the read actually happened.",
    fixGeneric: "Do not build a filesystem path from request input. Map an opaque identifier to a path through a lookup you control; where a path component is unavoidable, resolve the final path and verify it is still inside the intended directory *after* resolution — checking for `..` before resolving is defeated by encoding and by `....//`.",
    fixNest: "Validate the parameter to a shape that cannot traverse — a UUID pipe, or a strict pattern — and resolve with `path.resolve(base, name)` followed by an explicit `resolved.startsWith(base + path.sep)` check. `path.join` alone does not confine, since it happily resolves the hops before you see the result.",
    cwe: 22,
    refs: [
      { label: 'OWASP — Path Traversal (Web Security Testing Guide)', url: 'https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/05-Authorization_Testing/01-Testing_Directory_Traversal_File_Include' },
      cweRef(22, "Improper Limitation of a Pathname to a Restricted Directory ('Path Traversal')"),
    ],
  },

  'sec/oversized-input-accepted': {
    title: 'A value far beyond any plausible bound was accepted',
    what: 'A field was sent at a length no legitimate client would produce and the endpoint answered 2xx — nothing refused it.',
    why: 'An unbounded field is an unbounded cost: memory to hold it, a row or index to store it, and whatever downstream system it is later passed to. Individually minor, it is the primitive a resource-exhaustion attempt is built from, and it usually indicates the field has no validation at all rather than a bound set too high.',
    fixGeneric: 'Give every string and array field an explicit maximum, declared alongside the type so the check cannot be skipped, and enforce a body size limit at the edge as well. A `413` or a `400` here is the correct behaviour and is what this rule looks for.',
    fixNest: "Add `@MaxLength(n)` (or `@ArrayMaxSize`) to the DTO property and keep the global `ValidationPipe` on, so the bound is refused before the handler runs. Pair it with a body limit on the HTTP adapter for the payloads that never reach a DTO.",
    cwe: 770,
    refs: [
      { label: 'OWASP — Input Validation Cheat Sheet', url: 'https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html' },
      cweRef(770, 'Allocation of Resources Without Limits or Throttling'),
    ],
  },
};

/**
 * The entry for a rule id, or `undefined` for an id the KB does not know.
 *
 * The `undefined` arm is unreachable for any rule this build ships — that is D409's whole point —
 * and exists because a `ScanFinding.rule` is a `string` on the wire: a `results.json` from a newer
 * build, replayed through an older reporter, must render without its fixes rather than throw.
 */
export function remediationFor(rule: string): KbEntry | undefined {
  return (REMEDIATION_KB as Readonly<Record<string, KbEntry>>)[rule];
}
