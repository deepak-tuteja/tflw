// addressClass.ts — is this target's address on the operator's own network, or on the internet?
// (M131a, `PLAN_M131_SAFETY_COMPLETION.md` D338/D339.)
//
// D21 layer 3 says a public target needs an affirmation that **cannot live in config**. Deciding
// which targets those are is this file's whole job, and it does it from the URL's host *as written*.
//
// ## No DNS. Ever. Not as a fallback, not behind a flag (D338)
//
// 1. **A safety control that resolves DNS sends a packet to decide whether it is allowed to send a
//    packet.** That is not a hypothetical objection — it is the control conceding the first move to
//    the thing it exists to gate.
// 2. **The answer is not stable.** It differs on VPN and off it, differs between a laptop and CI,
//    and a TTL-0 record can rebind between `tflw check` and the probe. A control defeatable by the
//    network it is guarding against is worth less than one that says plainly it does not look.
// 3. **It makes the control testable without touching the internet.** This is the reason that
//    turned a defensible choice into an obvious one: under literal classification
//    `https://staging.example.invalid` (RFC 2606, guaranteed never to resolve) is `public` with no
//    lookup, so `M131b`'s whole acceptance corpus is real, offline, and stays that way (D347).
//
// **The cost, stated rather than hidden:** `https://api.internal.corp` is genuinely private and
// still needs the flag, because nothing in that string says so. That is one more argument in a CI
// invocation, and the error direction is the safe one — this over-asks, it never under-asks. The
// alternative that would remove the cost, a config-declared private-name suffix, was rejected: it
// puts the exemption back *inside config*, which is precisely the arrangement D21 §3.2(3) exists to
// forbid.
//
// ## Why `invalid` is a third answer rather than folded into `public`
//
// `0.0.0.0` and `::` are not addresses of a host, they are wildcards, and a target written that way
// is a config mistake its author should fix. Classifying them `public` would make the flag able to
// *authorize* one, and classifying them `exempt` would quietly bless whatever the resolver decides
// they mean. Neither is a thing anyone can affirm, so the callers get a distinct answer and refuse
// on it. Same for a string that is not a URL at all — permission is never inferred from something
// that failed to parse, the rule `mayProbeMutating` already follows one package over.

export type AddressClass = 'exempt' | 'public' | 'invalid';

/**
 * D339's table, as one predicate over a URL's literal host.
 *
 * - `exempt` — loopback, RFC1918, IPv6 unique-local, link-local, CGNAT, and the reserved name
 *   `localhost` (plus `*.localhost`, which RFC 6761 §6.3 requires resolvers to keep loopback).
 * - `invalid` — unparseable, hostless, or an unspecified/wildcard address.
 * - `public` — **everything else, including every other hostname.** There is no name-based
 *   exemption beyond `localhost`, by D338.
 */
export function classifyAddress(url: string): AddressClass {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return 'invalid';
  }
  if (host === '') return 'invalid';

  // `URL` keeps IPv6 literals in brackets; everything below wants the address itself.
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  const lower = bare.toLowerCase();

  if (isUnspecified(lower)) return 'invalid';

  const v4 = parseIpv4(lower) ?? mappedIpv4(lower);
  if (v4 !== null) return isExemptIpv4(v4) ? 'exempt' : 'public';
  if (looksIpv6(lower)) return isExemptIpv6(lower) ? 'exempt' : 'public';

  // RFC 6761 §6.3 — `localhost` and anything under it. Written as a suffix test rather than a
  // wildcard match because there is exactly one exempt name and a pattern matcher here would be an
  // invitation to add a second (D338).
  if (lower === 'localhost' || lower.endsWith('.localhost')) return 'exempt';

  return 'public';
}

/** The wildcard/unspecified addresses, which name no host at all (D339). */
function isUnspecified(host: string): boolean {
  if (host === '0.0.0.0' || host === '::' || host === '0:0:0:0:0:0:0:0') return true;
  const mapped = mappedIpv4(host);
  return mapped !== null && mapped[0] === 0 && mapped[1] === 0 && mapped[2] === 0 && mapped[3] === 0;
}

/** Dotted-quad only, and that is sufficient rather than lax: **the WHATWG parser has already
 *  normalized the obfuscated forms** before this sees them. `new URL('http://0x7f000001').hostname`
 *  is `"127.0.0.1"`, and so are `0177.0.0.1` and `2130706433`. Re-implementing `inet_aton` here
 *  would be a second opinion about a question `URL` settles, and a second opinion is how the
 *  classifier and the sender come to disagree about which host a run is talking to — the sender
 *  uses the same parser. Measured, not assumed: `addressClass.test.ts` asserts all three. */
function parseIpv4(host: string): [number, number, number, number] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const nums: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    nums.push(n);
  }
  return [nums[0]!, nums[1]!, nums[2]!, nums[3]!];
}

/** `::ffff:127.0.0.1` and `::ffff:7f00:1` — the IPv4-mapped forms, which are the same host reached
 *  through a dual-stack socket. Exempting the dotted form but not the mapped one would make the
 *  control depend on how a stack chose to print an address. */
function mappedIpv4(host: string): [number, number, number, number] | null {
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(host);
  if (dotted) return parseIpv4(dotted[1]!);
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(host);
  if (!hex) return null;
  const hi = parseInt(hex[1]!, 16);
  const lo = parseInt(hex[2]!, 16);
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];
}

function isExemptIpv4(ip: readonly [number, number, number, number]): boolean {
  const [a, b] = ip;
  if (a === 127) return true; // loopback 127/8
  if (a === 10) return true; // RFC1918 10/8
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918 172.16/12
  if (a === 192 && b === 168) return true; // RFC1918 192.168/16
  if (a === 169 && b === 254) return true; // link-local 169.254/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  return false;
}

/** Loose on purpose: anything with a colon that `URL` accepted as a host is an IPv6 literal, and
 *  this only has to decide whether it is one of D339's rows. */
function looksIpv6(host: string): boolean {
  return host.includes(':');
}

function isExemptIpv6(host: string): boolean {
  if (host === '::1' || /^(0{1,4}:){7}0{0,3}1$/.test(host)) return true; // loopback
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true; // unique-local fc00::/7
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true; // link-local fe80::/10
  return false;
}
