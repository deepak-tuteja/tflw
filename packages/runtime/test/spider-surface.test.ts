// `seed spider` — the walked surface (`M137f`, `D442`/`D483`).
//
// `fetchPage` is injected, so these are unit tests over a hand-written site rather than fixture-server
// runs. They are organised around the properties the walker exists to keep, not around its functions:
//
//  1. **A truncated walk never reads as a complete one.** `D435` requires that truncation is reported
//     *as* truncation, which is why `walkCapped` is a field. A spider that stopped at its cap and
//     reported the same shape as one that ran out of links would be a coverage lie of exactly the kind
//     this arc keeps filing rows about.
//  2. **A site the spider cannot see is a stated gap, not a zero.** `D442`'s SPA case: an origin that
//     needs rendering comes back with pages fetched and nothing found, and *that* is the finding.
//     A scan that saw nothing and a site that has nothing are different facts.
//  3. **Every value tflw made up is named.** `CrawlRequestPlan.invented` is what keeps a finding built
//     on a synthesized form field from reading as a finding about the application's own data.
//
// The refusals get as much attention as the successes, for the reason `crawl-surface.test.ts` states
// about its own: an off-origin link or an unreadable page has to say so, because a silently dropped
// route is indistinguishable from one that was never there.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPIDER_DEFAULTS, walkSpiderSurface, type SpiderPage } from '../src/spiderSurface.js';

const ORIGIN = 'http://admin.test';

/** A site as a map of path → HTML. Anything not in the map 404s with an empty body, which is what a
 *  real walk meets when a template links somewhere that does not exist. */
function site(pages: Record<string, string>, contentType = 'text/html; charset=utf-8') {
  const fetched: string[] = [];
  const fetchPage = async (url: string): Promise<SpiderPage> => {
    fetched.push(url);
    const path = new URL(url).pathname;
    const body = pages[path];
    if (body === undefined) return { url, status: 404, contentType, body: '' };
    return { url, status: 200, contentType, body };
  };
  return { fetchPage, fetched };
}

function link(href: string): string {
  return `<a href="${href}">go</a>`;
}

test('a walk follows links breadth-first and reports every page it reached as a route', async () => {
  const { fetchPage } = site({
    '/': link('/orders') + link('/users'),
    '/orders': link('/orders/1'),
    '/users': '',
    '/orders/1': '',
  });
  const surface = await walkSpiderSurface(`${ORIGIN}/`, [], { maxPages: 50, maxDepth: 5 }, fetchPage);

  assert.equal(surface.walked, 4);
  assert.equal(surface.walkCapped, false);
  // `/orders/1` normalizes to `/orders/{id}` — the same grouping rule the traffic seed applies, so a
  // console listing forty orders is one route to probe rather than forty.
  assert.deepEqual(
    surface.requests.map((r) => `${r.method} ${r.template}`).sort(),
    ['GET /', 'GET /orders', 'GET /orders/{id}', 'GET /users'],
  );
});

test('the page cap truncates the walk AND says so — a partial surface never reports as a whole one', async () => {
  const pages: Record<string, string> = { '/': '' };
  // Twenty siblings off the root, so the cap is what stops this and not the link supply.
  for (let i = 0; i < 20; i++) pages['/'] += link(`/p${i}`);
  for (let i = 0; i < 20; i++) pages[`/p${i}`] = '';
  const { fetchPage } = site(pages);

  const surface = await walkSpiderSurface(`${ORIGIN}/`, [], { maxPages: 5, maxDepth: 5 }, fetchPage);

  assert.equal(surface.walked, 5, 'the cap is a bound on pages fetched, not a target');
  assert.equal(surface.walkCapped, true, 'D435 — truncation is reported as truncation');
  // The whole point of the flag: the surface is genuinely smaller, so nothing about `requests` alone
  // could tell a reader this walk was cut short.
  assert.ok(surface.requests.length < 21);
});

test('the depth cap bounds distance from the root, which is what breadth-first buys', async () => {
  const { fetchPage } = site({
    '/': link('/a'),
    '/a': link('/a/b'),
    '/a/b': link('/a/b/c'),
    '/a/b/c': '',
  });
  const surface = await walkSpiderSurface(`${ORIGIN}/`, [], { maxPages: 50, maxDepth: 1 }, fetchPage);

  // Root at depth 0, `/a` at depth 1, and `/a/b` queued but never fetched.
  assert.equal(surface.walked, 2);
  assert.equal(surface.walkCapped, true, 'links left queued when the depth ran out is truncation too');
  assert.deepEqual(surface.requests.map((r) => r.template).sort(), ['/', '/a']);
});

test('an origin that yields pages but no links is recorded as a blind spot, not as an empty surface', async () => {
  // `D442`'s SPA case: the shell is real HTML, served with a 200, and contains nothing a fetching
  // spider can follow because the routes only exist after JavaScript runs.
  const { fetchPage } = site({ '/': '<div id="root"></div><script src="/app.js"></script>' });
  const surface = await walkSpiderSurface(`${ORIGIN}/`, [], SPIDER_DEFAULTS, fetchPage);

  assert.equal(surface.walked, 1);
  assert.match(surface.blindSpot ?? '', /client-rendered/);
  assert.match(surface.blindSpot ?? '', /a scan that saw nothing and a site that has nothing are different facts/);
  // The route it *did* reach is still a route. The blind spot is about what it could not see beyond.
  assert.deepEqual(surface.requests.map((r) => r.template), ['/']);
});

test('a site with links does NOT carry a blind spot — the flag means "saw nothing", not "spider ran"', async () => {
  const { fetchPage } = site({ '/': link('/orders'), '/orders': '' });
  const surface = await walkSpiderSurface(`${ORIGIN}/`, [], SPIDER_DEFAULTS, fetchPage);
  assert.equal(surface.blindSpot, undefined);
});

test('an off-origin link is skipped with a reason rather than dropped', async () => {
  const { fetchPage } = site({ '/': link('https://elsewhere.test/admin') + link('/orders'), '/orders': '' });
  const surface = await walkSpiderSurface(`${ORIGIN}/`, [], SPIDER_DEFAULTS, fetchPage);

  const off = surface.skipped.find((s) => s.template.includes('elsewhere.test'));
  assert.ok(off, 'the off-origin link is reported, because a silently dropped link is indistinguishable from one that was never there');
  assert.match(off.reason, /authorized target/);
  assert.equal(surface.walked, 2, 'and it is not fetched');
});

test('unfollowable hrefs are not addresses and are never fetched', async () => {
  const { fetchPage, fetched } = site({
    '/': [link('#section'), link('mailto:a@b.test'), link('javascript:void(0)'), link('tel:+100'), link('/real')].join(''),
    '/real': '',
  });
  await walkSpiderSurface(`${ORIGIN}/`, [], SPIDER_DEFAULTS, fetchPage);
  assert.deepEqual(fetched.map((u) => new URL(u).pathname).sort(), ['/', '/real']);
});

test('a POST form becomes a urlencoded request, and every field tflw filled in is named as invented', async () => {
  const { fetchPage } = site({
    '/': `<form action="/orders" method="POST">
            <input type="hidden" name="_csrf" value="tok-123">
            <input type="text" name="title">
            <input type="number" name="qty">
            <input type="submit" value="Create">
          </form>`,
  });
  const surface = await walkSpiderSurface(`${ORIGIN}/`, [], SPIDER_DEFAULTS, fetchPage);

  const post = surface.requests.find((r) => r.method === 'POST');
  assert.ok(post, 'the form is a discovered route');
  assert.equal(post.contentType, 'application/x-www-form-urlencoded');
  assert.equal(post.mutating, true);
  // The document's own hidden token is carried, NOT invented — that distinction is the whole reason
  // `invented` exists, and a CSRF token counted as invented would make every finding on this route
  // read as resting on a value tflw made up.
  assert.match(post.body ?? '', /_csrf=tok-123/);
  assert.deepEqual([...post.invented].sort(), ['form field `qty`', 'form field `title`']);
  // The submit button is not a field.
  assert.ok(!(post.body ?? '').includes('Create'));
});

test('a GET form is a query string, not a body — a browser would never send one as a body', async () => {
  const { fetchPage } = site({ '/': '<form action="/search" method="get"><input name="q"></form>' });
  const surface = await walkSpiderSurface(`${ORIGIN}/`, [], SPIDER_DEFAULTS, fetchPage);

  const get = surface.requests.find((r) => r.template === '/search');
  assert.ok(get);
  assert.equal(get.method, 'GET');
  assert.equal(get.body, undefined);
  assert.match(get.path, /\/search\?q=/);
  assert.equal(get.mutating, false);
});

test('`exclude` drops a walked route from the surface and says which pattern did it', async () => {
  const { fetchPage } = site({ '/': link('/vuln/x') + link('/orders'), '/vuln/x': '', '/orders': '' });
  const surface = await walkSpiderSurface(`${ORIGIN}/`, ['/vuln/**'], SPIDER_DEFAULTS, fetchPage);

  assert.deepEqual(surface.requests.map((r) => r.template).sort(), ['/', '/orders']);
  const dropped = surface.skipped.find((s) => s.template === '/vuln/x');
  assert.match(dropped?.reason ?? '', /excluded by/);
});

test('a page that will not load is a blind spot, and the walk continues past it', async () => {
  const fetchPage = async (url: string): Promise<SpiderPage> => {
    if (new URL(url).pathname === '/broken') throw new Error('ECONNRESET');
    return { url, status: 200, contentType: 'text/html', body: link('/broken') + link('/fine') };
  };
  const surface = await walkSpiderSurface(`${ORIGIN}/`, [], { maxPages: 10, maxDepth: 1 }, fetchPage);

  assert.match(surface.skipped.find((s) => s.template === '/broken')?.reason ?? '', /ECONNRESET/);
  assert.ok(surface.requests.some((r) => r.template === '/fine'), 'one unreadable page is a blind spot, not a verdict');
});

test('a non-HTML response is still a route, but the walk does not try to read links out of it', async () => {
  const fetchPage = async (url: string): Promise<SpiderPage> => {
    const path = new URL(url).pathname;
    if (path === '/api/orders') return { url, status: 200, contentType: 'application/json', body: '{"href":"/should-not-be-followed"}' };
    return { url, status: 200, contentType: 'text/html', body: link('/api/orders') };
  };
  const surface = await walkSpiderSurface(`${ORIGIN}/`, [], { maxPages: 10, maxDepth: 3 }, fetchPage);

  assert.ok(surface.requests.some((r) => r.template === '/api/orders'), 'a JSON endpoint reached by a link is a route the openapi seed may not describe');
  assert.ok(!surface.requests.some((r) => r.template === '/should-not-be-followed'));
});

test('links are joined against the page final URL, so a redirect does not manufacture addresses', async () => {
  // `/admin` 302s to `/admin/dashboard`; the relative link there is `orders`, which means
  // `/admin/orders` — and would mean `/orders` if joined against the URL that was requested.
  const fetchPage = async (url: string): Promise<SpiderPage> => {
    const path = new URL(url).pathname;
    if (path === '/admin') return { url: `${ORIGIN}/admin/dashboard`, status: 200, contentType: 'text/html', body: link('orders') };
    return { url, status: 200, contentType: 'text/html', body: '' };
  };
  const surface = await walkSpiderSurface(`${ORIGIN}/admin`, [], { maxPages: 10, maxDepth: 2 }, fetchPage);
  assert.ok(surface.requests.some((r) => r.template === '/admin/orders'), 'joined against the final URL');
  assert.ok(!surface.requests.some((r) => r.template === '/orders'));
});

test('a walked route travels as an ABSOLUTE url, so it is dialled at the origin it was found on', async () => {
  // Regression, and it was found by running the thing rather than by reading it. A relative
  // `path` is resolved by the interpreter against the *default* `api` base — so against a corpus
  // whose base is `localhost:4001/v1`, every route walked on `localhost:8091` was dialled at
  // `localhost:4001/v1/login` and answered `404`. `D481` turned that into a red crawl rather than a
  // green one, which is the only reason it was not a silent nothing.
  //
  // `template` must stay the path at the same time: it is the route's identity, what `exclude`
  // matches and what a reader recognises. So this pins both halves of the same entry, because a fix
  // that made `path` absolute by making `template` absolute too would break grouping instead.
  const { fetchPage } = site({ '/': link('/login'), '/login': '' });
  const surface = await walkSpiderSurface(`${ORIGIN}/`, [], SPIDER_DEFAULTS, fetchPage);

  const login = surface.requests.find((r) => r.template === '/login');
  assert.ok(login, 'grouped and reported by path');
  assert.equal(login.path, `${ORIGIN}/login`, 'but sent to the origin it was walked on');
});
