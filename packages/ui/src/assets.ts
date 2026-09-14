// Where a report's binary evidence lives on disk (`M192` U3). `results.json` carries a screenshot
// and a trace inline as base64; the reporter writes a trace — always — and a large screenshot to
// `assets/` under a name that is the sha1 of that base64, first sixteen hex digits
// (`reporter/src/assets.ts`, `assetHash`). The page restates that rule here in Web Crypto because
// the reporter's is `node:crypto` and cannot be bundled; the page gate asserts the link resolves,
// so a change to the rule there goes red here rather than dangling.

export async function assetHash(base64: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(base64));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

export const tracePath = async (base64: string): Promise<string> => `assets/traces/${await assetHash(base64)}.zip`;

/** The step kinds that drive a browser — a test with one of these is a WebUI test, whose binary
 * evidence exists only at `evidence full` (`FS-01`, `D987`). Mirrors the browser family of
 * `StepKind` in `@tflw/runtime`; `screenshot` and `stub` included because they are page steps. */
export const BROWSER_KINDS: ReadonlySet<string> = new Set([
  'open', 'click', 'fill', 'select', 'checkbox', 'uncheckbox', 'press', 'hover', 'scroll', 'within', 'dialog', 'switchTab', 'closeTab', 'download', 'drag', 'dropFile', 'screenshot', 'stub',
]);
