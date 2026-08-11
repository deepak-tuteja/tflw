// The WHATWG Fetch standard's "bad port" list (https://fetch.spec.whatwg.org/#bad-port), which
// undici enforces before it opens a socket: a request to one of these ports is a network error
// with no syscall attempted (M125b2, `FU-20a`, D260).
//
// Why tflw carries its own copy of the list rather than reading the error undici throws: that
// error is a plain `Error` whose `message` is the string `"bad port"` and which carries **no
// `code`** at all, so `fetchErrorHint`'s `switch (code)` has nothing to match on. Matching the
// prose instead would tie a tflw diagnostic to a dependency's untyped English, and the failure
// would be silent and *closed* — one refactor upstream and the hint vanishes, leaving the bare
// `fetch failed` this row exists to fix, with no test failing anywhere.
//
// The list is a fixed, published constant of the fetch standard, and tflw already has the URL in
// hand at every call site. So the question "is this port refused before the request is sent?" is
// answerable from the URL alone, without consulting the error at all. `blockedPorts.test.ts`
// checks this copy against what `fetch()` actually refuses, so a divergence fails loudly here
// instead of degrading a message in production.
const BLOCKED_PORTS: ReadonlySet<number> = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102,
  103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465,
  512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993,
  995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668,
  6669, 6679, 6697, 10080,
]);

/** Every port the fetch standard refuses, ascending — exported for the conformance test that
 * checks this list against `fetch()`'s own behavior rather than against itself. */
export const blockedPortList: readonly number[] = [...BLOCKED_PORTS].sort((a, b) => a - b);

/**
 * The port `url` names, if the fetch standard blocks it — otherwise `undefined`.
 *
 * A URL with no explicit port is never blocked: the scheme default (80/443) is not on the list, and
 * `URL.port` is `''` in that case rather than the default, so there is nothing to look up. An
 * unparseable URL answers `undefined` too — this is a hint, and a hint must never be the thing that
 * throws.
 */
export function blockedPort(url: string): number | undefined {
  let port: string;
  try {
    port = new URL(url).port;
  } catch {
    return undefined;
  }
  if (port === '') return undefined;
  const n = Number(port);
  return BLOCKED_PORTS.has(n) ? n : undefined;
}
