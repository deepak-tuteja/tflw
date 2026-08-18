// The out-of-band TLS probe (M128c, PLAN_M128_PENTEST_TIER1.md D288) — the I/O half of the two
// `sec/tls-*` rules, kept in its own file for the same reason `a11y.ts` is kept out of `finding.ts`:
// `securityRules.ts` must stay pure, and a rule that opened a socket would end that.
//
// ## Why a second connection at all
//
// `runtime/src/tls.ts` documents the constraint. The runtime drives Node's global `fetch` (undici),
// and PLAN decision 43's zero-runtime-dependency bundle forbids the `undici`/`https.Agent`
// dependency that would expose the protocol and cipher the *observed* request negotiated. So the
// facts come from a fresh `tls.connect()` to the same `host:port` — stdlib only, no new dependency,
// decision 43 intact.
//
// **What that buys and what it costs, stated in the failure text and not only here (D299):** this
// establishes what the host gives *a current client on a fresh connection* — not what the request
// that was actually asserted on negotiated, and not the full set of parameters the host would
// accept from somebody else. For a service with one TLS configuration the first gap is nil; behind
// a load balancer with heterogeneous nodes it is not, and only the undici dependency would close
// it.
//
// **The second gap is closed by `M137g`** (`D485`). The sentence that used to stand here — that
// enumerating a server's whole offer "takes one handshake per suite, which is a scanner's job
// (Tier 3's `tflw scan`), not an assertion's" — was overtaken twice: `D432` killed that mode, and
// `D441` landed the capability here instead, behind `probe ciphers`. Corrected rather than stepped
// over (`M132b`'s precedent), because a file's own header is the last place a reader expects to be
// told about a capability the file has since grown. See `enumerateOffered`.
//
// ## One handshake per host, per run
//
// A rule that fires per response must not open a handshake per response: a suite with 400 assertions
// against one host would otherwise pay 400 handshakes for one unchanging answer. The cache holds the
// in-flight *promise*, not the settled value, so concurrent assertions against the same host share
// one connection rather than racing to open several.
//
// ## The two refusals are not cached
//
// `allow hosts` and the D291 `authorized target` declaration are *policy*, evaluated per call and
// never memoized. They are cheap, and — more to the point — they belong to the config the assertion
// ran under, while the cache is shared across every file in the run. Caching a refusal would let one
// file's narrower allowlist answer another file's question.

import { connect, type ConnectionOptions, type TLSSocket } from 'node:tls';
import { isIP } from 'node:net';
import { allowHostsRefusal, isHostAllowed } from './allowHosts.js';
import type { OfferedSuites, TlsObservation } from './securityRules.js';
import type { AuthorizedTarget } from './types.js';

/** Everything about the config that can change a probe's answer or its permission to run. Passed per
 * call rather than held on the prober, because the prober is shared across a whole `tflw run` while
 * these come from whichever file's resolved config the assertion executed under. */
export interface TlsProbePolicy {
  readonly timeoutMs: number;
  /** `insecure true` (decision 78). Passed explicitly rather than left to the process-wide
   * `NODE_TLS_REJECT_UNAUTHORIZED` that `tls.ts` sets: that env var *would* reach `tls.connect`, but
   * relying on it would make this file's behavior depend on a side effect set up somewhere else and
   * refcounted against a third thing. The probe verifies certificates exactly when the run's
   * requests do, and says so in one place. */
  readonly insecure: boolean;
  readonly allowHosts: readonly string[] | null;
  readonly authorizedTargets: readonly AuthorizedTarget[];
  /** `probe ciphers` on the `authorized target` covering this origin (`M137g`, `D485`). Governs
   * `enumerateOffered` only; the single `D288` handshake `probe` makes is unaffected and stays
   * available to every security assertion without an opt-in, exactly as it has since `M128c`. */
  readonly probeCiphers: boolean;
}

/**
 * D291's runtime half.
 *
 * The checker already rejects a security assertion whose target has no matching `authorized target`
 * (`TF060`), so this can never be the *only* enforcement — and it is not redundant either. The
 * checker judges the base URL it can see statically; this judges `response.finalUrl`, which is where
 * the run actually ended up. A redirect to a host nobody declared is the case that only exists at
 * run time, and it is precisely the case where opening an unasked-for second connection would be
 * least defensible.
 *
 * Origin equality, not the `allow hosts` wildcard matcher — deliberately, and the same call the
 * checker makes. A declaration is an affirmation about one named target; matching it loosely would
 * make the affirmation cover hosts its author never wrote down, which is what D291 rejects
 * wildcards for in the first place.
 */
function authorizedFor(url: URL, targets: readonly AuthorizedTarget[]): AuthorizedTarget | undefined {
  return targets.find((t) => {
    try {
      return new URL(t.target).origin === url.origin;
    } catch {
      return false;
    }
  });
}

/** `host:port`, plus the one policy bit that can change the *answer* rather than the permission: a
 * run with `insecure true` may complete a handshake that an ordinary run refuses at certificate
 * verification, and those two results must not share a cache entry. */
function cacheKey(url: URL, policy: TlsProbePolicy): string {
  const port = url.port === '' ? '443' : url.port;
  return `${url.hostname}:${port}${policy.insecure ? ' insecure' : ''}`;
}

/**
 * The connection parameters the probe uses, extracted so they can be **asserted on**.
 *
 * Not a refactor for tidiness. `minVersion` below is the one decision in this file whose effect is
 * invisible on a modern host: a TLS 1.0 listener cannot be constructed on OpenSSL 3.x at all
 * (measured — Fedora 43's crypto policy compiles the protocol out), so no test anywhere can observe
 * the difference between offering that floor and not offering it by watching a handshake. Exposing
 * the object is the only way the choice is checkable rather than merely commented, and a decision
 * that no test can distinguish from its opposite is a decision that will be silently reverted.
 */
export function connectionOptions(host: string, port: number, policy: TlsProbePolicy): ConnectionOptions {
  return {
    host,
    port,
    rejectUnauthorized: !policy.insecure,
    // **D298 — the probe reaches down to TLS 1.0 on purpose, and this line is what makes
    // `sec/tls-version-old` able to fire at all.**
    //
    // Node's `tls.DEFAULT_MIN_VERSION` is `TLSv1.2`. Without this, a server that speaks nothing
    // but TLS 1.0 refuses the handshake, the probe reports `ok: false`, and the rule stands down
    // as *not applicable* — so the pack's answer to "is this host on a dead protocol?" would be
    // "we could not tell", permanently, and most loudly in exactly the case the rule exists for.
    //
    // Safe, and measured rather than assumed: offering an old floor does not drag a healthy server
    // down, because the server still picks the best version *both* sides speak. A TLS 1.3 listener
    // probed by a `TLSv1`-floored client negotiates TLS 1.3, and a TLS-1.2-minimum listener does
    // too. The floor only decides which servers we can reach, never which version we settle on.
    //
    // Ciphers are deliberately **not** widened the same way. Reaching a legacy-cipher-only server
    // needs `@SECLEVEL=0`, and OpenSSL's security level is not a cipher knob — it also lowers what
    // counts as an acceptable *certificate*, so a strict run would quietly start trusting keys and
    // signatures it currently rejects. That is a verification cost paid for a cipher reach, and on
    // OpenSSL 3.x the suites in question are not compiled in at all, so it buys nothing anyway.
    // See `sec/tls-weak-cipher`'s own note for what that means for the rule's power.
    minVersion: 'TLSv1',
    // SNI is a hostname extension; sending an IP literal in it is a protocol violation that some
    // servers reject outright, so an IP target gets no `servername` at all. Node infers the same
    // default, but stating it means a reader does not have to know that it does.
    ...(isIP(host) === 0 ? { servername: host } : {}),
  };
}

/**
 * `M137g`/`D485` — the broken suites worth *asking* a host about, one handshake each.
 *
 * **Static, and it has to be**, which is a measurement rather than a preference. `tls.getCiphers()`
 * reports 62 suites on this stack and **not one of them is broken** — it reflects the default list
 * at OpenSSL's security level 2, while the suites below are reachable from the same binary once
 * `@SECLEVEL=0` is named. So a candidate list derived from the stack would be empty and would report
 * a clean offer for every host on earth: the vacuous-control shape this arc keeps filing findings
 * about, arriving as a portability nicety.
 *
 * What is *not* assumed is which of these the local stack can speak. That is discovered per run —
 * see `unaskable` on `OfferedSuites`. Ordered broken-family first so a truncated log still shows the
 * interesting half.
 */
export const BROKEN_SUITE_CANDIDATES: readonly string[] = [
  // No encryption at all. The only family this stack could still reach when D486 measured it.
  'NULL-MD5',
  'NULL-SHA',
  'NULL-SHA256',
  'ECDHE-RSA-NULL-SHA',
  'ECDHE-ECDSA-NULL-SHA',
  // No authentication — an anonymous key exchange is a man in the middle's front door.
  'AECDH-NULL-SHA',
  'ADH-AES128-SHA',
  'AECDH-AES128-SHA',
  // Broken stream cipher (RFC 7465).
  'RC4-MD5',
  'RC4-SHA',
  'ECDHE-RSA-RC4-SHA',
  'ECDHE-ECDSA-RC4-SHA',
  // 64-bit block ciphers — Sweet32 (RFC 7457 §2.9).
  'DES-CBC3-SHA',
  'ECDHE-RSA-DES-CBC3-SHA',
  'EDH-RSA-DES-CBC3-SHA',
  'DES-CBC-SHA',
  // Deliberately weakened for 1990s export law, and still answered by some appliances.
  'EXP-RC4-MD5',
  'EXP-DES-CBC-SHA',
];

export class TlsProber {
  readonly #handshakes = new Map<string, Promise<TlsObservation>>();
  /** `M137g` — memoized per `host:port` for `D288`'s reason, unchanged: an offer is a property of
   * the host, and a suite with 400 assertions against it must not pay for the enumeration 400
   * times. Holds the in-flight promise, so concurrent assertions share one enumeration. */
  readonly #offers = new Map<string, Promise<OfferedSuites>>();
  #inFlight = 0;
  #peakInFlight = 0;

  /** How many enumeration handshakes were ever open at once. `D435` keeps the crawl strictly
   * sequential and leaves `probe rate` deferred; this is the first **non-HTTP** path where that
   * could drift unnoticed, so the property is measured rather than asserted in a comment — the same
   * treatment `authz-probe-pacing.test.ts` gives the HTTP path. */
  get peakHandshakesInFlight(): number {
    return this.#peakInFlight;
  }

  /** How many handshakes this prober has actually opened. Exposed for the tests that assert the
   * cache is doing its job — a cache whose only evidence is that results match is a cache that could
   * be re-probing every time and nobody would know. */
  get handshakeCount(): number {
    return this.#handshakes.size;
  }

  /**
   * Reads the TLS facts for `url`, or the reason they could not be read.
   *
   * Never throws and never rejects. Every failure path — a refused connection, a timeout, an
   * untrusted certificate, a policy refusal — comes back as `{ ok: false, reason }`, because a
   * failed probe is *not applicable*, not an error: the third state D284 built for exactly this.
   * Turning a transient socket failure into a thrown `RuntimeError` would fail a security assertion
   * that still had ten other rules to judge, and would report a network hiccup as a security verdict.
   */
  async probe(url: string, policy: TlsProbePolicy): Promise<TlsObservation> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, reason: `the response URL (${url}) could not be parsed` };
    }
    if (parsed.protocol !== 'https:') {
      // Callers gate on the scheme already; this is the belt to that's braces, and it keeps the
      // sentence honest for anyone who calls the prober directly.
      return { ok: false, reason: `the response did not arrive over https (${parsed.protocol}//)` };
    }
    if (!isHostAllowed(url, policy.allowHosts)) {
      return { ok: false, reason: allowHostsRefusal(url, policy.allowHosts!, { kind: 'tls-probe' }) };
    }
    if (!authorizedFor(parsed, policy.authorizedTargets)) {
      return {
        ok: false,
        reason:
          `no \`authorized target\` covers ${parsed.origin} — refusing to open the TLS probe connection. ` +
          `The run ended up here (a redirect, or a base URL that resolves differently than it reads), and the probe is a second connection tflw makes on its own initiative, so it needs its own affirmation: add \`authorized target "${parsed.origin}" reason "…"\` (SPEC §3.10, D291)`,
      };
    }

    const key = cacheKey(parsed, policy);
    const cached = this.#handshakes.get(key);
    if (cached) return cached;
    const port = parsed.port === '' ? 443 : Number(parsed.port);
    const started = handshake(parsed.hostname, port, policy);
    this.#handshakes.set(key, started);
    return started;
  }

  /**
   * `M137g`/`D485` — what this host *offers*, one handshake per candidate suite.
   *
   * Returns `undefined` when the caller has no permission to ask: the same two policy gates `probe`
   * applies, plus `probe ciphers` on the `authorized target` covering this origin. `undefined` is
   * **not** an empty offer, and the rule must not render it as one — that is the whole difference
   * between "asked and found nothing" and "never asked".
   *
   * Strictly sequential (`D435`). The handshakes are `await`ed one at a time rather than raced, and
   * `peakHandshakesInFlight` is the guard that says so out loud.
   */
  async enumerateOffered(url: string, policy: TlsProbePolicy): Promise<OfferedSuites | undefined> {
    if (!policy.probeCiphers) return undefined;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return undefined;
    }
    if (parsed.protocol !== 'https:') return undefined;
    if (!isHostAllowed(url, policy.allowHosts)) return undefined;
    if (!authorizedFor(parsed, policy.authorizedTargets)) return undefined;

    const key = cacheKey(parsed, policy);
    const cached = this.#offers.get(key);
    if (cached) return cached;
    const port = parsed.port === '' ? 443 : Number(parsed.port);
    const started = this.#enumerate(parsed.hostname, port, policy);
    this.#offers.set(key, started);
    return started;
  }

  async #enumerate(host: string, port: number, policy: TlsProbePolicy): Promise<OfferedSuites> {
    const accepted: string[] = [];
    const refused: string[] = [];
    const unaskable: string[] = [];
    // The tracker wraps the **socket**, not this loop. It counted iterations until `M137g`'s own
    // mutation sweep walked through the guard untouched: racing two handshakes inside one iteration
    // left the peak at 1, so the control that keeps `probe rate` deferred could not see the change
    // that would revive it. A pacing guard measuring the wrong noun is worse than none, because it
    // reads as evidence.
    const track = {
      open: (): void => {
        this.#inFlight += 1;
        this.#peakInFlight = Math.max(this.#peakInFlight, this.#inFlight);
      },
      close: (): void => {
        this.#inFlight -= 1;
      },
    };
    for (const suite of BROKEN_SUITE_CANDIDATES) {
      const verdict = await suiteHandshake(host, port, suite, policy, track);
      (verdict === 'accepted' ? accepted : verdict === 'refused' ? refused : unaskable).push(suite);
    }
    return { accepted, refused, unaskable };
  }
}

/** One suite, one handshake, three possible answers (`D486`).
 *
 * **Certificate verification is off unconditionally, and that is the decision rather than an
 * oversight.** `D298` refused to widen the probe's cipher list because reaching a legacy suite needs
 * `@SECLEVEL=0`, which also lowers what counts as an acceptable certificate — *"a strict run would
 * quietly start trusting keys and signatures it currently rejects."* That objection is fatal to a
 * probe whose answer feeds a **trust** decision, and this one's does not: it reads a single bit —
 * did the peer accept this suite — transfers no application data, sends no credential and reads no
 * body. The result reaches exactly one field (`OfferedSuites`), which `sec/tls-version-old` is
 * forbidden to read and a guard test asserts it never does.
 *
 * The `unaskable` verdict is the one that keeps this honest. `ERR_SSL_NO_CIPHERS_AVAILABLE` and
 * `NO_CIPHER_MATCH` come from **our own** OpenSSL declining to build a ClientHello, before a byte
 * reaches the network — so nothing whatever was learned about the server, and calling that a refusal
 * would report a clean answer to a question nobody asked.
 */
type SuiteVerdict = 'accepted' | 'refused' | 'unaskable';

/** Our own stack declining to build the ClientHello, in either of the two shapes it arrives in.
 *
 * One function rather than a condition at each call site, because `M137g`'s sweep showed the two
 * paths drifting apart is invisible: the synchronous throw is the one this OpenSSL takes, so a
 * mutation of the asynchronous branch alone survived every test. Same question, one answer. */
function isUnaskable(code: string): boolean {
  return code.includes('NO_CIPHERS_AVAILABLE') || code.includes('NO_CIPHER_MATCH');
}

interface HandshakeTracker {
  open(): void;
  close(): void;
}

function suiteHandshake(host: string, port: number, suite: string, policy: TlsProbePolicy, track: HandshakeTracker): Promise<SuiteVerdict> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (verdict: SuiteVerdict): void => {
      if (settled) return;
      settled = true;
      clearTimeout(overall);
      socket?.destroy();
      track.close();
      resolve(verdict);
    };

    let socket: TLSSocket | undefined;
    track.open();
    try {
      socket = connect({
        host,
        port,
        // Never `policy.insecure`. See this function's header: the connection reads one bit and is
        // forbidden to contribute a certificate fact to anything.
        rejectUnauthorized: false,
        ciphers: `${suite}:@SECLEVEL=0`,
        // These are all TLS 1.2-and-below suites. TLS 1.3 negotiates its suites through a separate
        // `ciphersuites` list, so leaving 1.3 reachable would let a healthy server answer the modern
        // way and make every candidate look refused.
        minVersion: 'TLSv1',
        maxVersion: 'TLSv1.2',
        ...(isIP(host) === 0 ? { servername: host } : {}),
      });
    } catch (err) {
      // Thrown synchronously when OpenSSL cannot parse or satisfy the cipher string at all — which
      // is the path this stack actually takes for RC4 and 3DES.
      settled = true;
      track.close();
      resolve(isUnaskable((err as NodeJS.ErrnoException).code ?? '') ? 'unaskable' : 'refused');
      return;
    }

    socket.on('secureConnect', () => finish('accepted'));
    socket.setTimeout(policy.timeoutMs, () => finish('refused'));
    const overall = setTimeout(() => finish('refused'), policy.timeoutMs);
    overall.unref?.();
    socket.on('error', (err: NodeJS.ErrnoException) => {
      finish(isUnaskable(err.code ?? '') ? 'unaskable' : 'refused');
    });
  });
}

/**
 * One handshake, resolved to facts or to a reason.
 *
 * Two timers' worth of care, because they cover different failures. `socket.setTimeout` fires on
 * *inactivity*, which catches a peer that accepts the TCP connection and then says nothing — the
 * classic hang a plain connect timeout misses entirely. The outer timer bounds the whole attempt,
 * including a peer that dribbles bytes forever and so never goes idle. Whichever fires first
 * destroys the socket and settles the promise once.
 */
function handshake(host: string, port: number, policy: TlsProbePolicy): Promise<TlsObservation> {
  return new Promise<TlsObservation>((resolve) => {
    const where = `${host}:${port}`;
    let settled = false;
    const finish = (result: TlsObservation): void => {
      if (settled) return;
      settled = true;
      clearTimeout(overall);
      socket.destroy();
      resolve(result);
    };

    const socket: TLSSocket = connect(connectionOptions(host, port, policy), () => {
      const protocol = socket.getProtocol();
      const cipher = socket.getCipher();
      if (protocol === null || cipher === undefined) {
        // Reachable in principle (Node types both as nullable for a socket that is no longer
        // connected) and worth its own sentence: "the handshake completed but reported nothing" is a
        // different diagnosis from "the handshake failed", and a reader who sees the second when the
        // first happened has been sent to look in the wrong place.
        finish({ ok: false, reason: `the handshake to ${where} completed but reported no protocol or cipher` });
        return;
      }
      finish({
        ok: true,
        protocol,
        cipherName: cipher.name,
        ...(cipher.standardName !== undefined ? { cipherStandardName: cipher.standardName } : {}),
      });
    });

    socket.setTimeout(policy.timeoutMs, () => {
      finish({ ok: false, reason: `the TLS handshake to ${where} went idle after ${policy.timeoutMs}ms` });
    });
    const overall = setTimeout(() => {
      finish({ ok: false, reason: `the TLS handshake to ${where} did not complete within ${policy.timeoutMs}ms` });
    }, policy.timeoutMs);
    // A run should not be held open by a probe that is going to be abandoned anyway.
    overall.unref?.();

    socket.on('error', (err: NodeJS.ErrnoException) => {
      // `code` first, `message` second. `ECONNREFUSED` and `DEPTH_ZERO_SELF_SIGNED_CERT` are the two
      // an author will actually hit — the first means the port is not listening, the second means
      // the run verifies certificates and this one is self-signed, which is `insecure true`'s exact
      // shape. Both are more use than the prose Node wraps them in.
      finish({ ok: false, reason: `the TLS handshake to ${where} failed: ${err.code ?? err.message}` });
    });
  });
}
