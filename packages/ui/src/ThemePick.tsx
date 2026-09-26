// The theme switcher (`M213` `S0`, `D1096`).
//
// FOUR THEMES, NOT A DARK/LIGHT TOGGLE. They differ in type, density and shape as much as in hue
// (`styles.css`'s head is the whole definition), so this is a choice among four named things and a
// `<select>` says that better than a switch does. `Terminal` is the default (`D1107`) and is what a
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
import { useState } from 'react';

export const THEMES = [
  ['instrument', 'Instrument'],
  ['terminal', 'Terminal'],
  ['ribbon', 'Ribbon'],
  ['paper', 'Paper'],
] as const;

export type ThemeName = (typeof THEMES)[number][0];

export const STORAGE_KEY = 'tflw.theme';

const current = (): ThemeName => {
  const on = document.documentElement.getAttribute('data-tflw-theme');
  // No attribute is the stylesheet's bare `:root`, which is `Paper` since `M240` `F` (`D1296`).
  return THEMES.some(([id]) => id === on) ? (on as ThemeName) : 'paper';
};

export function ThemePick() {
  const [theme, setTheme] = useState<ThemeName>(current);
  const pick = (next: ThemeName): void => {
    document.documentElement.setAttribute('data-tflw-theme', next);
    // A private window, or storage the reader has turned off, must not take the page down with it.
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // the choice still applies to this page; it just will not outlive it
    }
    setTheme(next);
  };
  return (
    <div className="theme-pick" data-theme-pick={theme} data-tip="colour, type and density together — a theme here is a whole token set, not a palette. Remembered in this browser and nowhere else.">
      <label htmlFor="tflw-theme">theme</label>
      <select id="tflw-theme" value={theme} onChange={(e) => pick(e.target.value as ThemeName)} data-theme-select>
        {THEMES.map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}
