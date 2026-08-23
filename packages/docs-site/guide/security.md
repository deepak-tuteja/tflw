# Security & vulnerability testing

Three of the chapters in this pillar ask a different question about the same thing — the response
your test already fetched. What does it say about itself? Can somebody else fetch it? What does the
endpoint behind it do when the input is not what it expected? A fourth finds responses your suite
never asked for, and a fifth is about what happens to everything the first four raise.

None of it is a separate tool or a separate run. Every one of these is an assertion inside an
ordinary `test`, evaluated by `tflw run` alongside your functional suite, and reported in the same
`report.html`.

## What each chapter answers

| chapter | the question it answers |
| --- | --- |
| [Hygiene scanning](/guide/security-scanning) | what does this response say about itself? |
| [Authorization testing](/guide/authorization-testing) | can somebody who should not have it fetch this? |
| [Input-handling testing](/guide/input-handling) | what does the endpoint do with input it did not expect? |
| [Crawling an undocumented surface](/guide/crawling) | what about the routes nobody wrote a test for? |
| [Findings, baselines & the gate](/guide/findings-and-baselines) | a finding exists — now what? |

Read them in that order. The first three are the matchers, the fourth is a different way of
producing responses for those same matchers to judge, and the fifth is the machinery all four feed.

## Three questions, one response

The first three chapters each teach their matcher alone. Together they are three lines:

```tflw
test "an order is safe, private, and hard to confuse" as shopper
  api GET /orders
  capture body[0].id as orderId

  api GET /orders/{orderId}
  expect response has no security violations
  expect response has no authorization violations
  expect response has no input handling violations
```

The subject is the same word three times, and it means the same thing three times — **the response
the `api` step above actually received**. What changes is what each matcher does with it: one reads
the response, one re-sends the request as a different principal, one re-sends it with the payload
altered. Their chapters are where those differences live, and the differences matter enough that
folding the three into one matcher was rejected.

Note the ordinary two-step setup above them. A scan is not pointed at a URL from a config file; it
judges a request your suite made, under an identity your suite chose, against a resource your suite
knows the owner of. That is the whole reason these live in a test rather than in a scanner.

## The order you adopt this in

Each chapter is written to be read alone, so the sequence across them is easy to miss. It is four
steps, and skipping the first is a `TF060` and skipping the last is why scanners get switched off:

1. **Declare what you are allowed to scan.** One `authorized target` line with a written reason, in
   `tflw.config` — see [Config & environments](/guide/config) for where it goes and
   [hygiene scanning](/guide/security-scanning) for what it affirms.
2. **Add one matcher to one test** and read what comes back, including the counts on the passing
   line. A green scan that says how much it checked is the point of the format.
3. **Record what is already there.** `--baseline-write` on the first run against an existing
   application, so today's findings do not have to be fixed today —
   [Findings, baselines & the gate](/guide/findings-and-baselines).
4. **Turn it into a gate.** `--fail-on`, the exit code and, if you use GitHub code scanning,
   `findings.sarif` — the same chapter, then [CI, reporting &
   safety](/guide/ci-and-reporting).

Step 3 is the one people skip, and it is the one that decides whether any of this is still running
in a month.

## Where to go next

- **Start here:** [Hygiene scanning](/guide/security-scanning) — the smallest thing that works, and
  the chapter that introduces the declaration all four scans need.
- **The highest-value scan:** [Authorization testing](/guide/authorization-testing). It is the one
  class of flaw a scanner cannot find on its own, because only your suite knows who owns what.
- **A surface with no test coverage:** [Crawling an undocumented
  surface](/guide/crawling).
- **The other pillars:** [Functional testing](/guide/functional) and [Performance
  testing](/guide/performance).
