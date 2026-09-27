# Signed requests

Some APIs don't take a token. They take a **signature over the request itself**: a hash of the
body (and often the method, path and a timestamp) keyed with a secret you share with the server.
tflw is the client here, so a signer is what lets a test reach:

- **your own webhook receiver**, which checks the sender's signature before it trusts the payload.
  To test the handler, the test has to sign as the sender would;
- **a signed partner API**, where an HMAC over method, path, timestamp and body is the credential
  on every call;
- **anything behind AWS IAM**: API Gateway with IAM auth, Lambda function URLs, S3, OpenSearch.

A signer is declared once in `tflw.config`, with its secret read through `env(…)`, so no secret
ever appears in a test file:

```tflw-config fragment
require env STRIPE_WEBHOOK_SECRET

signer stripe hmac sha256 hex secret env(STRIPE_WEBHOOK_SECRET)
  signs "{timestamp}.{body}"
  header "Stripe-Signature" is "t={timestamp},v1={signature}"
```

A request opts in with a `sign with` line under its `api` step, beside any `header` lines:

```tflw
test "a paid invoice is recorded"
  api POST /webhooks/stripe body { id: "evt_1", type: "invoice.paid" }
    sign with stripe
  expect status equals 200
```

The signature covers **the bytes that are sent**. tflw serialises the body once (JSON, form, text,
or multipart with its boundary), signs those bytes and sends them. There's no second serialisation
that could differ.

## Writing a scheme

`hmac` takes a hash (`sha1`, `sha256` or `sha512`), how the signature is written (`hex` or
`base64`) and the secret. Under it, `signs` is the string that gets signed and each `header` line
is where the signature travels. Their `{…}` are the signer's own placeholders, not variables:

| Placeholder | In | Is |
|---|---|---|
| `{body}` | `signs` | the body bytes as sent |
| `{body sha256}` | `signs` | the hex SHA-256 of those bytes, for schemes that sign a hash |
| `{method}` | `signs` | `POST`, upper case |
| `{path}` | `signs` | the path as sent, `/webhooks/stripe` |
| `{query}` | `signs` | the query string without its `?` |
| `{timestamp}` | `signs`, `header` | Unix seconds |
| `{signature}` | `header` | the signature `signs` produced |

A placeholder the signer doesn't fill, `{signature}` inside `signs`, or no header carrying
`{signature}` is `TF087`. `tflw check` reports it before anything is sent.

There are no built-in vendor presets, so a provider changing its format can't change a suite
under you. These are the common schemes written out:

```tflw-config fragment
require env GITHUB_WEBHOOK_SECRET, SLACK_SIGNING_SECRET, ACME_SECRET

signer github hmac sha256 hex secret env(GITHUB_WEBHOOK_SECRET)
  signs "{body}"
  header "X-Hub-Signature-256" is "sha256={signature}"

signer slack hmac sha256 hex secret env(SLACK_SIGNING_SECRET)
  signs "v0:{timestamp}:{body}"
  header "X-Slack-Request-Timestamp" is "{timestamp}"
  header "X-Slack-Signature" is "v0={signature}"

signer acme hmac sha256 base64 secret env(ACME_SECRET)
  signs "{method}\n{path}\n{timestamp}\n{body sha256}"
  header "X-Timestamp" is "{timestamp}"
  header "X-Signature" is "{signature}"
```

## AWS Signature Version 4

```tflw-config fragment
require env AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN

signer aws sigv4 region "eu-west-1" service "execute-api" key env(AWS_ACCESS_KEY_ID) secret env(AWS_SECRET_ACCESS_KEY) token env(AWS_SESSION_TOKEN)
```

`region`, `service`, `key` and `secret` come in that order. `token` is only for temporary
credentials. tflw computes SigV4 itself, with no AWS SDK:

- it signs `host`, `content-type` when the request has one, and every `x-amz-*` header;
- it adds `x-amz-date` and, for a `token`, `x-amz-security-token`;
- with `service "s3"` it also sends `x-amz-content-sha256`, which S3 requires.

```tflw
test "the orders API behind IAM answers"
  api GET /prod/orders
    sign with aws
  expect status equals 200
```

## Signing every request of a session

A session can sign everything a test sends while it's in use:

```tflw-config fragment
require env STRIPE_WEBHOOK_SECRET

signer stripe hmac sha256 hex secret env(STRIPE_WEBHOOK_SECRET)
  signs "{timestamp}.{body}"
  header "Stripe-Signature" is "t={timestamp},v1={signature}"

session partner signed with stripe
  header "X-Partner" is "acme"
```

A test that opts into `as partner` has every request signed. A step's own `sign with` line wins
over the session's, which is how one step in a signed test sends a bad signature.

## Testing that the server refuses a bad signature

For a webhook endpoint, the question to ask is whether it **rejects** what it should. Each case is
an override on the `sign with` line, and each reads as what it does:

```tflw
test "the webhook refuses a wrong key"
  api POST /webhooks/stripe body { id: "evt_1" }
    sign with stripe secret "not-the-secret"
  expect status equals 400

test "the webhook refuses a replayed timestamp"
  api POST /webhooks/stripe body { id: "evt_1" }
    sign with stripe at now - 10 minutes
  expect status equals 400

test "the webhook refuses a body changed after signing"
  api POST /webhooks/stripe body { amount: 100 }
    sign with stripe then body { amount: 1 }
  expect status equals 400

test "the webhook refuses an unsigned request"
  api POST /webhooks/stripe body { id: "evt_1" }
  expect status equals 400
```

`then body …` signs the step's own body and sends the other one. `at` takes a time, relative to
the moment the request is signed.

## The clock

A signature's timestamp is the **run clock**, the same one `now` and the generators read, so
`--now` pins it and a signed run is reproducible. It moves forward by the time the run has taken,
though: a request twenty minutes into a long run carries a timestamp twenty minutes after the
start, not the start itself, which a receiver's five-minute tolerance would refuse. A `retry
honoring` re-issue and a session's refresh after a `401` both re-sign with a fresh timestamp.

The secret is redacted from every report like any `env()` value. The signature header is shown,
because it isn't a secret and a failed verification needs it to be diagnosed.
