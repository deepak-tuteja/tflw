// Rendering helpers shared by the views (`M192` U2).

/** JSON bodies pretty-printed, everything else verbatim — `html.ts`'s `pretty`, the same rule. */
export function pretty(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** Whole milliseconds as the report prints them; a float (a request's `durationMs`, `D807`) is
 * rounded here, once, at render. */
export function ms(n: number): string {
  return `${Math.round(n)} ms`;
}

export function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** `report/runs/<id>` → `<id>`; `report` → `current`. The kept path is relative to the root. */
export function reportIdOf(kept: string): string {
  const parts = kept.split('/');
  return parts.length >= 2 && parts[parts.length - 2] === 'runs' ? parts[parts.length - 1]! : 'current';
}

/** Whether a run's exit is already told by the report it wrote. `tflw run`'s codes (`cli.ts`):
 * 0 ok, 1 a test failed, 3 inconclusive, 130 aborted — each the report's own fact, stated in
 * its header. Anything else (a 2 after the report was written, a signal, a cancel from this
 * page) is a fact the report cannot carry and the page must, or a kept directory reads as a
 * clean run. `M192` U7: the dogfood run wrote a 326/326 report, then died writing
 * `events.ndjson` (`error: Invalid string length`, exit 2), and the page showed PASS. */
export function exitExplained(run: { readonly status: 'running' | 'done' | 'cancelled'; readonly exitCode: number | null; readonly signal: string | null }, report: { readonly ok: boolean; readonly inconclusive?: boolean; readonly aborted?: boolean }): boolean {
  if (run.status !== 'done' || run.signal !== null) return false;
  switch (run.exitCode) {
    case 0:
      return report.ok;
    case 1:
      return !report.ok;
    case 3:
      return report.inconclusive === true;
    case 130:
      return report.aborted === true;
    default:
      return false;
  }
}
