// The spider (`M137f`, `D442`/`D483`) — a surface discovered by **fetching and parsing**, not by
// rendering.
//
// That is a scope statement about capability and, first, a safety one. Every gate this arc built lives
// on the request path — `allow hosts` (re-checked inside every prober), the blocked-port list,
// `authorized target`/`TF060`, `publicTargetRefusal`, and the strictly-sequential pacing that keeps
// `probe rate`'s deferral condition (D21 layer 5) untripped. A spider that issues ordinary requests
// inherits all of them for free; a Playwright-driven crawl would have had to re-establish every one at
// a different layer, which is `D442`'s central argument and the reason the browser engine is absent.
//
// It is also the first seed whose **enumeration is itself traffic** (`D483`). `seed openapi` fetches
// one document and `seed traffic` fetches nothing, so both resolve before the crawl discloses what it
// will send. A spider cannot: the only way to learn `/admin/orders` exists is to fetch `/admin` and
// read it. Hence the walk is a phase of its own, bounded by a cap that is disclosed before it starts —
// see `walkSpiderSurface`'s contract, which reports `walked` and `walkCapped` so a truncated walk can
// never read as a complete one.
//
// Nothing here touches the network directly. `fetchPage` is injected, the same `D323` seam the rest of
// the crawl uses, so this file is testable without a server and the interpreter keeps sole ownership
// of how a request is actually built.

import type { HttpMethod } from '@tflw/lang';
import { isSafeMethod } from './authzProbe.js';
import { excludedByReason, matchesRoutePattern, normalizeTemplate, type CrawlRequestPlan, type CrawlSurfaceSkip } from './crawlSurface.js';

/**
 * `D435`'s "browser half — bound it", as numbers.
 *
 * **Defaults, not limits.** An author who has walked their own console knows its shape better than
 * this file does, which is why `seed spider` takes `max pages` and `max depth` as declared
 * sub-clauses. These are what a crawl uses when they are absent.
 *
 * The values are deliberately modest. A default that silently truncates is the failure `walkCapped`
 * exists to make visible, and the honest way to raise one is to walk a real target and argue from what
 * it turns out to contain — not to pick a large number in advance so the question never comes up.
 */
export interface SpiderCaps {
  readonly maxPages: number;
  readonly maxDepth: number;
}

export const SPIDER_DEFAULTS: SpiderCaps = { maxPages: 50, maxDepth: 3 };

/** One page the walk retrieved, as the walker needs it. `url` is the **final** URL, so a redirect is
 *  resolved before links are joined against it — joining against the requested URL is how a spider
 *  ends up inventing paths that never existed. */
export interface SpiderPage {
  readonly url: string;
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
}

export interface SpiderSurface {
  readonly requests: readonly CrawlRequestPlan[];
  readonly skipped: readonly CrawlSurfaceSkip[];
  /** Pages actually fetched. `D483`'s second total: it sits **beside** `discovered = withheld + sent`
   *  rather than inside it, because a fetched page is not an operation and folding it in would either
   *  break that identity or back-fill every page as a discovered operation it may not correspond to. */
  readonly walked: number;
  /** True when the walk stopped on a bound rather than on running out of links. `D435` requires that
   *  truncation is reported *as* truncation, so this is a field and not a log line. */
  readonly walkCapped: boolean;
  /** Set when the walk found no link and no form at all — the SPA case (`D442`). Not an error: an
   *  origin that needs rendering to crawl is a real limitation, and the honest treatment is a graded
   *  visible gap rather than a silent zero. */
  readonly blindSpot?: string;
}

/** Schemes a spider must never follow. `javascript:` and `data:` are not addresses, `mailto:`/`tel:`
 *  are not HTTP, and a fragment-only `href` is the page it is already on. */
const UNFOLLOWABLE = /^(?:javascript|data|mailto|tel|blob|about):/i;

/**
 * Walk from `root`, breadth-first, and return the surface it found.
 *
 * **Breadth-first is the design, not a convenience.** `max depth` only means anything against a
 * traversal that finishes each level before starting the next; depth-first with a page cap would
 * return one arbitrary deep spine of the site and call it a surface. Breadth-first truncates by
 * *distance from the root*, which is the bound an author who wrote `max depth 3` was asking for.
 *
 * **Same-origin, and the boundary is the root's origin.** A crawl is authorized per origin
 * (`authorized target`), so following a link off-site would probe a host nobody affirmed — the one
 * failure `D442` cannot delegate to the request path, because by the time `send` refuses it the spider
 * has already decided to ask. Off-origin links are recorded as skips rather than dropped, so a console
 * that mostly links elsewhere reports that fact.
 */
export async function walkSpiderSurface(
  root: string,
  excludes: readonly string[],
  caps: SpiderCaps,
  fetchPage: (url: string) => Promise<SpiderPage>,
): Promise<SpiderSurface> {
  const origin = originOf(root);
  const requests: CrawlRequestPlan[] = [];
  const skipped: CrawlSurfaceSkip[] = [];
  const seenPage = new Set<string>();
  const seenPlan = new Set<string>();
  let walked = 0;
  let walkCapped = false;
  let sawAnyLink = false;

  let frontier: string[] = [stripFragment(root)];
  seenPage.add(frontier[0]!);

  for (let depth = 0; depth <= caps.maxDepth && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const url of frontier) {
      if (walked >= caps.maxPages) {
        walkCapped = true;
        break;
      }
      let page: SpiderPage;
      try {
        page = await fetchPage(url);
      } catch (err) {
        // A refusal (`allow hosts`, a blocked port) and a connection failure are the same thing from
        // the walk's point of view: a page it could not read. One unreadable page is a blind spot, not
        // a verdict, so it is recorded and the walk continues — `runCrawl`'s rule for a send that
        // throws, applied one phase earlier.
        skipped.push({ method: 'GET', template: templateOf(url), reason: `the page could not be fetched: ${err instanceof Error ? err.message : String(err)}` });
        continue;
      }
      walked++;

      // Every page the walk retrieves is itself a route the crawl should probe — it is a real URL the
      // application served, which is the one thing the openapi seed can never guarantee. Recorded
      // before the content-type gate below, because a JSON endpoint reached by a link is still a
      // route even though it has no links to give back.
      addPlan(requests, seenPlan, skipped, excludes, { method: 'GET', url: page.url, origin });

      if (!/\btext\/html\b/i.test(page.contentType)) {
        // Not an error and not a skip of the *route* — the route was just added. This only says the
        // walk cannot continue through it, which is why it carries no `skipped` entry: a JSON response
        // with no links is the expected shape of half a console's endpoints, and reporting each as a
        // decline would bury the declines that mean something.
        continue;
      }

      const { links, forms } = parseHtml(page.body, page.url);
      if (links.length > 0 || forms.length > 0) sawAnyLink = true;

      for (const form of forms) {
        addPlan(requests, seenPlan, skipped, excludes, { method: form.method, url: form.action, origin, body: form.body, contentType: form.contentType, invented: form.invented });
      }

      for (const link of links) {
        if (originOf(link) !== origin) {
          skipped.push({ method: 'GET', template: link, reason: 'off-origin — a crawl is authorized per origin, and following this would probe a host no `authorized target` affirmed' });
          continue;
        }
        const clean = stripFragment(link);
        if (seenPage.has(clean)) continue;
        seenPage.add(clean);
        next.push(clean);
      }
    }
    if (walked >= caps.maxPages && next.length > 0) walkCapped = true;
    if (walkCapped) break;
    frontier = next;
  }

  // Depth exhausted with pages still queued is truncation too, and it is the one an author is most
  // likely to hit without noticing — `max depth` has a default and `max pages` is generous.
  if (frontier.length > 0 && !walkCapped) walkCapped = true;

  return {
    requests,
    skipped,
    walked,
    walkCapped,
    ...(walked > 0 && !sawAnyLink
      ? {
          blindSpot:
            'the walk fetched pages but found no link and no form — this origin is very likely client-rendered, and a fetching spider cannot see routes that only exist after JavaScript runs (`D442`). ' +
            'Recorded as a gap rather than reported as an empty surface, because a scan that saw nothing and a site that has nothing are different facts',
        }
      : {}),
  };
}

/** Adds one discovered request, deduplicated by method + normalized template and filtered by the
 *  crawl's `exclude` patterns — the same two rules the traffic seed applies, for the same reasons. */
function addPlan(
  requests: CrawlRequestPlan[],
  seen: Set<string>,
  skipped: CrawlSurfaceSkip[],
  excludes: readonly string[],
  found: { method: HttpMethod; url: string; origin: string; body?: string; contentType?: string; invented?: readonly string[] },
): void {
  if (originOf(found.url) !== found.origin) return;
  const template = templateOf(found.url);
  const key = `${found.method} ${template}`;
  if (seen.has(key)) return;
  seen.add(key);
  if (excludes.some((pattern) => matchesRoutePattern(template, pattern))) {
    skipped.push({ method: found.method, template, reason: excludedByReason(excludes.find((p) => matchesRoutePattern(template, p))!) });
    return;
  }
  requests.push({
    method: found.method,
    template,
    // **The absolute URL, not the path** — and this is `D480`'s defect one seed later, caught on the
    // spider's first live run against the console. A relative `CrawlRequestPlan.path` is resolved by
    // the interpreter against the *default* `api` base, so a route walked on `localhost:8091` was
    // dialled at `localhost:4001/v1/login` and answered `404`. Every probe came back unreached, which
    // `D481` correctly turned into a red crawl rather than a green one.
    //
    // The traffic seed already had the right shape for the same reason: a request it re-issues carries
    // the origin it was captured from. A walked page is the same kind of fact — an address the
    // application really served — so it travels absolute and needs no `base`. `template` stays the
    // path, because that is the route's identity and what a reader recognises in the report.
    path: found.url,
    mutating: !isSafeMethod(found.method),
    invented: found.invented ?? [],
    ...(found.body === undefined ? {} : { body: found.body, contentType: found.contentType ?? 'application/x-www-form-urlencoded' }),
  });
}

interface SpiderForm {
  readonly method: HttpMethod;
  readonly action: string;
  readonly body?: string;
  readonly contentType?: string;
  readonly invented: readonly string[];
}

/**
 * Link and form extraction.
 *
 * **Regex, and deliberately so — no HTML parser is added.** The alternative is a dependency in a
 * package that has kept a very small one, to gain correctness on malformed markup that a *test target*
 * is not trying to serve. The cost is bounded and stated: this reads `href` and `action` attributes and
 * does not understand `<base>`, `<template>` contents, or markup inside comments. Anything it misses
 * is a route the crawl does not probe — an under-report, never a wrong conclusion — and `walked` plus
 * the blind-spot entry are what keep an under-report visible. If a real target is ever found where
 * this matters, the fix is a parser, and this comment is the record of the decision it overturns.
 */
function parseHtml(html: string, pageUrl: string): { links: string[]; forms: SpiderForm[] } {
  const links: string[] = [];
  for (const match of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const href = (match[2] ?? match[3] ?? match[4] ?? '').trim();
    if (!href || href.startsWith('#') || UNFOLLOWABLE.test(href)) continue;
    const abs = resolve(href, pageUrl);
    if (abs) links.push(abs);
  }

  const forms: SpiderForm[] = [];
  for (const match of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const attrs = match[1] ?? '';
    const inner = match[2] ?? '';
    const verb = (attribute(attrs, 'method') ?? 'GET').toUpperCase();
    const method: HttpMethod = verb === 'POST' ? 'POST' : verb === 'PUT' ? 'PUT' : verb === 'PATCH' ? 'PATCH' : verb === 'DELETE' ? 'DELETE' : 'GET';
    const action = resolve(attribute(attrs, 'action') ?? '', pageUrl);
    if (!action) continue;

    const fields: [string, string][] = [];
    const invented: string[] = [];
    for (const field of inner.matchAll(/<(input|select|textarea)\b([^>]*)>/gi)) {
      const fAttrs = field[2] ?? '';
      const name = attribute(fAttrs, 'name');
      if (!name) continue;
      const type = (attribute(fAttrs, 'type') ?? '').toLowerCase();
      if (type === 'submit' || type === 'button' || type === 'image' || type === 'reset') continue;
      const value = attribute(fAttrs, 'value');
      if (value !== undefined && value !== '') {
        // A value the *document supplied* — a hidden CSRF token, a pre-filled id. Carried as-is and
        // not counted as invented, which is the distinction `CrawlRequestPlan.invented` exists to
        // draw: only a response to a request tflw did not have to make up means what it appears to.
        fields.push([name, value]);
      } else {
        fields.push([name, syntheticFor(type)]);
        invented.push(`form field \`${name}\``);
      }
    }

    if (method === 'GET') {
      // A GET form is a query string, not a body — submitting one as a body would send a request no
      // browser would ever produce, and the response would be about the wrong thing.
      const query = new URLSearchParams(fields).toString();
      forms.push({ method, action: query ? `${action}${action.includes('?') ? '&' : '?'}${query}` : action, invented });
      continue;
    }
    forms.push({ method, action, body: new URLSearchParams(fields).toString(), contentType: 'application/x-www-form-urlencoded', invented });
  }

  return { links, forms };
}

/** A value that satisfies the field's declared type without pretending to be meaningful. Every one of
 *  these lands in `invented`, so a finding built on one is reported as resting on a value tflw made up. */
function syntheticFor(type: string): string {
  switch (type) {
    case 'number':
    case 'range':
      return '1';
    case 'email':
      return 'tflw@example.invalid';
    case 'url':
      return 'https://example.invalid/';
    case 'date':
      return '2000-01-01';
    case 'checkbox':
    case 'radio':
      return 'on';
    default:
      return 'tflw';
  }
}

function attribute(attrs: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs);
  if (!match) return undefined;
  return match[2] ?? match[3] ?? match[4];
}

/** Absolute URL, or `undefined` for anything that will not resolve. A href a spider cannot turn into
 *  an address is dropped rather than guessed at. */
function resolve(href: string, base: string): string | undefined {
  try {
    return new URL(href, base).toString();
  } catch {
    return undefined;
  }
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

function stripFragment(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url;
  }
}

/** The route's identity, which is the path with ids normalized and the query dropped — a query is an
 *  argument to a route, not a different route, and grouping by it would report one endpoint as many. */
function templateOf(url: string): string {
  try {
    return normalizeTemplate(new URL(url).pathname);
  } catch {
    return url;
  }
}
