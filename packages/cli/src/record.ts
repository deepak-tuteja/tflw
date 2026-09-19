// `tflw record`'s line — `M213` `S5` (`D1095`).
//
// **IT IS A MODULE OF ITS OWN BECAUSE `cli.ts` RUNS WHEN IT IS IMPORTED.** That is this
// repository's own recorded landmine (`M122`, and `scripts/mutate.test.mjs` keeps a test named
// *importing this module runs nothing* about a sibling) — a test that imported `cli.ts` to reach
// one pure function got the whole command line instead, printed the usage banner, and failed
// without ever running an assertion. A pure function that a gate wants to reach does not live in
// an entry point.

import {
  parseSource,
  print,
  buildOpen,
  buildClick,
  buildFill,
  buildSelect,
  buildCheck,
  buildPress,
  type Step,
  type LocatorSpec,
} from '@tflw/lang';
import type { RecordedAction } from '@tflw/runtime';

/**
 * One recorded action, as the line this command prints — built and printed by the language
 * (`D1087`), never assembled as a string.
 *
 * **THAT IS NOT FASTIDIOUSNESS HERE, IT IS THE WHOLE RISK OF A RECORDER.** Every value in a
 * recorded line comes from the page: an `<option>`'s text, a field's contents, a button's label.
 * One apostrophe in a product name turns a concatenated `select … with 'Women's'` into a file that
 * does not lex — and the recording is gone the moment the window closes. The builders are where
 * arbitrary text becomes a `StringLit` the printer knows how to quote, and the reader at the other
 * end (`@tflw/ui`) parses each line back rather than trusting it, the way `pick`'s output is
 * classified by the grammar rather than by excluding the banners.
 *
 * Returns `null` for an action the builders refuse — a locator the page could not name, a value
 * that is not a value. A refused action is **skipped with a word on stderr** rather than dropped
 * silently: a recording that quietly loses a step is worse than one that says it did.
 */
export function recordedLine(action: RecordedAction): { ok: true; text: string } | { ok: false; reason: string } {
  const locator = ((): LocatorSpec | null => {
    if (action.locator === null) return null;
    // The locator arrives as printed syntax (`button "Sign in"`), which is what `pick` emits and
    // what `resolvePickedLocator` verified. Reading it back through the parser is the same
    // discipline the page end follows: the only thing entitled to say what `button "x"` means is
    // the grammar.
    const { program, diagnostics } = parseSource(`test "r"\n  click ${action.locator}\n`);
    if (diagnostics.some((d) => d.severity === 'error')) return null;
    const step = program.tests[0]?.body[0];
    if (!step || step.type !== 'ClickStmt') return null;
    return { kind: step.locator.kind, value: step.locator.value.value };
  })();
  if (action.locator !== null && locator === null) return { ok: false, reason: `could not read the locator ${JSON.stringify(action.locator)}` };

  const built = ((): { ok: true; node: Step } | { ok: false; reason: string } => {
    switch (action.kind) {
      case 'open': return buildOpen(action.value ?? '/');
      case 'click': return buildClick({ locator: locator!, kind: 'single' });
      case 'fill': return buildFill({ locator: locator!, value: JSON.stringify(action.value ?? '') });
      case 'select': return buildSelect({ locator: locator!, value: JSON.stringify(action.value ?? '') });
      case 'tick': return buildCheck({ locator: locator!, ticked: true });
      case 'untick': return buildCheck({ locator: locator!, ticked: false });
      /* **The control the key was typed into, when there is one.** `press "Enter"` at page level
         goes to whatever has focus, and *whatever has focus* is a fact about the moment rather
         than about the test — so a recorder that dropped the locator would write a line that
         passes on the machine it was recorded on. */
      case 'press': return buildPress({ keys: action.value ?? 'Enter', locator });
    }
  })();
  if (!built.ok) return built;
  const printed = print(built.node, { indent: 0 });
  return printed.ok ? { ok: true, text: printed.text.trim() } : { ok: false, reason: printed.reason ?? 'the printer refused this action' };
}

