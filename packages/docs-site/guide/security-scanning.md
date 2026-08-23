# Security hygiene scanning

Every response your API sends says something about itself: whether its cookies can be read by
JavaScript, whether a shared proxy may cache it, whether a browser is allowed to frame it. Those
answers are easy to assert one at a time — `expect header "Strict-Transport-Security" contains
"max-age"` has always worked — and nobody writes them twice.

`expect response has no security violations` runs a built-in pack of ten hygiene rules over the
response your last `api` step actually received.

```tflw fragment
api GET /orders
expect response has no security violations
```

That is the whole feature. The rest of this page is about what it checks, what it deliberately does
*not* check, and the one line of config it requires first.

## You have to say what you are allowed to scan

Before any of the above runs, `tflw.config` needs a declaration naming the target:

```tflw-config
env secureLocal
  api "https://localhost:8443/v1"
  insecure true
  allow hosts "localhost"
  authorized target "https://localhost:8443" reason "self-hosted test fixture"
```

Without it, `tflw check` fails with `TF060` and the run never starts.

This is a deliberate speed bump, not a formality. A test suite pointed at the wrong host is an
inconvenience; a *scanner* pointed at the wrong host is somebody else's incident. The declaration
is an affirmation, in writing, that you are permitted to do this — so it names one origin and takes
no wildcards (`https://*.example.com` is `TF061`), and the `reason` is required because a
declaration without one is a checkbox.

Your reason is printed in the run summary and embedded in `report.html`:

```console
ℹ authorized target https://localhost:8443 — self-hosted test fixture
```

so the claim that permitted the scan travels in the same artifact as the scan's findings.

Loopback gets no exemption. `http://localhost:4001` needs a declaration exactly like production
does.

## What the pack checks

Ten rules, with fixed severities you filter rather than re-grade:

| rule | severity | applies when |
| --- | --- | --- |
| `sec/cookie-not-httponly` | critical | the response sets a cookie |
| `sec/cookie-not-secure` | critical | the scheme is https **and** the response sets a cookie |
| `sec/cors-wildcard-with-credentials` | critical | the response carries `Access-Control-Allow-Origin` |
| `sec/hsts-missing` | serious | the scheme is https |
| `sec/csp-missing` | serious | the response is a document (`text/html`) |
| `sec/tls-version-old` | serious | the scheme is https and the TLS probe succeeded |
| `sec/tls-weak-cipher` | serious | the scheme is https and the TLS probe succeeded |
| `sec/x-frame-options` | moderate | the response is a document (`text/html`) |
| `sec/cookie-samesite-none` | moderate | the response sets a cookie |
| `sec/nosniff-missing` | moderate | always |
| `sec/authenticated-response-cacheable` | moderate | the request carried session or bearer credentials |
| `sec/server-version-disclosure` | minor | always |

A severity word is a **floor**, not an exact match, the same as the a11y scan in
[the a11y scan](/guide/browser-advanced):

```tflw fragment
expect response has no serious security violations   # serious and critical
```

## "Not applicable" is a real answer

Look at the third column of that table again. Most of those rules only mean something about
*certain* responses.

Over plaintext, a `Secure` cookie is not merely unset — a browser would refuse to store it at all.
`Strict-Transport-Security` over `http://` is ignored. A `Content-Security-Policy` on a JSON body
governs nothing. If the pack reported those as violations, a plaintext suite would light up on every
single response, and every fix it suggested would break something.

So a rule whose precondition is unmet is **not applicable** — which is neither a violation nor a
silent pass, and the result says so:

```console
✓ expect response has no security violations — 12 rules — 2 applicable, 10 not applicable, 0 violations
```

Three numbers and their denominator, on pass and on failure alike. A green line that says
`2 applicable` is telling you something a bare ✓ cannot: this response was checked, and ten of the
twelve questions did not apply to it.

## An assertion that could not have failed, fails

Here is the case that catches people, and it is intentional:

```tflw fragment
api GET /orders                                       # plain JSON, no cookies, no CORS
expect response has no critical security violations   # ✗
```

```console
✗ this assertion had no power to fail: no `critical`-or-worse security rule applied to this
  response (3 rules — 0 applicable, 3 not applicable, 0 violations).
  - sec/cookie-not-httponly applies when: the response sets a cookie
  - sec/cookie-not-secure applies when: the scheme is https AND the response sets a cookie
  - sec/cors-wildcard-with-credentials applies when: the response carries Access-Control-Allow-Origin
  Point it at a response one of these rules can judge, or lower the severity floor.
```

All three critical rules are about cookies and CORS. This endpoint has neither, so nothing engaged.
Passing would have written "checked and clean" into your report about a response that was never
checked — and a green assertion nobody can fail is worse than no assertion, because it looks like
coverage.

Note that the floor narrowed the pack to **3 rules**, not 12. That is why the denominator is honest:
it counts the work the assertion actually did.

## The two TLS rules open a second connection

`sec/tls-version-old` and `sec/tls-weak-cipher` are unlike the other ten: their facts are not in the
response at all. tflw drives Node's built-in `fetch`, which will not tell you which protocol version
or cipher suite a request negotiated, and the library that would is a runtime dependency tflw does
not take.

So tflw opens its own connection to the same host and port, reads the protocol and cipher, and hangs
up. **Once per host per run** — not once per response. It obeys `allow hosts`, and it needs an
`authorized target` covering wherever the run actually ended up, which is checked again here because
a redirect can land somewhere the config never named.

Three things follow, and they are worth knowing before you read a finding:

- **It is a second connection, not the one you asserted on.** For a service with one TLS
  configuration these are the same thing. Behind a load balancer whose nodes are configured
  differently, they need not be — and the failure message says so rather than leaving you to
  discover it.
- **It reports what the host gives a *current* client, not everything the host would accept.** A
  server that still supports RC4 but prefers AES-GCM will negotiate AES-GCM, and `tls-weak-cipher`
  stays correctly silent — because that is what your callers get. Finding every suite a server would
  accept takes one handshake per suite; that is a scanner's job, not an assertion's.
- **If the handshake cannot be made, both rules are "not applicable" — never a failure.** A refused
  connection, a timeout, or a self-signed certificate on a run without `insecure true` gets you:

  ```console
  - sec/tls-version-old applies when: the scheme is https and the TLS probe succeeded — it did
    not: the TLS handshake to localhost:8443 failed: DEPTH_ZERO_SELF_SIGNED_CERT
  ```

  A network problem is not a security verdict, and the listing tells you which half went wrong.

One deliberate asymmetry: the probe offers to speak **TLS 1.0**, which is older than Node's own
client will normally go. It has to. A server that speaks nothing but TLS 1.0 would otherwise refuse
the handshake, and the rule whose entire job is to catch that server would report "could not tell".
Offering an old floor never drags a healthy server down — the server still picks the newest version
you both speak, so a TLS 1.3 host is still reported as TLS 1.3.

## Your session's login response is scanned too

The single most valuable thing this pack can find is a session cookie without `HttpOnly` — and that
cookie is set by your `session` block, not by the endpoint you are asserting about.

So each session's own login response is scanned once, when the session is established, and its
findings are folded into every security assertion in a test that uses it:

```console
✗ expected response to have no security violations, but found 1 — 12 rules — 2 applicable, …:
  - [critical] sec/cookie-not-httponly: cookie is readable by JavaScript (no HttpOnly)
    (session "admin" login — cookie `sid` — any XSS on this origin can read it)
```

Nothing inspects a cookie jar or reaches across requests: that login response is a response your run
genuinely made.

## Covering more than one endpoint

Assertions are explicit, one per step. There is no config key that scans every response
automatically — a hidden assertion that no line of your test file shows would mean a passing suite's
guarantees are no longer readable from the suite.

There is also no hook shortcut. This language has no `before each`/`after each`, and a bare `after`
hook runs in its own scope where it never inherits the test's last response (`TF039`). So the scan
sits in the test body, next to the request it judges:

```tflw
test "order endpoints answer safely"
  api GET /orders
  expect response has no serious security violations

  api GET /orders/1
  expect response has no serious security violations
```

That is more typing than a hook would be, and it is a deliberate trade: every guarantee this suite
claims is a line somebody can read in the file that claims it.

## What this does not do

- **No authorization testing — in *this* matcher.** The pack reads what a response *says about
  itself*. Whether user A can fetch user B's order is a different question, and a much more
  valuable one: it is [authorization testing](/guide/authorization-testing)'s `has no authorization
  violations`, a **separate** matcher on the same `response` subject. Deliberately separate — folding
  it in here would have made every assertion on this page start sending cross-identity traffic the
  moment its author upgraded.
- **No per-rule suppression.** A severity floor is the only filter. Allow-listing individual rule
  ids is deliberately unsupported, the same as for the a11y scan.
- **No SARIF or standalone scan report.** A finding here is an assertion failure: it surfaces in the
  console and in `report.html` like any other.

## Related

- [Assertions in depth](/guide/assertions) — the `expect`/`check` split and severity floors
- [Config & environments](/guide/config) — where `authorized target` lives
- [Browser testing: advanced scenarios](/guide/browser-advanced) — the a11y scan this shares its
  finding model with
- [Authorization testing](/guide/authorization-testing) — the other matcher on `response`, and the
  question this one deliberately does not ask
- [Input-handling testing](/guide/input-handling) — the third matcher on `response`: what the app
  does with input it did not expect
- [Findings, baselines & the gate](/guide/findings-and-baselines) — fingerprints, `--baseline` and
  `--fail-on`: what happens to a finding after a rule raises it
