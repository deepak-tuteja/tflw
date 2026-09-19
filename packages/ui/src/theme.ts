// Reading a theme token from code (`M213` `S1`).
//
// WHY ANYTHING NEEDS THIS AT ALL. A theme is CSS custom properties and nothing else, so everything
// the page paints follows it for free — `color: var(--fail)` is resolved by the browser and changes
// the instant the attribute on `<html>` changes. That covers the whole app except one surface: a
// **canvas**. `strokeStyle` is a string, not a stylesheet, and `ctx.strokeStyle = 'var(--accent)'`
// is silently ignored — so uPlot cannot be handed a token and the load charts had four literals
// instead (`rgb(59, 130, 246)`, `rgb(234, 88, 12)`, `rgb(220, 38, 38)`, `rgb(22, 163, 74)`).
//
// **THAT WAS FOUND BY `S1`'s PALETTE GATE ON ITS FIRST RUN, AND IT IS `§1.5`'s OWN DEFECT LIVING IN
// THE REPORT.** The plan measured the Compose pane painting five greys and one blue while three
// state tokens went unspent; the charts are the mirror image — four saturated hues nobody declared,
// painted on all four themes identically, including the light one. Nothing could have said so: a
// chart's colours are an argument to a component, and every gate in this repository reads
// selectors, attributes and counts.
//
// HOW IT RESOLVES A TOKEN, AND WHY IT GOES THROUGH THE BROWSER. A custom property is an unparsed
// token sequence — `getPropertyValue('--accent')` gives back the literal text `#56d4dd`, not a
// colour, because CSS never needed to parse it to substitute it. Rather than teach this file to
// read hex, the value is set on a throwaway element's `color` and read back computed, which is the
// browser's own parser answering in the browser's own normal form (`rgb(86, 212, 221)`). That form
// is what `Chart.tsx` wants, and it costs one layout-free style read per token per theme, cached.
//
// AND IT HAS TO BE REACTIVE, BECAUSE THE THEME CHANGES WITHOUT A NAVIGATION. `ThemePick` sets an
// attribute; React is not told. A component that resolved a token once at mount would keep a dead
// colour until something else re-rendered it — so the attribute is watched, and the watch is a
// `useSyncExternalStore` over one shared `MutationObserver` rather than an observer per component.
import { useMemo, useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;

/** The active theme's name, or `''` for the default — which is not a name, because the default is
 *  the bare `:root` block and carries no attribute at all (`D1107`). `''` is a perfectly good cache
 *  key, and treating it as one is what keeps this file from having to know the default's name. */
const currentTheme = (): string => document.documentElement.getAttribute('data-tflw-theme') ?? '';

const subscribe = (notify: () => void): (() => void) => {
  listeners.add(notify);
  if (!observer) {
    observer = new MutationObserver(() => {
      for (const l of listeners) l();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-tflw-theme'] });
  }
  return () => {
    listeners.delete(notify);
  };
};

const cache = new Map<string, string>();

/**
 * One theme token, as a colour string the canvas understands.
 *
 * Cached on `(theme, token)`, so switching back and forth costs one read per pair for the life of
 * the page. The cache is never invalidated, and the one thing that would make that wrong — editing
 * the stylesheet under a running page — happens only under Vite's HMR, which replaces the module
 * and the map with it.
 */
export function tokenColor(name: string): string {
  const key = `${currentTheme()}|${name}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const probe = document.createElement('span');
  probe.style.display = 'none';
  probe.style.color = raw;
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  cache.set(key, resolved);
  return resolved;
}

/** Several tokens at once, re-resolved whenever the theme changes.
 *
 *  The returned array is a new identity on every theme change **by design**: consumers put it in a
 *  `useMemo` dependency list, and a chart that did not rebuild on a theme change would go on
 *  drawing the previous theme's strokes until some unrelated state moved. */
export function useTokenColors(names: readonly string[]): readonly string[] {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => '');
  const key = names.join(',');
  return useMemo(() => names.map(tokenColor), [theme, key]); // eslint-disable-line react-hooks/exhaustive-deps
}
