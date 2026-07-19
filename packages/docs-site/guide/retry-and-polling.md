# 8. Retry, polling & flaky handling

Three different mechanisms cover three different kinds of instability — don't reach for the wrong
one.

## `retry N` — re-run a failing test

```
test "flaky endpoint eventually succeeds" retry 2
  api GET /flaky
  expect status equals 200
```

Re-runs the **entire test** up to `N` more times on failure. A pass on a later attempt is never
silently green — it's reported passed-but-flagged:

```
✓ flaky endpoint eventually succeeds (flaky) (48 ms)
```

`unique(...)`-family values keep advancing their counter across attempts (so a retry never
collides with data the failed attempt already created); `random`-family values replay identically
on every attempt (same per-test seed) — see
[Variables, generators & expressions](/guide/variables) for why that split matters.

## `wait until api` — poll for eventual state

For state that becomes true asynchronously (a job finishes, an order ships), re-issues the
request until its `expect`-only block passes or the wait timeout elapses (default 30s,
`timeout wait <duration>` in config to override):

```
test "order eventually ships"
  api POST /products body { name: "Widget", status: "processing" }
  expect status equals 201
  capture body.id as id

  wait until api GET /products/{id}
    expect body.status equals "shipped"
```

## `retry honoring "Retry-After" up to N` — one step, not the whole test

Deliberately **not** the same mechanism as `retry N`, which retries the whole test immediately.
This is a per-`api`-step clause for a server that replies `429`/`503` with a `Retry-After` header
telling you exactly how long to wait before trying *that one request* again:

```
api POST /orders body { productId: {id} }
  retry honoring "Retry-After" up to 3
expect status equals 201
```

Reads the response's `Retry-After` header (seconds or an HTTP-date), sleeps that long, and
re-issues the identical request — up to `N` extra attempts. If the header is absent or
unparseable, the step behaves exactly as if the clause weren't there (one attempt, no wait). A
retried step's report line shows a visible "retried Nx honoring Retry-After (waited Xms total)"
suffix — retry evidence is never hidden.

Full reference: [SPEC.md §4.4](https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md#4-tests--structure-),
[§5.1 (api steps)](https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md#5-api-steps-p3-p7-p29-p32-p33-).
