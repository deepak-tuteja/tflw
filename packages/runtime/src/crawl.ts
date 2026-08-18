// The crawl (`M137c`, `D435`/`D436`/`D465`) — what happens between a resolved surface and a verdict.
//
// Everything that touches the world is injected (`CrawlDeps`), the same seam `D323` used for the authz
// prober and for the same two reasons: this file establishes no sessions and composes no interpolated
// path, so it is testable without a network; and the interpreter keeps sole ownership of *how* a
// request is built, so a crawl can never disagree with an `api` step about what a request is.
//
// The order of the four things it does is the design:
//
//  1. **Resolve the seeds** — fetch, enumerate, and account for every operation (`crawlSurface.ts`).
//  2. **Decide what may be sent**, and say so *before* sending any of it (`D435`, `D465`). Disclosure
//     is not a summary printed afterwards; a planned total that only exists once the work is done is
//     not a bound on the work.
//  3. **Send, sequentially**, one request in flight at a time — `D435` and `D381`'s *never
//     concurrency*, which is also what keeps `probe rate`'s deferral condition (D21 layer 5) untripped.
//  4. **Judge only what landed on real code** (`D436`). A `400` from a validator is indistinguishable
//     from a hardened endpoint, so scoring one would be the false-negative engine wearing a coverage
//     badge; the route goes to the blind-spot channel instead.

import type { HttpMethod } from '@tflw/lang';
import type { CrawlDecl } from '@tflw/lang';
import { isSafeMethod, mayProbeMutating } from './authzProbe.js';
import type { OpenApiDocument } from './contract.js';
import { documentServerBasePath, enumerateOpenApiSurface, excludedByReason, matchesRoutePattern, normalizeTemplate, type CrawlRequestPlan, type CrawlSurfaceSkip } from './crawlSurface.js';
import { SPIDER_DEFAULTS, walkSpiderSurface, type SpiderPage } from './spiderSurface.js';
import type { CrawlVia } from './scanFindings.js';
import type { CrawlSurfaceReport, RequestTrace, ResolvedConfig, ResponseTrace, StepResult } from './types.js';

/** One request the crawl decided to send, resolved to a real URL. */
export interface CrawlRequest {
  readonly method: string;
  /** Absolute, or a path resolved against `base` — falling back to the default service's base URL, the
   *  same rule `api GET /path` follows, so a traffic-seeded request that came from another origin keeps
   *  its own address. */
  readonly path: string;
  /** `M137c1` (`D480`) — the base an **openapi**-seeded path resolves against: the configured origin
   *  plus whatever prefix the *document's* own `servers` entry declares. Present only for that seed,
   *  because it is the only one whose paths come out of a document with its own opinion about where
   *  they hang. Absent for `seed traffic`, whose paths are already absolute URLs this run really sent.
   *
   *  It is a separate field rather than being folded into `path` so that a report line stays
   *  `GET /v1/health` — the thing an author recognises — while the request goes where the document
   *  says. */
  readonly base?: string;
  readonly body?: string;
  readonly contentType?: string;
}

/** Everything the crawl needs from the world (`D323`'s seam). */
export interface CrawlDeps {
  /** `seed openapi "<source>"` — resolves and fetches. Rejects for a document that will not load,
   *  which is a `TF068` runtime cause rather than a crash. */
  readonly loadDocument: (source: string) => Promise<{ readonly url: string; readonly document: OpenApiDocument }>;
  /** `seed traffic` — every request this run's own tests have made so far, in order. */
  readonly capturedTraffic: () => readonly RequestTrace[];
  /** Resolves `request.path` and sends. Applies `allow hosts`, the blocked-port list, the session's
   *  credential and the cookie jar — none of which this file knows about. */
  readonly send: (request: CrawlRequest) => Promise<{ readonly request: RequestTrace; readonly response: ResponseTrace }>;
  /** Runs the crawl's body against one exchange: one `StepResult` per body step, `ok: false` on any
   *  assertion that failed. `via` is `D437`'s provenance — which seed reached this route — and it is a
   *  parameter rather than something the judge could look up, because it is a fact about the *route*
   *  and the judge only ever sees one exchange. */
  readonly judge: (request: RequestTrace, response: ResponseTrace, via: CrawlVia) => Promise<readonly StepResult[]>;
  /** `seed spider "<root>"` — retrieves one page and reports where it actually ended up, so links are
   *  joined against the final URL rather than the requested one (`M137f`). Separate from `send`
   *  because the walk is a phase of its own (`D483`) and its traffic is counted in its own field, not
   *  in `sent`. It goes down the same request path all the same, which is what gives the spider
   *  `allow hosts`, the blocked-port list and `authorized target` for free. */
  readonly fetchPage: (url: string) => Promise<SpiderPage>;
  /** `RunReport.scanBlindSpot.declines` — what the crawl met and turned down, aggregated by reason. */
  readonly decline: (subject: string, reason: string) => void;
  /** A report line. `request`/`response` are attached to the `api` steps so `report.html` renders the
   *  same request/response panels it renders for an authored step. */
  readonly step: (
    kind: 'seed' | 'api',
    source: string,
    ok: boolean,
    detail: string,
    evidence?: { readonly request: RequestTrace; readonly response: ResponseTrace; readonly endpoint: string },
  ) => StepResult;
}

export interface CrawlOutcome {
  readonly steps: readonly StepResult[];
  readonly ok: boolean;
  readonly error?: string;
  readonly surface: CrawlSurfaceReport;
}

/** One seed's contribution, after resolution. */
interface ResolvedSeed {
  readonly seed: CrawlVia;
  readonly source?: string;
  readonly requests: readonly CrawlRequestPlan[];
  readonly skipped: readonly CrawlSurfaceSkip[];
  /** `D480` — the base this seed's paths resolve against. Set for `openapi` (origin + the document's
   *  own declared prefix), absent for `traffic` (already absolute). */
  readonly base?: string;
  /** Set when the seed itself did not resolve — a document that would not load, a `traffic` seed on a
   *  run whose tests sent nothing. Its own field rather than a thrown error, because one broken seed
   *  must not discard what a working one found (`probePrincipalFor`'s rule, applied to seeds). */
  readonly failure?: string;
  /** `M137f`/`D483` — set by the spider seed alone: pages fetched, and whether the walk was truncated. */
  readonly walked?: number;
  readonly walkCapped?: boolean;
}

export async function runCrawl(crawl: CrawlDecl, config: ResolvedConfig, deps: CrawlDeps): Promise<CrawlOutcome> {
  const steps: StepResult[] = [];
  const seeds = await resolveSeeds(crawl, config, deps);

  const discovered = seeds.reduce((n, s) => n + s.requests.length + s.skipped.length, 0);
  const surfaceSeeds = seeds.map((s) => ({ seed: s.seed, ...(s.source ? { source: s.source } : {}), discovered: s.requests.length + s.skipped.length }));

  // `D483`'s second total. Aggregated across seeds because a crawl may declare more than one spider,
  // and left **absent** rather than zero when none did — a report carrying `walked: 0` for a phase
  // that never existed reads as a walk that found nothing, which is a different fact.
  const walkedSeeds = seeds.filter((s) => s.walked !== undefined);
  const walkFigures =
    walkedSeeds.length === 0
      ? {}
      : { walked: walkedSeeds.reduce((n, s) => n + (s.walked ?? 0), 0), walkCapped: walkedSeeds.some((s) => s.walkCapped === true) };

  // Every operation an enumerator refused, into the blind-spot channel with the reason that refused
  // it. Done before the gate below so the report's arithmetic holds even for a crawl that sends
  // nothing: `discovered` is accounted for whatever happens next.
  for (const seed of seeds) {
    for (const skip of seed.skipped) deps.decline(`${skip.method} ${skip.template}`, skip.reason);
  }

  // `D465` — the crawl's own writes are gated by `probe mutating`, the opt-in `D330` already added for
  // exactly this question. Every prober in this arc re-issues a request its author wrote; a crawl
  // invents one nobody wrote, and `authorized target` answers *may I scan this origin*, never *may I
  // write to it*. Resolved per request rather than once, because the grant is per origin and a
  // traffic-seeded surface can span several.
  //
  // Each survivor is paired with the seed that found it rather than carrying provenance on the plan
  // itself: which seed reached a route is a fact about the *seed*, and a `CrawlRequestPlan` describes a
  // request. `D437`'s discriminator rides from here to the assertion that judges the response.
  const sendable: { readonly plan: CrawlRequestPlan; readonly via: CrawlVia; readonly base?: string }[] = [];
  let withheldMutating = 0;
  for (const seed of seeds) {
    for (const plan of seed.requests) {
      if (plan.mutating && !mayProbeMutating(absoluteFor(plan.path, seed.base, config), config.authorizedTargets)) {
        withheldMutating++;
        deps.decline(
          `${plan.method} ${plan.template}`,
          'a synthesized write, and this origin\'s `authorized target` does not declare `probe mutating` — affirming a scan is not affirming writes (`D330`/`D465`)',
        );
        continue;
      }
      sendable.push({ plan, via: seed.seed, ...(seed.base === undefined ? {} : { base: seed.base }) });
    }
  }

  const withheld = discovered - sendable.length;

  // `D435`'s disclosure, and it is emitted **before the first request goes out**. A planned total that
  // only exists once the work is finished is a report, not a bound; this is also the one step a crawl
  // has when nothing has been sent yet, so a run interrupted immediately still says what it was about
  // to do. One line per seed, because a reader debugging an empty crawl needs to know *which* seed
  // came back with nothing.
  for (const seed of seeds) {
    const found = seed.requests.length + seed.skipped.length;
    const label = `seed ${seed.seed}${seed.source ? ` "${seed.source}"` : ''}`;
    const walk = seed.walked === undefined ? '' : ` (${seed.walked} page${seed.walked === 1 ? '' : 's'} walked${seed.walkCapped ? ', TRUNCATED at its cap' : ''})`;
    const detail = seed.failure
      ? `${label} → nothing: ${seed.failure}`
      : `${label} → ${found} operation${found === 1 ? '' : 's'} discovered, ${seed.skipped.length} not sendable${walk}`;
    steps.push(deps.step('seed', label, seed.failure === undefined, detail));
  }
  const plannedDetail =
    `${discovered} discovered · ${withheld} withheld (${withheld - withheldMutating} the seeds could not build, ${withheldMutating} mutating with no \`probe mutating\`) · ` +
    `${sendable.length} to send, one at a time`;
  steps.push(deps.step('seed', `crawl "${crawl.name.value}"`, true, plannedDetail));

  // `TF068`'s **runtime** door (`D443`). The checker refuses a crawl that declares no `seed`; this is
  // the same repair for the same mistake arrived at from the other side — the seeds are there and the
  // surface they resolve to is empty, which is a fact about this run rather than about the file. One
  // code, because the sentence an author has to act on is identical: *give the crawl something to
  // crawl*.
  if (sendable.length === 0) {
    const why = seeds.map((s) => `${s.seed}: ${s.failure ?? (s.requests.length + s.skipped.length === 0 ? 'discovered nothing' : 'discovered nothing it could send')}`).join('; ');
    return {
      steps,
      ok: false,
      error:
        `crawl "${crawl.name.value}" has nothing to crawl — its seeds resolved to no sendable request (${why}). ` +
        'Every assertion in its body would pass whatever the application did, so the crawl fails rather than reporting green over an empty surface (SPEC §9.15, `TF068`, D285)',
      surface: { discovered, withheld, sent: 0, reached: 0, seeds: surfaceSeeds, ...walkFigures },
    };
  }

  let ok = true;
  let sent = 0;
  let reached = 0;
  // Strictly sequential, and the `for … of await` shape is the assertion: `D435` keeps the crawl to
  // one request in flight, `authz-probe-pacing.test.ts:101`'s `maxInFlight() === 1` remains the
  // tripwire for the prober, and `probe rate` (D21 layer 5) stays deferred with its condition unmet.
  for (const { plan, via, base } of sendable) {
    const source = `${plan.method} ${plan.path}`;
    let exchange: { request: RequestTrace; response: ResponseTrace };
    try {
      exchange = await deps.send({ method: plan.method, path: plan.path, ...(base === undefined ? {} : { base }), ...(plan.body !== undefined ? { body: JSON.stringify(plan.body), contentType: plan.contentType ?? 'application/json' } : {}) });
    } catch (err) {
      // A refusal (`allow hosts`, a blocked port) and a connection failure both land here, and both
      // are the same thing from the crawl's point of view: a question it could not ask. It is not a
      // crawl failure — one unreachable route out of eighty is a blind spot, not a verdict — so the
      // reason is recorded and the walk continues.
      const reason = err instanceof Error ? err.message : String(err);
      deps.decline(`${plan.method} ${plan.template}`, `the request could not be sent: ${reason}`);
      steps.push(deps.step('api', source, true, `${source} → not sent: ${reason}`));
      continue;
    }
    sent++;
    const invented = plan.invented.length > 0 ? ` (tflw invented ${plan.invented.join(', ')})` : '';
    const landing = reachability(exchange.response.status, plan.invented.length > 0);
    const endpoint = `${plan.method} ${plan.template}`;
    if (!landing.reached) {
      // `D436`'s gate. The response exists and is *not* judged, which is the whole point: scoring a
      // validator's `400` would report a conclusion about code that never ran.
      deps.decline(endpoint, landing.reason);
      steps.push(deps.step('api', source, true, `${source} → ${exchange.response.status} (${exchange.response.durationMs}ms)${invented} — not judged: ${landing.reason}`, { ...exchange, endpoint }));
      continue;
    }
    reached++;
    steps.push(deps.step('api', source, true, `${source} → ${exchange.response.status} (${exchange.response.durationMs}ms)${invented}`, { ...exchange, endpoint }));
    const judged = await deps.judge(exchange.request, exchange.response, via);
    steps.push(...judged);
    if (judged.some((s) => !s.ok)) ok = false;
  }

  // `TF068`'s **fourth** runtime cause (`D481`), and the one the other three could not have caught: the
  // seeds resolved, the surface was real, requests went out — and not one of them landed on the
  // application, so every assertion in this crawl's body passed having judged nothing. The engine had
  // both numbers, printed them, and returned success; that is what this closes.
  //
  // One code rather than a new one, per `D456`: `spec-data.ts`'s probes execute through the checker, so
  // a diagnostic with no check-time door has nothing `verify-check-diagnostics.mjs` can run — which is
  // why `TF069` was withdrawn. `TF068` already carries one check-time door and three runtime causes,
  // each with its own sentence. This is a fourth sentence, not a fourth code.
  //
  // Deliberately `sent > 0`, not `discovered > 0`: an all-withheld surface judged nothing too, but its
  // withholding is already explicit and per route, and failing there would break the documented
  // workflow of crawling a surface you have chosen not to authorize writes to. Deferred on a condition
  // (`D481`): the first report of a crawl read as clean whose entire surface was withheld.
  if (sent > 0 && reached === 0) {
    return {
      steps,
      ok: false,
      error:
        `crawl "${crawl.name.value}" sent ${sent} request${sent === 1 ? '' : 's'} and none of them reached your application. ` +
        'Every assertion in its body passed having judged no response, so the crawl fails rather than reporting green over a surface it never touched. ' +
        "The blind-spot declines say why each one was turned away; if they are `404`s, check that your `api` base and the document's own `servers` agree " +
        '(SPEC §9.15, `TF068`, D285)',
      surface: { discovered, withheld, sent, reached, seeds: surfaceSeeds, ...walkFigures },
    };
  }

  return { steps, ok, surface: { discovered, withheld, sent, reached, seeds: surfaceSeeds, ...walkFigures } };
}

/**
 * `D436` — did this request land on **real code**?
 *
 * The question is not *did it succeed*. A `500` reached real code and is scoreable (and interesting);
 * a `400` did not, and neither did a `404` on a route whose id the crawl invented. What every
 * unreached status has in common is that the response describes the *request* rather than the
 * application's behaviour, so an oracle reading it would be comparing tflw's guesses.
 *
 * `401`/`403` are the sharp pair, and they are **unreached on purpose**. Tier 2's oracle compares what
 * the owner got against what another principal got; if the crawl's own declared principal was refused
 * before the route ran, there is nothing to compare against, and reading that refusal as clean is
 * `M130-01` exactly — the false negative this arc has been closing all the way through.
 */
export function reachability(status: number, invented = true): { readonly reached: true } | { readonly reached: false; readonly reason: string } {
  if (status >= 500) return { reached: true };
  if (status >= 200 && status < 400) return { reached: true };
  if (status === 401 || status === 403) {
    return { reached: false, reason: `the crawl's own principal was refused (${status}) before the route's code ran, so there is no behaviour to compare against — reading that as clean is \`M130-01\`` };
  }
  if (status === 400 || status === 422) {
    return { reached: false, reason: `the synthesized request was rejected as invalid (${status}), so nothing behind the validator ran — a validator's refusal is indistinguishable from a hardened endpoint` };
  }
  if (status === 404 || status === 405 || status === 410) {
    // `M137c1` — the reason branches on whether anything was actually invented, and that is not a
    // nicety. Before `D480` was found, all 31 of these on the dogfood target read *"the value tflw
    // invented for a path parameter does not exist"* — including on `GET /v1/health`, which has no
    // path parameter and where nothing was invented at all. A reason that names a cause the request
    // cannot have sends the reader to synthesis and away from the actual defect, which was the base.
    return {
      reached: false,
      reason: invented
        ? `no route answered (${status}) — for a synthesized path this usually means the value tflw invented for a path parameter does not exist`
        : `no route answered (${status}), and this request had nothing invented in it — so the path itself is not served here. Check that your \`api\` base and the document's own \`servers\` agree: a crawl resolves paths against the document, so a base carrying a prefix the document also carries dials it twice`,
    };
  }
  if (status === 415) return { reached: false, reason: 'the route refused the content type the crawl synthesized (415)' };
  if (status === 429) return { reached: false, reason: 'the target rate-limited this request (429), so its response is about pacing rather than about the route' };
  return { reached: false, reason: `the request was refused before the route's code ran (${status})` };
}

/** `D480` — the configured **origin**, plus the prefix the document itself declares. `undefined` when
 *  no `api` base is configured or it will not parse, which leaves the sender on its existing fallback
 *  rather than inventing an origin: a base guessed from nothing is how a scan reaches a host nobody
 *  named. */
function openApiBase(document: OpenApiDocument, config: ResolvedConfig): string | undefined {
  if (!config.apiBaseUrl) return undefined;
  let origin: string;
  try {
    origin = new URL(config.apiBaseUrl).origin;
  } catch {
    return undefined;
  }
  return origin + documentServerBasePath(document);
}

async function resolveSeeds(crawl: CrawlDecl, config: ResolvedConfig, deps: CrawlDeps): Promise<ResolvedSeed[]> {
  const out: ResolvedSeed[] = [];
  const excludes = crawl.excludes.map((e) => e.value);
  for (const seed of crawl.seeds) {
    if (seed.type === 'OpenApiSeed') {
      try {
        const { url, document } = await deps.loadDocument(seed.source.value);
        const surface = enumerateOpenApiSurface(document, excludes);
        // `D480` — the document decides where its own paths hang, and the configured origin decides
        // which deployment they hang on. The `api` base's *path* takes no part in this: it is the one
        // ingredient that was being used before, and using it is what dialled `/v1/v1/…`.
        const base = openApiBase(document, config);
        out.push({ seed: 'openapi', source: url, requests: surface.requests, skipped: surface.skipped, ...(base === undefined ? {} : { base }) });
      } catch (err) {
        // A document that 404s, 500s, or comes back as HTML is the commonest way a crawl finds
        // nothing, and it must say *that* rather than "no routes" — `TF068`'s hint sends an author to
        // their seed, and this is the sentence that tells them which seed and why.
        out.push({ seed: 'openapi', source: seed.source.value, requests: [], skipped: [], failure: err instanceof Error ? err.message : String(err) });
      }
      continue;
    }
    if (seed.type === 'TrafficSeed') {
      const surface = trafficSurface(deps.capturedTraffic(), excludes);
      out.push({
        seed: 'traffic',
        requests: surface.requests,
        skipped: surface.skipped,
        ...(surface.requests.length === 0 && surface.skipped.length === 0
          ? { failure: 'this run\'s own tests made no request the crawl could re-issue — a `traffic` seed is only as large as the suite that ran before it' }
          : {}),
      });
      continue;
    }
    if (seed.type === 'SpiderSeed') {
      const caps = {
        maxPages: seed.maxPages ? seed.maxPages.value : SPIDER_DEFAULTS.maxPages,
        maxDepth: seed.maxDepth ? seed.maxDepth.value : SPIDER_DEFAULTS.maxDepth,
      };
      const root = absoluteFor(seed.root.value, undefined, config);
      // `D483`'s first disclosure, and it is emitted **here**, before a single page is fetched. The
      // walk is the one phase whose total cannot be known in advance — that is `D435`'s "browser half
      // — bound it" — so what precedes it is the *cap* rather than the count. The property `D435` was
      // protecting is unchanged: nothing goes out before a line saying what may.
      deps.step(
        'seed',
        `seed spider "${seed.root.value}"`,
        true,
        `walking ${root} — at most ${caps.maxPages} page${caps.maxPages === 1 ? '' : 's'}, depth <= ${caps.maxDepth}, same-origin only`,
      );
      try {
        const surface = await walkSpiderSurface(root, excludes, caps, deps.fetchPage);
        if (surface.blindSpot) deps.decline(root, surface.blindSpot);
        out.push({
          seed: 'spider',
          source: root,
          requests: surface.requests,
          skipped: surface.skipped,
          walked: surface.walked,
          walkCapped: surface.walkCapped,
          ...(surface.walked === 0 ? { failure: 'the walk fetched no page — the spider root did not resolve to anything readable' } : {}),
        });
      } catch (err) {
        out.push({ seed: 'spider', source: root, requests: [], skipped: [], walked: 0, walkCapped: false, failure: err instanceof Error ? err.message : String(err) });
      }
      continue;
    }
    // `M137f` — exhaustive on purpose, and the previous shape is why. Until now this loop ended in an
    // **unconditional** traffic branch: anything that was not an `OpenApiSeed` fell through to
    // `trafficSurface`. That was correct while the union had exactly two members and silently wrong
    // the instant it had three — adding `SpiderSeed` to `CrawlSeed` compiled clean across every
    // package and would have resolved `seed spider "/admin"` **as a traffic seed**, reporting
    // `seed: 'traffic'` for a line the author did not write, with no error anywhere. A default branch
    // that happens to be a real behaviour is the failure mode a `never` check exists to prevent, so
    // the third member arrives together with the guard that would have caught it.
    const unreached: never = seed;
    throw new Error(`unhandled crawl seed: ${JSON.stringify(unreached)}`);
  }
  return out;
}

/**
 * `seed traffic` — the run's own requests, as a surface.
 *
 * **Deduplicated by method + normalized template**, which is the difference between a seed and a
 * replay: forty `GET /products/{id}` calls across a suite are one thing to crawl, and re-issuing all
 * forty would multiply the run's traffic by the size of its own test suite for no extra information.
 * The first occurrence wins, so the concrete path and body the crawl sends are ones the suite really
 * used — the opposite of the openapi seed's problem, and why this seed reaches code the other cannot.
 *
 * Nothing here is invented, so `invented` is empty on every entry: that is the whole distinction the
 * report is drawing between these two seeds.
 */
function trafficSurface(traffic: readonly RequestTrace[], excludes: readonly string[]): { requests: CrawlRequestPlan[]; skipped: CrawlSurfaceSkip[] } {
  const requests: CrawlRequestPlan[] = [];
  const skipped: CrawlSurfaceSkip[] = [];
  const seen = new Set<string>();
  for (const request of traffic) {
    let template: string;
    try {
      template = normalizeTemplate(new URL(request.url).pathname);
    } catch {
      continue;
    }
    const key = `${request.method} ${template}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const excludedBy = excludes.find((pattern) => matchesRoutePattern(template, pattern));
    if (excludedBy !== undefined) {
      skipped.push({ method: request.method, template, reason: excludedByReason(excludedBy) });
      continue;
    }
    const method = HTTP_METHODS.find((m) => m === request.method.toUpperCase());
    if (!method) {
      skipped.push({ method: request.method, template, reason: 'tflw has no step for this method, so a crawl cannot re-issue it' });
      continue;
    }
    // A captured body has to be re-sendable as the same JSON the suite sent, and the plan carries a
    // *value* rather than bytes — one representation, so nothing can double-encode. A form-encoded or
    // multipart body therefore cannot be carried, and the operation is refused with the content type
    // named rather than re-issued bodiless: a `POST` sent without its body produces a `400`, which
    // this crawl would then correctly record as unreachable, having learned nothing.
    let body: unknown;
    if (request.body !== undefined && request.body !== '') {
      try {
        body = JSON.parse(request.body);
      } catch {
        const contentType = Object.entries(request.headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? 'an unnamed content type';
        skipped.push({ method, template, reason: `its captured body is \`${contentType}\`, and the crawl re-issues JSON bodies only` });
        continue;
      }
    }
    requests.push({
      method,
      template,
      // The absolute URL, not the path: a suite talking to two services captured requests to both, and
      // resolving this one against the default base would silently retarget it. The sender follows
      // `api GET /path`'s own rule — absolute passes through.
      path: request.url,
      ...(body === undefined ? {} : { body, contentType: 'application/json' }),
      mutating: !isSafeMethod(method),
      invented: [],
    });
  }
  return { requests, skipped };
}

const HTTP_METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

/** The URL a plan's `path` will resolve to, for the one decision that needs it before the request is
 *  built: `D465`'s per-origin `probe mutating` lookup. Absolute passes through; a bare path takes the
 *  default service's base, which is the only base a crawl-synthesized path can mean. A base that is
 *  not configured yields the path itself, and `mayProbeMutating` refuses anything it cannot parse —
 *  permission is never inferred from something that failed to parse. */
function absoluteFor(path: string, base: string | undefined, config: ResolvedConfig): string {
  if (/^https?:\/\//i.test(path)) return path;
  const resolved = base ?? config.apiBaseUrl;
  return resolved ? resolved + (path.startsWith('/') ? path : `/${path}`) : path;
}
