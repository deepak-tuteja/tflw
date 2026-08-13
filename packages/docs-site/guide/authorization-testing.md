# 15. Authorization testing

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

That is OWASP API #1 — broken object-level authorization, the "authenticated but not authorized"
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

Three more limits worth knowing:

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

- [Security hygiene scanning](/guide/security-scanning) — the sibling matcher, and where
  `authorized target` comes from
- [Sessions & auth](/guide/sessions) — `session` blocks and `as <session>`
- [Config & environments](/guide/config) — `privileged` and `probe mutating`
