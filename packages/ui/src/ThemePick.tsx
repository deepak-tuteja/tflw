// The theme switcher (`M213` `S0`, `D1096`).
//
// NAMED THEMES, NOT A DARK/LIGHT TOGGLE. They differ in type, density and shape as much as in hue
// (`styles.css`'s head is the whole definition), so this is a choice among named things and a
// `<select>` says that better than a switch does. `Paper` is the default (`D1315`) and is what a
// page that has never been told anything renders — it is the bare `:root` block in `styles.css`,
// so the fallback below and the stylesheet say the same thing in two languages.
//
// THE ATTRIBUTE IS THE STATE. `data-tflw-theme` on `<html>` is what the stylesheet reads, and
// `localStorage` is only how it survives a reload — so this component writes the attribute first
// and remembers second. It also means `index.html`'s pre-paint script and this component set
// exactly the same thing, and neither has to know about the other.
//
// WHY THE FIRST STAMP IS NOT HERE. React mounts after the first paint, so a theme read in a
// `useEffect` would show the default for one frame and then swap — a flash of the wrong theme on
// every load, which is worse for `Paper` than for any of the dark three. `index.html` carries four
// lines of inline script that run before the body exists; this component never fires on mount, it
// only reacts to a choice.
//
// `M258` (`D1411`): TWO IN THE PICKER, AND DENSITY IS A SWITCH. Paper (light, the default) and
// Terminal (dark) are what a reader is offered; `compact` beside them takes two pixels off `--unit`
// on either. Instrument and Ribbon are still complete token sets in `styles.css`, reached by
// `?theme=` — when one is on, the select shows it, because a select whose value is not among its
// options would show the first option and say the wrong thing.
import { useEffect, useState } from 'react';

export const THEMES = [
  ['paper', 'Paper'],
  ['terminal', 'Terminal'],
] as const;

/** The two sets `?theme=` still reaches (`D1411`): not offered, not stored, not in the docs. */
const UNOFFERED = [
  ['instrument', 'Instrument'],
  ['ribbon', 'Ribbon'],
] as const;

export type ThemeName = (typeof THEMES)[number][0] | (typeof UNOFFERED)[number][0];

export const STORAGE_KEY = 'tflw.theme';
export const DENSITY_KEY = 'tflw.density';

const current = (): ThemeName => {
  const on = document.documentElement.getAttribute('data-tflw-theme');
  // No attribute is the stylesheet's bare `:root`, which is `Paper` since `M240` `F` (`D1315`).
  return [...THEMES, ...UNOFFERED].some(([id]) => id === on) ? (on as ThemeName) : 'paper';
};

const isCompact = (): boolean => document.documentElement.getAttribute('data-tflw-density') === 'compact';

/** A private window, or storage the reader has turned off, must not take the page down with it —
 *  the choice still applies to this page; it just will not outlive it. */
const remember = (key: string, value: string | null): void => {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // see above
  }
};

export function ThemePick() {
  const [theme, setTheme] = useState<ThemeName>(current);
  const [compact, setCompact] = useState<boolean>(isCompact);
  // The root's two attributes are the state, so the picker follows them whoever writes them — a
  // script, an extension, a test — rather than holding what it read at mount (`M258-02`).
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setTheme(current());
      setCompact(isCompact());
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-tflw-theme', 'data-tflw-density'] });
    return () => observer.disconnect();
  }, []);
  const pick = (next: ThemeName): void => {
    document.documentElement.setAttribute('data-tflw-theme', next);
    remember(STORAGE_KEY, next);
    setTheme(next);
  };
  const tighten = (on: boolean): void => {
    if (on) document.documentElement.setAttribute('data-tflw-density', 'compact');
    else document.documentElement.removeAttribute('data-tflw-density');
    remember(DENSITY_KEY, on ? 'compact' : null);
    setCompact(on);
  };
  const offered = [...THEMES, ...UNOFFERED.filter(([id]) => id === theme)];
  return (
    <div className="theme-pick" data-theme-pick={theme} data-tip="colour and type as one set — remembered in this browser only">
      {/* `M254` (`D1400`): the header is one row, and the select says what it is by what it shows. The
          label stays for a screen reader. */}
      <label htmlFor="tflw-theme" className="sr-only">theme</label>
      <select id="tflw-theme" value={theme} onChange={(e) => pick(e.target.value as ThemeName)} data-theme-select>
        {offered.map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
      <label className="density" data-tip="tighter spacing and smaller titles, on either theme">
        <input type="checkbox" checked={compact} onChange={(e) => tighten(e.target.checked)} data-density-toggle />
        compact
      </label>
    </div>
  );
}
