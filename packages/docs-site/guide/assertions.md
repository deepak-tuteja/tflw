# 4. Assertions in depth

One form covers every assertion:

```
expect <subject> [not] <matcher> [value]
check  <subject> [not] <matcher> [value]     # soft twin
```

Subjects: `status`, `duration`, `header "<name>"`, `body`, `body.<path>`, `request` (the connection
attempt itself — see below). The matcher set is **closed** — custom logic goes through the
[JS escape hatch](/guide/actions). See the full [Matchers reference](/reference/matchers) for
every matcher, what it applies to, and an example.

`not` negates any matcher: `expect status not equals 404`.

## Array quantifiers

```
expect any body.items.name equals "Widget"
expect all body.items.status equals "active"
```

## Partial-object matching

`equals` is a full deep-equal; `matches subset {...}` checks the other direction only — every
key/value in the literal must be present on the actual object, extra keys are ignored:

```
expect body matches subset { type: "about:blank", title: "Unprocessable Entity", status: 422 }
```

Recurses into nested **objects** (a nested field can itself be a partial literal); a nested
**array** still needs full equality. Composes with `any`/`all` like any other matcher. A failed
subset match reports only the keys that are actually missing or mismatched — not the whole actual
object — so a large response with one wrong field reads as one short line.

## Contract validation against a real OpenAPI document

```
api GET /products/{productId}
expect body matches schema "ProductResponseDto" from "/openapi.json"
```

Validates the subject against a named schema in an externally-fetched OpenAPI document using a
real **ajv** (JSON-Schema) validator, including `$ref` resolution across `components.schemas`.
`"src"` is an absolute URL, or a path resolved against the default `api` service's base URL. The
document is fetched once and cached for the rest of the run — every further `matches schema`
assertion against the same source reuses it, including across `--workers N`. `allow hosts`
(see [Config & environments](/guide/config)) gates this fetch the same as any `api` step.
`not matches schema ...` asserts the subject does **not** conform — useful for a
deliberately-drifted-endpoint regression check.

## Connection-failure assertions

```
api GET /health
expect request fails matching "certificate"
```

A request that fails *before* any HTTP response exists — a TLS handshake rejection, DNS failure,
`ECONNREFUSED`, an [`allow hosts`](/guide/config) block — normally crashes the whole test
immediately. `expect`/`check request connects`/`fails` opts a single request into catching that
error instead, so a guardrail like this can be a genuinely passing regression test rather than
something only provable by unit-testing the tool itself. `fails matching "<regex>"` additionally
checks *why* it failed; a bare `fails` accepts any connection-level failure. `not` composes the
same way it does everywhere else — `expect request not connects` behaves exactly like a bare
`expect request fails`.

Only the request immediately followed by a `request` assertion opts in — every other `api` step
keeps today's fail-fast behavior unchanged. `request` can't be combined with a response-based
assertion (`status`/`header`/`body`/`duration`) on the same request, isn't supported inside `wait
until api`, and isn't `capture`-able — it carries no value, only a pass/fail judgment on whether a
connection was established.

## Hard vs. soft

- `expect` fails the test immediately (trustworthy artifacts — nothing downstream is safe to run).
- `check` records pass/fail and continues; any failed check fails the test at the end.
- This stays uniform through an `action` call: a `check` failing *inside* an imported action
  propagates back to the caller as soft, exactly as if it had been written inline.

## Failure-message size

Every failure message's "expected"/"got" text is capped at 2000 characters, with a truncation
marker pointing at `report.html` for the full body — a large response never floods the CLI or the
report with an 11,000-character single line.

Full reference: [SPEC.md §6](https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md#6-assertions-p1316-).
