# 16. Input-handling testing

The previous two chapters ask what a response says about itself, and whether somebody else can fetch
it. This one asks the third question: **what happens when the input is not what your app expected?**

`expect response has no input handling violations` takes the request your last `api` step actually
made, re-sends it once per (mutable input × payload) with **exactly one** input replaced, and reads
what comes back for evidence the application handled it badly.

```tflw
test "search survives what it cannot parse"
  api GET /products?q=shoes
  expect response has no input handling violations
```

That covers the flaws that live at the boundary between your validation layer and everything behind
it: a stack trace leaking a file path, a search term echoed into HTML unescaped, a path segment that
turns out to be a filename.

## It is two bare words, not one hyphenated one

`input handling`, with a space. The lexer's identifier rule is `[A-Za-z0-9_]` and `-` is the minus
operator, so a hyphen cannot appear in a tflw keyword — every multi-word construct in the language is
space-separated for the same reason. `input-handling` is a parse error, and there is a test that
keeps it one.

## Nothing about your identity changes

This is the difference from the previous chapter, and it decides what each scan can find.

An authorization scan *replaces* the identity: it strips `Authorization` and `Cookie` and sends the
request as somebody else. An input-handling scan changes **only the payload**. Every header the
observed request carried travels with every probe — including its own `X-CSRF-Token`, which is
exactly why these probes reach the code they were sent to test where a cross-identity probe gets
turned away at the door.

Two consequences worth knowing up front:

- **You need no owner.** There is no `as <session>` requirement here and no privileged-principal
  concept. A test with no session is fine.
- **A credential written onto the step is fine too.** Nothing is being swapped, so there are no two
  identities to confuse — the refusal the authorization scan has to make (`TF062`) has no analogue.

## What counts as a mutable input

Three kinds, read off the request that actually went out:

| site | example | what changes |
| --- | --- | --- |
| an identifier path segment | `/orders/a1e3-9f` | a UUID, an all-digit segment, or 24+ hex characters |
| a query parameter | `?q=shoes` | one value at a time, repeated keys preserved |
| a JSON body leaf | `{ "text": "hi" }` | one leaf at a time, at any depth |

A path segment that is not identifier-shaped is left alone — `/products` is a route, not an input.
Query and path payloads are percent-encoded on the way out; letting `../` through raw would have the
URL parser normalise it away before the request ever left the process.

**Type-confusion payloads apply to body leaves only.** A path segment and a query value are strings
by construction — there is no type there to confuse.

## The corpus is fixed, and that is deliberate

Fifteen payloads, in four classes, applied to every mutable input, in a fixed order. No sampling, no
seed, no random generation.

| class | count | default | what it is for |
| --- | --- | --- | --- |
| type confusion | 5 | **on** | `null`, `true`, a number, an array, an object where a string was expected |
| injection | 5 | **on** | `tflw'`, `tflw"`, `tflw;`, `{{7*7}}`, `<tflw>` |
| oversized | 1 | off | a 64 KiB string |
| traversal | 4 | off | `../` in four spellings, including encoded and absolute |

tflw is deterministic by identity. A seeded random fuzzer would give you a different result on every
run, need a corpus-coverage story to tell you when it had finished, and produce findings whose
fingerprints changed with the seed. A finite matrix gives you a number you can put in a report: this
run sent 45 requests across 3 sites, and it will send the same 45 tomorrow.

The injection payloads are worth reading closely. Every one of them is **detection-oriented** — none
names a table, a file, a command or a host. `tflw'` is there to see whether an unbalanced quote comes
back as a SQL error, not to run anything.

## Two payload classes are off until you say otherwise

```tflw-config fragment
defaults
  authorized target "http://localhost:4001" reason "self-hosted test fixture"
    probe mutating
    probe oversized
    probe traversal
```

Each line grants only itself. They hang off `authorized target` because each is a property of *that
host* — staging may be safe to send a 64 KiB body to and production may not.

- **`probe oversized`** is off because a body-size question is a resource question. One 64 KiB
  payload is not a denial of service, but the class is exhaustion-shaped and this is where the safety
  model's per-class opt-in first has literal classes to apply to.
- **`probe traversal`** is off because a positive finding *is* the act. If the traversal works,
  tflw has read `/etc/passwd` off your server to tell you it could.
- **`probe mutating`** is the same declaration the authorization scan uses. A mutated `POST` is still
  a `POST` — without it the whole step is not probed, and the line says so.

## The bar is disclosure, not status

A `5xx` is **not** a finding on its own. Plenty of correct applications answer `500` to a type they
never expected; a tier that scored that as a violation would fire on well-behaved software and get
switched off within a week. A `5xx` that *leaks* is a different matter.

| rule | severity | what it reads |
| --- | --- | --- |
| `sec/error-detail-disclosure` | serious | stack frames, filesystem paths, framework debug pages, driver-level SQL errors |
| `sec/reflected-input-unescaped` | moderate | raw `<`, `>`, `"` from the payload echoed into an HTML or text body |
| `sec/path-traversal-read` | critical | filesystem signatures — the shape of `/etc/passwd`, a private key header |
| `sec/oversized-input-accepted` | minor | a `2xx` for a 64 KiB value |

**Every rule subtracts the control's own hits.** The observed response is the baseline, so a finding
means *this payload caused it* rather than *this string was always there*. An app that prints a
stack trace on its happy path reports no disclosure violation, because your payload did not cause it.

## Three outcomes, not five

The authorization scan has five; this one has three, and the difference is `5xx`.

| outcome | when | counts as |
| --- | --- | --- |
| answered | **any** status the host produced, `5xx` included | judgeable |
| inconclusive | `429` | **not clean** |
| not probed | a class without its opt-in, a mutating method without `probe mutating` | **not clean** |

A `5xx` is a first-class answer here because the application *did* process the payload — which is the
thing being asked about. A `429` is inconclusive for the reason it always is: the app never processed
it, so scoring it as *handled correctly* would let a suite that trips its own throttle report the
throttle as a clean result.

## An assertion with nothing to mutate is a failure

```console
✗ this assertion had no power to fail: nothing in the request could be mutated  [TF067]
  - the request has no identifier path segment, no query parameter and no JSON body leaf
```

`api GET /health` has no site. No probe could have gone out, so nothing could have been found, and
"0 violations" would be a green line over an empty test. It is `TF067` at check time and the same
verdict at run time.

The checker only reports what it can **prove**. A `{var}` in the path may bind to an id, a `body
from` file is not the checker's to read, and a raw text body may well be JSON — every one of those is
silent, and caught at run time instead if it turns out to be empty.

## What every line tells you it cost

Pass or fail, the result says how much traffic it added and what it declined to send:

```console
✓ response has no input-handling violations — 4 rules — 2 applicable, 2 not applicable, 0 violations;
  3 sites, 30 requests sent, 10.0 per site — 30 answered
  note: not probed for oversized or traversal — add `probe oversized` / `probe traversal` under that
  `authorized target` (SPEC §9.12)
```

That last note exists because a green run that skipped two classes and a green run that ran them are
otherwise indistinguishable. The one you would misread is the one that tested less.

Probes that could not answer are grouped **by reason**, not listed one per probe — a matrix is dozens
of entries wide, and `13 probes — POST changes state, and no \`probe mutating\` covers this target`
is a sentence you can act on where thirteen copies of it is one you scroll past.

Probes are **strictly sequential**, one request in flight, so the traffic an assertion adds is
bounded and predictable — but note the multiplication: one probe *per payload per mutable input*. A
request with three sites and both optional classes on is 45 requests. That is why this assertion is
refused inside a workload (`TF033`) with a blunter hint than the authorization scan's, and inside
`wait until api` (`TF064`), which would re-send the whole matrix on every poll.

## Every finding comes with a test you can run

A violation writes a `.tflw` file under `report/input-repro/` — beside `report/authz-repro/`, not
mixed into it — named from the rule, the method, the path, the mutation site and the detector that
matched:

```tflw
# emitted by tflw M137d — sec/error-detail-disclosure
# GET /products?q=tflw%27 — query `q` carrying `injection/sql-quote` returned a stack frame
# re-run: tflw run --env secureLocal input-repro/error-detail-disclosure--get--products-q-tflw-27--query-q--a-stack-frame.tflw
test "GET /products?q=tflw%27 must not disclose a stack frame for query `q`"
  api GET /products?q=tflw%27
  expect body text not matches "(?:\\n|\\\\n)\\s+at [\\w$.<>[\\] ]+ \\("
```

**Each rule asserts its own leak, and none of them re-runs this scan.** That is deliberate and it is
the one thing worth understanding about these files. `expect response has no input handling
violations` would be the obvious body for a repro, and it would **pass against an unfixed
application**: every rule here is differential against the request you wrote, and subtracts whatever
the un-mutated response already contained. In a repro the mutated request *is* the request you wrote,
so the disclosure lands in the control and is subtracted from itself. So instead:

| Rule | The repro asserts |
|---|---|
| `sec/error-detail-disclosure` | `expect body text not matches "<the detector's pattern>"` |
| `sec/path-traversal-read` | `expect body text not matches "<the filesystem signature>"` — never the payload, since an app that merely echoes `../../etc/passwd` has read nothing |
| `sec/reflected-input-unescaped` | `expect body text not contains "<the payload>"` — here the echo *is* the finding |
| `sec/oversized-input-accepted` | `expect status is greater than 399` — any refusal, because `400` and `413` are both correct fixes |

`body text` rather than `body` throughout, because a disclosure often arrives as an HTML error page
and the bare-body subject expects JSON.

**The path is relative to your `api` base URL, and the `re-run` line names the env.** Both matter for the
same reason: a repro reaches whichever application the env points at, so running one under a different env
can pass without telling you. If a payload class's opt-in (`probe traversal`, `probe oversized`) is
declared on one target and not another, the repro for it only reproduces under the target that granted it.

**A repro from a [`crawl`](/guide/crawling) says so, on its own header line:**

```text
# via: derived by a crawl from `seed openapi` — tflw built this request, no test declared it
```

Read it as a caveat, because that is what it is. A crawl synthesizes values your schema does not pin
down, so a finding on a derived request can be a consequence of a value tflw guessed rather than a
weakness in the route — and the repro is the only artifact that tells you which. A repro from a request
you wrote carries no such line; the silence is what makes the line worth noticing.

Every literal in these files is a payload tflw sent or a pattern tflw looks for — never a byte your
application produced. The finding's own message quotes an excerpt of the evidence; the repro
deliberately does not, because its job is to provoke the leak again rather than to record it. A
body-site repro does carry a body, and that is the **request's**, redacted exactly as the run redacted
it everywhere else.

The hygiene scan emits no repro at all. Its findings are about a response's own headers, where there
is no second request to build — the re-run would be the request that already produced the finding, so
the file would restate the assertion you just read. What you want there is the fix, which
[the findings guide](/guide/findings-and-baselines) carries.

## Related

- [Authorization testing](/guide/authorization-testing) — the sibling scan, and where `probe
  mutating` comes from
- [Security hygiene scanning](/guide/security-scanning) — the response-inspection scan, and where
  `authorized target` comes from
- [Config & environments](/guide/config) — `probe oversized` and `probe traversal`
- [Findings, baselines & the gate](/guide/findings-and-baselines) — `--probe-seeded`, and what happens
  to a finding after a rule raises it
- [CI & reporting](/guide/ci-and-reporting) — `--allow-public-target` and the other CI gates
