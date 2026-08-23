# Findings, baselines & the gate

The other chapters in this pillar are about *finding* things. This one is about what happens next.

A scanner that goes red on its first run against an existing codebase gets turned off. That is not a
hypothetical failure mode, it is the normal one: you point a new tool at a real application, it finds
forty things, none of them are today's problem, and the pragmatic move is to delete the assertion.
This chapter is the machinery that makes the other outcome possible — adopt now, fix on a schedule,
and never lose sight of what you deferred.

Everything here applies identically to all three scans ([security
hygiene](/guide/security-scanning), [authorization](/guide/authorization-testing) and
[input-handling](/guide/input-handling)) — including the responses a
[crawl](/guide/crawling) issues, which run those same three and carry how they were reached as
provenance rather than as a fourth kind. One contract, not three.

## Every finding has a fingerprint

Open `report/report.html` after any run that raised a finding and you will see a **Security
findings** block. Each row carries a short hex string:

```text
serious   sec/error-detail-disclosure          a3f19c2e5b04d871
          GET /orders/{id} · query.sort · a stack frame
          answered 500 with a stack frame: Error: bad sort at OrderService…
```

That fingerprint is the finding's identity, and it is stable across runs. It is computed from the
scan, the rule, the endpoint, *where* within the request, and *what* was violated — and deliberately
**not** from the payload that triggered it or the response text that proves it. Reword an error
message and the fingerprint does not move, because rewording an error message fixed nothing. Fix the
endpoint and the finding disappears, which is the only way it should.

Two weaknesses on one endpoint keep two fingerprints. That matters more than it sounds: if they
shared one, accepting the first would silently accept the second, and nothing would announce it.

## `--baseline` — accept what is there, fail on what is new

Two commands to adopt a scan on an existing codebase:

```sh
# 1. record what is already broken
tflw run --baseline-write security-baseline.json

# 2. from now on, only *new* findings fail the build
tflw run --baseline security-baseline.json
```

The file is plain JSON you are meant to read and edit:

```json
{
  "version": 1,
  "accepted": [
    {
      "fingerprint": "a3f19c2e5b04d871",
      "rule": "sec/error-detail-disclosure",
      "endpoint": "GET /orders/{id}"
    }
  ]
}
```

`rule` and `endpoint` are there for you; the match is on the fingerprint alone. That is deliberate —
if a rule were renamed in a tflw release, matching on the name would silently un-accept every entry
that mentioned it and your next CI run would go red for no reason you caused.

**A baselined finding still appears in the report**, badged *known/accepted*. It is not suppressed,
it is deferred, and the difference is the whole feature: a baseline whose contents you cannot see is
not something anyone will ever review.

**Delete a line to un-accept it.** That is the workflow — fix an endpoint, delete its entry, and the
build now protects the fix.

::: tip Stale entries are reported, never removed
If a baseline lists a fingerprint this run did not produce, tflw says so and leaves the file alone. It
does not prune, because a `--tag smoke` run legitimately produces a subset of the suite's findings —
auto-pruning would quietly delete acceptances the next full run still needs.
:::

A malformed baseline file is an error, not a warning. Every way this file can fail makes your build
*greener*, and a file that parsed to "accepted nothing" looks exactly like a codebase that fixed
everything.

## `--fail-on` — a severity floor for the whole run

```sh
tflw run --fail-on serious
```

Findings below `serious` are reported and do not fail the build. Useful when you want the `minor`
hygiene findings visible in the report without blocking a release on them.

## The one rule both flags obey

> **The gate can only relax, never tighten — and never silently.**

If a test wrote its own floor:

```tflw fragment
expect response has no serious security violations
```

then `--fail-on minor` **does not** lower it. The stricter of the two wins, always. The reasoning is
about where a failure can be diagnosed from: a test file is checked in and readable, and a CI flag is
not. A flag that could turn a green suite red for a reason invisible in the source produces a failure
nobody can locate.

The corollary is that neither flag applies to the negated form:

```tflw fragment
expect response not has no security violations
```

There, a finding is what makes the assertion *succeed*. Withholding findings would fail the assertion
for having found something, which is not a relaxation in any sense.

And whenever a run withholds anything, the passing line says so:

```console
✓ response has no input-handling violations (4 rules applied)
  note: 3 findings withheld — 2 known/accepted, 1 below the --fail-on floor
```

A report that agreed with the gate would be describing the gate rather than the run.

## `--probe-seeded` — payloads nobody wrote

The [input-handling scan](/guide/input-handling) ships a fixed, reviewed corpus. `--probe-seeded`
adds generated payloads on top of it:

```sh
tflw run --probe-seeded 8 --seed 4711
```

Eight extra payloads per **already-granted** mutation class, drawn from the run seed. It cannot widen
what your `authorized target` permitted — if you did not write `probe traversal`, no number here
produces a traversal request. Seeding is a property of the run; a mutation class is a claim in your
config, and the two do not trade.

**Its findings never fail a build.** They appear in their own part of the report, marked non-gating,
each with the payload that found it and the seed that drew it:

```console
seeded (seed 4711) — promote this payload into the corpus: tflw';
```

The reason is the same one that makes `--seed` exist at all. A generated payload cannot have a stable
fingerprint — it appears under one seed and vanishes under the next — so gating on it would either
churn your baseline every run or fail your build on a coin flip.

So the layer's job is to tell you **what to add to the reviewed corpus**, which makes it
self-liquidating: anything it finds twice should stop being seeded. The trade is explicit and worth
naming — a real weakness found only this way does not fail CI until somebody promotes it. A finding
you have to read is still better than a gate you cannot trust.

::: warning It is not free
Probes are strictly sequential, one in flight. `--probe-seeded 8` against a request with three
mutable sites and all four classes granted is a few hundred extra requests on **one assertion**. The
per-class ceiling is 64, and past that the honest answer is a narrower `--tag` run rather than a
bigger number.
:::

## Which rules actually ran

Every report also carries a **Which rules ran** block, per scan:

```text
Input handling
  applied: sec/error-detail-disclosure, sec/reflected-input-unescaped
  did not apply:
    · sec/path-traversal-read — `traversal` payloads need `probe traversal` under this
      `authorized target`
    · sec/oversized-input-accepted — `oversized` payloads need `probe oversized`
```

A rule that stands down produces no finding, which means without this block the only run where you
could learn it stood down is one where something else failed. This renders on **passing** runs too —
that is the point. A green run that tested less than you think and a green run that tested everything
should not look identical.

## Possible fixes, in the report

Every finding in `report.html` carries a collapsed **possible fixes** disclosure: what the weakness
is, why it is worth repairing, the repair in framework-neutral terms and again concretely in NestJS,
and the CWE and OWASP references the fix is traceable to. There is nothing to enable — an alert that
names a weakness and says nothing about repairing it is a task handed to someone with the research
still to do.

## `findings.sarif` — GitHub code scanning {#sarif}

A run that evaluated at least one security, authorization or input-handling assertion also writes
**`report/findings.sarif`** — SARIF 2.1.0, which GitHub's code-scanning UI ingests directly:

```yaml
- run: npx tflw run
- uses: github/codeql-action/upload-sarif@v3
  # The file exists only when the run actually scanned, so guard on it rather than on `always()`.
  if: hashFiles('report/findings.sarif') != ''
  with:
    sarif_file: report/findings.sarif
```

Each alert anchors to **the `.tflw` line that made the assertion** — the endpoint is usually not
source code in the repository being scanned, so it travels as a SARIF *logical location* where a
consumer can group by it. The rule's remediation is the same knowledge base `report.html` renders,
so the alert arrives with its fix, its CWE tag and its references.

Three things about the file are deliberate and worth knowing before you wire it up:

- **A run that did not scan writes no file at all** — not an empty one. `upload-sarif` reads an empty
  results array as *everything previously reported is fixed* and resolves the matching alerts, so a
  functional-only job emitting an empty document would silently close your security backlog. That is
  why the workflow above guards on `hashFiles` rather than on `always()`.
- **A baselined finding is uploaded as a dismissed alert**; one below `--fail-on` is uploaded as an
  ordinary one. Accepted and unranked are different states — nobody reviewed the second — and a team
  that later lowers the floor should not watch a pile of alerts un-dismiss themselves.
- **Rules that stood down are not in the rule catalog.** They are listed under
  `runs[].properties["tflw/notApplicable"]` with their reasons, so *applied and silent* stays
  distinguishable from *never applicable* in the machine-readable artifact too.
- **Paths are relative to the repository root, not to where you ran tflw.** GitHub anchors an alert
  by matching the path against the checked-out tree, so a corpus run from its own directory has to
  be recorded as `corpora/security/probe.tflw` and not `probe.tflw`. tflw finds the root by walking
  up for `.git`; outside a repository it emits the path as-is, which is all it can honestly say.

Findings drawn by `--probe-seeded` (above) are **not** in the document: they carry no
fingerprint by construction, and a tracking system keyed on identity would mint a fresh permanent
alert on every reseed.

## Related

- [Security & vulnerability testing](/guide/security#what-a-green-scan-does-not-claim) — the bar all
  four scans are held to, and why a state that is not an answer is never printed as clean
- [Security hygiene scanning](/guide/security-scanning) — the response-inspection scan
- [Authorization testing](/guide/authorization-testing) — the cross-principal scan
- [Input-handling testing](/guide/input-handling) — the mutation scan, and the corpus
  `--probe-seeded` extends
- [CI & reporting](/guide/ci-and-reporting) — exit codes, and the rest of the report
