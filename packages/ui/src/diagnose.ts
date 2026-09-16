// What `tflw check` would say about the source a form is about to write — `M200` `A1-4`
// (`D1052`).
//
// THE WRITE ROUTE'S TWO `422`s ARE PARSE AND FORMAT, NOT CHECK (`D1049`). That is the right
// scope for a server — it refuses what nobody can read back, and an unbound `{token}` reads
// perfectly well — but it leaves a real gap on the authoring side: a form field carrying a
// reference to a variable the test never binds produces a file that parses, formats, writes, and
// then fails `tflw check` in somebody's terminal or CI. `A1-4` hit it on its own first run, with
// `TF030: unknown variable "token"` from a header value nothing had captured.
//
// SO THE FORM SAYS IT, AND WRITES ANYWAY. Blocking would be wrong: a half-written test is a
// legitimate intermediate state, `tflw check` is a gate the author runs when they mean to, and
// `D985` makes the file the truth rather than the form's opinion of it. What the form owes is
// that the author is not surprised — which is the same argument `D1049` makes for refusing at the
// server rather than at the page, pointed the other way.
//
// It runs here because it can: `@tflw/lang` has no dependencies and no Node builtins, so this is
// the checker the CLI runs, in the browser, over the exact bytes the PUT will carry. Measured on
// the five fixture files with no options at all: **0 diagnostics**, which is what makes a panel
// worth showing rather than noise worth ignoring.
import { checkProgram, parseSource, type Diagnostic } from '@tflw/lang';

/** The diagnostics `tflw check` would report for this file, worst first. */
export function diagnose(text: string): readonly Diagnostic[] {
  const { program, diagnostics } = parseSource(text);
  // A parse error is the write route's own `422` and is already shown as a refusal; adding the
  // checker's opinion of a broken tree on top of it would report one mistake twice.
  if (diagnostics.some((d) => d.severity === 'error')) return [];
  const rank = (d: Diagnostic) => (d.severity === 'error' ? 0 : d.severity === 'warning' ? 1 : 2);
  return [...checkProgram(program)].sort((a, b) => rank(a) - rank(b) || a.span.start.line - b.span.start.line);
}
