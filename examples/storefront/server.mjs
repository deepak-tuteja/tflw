// The example storefront — the target `examples/storefront`'s tests run against.
//
// **This is an example, not a fixture, and the difference is visible in the code.**
// `packages/ui/fixtures/project/server.mjs` is shaped by what its gates need: an endpoint that
// fails its first call, another that fails every fourth, a seven-rung latency ladder so a
// histogram has more than one bucket. Those are artefacts of measuring, and a reader learning the
// language should not have to tell them apart from the shop. This server has none of them. It is
// a small storefront that behaves the way a small storefront does.
//
// The session cookie carries `HttpOnly` and `SameSite`, so the suite is green out of the box —
// an example that is red on a clean checkout teaches that red is normal. To watch the SCANS door
// do its job, delete `HttpOnly;` from either `set-cookie` below and run again: `sec/cookie-not-
// httponly` fires as a **critical** finding and `signin.tflw` goes red. That is the shortest round
// trip from "the scan passes" to "the scan caught something" this repository has.
//
// stdlib only, one file, no build. `node server.mjs` and it is up.
import { createServer } from 'node:http';

export const PORT = 4720;

const CATALOGUE = [
  { id: 1, name: 'Filter coffee, 1kg', price: 1400 },
  { id: 2, name: 'Espresso blend, 250g', price: 850 },
  { id: 3, name: 'Decaf, 250g', price: 900 },
];

const page = (title, body) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>` +
  '<style>body{font:16px/1.5 system-ui;margin:2rem;max-width:40rem;color:#111;background:#fff}' +
  'li{margin:.4rem 0}label{display:block;margin:.6rem 0}input{padding:.3rem}</style></head>' +
  `<body>${body}</body></html>`;

export function startStorefront(port = PORT) {
  const orders = new Map();
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;
    const json = (status, body, extra = {}) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff', ...extra });
      res.end(JSON.stringify(body));
    };
    const html = (status, body) => {
      // A Content-Security-Policy on every document. `sec/csp-missing` is a **serious** finding and
      // applies to anything served as `text/html`, so without this the crawl below fails honestly.
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'self'" });
      res.end(body);
    };
    const read = (then) => {
      let raw = '';
      req.setEncoding('utf8');
      req.on('data', (c) => (raw += c));
      req.on('end', () => then(JSON.parse(raw || '{}')));
    };

    if (req.method === 'GET' && path === '/') {
      // The shelf hands every visitor an anonymous cart cookie — which is what a shop does, and is
      // also the only thing on this server a *crawl* can judge. A crawl re-issues what the suite
      // sent, as a stranger, and withholds the mutating methods; so if no safe GET ever sets a
      // cookie, every security rule is `not applicable` and tflw fails the crawl's assertion for
      // having had no power to fail. See `tests/scan.tflw`.
      res.setHeader('set-cookie', 'cart=anon-1; Path=/; HttpOnly; SameSite=Lax');
      return html(200, page('The Coffee Shelf',
        '<h1>The Coffee Shelf</h1><p>Three things, roasted this week.</p><ul>' +
        CATALOGUE.map((i) => `<li>${i.name} — £${(i.price / 100).toFixed(2)}</li>`).join('') +
        '</ul><p><a href="/signin">Sign in</a></p>'));
    }
    if (req.method === 'GET' && path === '/signin') {
      return html(200, page('Sign in',
        '<h1>Sign in to The Coffee Shelf</h1><form method="post" action="/signin">' +
        '<label>Email <input name="email" type="email"></label>' +
        '<label>Password <input name="password" type="password"></label>' +
        '<button type="submit">Sign in</button></form>'));
    }
    if (req.method === 'POST' && path === '/signin') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'self'", 'set-cookie': 'session=example-1; Path=/; HttpOnly; SameSite=Lax' });
      return res.end(page('Signed in', '<h1>Signed in</h1><p>Welcome back.</p><p><a href="/">Back to the shelf</a></p>'));
    }
    if (req.method === 'GET' && path === '/health') return json(200, { ok: true });
    if (req.method === 'GET' && path === '/items') return json(200, { items: CATALOGUE });
    const item = /^\/items\/(\d+)$/.exec(path);
    if (req.method === 'GET' && item) {
      const found = CATALOGUE.find((i) => i.id === Number(item[1]));
      return found ? json(200, found) : json(404, { error: 'no such item' });
    }
    if (req.method === 'POST' && path === '/login') {
      // The API twin of `POST /signin`, carrying the same cookie with the same flags.
      return read(() => json(200, { ok: true }, { 'set-cookie': 'session=example-1; Path=/; HttpOnly; SameSite=Lax' }));
    }
    if (req.method === 'POST' && path === '/orders') {
      return read((body) => {
        const found = CATALOGUE.find((i) => i.id === body.itemId);
        if (!found) return json(400, { error: 'no such item' });
        const qty = Number(body.qty ?? 1);
        if (!Number.isInteger(qty) || qty < 1) return json(422, { error: 'qty must be a whole number of at least 1' });
        const order = { id: orders.size + 1, ref: body.ref ?? null, itemId: found.id, qty, total: found.price * qty };
        orders.set(order.id, order);
        json(201, order);
      });
    }
    const one = /^\/orders\/(\d+)$/.exec(path);
    if (req.method === 'GET' && one) {
      const order = orders.get(Number(one[1]));
      return order ? json(200, order) : json(404, { error: 'no such order' });
    }
    json(404, { error: `no route ${req.method} ${path}` });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href) {
  startStorefront().then(() => process.stdout.write(`the coffee shelf is on http://127.0.0.1:${PORT}\n`));
}
