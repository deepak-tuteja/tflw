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
