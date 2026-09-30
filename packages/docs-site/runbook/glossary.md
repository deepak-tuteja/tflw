# Glossary

The words the page, the report, the CLI and these docs use for tflw's own ideas. Ordinary testing
words — *test*, *step*, *assertion*, *session* — mean what they mean everywhere and are in the
[Guide](/guide/first-test).

**Baseline.** A file of findings you have accepted, each by its *fingerprint*: a scan or crawl
still reports them, but they no longer fail the run. `--baseline-write` records the current
findings. See [Findings and baselines](/guide/findings-and-baselines).

**Evidence.** What the report keeps about each step: request and response bodies and headers,
screenshots. `--evidence full` (the default), `headers-only` or `none` — turn it down before
attaching a report somewhere public.

**Fence.** A line the language deliberately does not cross: no conditionals, no loops, no boolean
operators in a test. What needs one goes into a helper module through `use`.
See [Variables](/guide/variables).

**Fingerprint.** A finding's identity, stable across runs: the same weakness on the same route
has the same fingerprint every time, which is what lets a baseline accept it and a report compare
two runs.

**Hint.** A suggestion the checker prints that is not an error. A *help* line under a diagnostic
says how to fix it (*did you mean `expect`?*); a *reuse hint* (`RF001`) proposes lifting a
repeated run of steps into an `action` or a repeated locator into an `element`, applied with
`tflw refactor apply` or the editor's code action.

**Kind.** One of the four kinds of work a test can do — **API**, **BROWSER**, **LOAD** and
**SCANS**. On the page they are chips over the file list: each counts the tests of its kind and, when
pressed, filters the list and what ▶ runs to them; `tflw run --kind` narrows a terminal's run the same
way. See [the four kinds](/ui/kinds).

**Lens.** How tflw decides which kinds a test is of: each kind of step belongs to one, and a test is
of every kind its steps belong to.

**Plant.** A test written to have a known answer — a route that is deliberately insecure, a run
that must fail — so that tflw reporting that answer is the proof it works. tflw's own dogfood
repository is full of them; a suite of your own rarely needs one.

**Ratchet.** A limit that only moves one way. tflw's own coverage floors rise when coverage rises
and are never lowered to make a red run green; a suite can hold its own numbers the same way.

**Roster.** The list a check holds itself to: the constructs a test must exercise, or the codes a
fixture set must cover. A roster turns *it passed* into *it passed having seen every one of these*.

**Spine.** The page's fixed shape — the header across the top, the file list on the left with the
kinds at its head, the tabs over whichever file is open. See [the spine](/ui/spine).

**Verdict.** What a run concluded about a test: passed, failed, skipped (with its reason), or —
for a load test whose generator was itself the bottleneck — inconclusive. The exit code follows the
worst verdict.

**Window.** A stretch of a load run that is measured on its own — a ramp's steps, a plateau, the
last few seconds the live line reports — and, in the checker, a run of consecutive steps the reuse
pass compares across tests.
