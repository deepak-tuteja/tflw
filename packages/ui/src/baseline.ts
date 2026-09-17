// What `[accept]` puts into a baseline document — `M208` `S3` (`Q1`, `D387`).
//
// **Its own module and not `App.tsx`'s, for a reason a test found.** It is a pure function over
// two strings and importing it from the shell drags in React, the stylesheet and `uplot`'s CSS,
// which `node:test` cannot load at all — so the cases that matter most here would have been
// reachable only through a browser. Those cases are the ones a browser gate is worst at: a
// document with a trailing key, an entry already present, bytes that are not JSON. A feature
// whose every failure mode makes a build **greener** wants them cheap to assert.

/** What a baseline document that has never been written starts as (`D387`'s shape, empty). */
export const EMPTY_BASELINE = '{\n  "version": 1,\n  "accepted": []\n}\n';

/**
 * Splice one accepted finding into a baseline document, and say which line it landed on
 * (`M208` `S3`).
 *
 * **A text splice and not a re-serialisation**, which is the same argument `ConfigPanel` makes for
 * being a textarea rather than a form: this is the author's own file, they will read it in a review,
 * and `JSON.parse` → mutate → `JSON.stringify` would silently reorder and reformat everything they
 * had. So the entry is written in the shape `--baseline-write` emits and inserted before the
 * closing bracket of `accepted`, at the indentation the document already uses.
 *
 * **It refuses rather than guesses.** A document it cannot read — not JSON, no `accepted` array, a
 * fingerprint already present — comes back unchanged with the line it would have gone to, and the
 * page opens the editor on it anyway. That is the honest failure for a feature whose whole hazard
 * is silently accepting something: an author looking at the document is in a better position than
 * any repair this function could invent.
 */
export function stageFingerprint(text: string, finding: { fingerprint?: string; rule: string; endpoint: string }): { text: string; line: number } {
  const lineOf = (source: string, index: number): number => source.slice(0, index).split('\n').length;
  const fp = finding.fingerprint ?? '';
  if (fp === '' || text.includes(`"${fp}"`)) return { text, line: lineOf(text, Math.max(text.indexOf(`"${fp}"`), 0)) };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { text, line: 1 };
  }
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { accepted?: unknown }).accepted)) {
    return { text, line: 1 };
  }
  const empty = ((parsed as { accepted: unknown[] }).accepted).length === 0;
  // The closing bracket of `accepted`, found from the key rather than from the end of the file —
  // `D387` documents have exactly one array, but a document with a trailing key would put `]` in
  // the wrong place if this counted backwards.
  const at = text.indexOf('"accepted"');
  const close = text.indexOf(']', at);
  if (at === -1 || close === -1) return { text, line: 1 };
  const entry = [
    '    {',
    `      "fingerprint": ${JSON.stringify(fp)},`,
    `      "rule": ${JSON.stringify(finding.rule)},`,
    `      "endpoint": ${JSON.stringify(finding.endpoint)}`,
    '    }',
  ].join('\n');
  const before = text.slice(0, close).replace(/\s*$/, '');
  const body = empty ? `${before}\n${entry}\n  ` : `${before},\n${entry}\n  `;
  const next = body + text.slice(close);
  // The line of the entry's own `"fingerprint"`, which is what the reader is being sent to see.
  return { text: next, line: lineOf(next, next.indexOf(`"${fp}"`)) };
}
