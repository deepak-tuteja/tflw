# 9. CI, reporting & safety

## Reports

Every run writes a self-contained `report/report.html` (step timeline, full request/response
detail) and `report/junit.xml` (for CI test-result ingestion) — they fall out of the same event
stream `tflw run` already emits, nothing to wire up.

`tflw check [files]` runs the same parse + full checker pipeline `run` executes before it does
anything, with **no execution** and no secrets required — a fast pre-commit/CI lint step. `tflw
run` exits non-zero on any test failure. A GitHub Actions example:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 22
- run: npm ci
- run: npx tflw run
- uses: actions/upload-artifact@v4
  if: always()
  with:
    name: tflw-report
    path: report/
```

## Secrets are redacted automatically

Anything that ever flowed through `env(NAME)` — header, body, URL, a derived interpolation —
prints as `•••(NAME)` in `report.html`, traces, and CLI output, automatically. See
[Config & environments](/guide/config) for `require env`.

## Declarative field redaction — PII by path, not by source

`redact` masks a JSON field regardless of where its value came from — useful for PII (`email`,
`address`, `ssn`) that's never actually read through `env(...)`:

```
env staging
  api "https://staging.example.com"
  redact body.email, body.*.address
```

`.prop` segments and a `.*` wildcard (matches every object key or array element). Applied only to
the report-only trace — `expect`/`capture` always see the real, unmasked value.

## Evidence levels — how much trace lands in the report

```
env staging
  evidence "headers-only"
```

- `full` (default) — everything: method/url/status/headers/body.
- `headers-only` — drops the request/response body (replaced with an `[omitted by evidence
  level]` marker).
- `none` — drops headers too; only method/url/status/duration remain.

`--evidence <level>` overrides the config value for one run — handy for a CI job that wants
`none`-level reports by policy regardless of what any given `tflw.config` declares.

## `--forbid-insecure` — a CI policy gate

Fails **before any test runs** if `insecure true` (TLS verification disabled — see
[Config & environments](/guide/config)) is active for the env actually running. Use it in CI to
make sure a self-signed-cert workaround never silently ships as the default for a shared pipeline.

Full reference: [SPEC.md §12](https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md#12-cli-),
[§13 (events/report)](https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md#13-events-report-ci-outputs-p4-5-p23-p30-).
