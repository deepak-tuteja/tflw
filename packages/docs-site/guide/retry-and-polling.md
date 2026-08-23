# Retry, polling & flaky handling

Three different mechanisms cover three different kinds of instability — don't reach for the wrong
one.

## `retry N` — re-run a failing test

```tflw
test "flaky endpoint eventually succeeds" retry 2
  api GET /flaky
  expect status equals 200
```

Re-runs the **entire test** up to `N` more times on failure. A pass on a later attempt is never
silently green — it's reported passed-but-flagged:

```console
✓ flaky endpoint eventually succeeds (flaky) (48 ms)
```

`unique(...)`-family values keep advancing their counter across attempts (so a retry never
collides with data the failed attempt already created); `random`-family values replay identically
on every attempt (same per-test seed) — see
[Variables, generators & expressions](/guide/variables) for why that split matters.

**The count is a whole number of re-runs, and `retry 0` is legal** — the default, spelled out loud.
`retry 2.5` is refused (`TF071`) rather than rounded: the interpreter runs `1 + N` attempts, so a
fraction used to run three attempts where two-and-a-half were asked for and say nothing about it.

### The report keeps every attempt

`report.html` shows **all** of a retried test's attempts, not just the last. Each failed prior
attempt renders as a collapsed section — `attempt 1 — failed`, `attempt 2 — failed` — above the
final attempt's visible steps, and that final one is labelled with its own verdict (`attempt 3 of 3
— passed`). So a `flaky` badge always has its evidence trail one click away, and a test that
exhausted its budget failing is never shown a green panel inside a failed one.

The console says how many attempts ran whenever more than one did — `✗ always fails (2 attempts)`
— except on a flaky pass, where `(flaky)` already states the more useful fact: that a retry *saved*
this test, rather than merely that retries happened. A test that ran once carries no count at all.

`junit.xml` stays summary-only by design: its `<testcase>` carries a `flaky` note with the attempt
count, and the step-level detail lives in `report.html`.

**A session is established once per test per name, not once per attempt.** A retrying test that
opts into `as admin` does not re-log-in between attempts — see
[Sessions & auth](/guide/sessions) for the two cases that *do* re-establish one, a `401` and a
known TTL.

## `wait until api` — poll for eventual state

For state that becomes true asynchronously (a job finishes, an order ships), re-issues the
request until its `expect`-only block passes or the wait timeout elapses (default 30s,
`timeout wait <duration>` in config to override — or on the step itself, for one slow poll; see
[browser advanced](/guide/browser-advanced)):

```tflw
test "order eventually ships"
  api POST /products body { name: "Widget", status: "processing" }
  expect status equals 201
  capture body.id as id

  wait until api GET /products/{id}
    expect body.status equals "shipped"
```

Note that the request is written out again inside the `wait until`. That is not boilerplate — it is
the whole mechanism. `wait until body.status equals "shipped"` on its own is refused, because the
response the last `api` step fetched is written once and nothing between two polls can change it; the
step would pass on its first attempt or spin until its deadline blaming an endpoint it never asked
twice. Re-issuing the request is what makes the condition able to become true. See
[what a `wait until` can wait for](/guide/browser-advanced) for the rule and the browser subjects it
also admits.

## `retry honoring "Retry-After" up to N` — one step, not the whole test

Deliberately **not** the same mechanism as `retry N`, which retries the whole test immediately.
This is a per-`api`-step clause for a server that replies `429`/`503` with a `Retry-After` header
telling you exactly how long to wait before trying *that one request* again:

```tflw fragment binds=id
api POST /orders body { productId: {id} }
  retry honoring "Retry-After" up to 3
expect status equals 201
```

Reads the response's `Retry-After` header (seconds or an HTTP-date), sleeps that long, and
re-issues the identical request — up to `N` extra attempts. If the header is absent or
unparseable, the step behaves exactly as if the clause weren't there (one attempt, no wait) —
guessing a wait time is worse than not retrying at all. A retried step's report line shows a visible
"retried Nx honoring Retry-After (waited Xms total)" suffix — retry evidence is never hidden.

`up to 0` is legal here too, and means something different from omitting the clause entirely:
honour the header, then do not re-issue. A position, not a mistake.

It is not available inside `wait until api`, which already has a poll-until-it-passes loop of its
own.

## Headers on a poll

A `wait until api` block takes `header "…" is <value>` lines exactly as an ordinary `api` step
does, and **every poll re-sends them**:

```tflw fragment binds=jobId,token
wait until api GET /jobs/{jobId}
  header "Authorization" is "Bearer {token}"
  expect body.status equals "done"
```

Headers first is a convention rather than a grammar rule — the block is one sequence, and the two
kinds of line may interleave. This matters for any poll that needs a token, a per-file namespace or
an idempotency key attached: without it, the only way to poll an authenticated endpoint would be a
workaround.

## Two budgets on one line

`wait until api GET /jobs timeout 5s timeout wait 5m` carries both, and they bound different things
— `timeout` is one poll's own HTTP request, `timeout wait` is how long the step keeps polling. The
first does not lengthen the second by a millisecond. Both forms of `wait until` take a step-level
`timeout wait`; [browser advanced](/guide/browser-advanced#one-slow-wait-timeout-wait-duration-on-the-step) has
the full account and the reason for reaching for it.

Full reference: [SPEC.md §4.4](https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md#4-tests--structure-),
[§5.1 (api steps)](https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md#5-api-steps-p3-p7-p29-p32-p33-).
