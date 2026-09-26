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

/**
 * **One spelling for a moment, with its zone** — `M240` `F` (`M239-05`).
 *
 * This was `d.toLocaleString()` with no options: `9/25/2026, 7:56:44 PM`, no zone, in a page whose
 * report ids and compare select spell the same instant `2026-09-25T17-56-44-949Z`. Two spellings
 * that never match by eye, and neither says where 7:56 PM is. The form is `2026-09-25 19:56:44
 * +02:00` — the reader's own zone, stated — so it reads next to the id and next to a log line.
 *
 * `zone` is a parameter so `format.test.ts` can ask for a fixed one; the page passes nothing and
 * gets the browser's. An unparseable string comes back as itself, as before.
 */
export function when(iso: string, zone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat('en-CA', {
    ...(zone === undefined ? {} : { timeZone: zone }),
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset',
  }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((x) => x.type === type)?.value ?? '';
  // `longOffset` spells UTC as a bare `GMT` and everything else as `GMT+02:00`.
  const offset = get('timeZoneName').replace(/^GMT/, '') || '+00:00';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')} ${offset}`;
}

/**
 * How long ago something happened, in the shortest true form — `M213` `S2`, moved here from
 * `parts.tsx` by `M240` `F` so the run chips and the composer's citation line share one clock.
 *
 * **`now` is a parameter and the caller passes `Date.now()` at render**, so the string ages only
 * when something else re-renders the card. That is deliberate rather than overlooked: a ticking
 * clock in a pane would repaint every request once a second for a figure whose whole job is to be
 * read at a glance, and the absolute time is in the tip for anyone who needs it exactly.
 *
 * A date is what `D956` is about: *a claim carries the evidence it rests on*, and the evidence
 * here is a run that happened at a particular moment. An absolute clock time would make a reader
 * do the subtraction, and the subtraction is the whole question — *is this about the code in front
 * of me?* So the relative form leads, and the absolute one is one hover away.
 */
export function ago(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 'at an unrecorded time';
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
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
