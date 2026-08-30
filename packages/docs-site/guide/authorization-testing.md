# Authorization testing

The previous chapter reads what a response *says about itself*. This one asks a harder question:
can somebody else fetch it?

`expect response has no authorization violations` takes the request your last `api` step actually
made, re-issues it under every *other* identity your config declares, and compares what comes back
against what the owner got.

```tflw
test "a shopper's order is nobody else's" as shopper
  api GET /orders
  capture body[0].id as orderId

  api GET /orders/{orderId}
  expect response has no authorization violations
```

That is the first entry in the OWASP API Security Top 10 — broken object-level authorization, the "authenticated but not authorized"
bug. It is the one class of flaw a scanner genuinely cannot find on its own, because only your suite
knows which identity is supposed to own which resource.

## It judges a request you actually made

The unit of input is **the request that went out**, not a route from your file. That distinction is
the whole design.

79% of `api` paths in a real suite carry a `{interpolation}`, so `api GET /orders/{orderId}` is an
address nobody can dial until the run has bound `orderId`. The probe is rebuilt from the observed
request — method, URL and body verbatim — rather than re-run through the step, because re-running it
would re-evaluate `unique(…)`, `random(…)` and every `{var}`, and ask about a resource the owner
never touched.

## You need an owner, and you need somebody else

The oracle is *differential*, so it needs two things your suite has to declare.

**An owner**: the test says who made the request.

```tflw
# `shopper` owns what this request returned, so `shopper` is the one identity not probed
test "orders are owner-scoped" as shopper
  api GET /orders
  capture body[0].id as orderId

  api GET /orders/{orderId}
  expect response has no authorization violations
```

A test with no `as <session>` is `TF063` at check time. So is the assertion inside a `before file`
hook, which runs in its own scope and can never have one. Every session a test names is an owner —
`test "…" as admin, shopper` sends admin's bearer *and* shopper's cookie at once, so both are the
owner and neither is probed.

**Somebody else**: the probe set is every declared `session` except the owner's, plus a built-in
`anonymous` that is always probed last. `anonymous` is a reserved name; `session anonymous` is a
config error.

If your config declares only the session the test is running as, the probe set is `anonymous` alone
— which tests *authentication*, not authorization. That is worth a second session:

```tflw-config
env local default
  api "http://localhost:4001"
  authorized target "http://localhost:4001" reason "self-hosted test fixture"

session shopper
  api POST /auth/login body { email: env(SHOPPER_EMAIL), password: env(SHOPPER_PW) }
  capture body.token as token
  header "Authorization" is "Bearer {token}"

session peer
  api POST /auth/login body { email: env(PEER_EMAIL), password: env(PEER_PW) }
  capture body.token as token
  header "Authorization" is "Bearer {token}"
```

Sessions are established **lazily** — only when an authorization assertion actually needs them. One
consequence is worth knowing before it surprises you: a broken credential for a session no test ever
names now surfaces *inside a test that never named it*, as an un-probed principal. That is a fact
about your config, reported where it first mattered.

## `privileged` — a principal that is meant to have access

An admin who can read everybody's orders is not a finding. Mark it:

```tflw-config fragment
session admin privileged
  api POST /auth/login body { email: env(ADMIN_EMAIL), password: env(ADMIN_PW) }
  capture body.token as token
  header "Authorization" is "Bearer {token}"
```

A `privileged` session is left out of every probe set, and every assertion says so on its own line,
pass or fail:

```console
note: not probed as `admin` — declared `privileged`
```

### You will not always know in advance which principals these are

Read the paragraph above and the natural conclusion is that you write `privileged` from what you
already know about your app's roles. That holds for a session literally called `admin`. It does not
hold for the ones whose authority lives somewhere you did not think to look — and those are the ones
that produce a critical finding you cannot fault.

So the workflow is **run, read, decide** — not declare, then run:

1. Run the assertion with nothing marked `privileged`.
2. Read **which principal** leaked. Every violation names one, and a per-principal pattern in the
   findings is itself the signal — two principals leaking the same ids is a question about those two
   identities, not about the endpoint.
3. For each, decide whether that principal is *meant* to have that access. If it is, mark it
   `privileged` and re-run. If it is not, you have found a bug.

Step 3 is a judgement about your app's role model, and it stays yours. Inferring privilege from the
responses would put the status-code oracle back in the middle of this feature: an admin's legitimate
`200` and a BOLA's `200` are the same `200`, and the whole design starts from refusing to tell them
apart by guessing.

### An `oauth2` session is privileged whenever its **grant** mints a privileged token

This is the case that catches people, because nothing in the config looks wrong.

A client-credentials session names a client id, a secret and a scope. **None of them say who the
token comes back as.** If the authorization server signs it for a privileged user, that session is
privileged — and that fact lives in the server's grant implementation, which the person writing the
suite may not own or even be able to read:

```tflw-config fragment
session oauthLong oauth2 privileged
  token url "http://localhost:4001/v1/oauth/token"
  client id env(OAUTH_CLIENT_ID)
  client secret env(OAUTH_CLIENT_SECRET)
  scope "orders.read orders.write"
```

The worked example is this project's own dogfood app. Its two machine clients, `oauthLong` and
`oauthShort`, read as ordinary service principals — a client id, a secret, an orders scope. Its
token endpoint signs both *for the seeded admin user*, because a client-credentials grant there
represents the admin service account. Run the assertion without `privileged` on them and you get two
criticals in which **every piece of evidence is accurate**: a real order id, served to a real
non-owner, with a repro that reproduces. The evidence is true and the conclusion is wrong, and no
amount of re-reading the report will show you why. Only the grant does.

The scope string is not the answer either. `orders.read orders.write` describes what the token may
do, not whose orders it may do it to.

**`privileged` is a claim about authority, not a speed knob.** Probes are sequential, so each
assertion costs roughly one extra request per principal — and the cheapest way to make a slow
assertion fast would be to declare away the thing it measures. If the cost is real, the lever is
*fewer assertion sites*. Marking every session privileged empties the probe set of real identities
and is refused outright (`TF063`).

## What counts as a leak

The comparison is on **resource identity**, not on status codes — because a status oracle gets both
of the interesting cases wrong. An admin legitimately gets a byte-identical `200` on another user's
order, and a collection endpoint's *correct* answer for a non-owner is a `200` with a filtered body.

So tflw reads the owner's response for resource ids, and then asks whether any of them came back to
somebody else:

- an **object** → its root `id`
- an **array** → each element's root `id`
- **nothing else** — nothing nested, no key aliases, no envelope unwrapping

Reading is deliberately narrow and containment is deliberately wide: a leak found under a different
key, or wrapped in an envelope the owner's own response did not use, is still a leak, so the
probe's body is walked to any depth with exact leaf equality.

That narrowness has a visible cost, and it is the intended one. If your list endpoint answers
`{ "data": [...], "nextCursor": "…" }`, the assertion reports **no resource identity found** and
fails rather than passing:

```console
✗ this assertion had no power to fail: no authorization rule applied
  - sec/authz-object-leak applies when: the owner returned a 2xx object with a root `id` — no
    resource identity found
```

That is a refusal to guess, not a bug. An oracle that unwrapped envelopes would be guessing which
key holds the payload, in the one file that must never become a false-positive machine.

## Five outcomes, and `clean` has to be earned

Each principal's probe lands in one of five states, and only two of them are a pass:

| outcome | when | counts as |
| --- | --- | --- |
| leaked | an owner id came back | **violation** |
| refused | `401`/`403`/`404` | boundary confirmed |
| served different content | `2xx`, carrying no owner id | boundary confirmed |
| inconclusive | `429`, any `5xx`, a non-JSON body, the CSRF case below | **not clean** |
| not probed | a mutating method with no opt-in, a session that would not establish | **not clean** |

`404` sits with the refusals on purpose: returning `404` rather than `403` so as not to reveal that
a resource exists is *correct*, and a tier that scored it as suspicious would fire on the more
careful of two correct implementations.

`429` and `5xx` are inconclusive rather than refusals for the reason that matters most here: in both
the probe demonstrably did not get the resource **and** demonstrably never reached an authorization
check. Scoring a rate limiter as a boundary would let a suite that trips its own throttle report the
throttle as a green authorization result.

An assertion whose entire probe set landed in the bottom two rows had no power to fail, and fails —
the same rule the hygiene scan applies to a pack where nothing was applicable.

```console
✓ response has no authorization violations — 2 rules — 1 applicable, 1 not applicable, 0 violations;
  3 principals probed — 2 refused, 1 served different content
```

Every "could not find out" is announced on the **passing** line too. A green assertion whose whole
probe set was rate-limited is exactly the one a reader would otherwise believe had tested something.

## Public data has no owner, so it has no boundary

Some resources are meant for everybody: a product list, a public feed, a category tree. Every
principal receives them, so every probe lands in `leaked` — and reading that as a violation would put
a **critical** finding on every public endpoint an application has.

So there is one more question, asked of the probe *set* rather than of any member of it: **did the
built-in `anonymous` principal receive the same resources?** If a caller with no credentials at all
can read them, there is no owner, and nothing any authenticated principal did was a crossing.

```console
✓ response has no authorization violations — 3 rules — 1 applicable, 2 not applicable, 0 violations;
  3 principals probed — 3 leaked
  note: `anonymous` received the same resources, so this is public data with no owner — the leak
  rules found nothing to violate rather than finding a boundary intact
```

That note is not decoration. `3 leaked` beside `0 violations` is two true statements that contradict
each other unless the reason is on the same line, and a reader comparing two green runs otherwise has
no way to tell *a boundary that held* from *a boundary that never existed*.

**The rule stays applicable**, which matters more than it looks. Routed through the not-applicable
door instead, a public collection would trip the no-power-to-fail rule above — the other two
authorization rules are already not-applicable on an array — and a crawl of any public API would come
back red.

::: tip It is narrower than "everybody got a 2xx"
Only `anonymous` landing in **`leaked`** counts. A `2xx` that carried *none* of the owner's resources
is `served different content`, which is a route scoping correctly for strangers and still capable of
leaking to a logged-in peer — so the leak rules keep judging it. And a route that answers `401` to a
credential-less caller is guarded, so a leak to an authenticated non-owner there is a real finding,
which is exactly the shape most real BOLA is.
:::

## Cookie sessions and CSRF

If a principal's identity is carried by cookies alone, a mutating request may be refused by a CSRF
guard *before* authorization is ever consulted — and a differential oracle would score that refusal
as clean.

tflw probes anyway, and says what it saw:

```console
note: `shopper` inconclusive — a cookie-borne principal was refused on a DELETE (403); this may be
  CSRF rather than authorization. Give it a bearer session to judge it.
```

Probing rather than skipping is deliberate. The app most worth catching is the one with cookie auth
and *no* CSRF defence at all — it answers `200`, leaks, and is caught. A pre-flight skip would
decline to probe exactly that app.

A bearer session is one way out of the `inconclusive`. The other is to give the cookie principal
its token: [`csrf from … send as header`](/guide/sessions#csrf-from-send-as-header-—-a-token-that-travels-with-the-credential)
in the session block attaches the token the application issued *that* credential to every mutating
request it makes, so the probe reaches authorization instead of stopping at the guard in front of
it. And once the engine can supply the token it can withhold it, which is what turns "does this app
enforce CSRF at all" into a finding of its own.

## Mutating methods need permission per host

`GET`, `HEAD` and `OPTIONS` are probed by default. Anything else — including a method tflw does not
recognise — is `not probed` unless the target says otherwise:

```tflw-config fragment
defaults
  authorized target "http://localhost:4001" reason "self-hosted test fixture"
    probe mutating
```

It hangs off `authorized target` because it is a property of *that host*: staging may be safe to
read as a stranger and not safe to write to. The one-line declaration is unchanged; `probe mutating`
is an optional indented line beneath it.

Turning it on widens what is *probed*, which is not the same as widening what can be *judged*. A
`DELETE` is probed and cannot be concluded on — see [the destruction
bound](#what-it-does-not-judge-stated-out-loud) below before you read a green mutating run as a
clean one.

## Scanning anything but a private address needs the command line

`authorized target` is the *declaration*, and it lives in `tflw.config` — a file somebody can merge
into `main`. That is enough for a loopback fixture. Point the same suite at a host outside the
private address ranges and the run also wants an affirmation the config is not allowed to make:

```console
$ tflw run
✗ orders.tflw — an authorization scan against "https://stg.example.com/v1" (the default `api` base)
  needs `--allow-public-target https://stg.example.com` on the command line  [TF065]

$ tflw run --allow-public-target https://stg.example.com
```

The flag is repeatable, takes one origin each (scheme + host + port), and must name a target this
env both scans and declares — a flag matching nothing is `TF066` rather than a silent no-op. There
is deliberately **no `tflw.config` key for it**: the whole layer exists so that a committed config
cannot by itself point a scanner at the internet, and a key granting it would not be a feature, it
would be the removal of this control. It takes no `--reason` either — the reason belongs on the
declaration, where it travels into the report.

Three things worth knowing about how it decides:

- **It never resolves DNS.** The address class is read from the URL as written. A control that
  resolved a name would be sending a packet to decide whether it may send a packet, and the answer
  would differ on a VPN, differ between your laptop and CI, and could change between the check and
  the probe.
- **Only `localhost` is exempt by name.** Loopback, RFC1918, IPv6 unique-local, link-local and CGNAT
  addresses are exempt; every other hostname is public, including a genuinely private
  `api.internal.corp`. Nothing in that string says it is private, so the flag is asked for. The
  control over-asks rather than under-asks, on purpose.
- **`tflw check` takes the same flag, and its answer is not a promise.** The check refuses what it
  can prove without a server, but your env's base URL is resolved against *your* environment — so a
  clean check on a laptop says nothing certain about CI. The probe engine re-judges the origin the
  request is actually going to, and that verdict is the binding one.

The sibling matcher, `has no security violations`, needs **no** flag. It only inspects a response
your suite already asked for; there is no extra packet to authorize. Gating both would read simpler
and would end with the flag parked permanently in CI, and a control everybody leaves on is not a
control.

## The probes are paced, and the pace is one at a time

Per assertion, principals are probed **sequentially** — one request in flight, in declared order
with `anonymous` last. So the traffic an assertion adds is one request per probeable principal, not
a burst, and a run's total is bounded by the assertion count rather than by anything asynchronous.

There is no `probe rate` knob, because there is nothing to slow down: the engine cannot exceed one
in flight. That bound is held by a test rather than by the shape of a loop somebody might optimise
later.

## Every finding comes with a test you can run

A violation writes a `.tflw` file under `report/authz-repro/`, named from the rule, method, path and
principal:

```tflw
# emitted by tflw M130 — sec/authz-object-leak
# GET /orders/a1e3-9f served `shopper`'s resource to `peer`
test "peer must not read shopper's /orders/a1e3-9f" as peer
  api GET /orders/a1e3-9f
  expect status equals 403
```

A collection leak gets a different template — `expect all body.id not equals "…"` — because a
filtered `200` is the *correct* answer there, and a repro that asserted `403` would go red the
moment somebody fixed the bug.

A repro names the method, path, principal and the leaked id, and never a response body. An id is an
identifier; a body is contents.

## What it does not judge, stated out loud

This feature judges **what your suite declares an identity for**, and every run says how much of
your suite that is:

```console
ℹ authz coverage: 41 of 1035 api steps in the suite sit in a test that declares an owner (3%) —
  the rest are unjudgeable by `authorization violations`, which needs `as <session>`
```

That number is about the whole discovered suite, not about the tests this run selected, and it
exists so that "we probed everything we asserted on" cannot be read as "we probed everything".

Five more limits worth knowing:

- **The bound is destruction, not mutation.** With `probe mutating` on, a `PUT` or `PATCH` that
  succeeds for the owner and then succeeds for a non-owner leaks like any read, and is found. A
  `DELETE` cannot be judged this way at all: the oracle is differential, so it replays the owner's
  request first — and if that succeeds, the resource is gone and every later probe is *correctly*
  `refused`; if it fails, no rule applies. There is no third arrangement. **A suite whose only
  mutating endpoints are `DELETE`s will read `probed, 0 violations` as safe when nothing was
  actually decided.** The five-outcome table above is what to read instead of the summary line.
- **A suite can have a sensible session list and zero judgeable principals.** The owner is excluded
  from its own probe set; anything `privileged` is excluded by declaration; a cookie-borne session
  is `inconclusive` on a mutating verb for the CSRF reason above. Those three exclusions are each
  correct and can compose until nobody is left able to answer — with nothing about the config
  looking wrong. The assertion fails rather than greens (an empty probe set has no power to fail),
  so what you get is a red that is really a request for one more bearer principal.
- **A credential written onto the step is refused, not worked around.** If the `api` step carries
  its own `Authorization` or `Cookie` header, the comparison would be between two identities the run
  cannot name — so it is `TF062` at check time and a hard failure at run time. Put the credential in
  a `session` and name it with `as`. A credential in a query string, in a body, or in an
  app-specific header is out of reach either way.
- **Not inside `wait until api` (`TF064`), and not inside a workload (`TF033`).** Both re-issue their
  request; the first would re-probe on every poll and report a real finding as a *timeout*, and the
  second would multiply cross-identity traffic by your load factor.
- **No client certificates on the probe.** Against an mTLS-only target every probe is refused, every
  outcome is `not probed`, and the assertion fails loudly rather than greening — which is the honest
  answer, not a workaround.

## Related

- [Security & vulnerability testing](/guide/security#what-a-green-scan-does-not-claim) — the bar all
  four scans are held to, and why a state that is not an answer is never printed as clean
- [Security hygiene scanning](/guide/security-scanning) — the sibling matcher, and where
  `authorized target` comes from
- [Input-handling testing](/guide/input-handling) — the third scan: same request, different payload,
  and the identity left alone
- [Sessions & auth](/guide/sessions) — `session` blocks and `as <session>`
- [Config & environments](/guide/config) — `privileged` and `probe mutating`
- [CI & reporting](/guide/ci-and-reporting) — `--allow-public-target` alongside the other CI gates
- [Findings, baselines & the gate](/guide/findings-and-baselines) — fingerprints, `--baseline` and
  `--fail-on`: what happens to a finding after a rule raises it
