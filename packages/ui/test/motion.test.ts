// `M250` `C` (`D1365`) — the page moves only for a reader who has not asked it not to.
//
// Every `transition` and `animation` declaration in the page's stylesheets must sit inside
// `@media (prefers-reduced-motion: no-preference)`. The walk is over the real files, and it first
// establishes that it read something and found motion at all — a gate over an empty stylesheet, or
// one that recognised no declaration, would pass by saying nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SHEETS = ['styles.css', 'fonts.css'].map((f) => ({ name: f, text: readFileSync(fileURLToPath(new URL(`../src/${f}`, import.meta.url)), 'utf8') }));
const MOTION = /(^|[;{\s])(transition|animation)(-[a-z-]+)?\s*:/;
const GUARD = /^@media\s*\(\s*prefers-reduced-motion\s*:\s*no-preference\s*\)$/;

/** Each motion declaration, with the at-rules it sits inside. Comments are dropped first. */
export function motionSites(css: string): { readonly declaration: string; readonly within: readonly string[] }[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: { declaration: string; within: string[] }[] = [];
  const stack: string[] = [];
  let buf = '';
  for (const ch of text) {
    if (ch === '{') {
      stack.push(buf.trim());
      buf = '';
    } else if (ch === '}' || ch === ';') {
      const decl = buf.trim();
      if (MOTION.test(` ${decl}`) && !stack.some((s) => s.startsWith('@keyframes'))) out.push({ declaration: decl, within: stack.filter((s) => s.startsWith('@')) });
      buf = '';
      if (ch === '}') stack.pop();
    } else buf += ch;
  }
  return out;
}

test('the gate reads the page\'s stylesheets and finds their motion', () => {
  for (const s of SHEETS) assert.ok(s.text.length > 0, `${s.name} was read`);
  const sites = SHEETS.flatMap((s) => motionSites(s.text));
  assert.ok(sites.some((x) => /animation:\s*pulse/.test(x.declaration)), `the running dot's pulse is found (got ${JSON.stringify(sites)})`);
});

test('every transition and animation sits under prefers-reduced-motion: no-preference', () => {
  const bare = SHEETS.flatMap((s) => motionSites(s.text).filter((x) => !x.within.some((w) => GUARD.test(w))).map((x) => `${s.name}: ${x.declaration}`));
  assert.deepEqual(bare, [], 'motion outside the guard moves the page for a reader who asked it not to');
});

test('the walk tells a guarded declaration from a bare one', () => {
  const sites = motionSites('.a { transition: color 1s; }\n@media (prefers-reduced-motion: no-preference) { .b { animation: x 1s; } }\n@keyframes x { from { opacity: 0; } }');
  assert.deepEqual(sites.map((x) => [x.declaration, x.within.some((w) => GUARD.test(w))]), [['transition: color 1s', false], ['animation: x 1s', true]]);
});
