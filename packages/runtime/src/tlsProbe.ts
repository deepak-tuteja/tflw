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
// it. The second gap is structural: enumerating a server's whole offer takes one handshake per
// suite, which is a scanner's job (Tier 3's `tflw scan`), not an assertion's.
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
import type { TlsObservation } from './securityRules.js';
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

export class TlsProber {
  readonly #handshakes = new Map<string, Promise<TlsObservation>>();

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
