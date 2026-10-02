// How a run was narrowed, as the user typed it. A run that did not run the whole suite says so
// wherever that changes what its output means: `--baseline-write` names it, because an entry the
// run did not match may belong to a test it skipped. This lived in `last-run.ts` until `M265`
// retired `report/.last-run.json`, the record it was first written into (`FU-23`, D250).

/** `undefined` for a full run, so a caller can tell "not narrowed" from "narrowed by nothing". */
export function describeRunFilter(f: { readonly tags?: readonly string[]; readonly kinds?: readonly string[]; readonly only?: string; readonly failed?: boolean; readonly shard?: string }): string | undefined {
  const parts: string[] = [];
  // `D1330` — a shard is a filter too.
  if (f.shard) parts.push(`--shard ${f.shard}`);
  if (f.tags?.length) parts.push(`--tag ${f.tags.join(',')}`);
  if (f.kinds?.length) parts.push(`--kind ${f.kinds.join(',')}`);
  if (f.only) parts.push(`--only ${f.only}`);
  if (f.failed) parts.push('--failed');
  return parts.length > 0 ? parts.join(' ') : undefined;
}
