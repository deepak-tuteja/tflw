# Assertions in depth

One form covers every assertion:

```text
expect <subject> [not] <matcher> [value]
check  <subject> [not] <matcher> [value]     # soft twin
```

The matcher set is **closed** — custom logic goes through the
[JS escape hatch](/guide/actions). See the full [Matchers reference](/reference/matchers) for
every matcher, what it applies to, and an example.

`not` negates any matcher: `expect status not equals 404`.

`is` is an **optional copula**. It carries no meaning of its own and may sit on either side of
`not`, so `is not visible`, `not is visible`, `is visible` and `not visible` are four spellings of
two assertions — write whichever reads best out loud. These docs use `is not visible`, and
`is greater than` / `is less than` for the comparisons.

## What an assertion can see

A response is not only its JSON. Eight subject forms read one, and which you pick decides what the
matcher on the right is comparing against:

| subject | is | example |
| --- | --- | --- |
| `status` | the response code | `expect status equals 201` |
| `duration` | wall time of the request | `expect duration is less than 500ms` |
| `header "<name>"` | one response header, by name | `expect header "content-type" contains "json"` |
| `body` / `body.<path>` | the body parsed as JSON, addressed by dot/index path | `expect body.items[0].price equals 9.99` |
| `body text` | the body as a raw string | `expect body text contains "healthy"` |
| `body bytes` | the body as untouched bytes | `expect body bytes has count 1024` |
| `body csv` / `body csv[N].col` | the body parsed as RFC-4180 CSV | `expect body csv[0].name equals "Widget"` |
| `body pdf text` | text extracted from a PDF body | `expect body pdf text contains "Invoice"` |

`request` is the ninth and the odd one out — it judges the connection attempt rather than a
response, and has [its own section](#connection-failure-assertions) below.

Three of these earn their existence on responses that are not JSON:

- **`body text`** is the plain-string reading, for HTML, XML or a bare text endpoint. Writing a JSON
  path against a non-JSON response does not fail with a parse error — it raises a teaching error
  pointing you at this subject.
- **`body bytes`** is the body with nothing done to it, for a PDF or an image that `body text`
  would irreversibly UTF-8-corrupt on its way to becoming a string. It accepts exactly two matchers:
  `has count` (the byte length) and [`matches file`](#comparing-a-binary-body-to-a-file). Everything
  else is refused, because raw bytes are not a quantifiable array and there is no way to write a
  binary literal inline to compare them against.
- **`body csv`** parses the body into rows and then addresses them with the same path machinery
  `body.<path>` uses — bare `body csv` is the whole array, `body csv[0].name` is one cell. Every
  matcher works on it, `any`/`all` included. A row whose field count disagrees with the header is a
  named runtime error, never a silently short row.

`body pdf text` walks the document's page tree, inflates each content stream and reads its
text-showing operators, joining lines within a page with a newline and pages with a blank line. It
is scoped to PDFs shaped like what a simple PDF writer emits; an unparsable one is a named runtime
error rather than an empty string that would quietly satisfy `not contains`.

## The everyday matchers

```tflw fragment
api GET /products
expect status equals 200
expect body.items has count 3
expect body.items[0].name contains "Widget"
expect header "content-type" matches "application/json"
expect body.items[0].price is greater than 0
```

- `equals` is a **full deep-equal** on objects and arrays, not a subset check — see below for the
  other direction.
- `contains` reads substrings on a string and membership on an array.
- `matches "<regex>"` is a regular expression against a string subject, unanchored — `matches
  "json"` is satisfied by `application/json; charset=utf-8`.
- `has count` is the length of an array, a UI list, or a `body bytes` subject.
- `is greater than` / `is less than` take numbers and durations.

`not` negates every one of them, and `any`/`all` (below) quantify the ones that apply to an array
element.

## Array quantifiers

```tflw fragment
expect any body.items.name equals "Widget"
expect all body.items.status equals "active"
```

## Partial-object matching

`equals` is a full deep-equal; `matches subset {...}` checks the other direction only — every
key/value in the literal must be present on the actual object, extra keys are ignored:

```tflw fragment
expect body matches subset { type: "about:blank", title: "Unprocessable Entity", status: 422 }
```

Recurses into nested **objects** (a nested field can itself be a partial literal); a nested
**array** still needs full equality. Composes with `any`/`all` like any other matcher. A failed
subset match reports only the keys that are actually missing or mismatched — not the whole actual
object — so a large response with one wrong field reads as one short line.

## Contract validation against a real OpenAPI document

```tflw fragment binds=productId
api GET /products/{productId}
expect body matches schema "ProductResponseDto" from "/openapi.json"
```

Validates the subject against a named schema in an externally-fetched OpenAPI document using a
real **ajv** (JSON-Schema) validator, including `$ref` resolution across `components.schemas`.
`"src"` is an absolute URL, or a path resolved against the default `api` service's base URL. The
document is fetched once and cached for the rest of the run — every further `matches schema`
assertion against the same source reuses it, including across `--parallel N`. `allow hosts`
(see [Config & environments](/guide/config)) gates this fetch the same as any `api` step.
`not matches schema ...` asserts the subject does **not** conform — useful for a
deliberately-drifted-endpoint regression check.

## Comparing a binary body to a file

`matches file "<path>"` is a byte-for-byte comparison against a file on disk. It exists because
`body bytes` has no inline literal syntax — there is no way to write a PDF into a `.tflw` file — so
the only thing a binary body can be compared against is another set of bytes:

```tflw fragment
api GET /receipts/latest
expect status equals 200
expect body bytes matches file "./receipt.png"
```

A captured binary body outlives the request that produced it, which is what makes a round-trip
assertion writable — upload some bytes, fetch them back several requests later, and compare the two:

```tflw fragment
api GET /receipts/latest
capture body bytes as receipt

api POST /receipts body { note: "re-filed" }
expect status equals 201

expect {receipt} matches file "./receipt.png"
```

That is deliberate rather than incidental: `matches file` is one of the few matchers allowed on a
bound value, because bytes are an ordinary capturable subject and not a live handle onto something
that has since moved on.

## Connection-failure assertions

```tflw fragment
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
