# 18. Crawling: scanning a surface you did not write down

The three scanning chapters before this one all judge a response your suite asked for. You write an
`api` step, the scan reads what came back. That means your security coverage is exactly as wide as
your test suite — and a test suite is written around the routes people remember.

A **crawl** is the other half. It finds the requests itself, from the surface your application
documents and from the traffic your own tests already produced, and applies the same three assertion
families to every response it gets back.

```tflw
crawl "the v1 API surface" as peer, shopper
  seed openapi "/openapi.json"        # the documented surface
  seed traffic                        # every request this run's own tests made
  exclude "/internal/**"              # drop routes from the discovered set

  expect response has no critical security violations
  expect response has no critical authorization violations
```

Run it with `tflw run`, like everything else. There is no separate subcommand.

## It is a source of requests, not a new kind of judgement

`crawl` is a top-level declaration, a sibling of `test`. What it adds to the language is *where
requests come from*; the `expect` lines inside it are the same three matchers chapters 14–16 already
covered, applying **per response the crawl issues** exactly as they apply per response inside a test.

There is no fourth matcher family and no new subject keyword to learn. A crawl body takes only those
three assertions — anything else is `TF070`, because an `api` step inside a crawl would be a request
nobody sends under a principal nobody chose, and `expect status equals 200` names a single response
that a crawl does not have.

## What `as` means here

The same thing it means on a test. Those sessions are the **owner**: their credentials fold together
in declared order and every request the crawl sends carries them. The authorization scan then
differentiates against every *other* session your config declares.

A crawl walks its surface **once**, not once per name in the list.

## The two seeds find different things, and that is the point

| seed | finds | invents |
| --- | --- | --- |
| `seed openapi "<source>"` | every operation the document describes | path parameters, required query values, request bodies |
| `seed traffic` | every distinct route this run's own tests touched | nothing |

The OpenAPI seed reaches routes nobody wrote a test for — including the ones nobody remembered. It
pays for that by having to make values up: a schema tells you an endpoint accepts a `status` field; it
does not tell you an id that exists. So a synthesized `GET /orders/{id}` usually answers `404`, and
the crawl says so rather than scoring it.

The traffic seed is the opposite. It re-issues requests your suite really made, so the ids are real
and the code behind them runs — but it can only ever be as wide as the suite that ran before it. It
deduplicates by route, so forty calls to `/products/{id}` are one thing to crawl, not forty.

Use both. Each one's blind spot is the other's strength.

`seed openapi` follows the same convention as `expect body matches schema … from "…"`: an absolute
`http(s)://` source is fetched as written, anything else resolves against your default `api` base URL
the way a plain `api GET /path` does.

## Where a documented path actually gets sent

The routes inside the document follow a different rule from the document's own address, and it is worth
one paragraph because getting it wrong is silent.

**A document's paths belong to the document's own server, not to your `api` base.** tflw reads
`servers[0]` and resolves every path against it, keeping the **origin** your `api` names:

| the document says | tflw sends to |
| --- | --- |
| no `servers`, or `[]`, or `/` — and `paths: {"/v1/health"}` | `<your origin>/v1/health` |
| `servers: [{"url": "/v1"}]` and `paths: {"/health"}` | `<your origin>/v1/health` |
| `servers: [{"url": "https://api.example.com/v2"}]` | `<your origin>/v2/…` — the path, never the host |

Those first two rows are the same deployment written two ways, and they reach the same place. The
third is deliberate: a document that names a host is describing where the API lives *under* one, and
which deployment you are testing is your `api` base's decision, not a field that survives a copy-paste
from production.

The practical consequence, if your app sits behind a prefix like NestJS's `setGlobalPrefix('v1')` or a
Spring `context-path`: **your `api` base's own path is not used twice.** A base of
`https://host/v1` and a document describing `/v1/health` still send one `/v1`. Point `api` wherever
your tests need it and the crawl will not double it.

::: warning If the crawl reaches nothing, this is the first thing to check
A crawl that sends requests and reaches none of them **fails** (`TF068`) rather than reporting a green
run over responses it never judged. A wall of `404`s is nearly always an addressing disagreement —
most often a document describing a prefix the host does not actually serve.
:::

## Everything discovered is accounted for

Before a crawl sends anything, it says what it is about to do:

```console
✓ the v1 API surface (crawl, 4210 ms)
    surface: 84 discovered (openapi "http://localhost:4001/openapi.json" → 84) · 31 withheld · 53 sent · 40 reached
```

Those four numbers always satisfy `discovered = withheld + sent`, and `reached ≤ sent`. That identity
is deliberate: a crawler that quietly dropped the routes it could not build would report a smaller
denominator and *look* like better coverage.

- **withheld** — enumerated, disclosed, and not sent. An `exclude`d route, an operation the crawl
  could not build a request for, or a write with no `probe mutating` (below).
- **reached** — sent, and the response landed on real code, so it was judged.

Every route in `discovered - reached` is in `results.json`'s `scanBlindSpot.declines` with the reason
it is there, and in `report.html`'s blind-spot block. The counts and the explanations are in the same
artifact.

## A response that did not reach your code is not scored

This is the rule that keeps a crawl's findings worth reading. A synthesized request can fail before
it reaches anything:

| what came back | judged? | why |
| --- | --- | --- |
| `2xx`, `3xx` | yes | it ran |
| `5xx` | yes | it ran, and crashed |
| `400`, `422` | no | your validator refused the value tflw invented |
| `404`, `405`, `410` | no | usually the invented path parameter does not exist |
| `401`, `403` | no | the crawl's own principal was refused before the route ran |
| `415`, `429` | no | the content type or the rate limit, not the route |

The `400` row is the important one. A validator's refusal is indistinguishable from a hardened
endpoint, so scoring it would let a crawl report a conclusion about code it never reached — a coverage
badge over nothing.

The `401`/`403` row is the subtle one. The authorization oracle compares what the owner got against
what another principal got; if the owner was turned away at the door, there is nothing to compare
against, and reading that refusal as *clean* is the single most common false negative in this kind of
tool.

Findings a crawl does produce carry **`via`** — `openapi` or `traffic` — so a report says how each one
was reached. It is provenance, not identity: the same weakness found by both seeds is one finding with
one fingerprint, so adding a seed never churns your baseline.

## Safety: the same gates, and one you should know about

Everything chapter 11 and chapter 14 describe applies unchanged, and is checked before a crawl runs:

- `authorized target` must name the origin (`TF060`).
- `--allow-public-target` must affirm a public one (`TF065`).
- `authorization violations` still needs an owner to differentiate against (`TF063`).
- A crawl is **strictly sequential** — one request in flight, always.

The one that is specific to crawling: **`probe mutating` gates the crawl's own writes.** Every other
probe in tflw re-issues a request you wrote; a crawl invents requests nobody wrote, and a synthesized
`DELETE /products/{id}` is a different proposition from re-sending a `DELETE` you authored. Affirming
that a scan may run is not affirming that it may write.

```tflw-config
defaults
  authorized target "https://staging.example.com" reason "our staging API"
    probe mutating
env staging
  api "https://staging.example.com"
```

Without that sub-clause, every mutating operation on that origin is enumerated, disclosed and **not
sent** — it shows up in the withheld count with the reason, rather than silently.

## `exclude` is a glob over route paths

```tflw
crawl "the surface, narrowed"
  seed openapi "/openapi.json"
  exclude "/internal/**"      # the whole subtree
  exclude "/admin/*"          # one segment only
  exclude "/products/{id}"    # one route, literally
  expect response has no critical security violations
```

`*` matches inside one path segment, `**` matches across them. Patterns are matched against the route
**template** (`/products/{id}`), never against the filled-in path, so whether a route is excluded can
never depend on the value synthesis happened to invent.

::: tip This is not `tflw.config`'s `exclude`
The config directive of the same name matches file paths by exact equality, because it names files you
have on disk and can spell. A crawl excludes from a set nobody has seen yet — the routes come out of a
document your application generates — so it takes a glob.
:::

## When a crawl finds nothing, it fails

`TF068`, and it fires from two directions: at check time for a crawl that declares no `seed`, and at
run time when the seeds resolve to nothing in fact — a document that answers `404`, a `traffic` seed
on a run whose tests sent nothing, an `exclude` list that happens to cover everything discovered.

It is a failure rather than a green run with a note, for the reason every empty scan in tflw is: every
assertion in that crawl's body would have passed whatever your application did. The `seed` line in the
report says which seed came back empty and why.

The same code covers the case where the surface was fine and **nothing landed**:

```console
✗ crawl "the v1 API surface" sent 31 requests and none of them reached your application
    surface: 81 discovered · 50 withheld · 31 sent · 0 reached
```

Same argument, arrived at from the other end — requests went out, every one was turned away before your
code saw it, and so the body judged nothing. The blind-spot declines say why each was turned away; if
they are `404`s, check that your `api` base and the document's `servers` agree.

## Where it runs

A crawl runs **after every test in its file** and before any `after file` hook, wherever you put the
declaration. `seed traffic` is the traffic the run itself produced, so ordering by position would make
what a crawl discovers depend on where you typed it. `--tag`, `--only` and `--failed` select a crawl
by name exactly as they select a test.
