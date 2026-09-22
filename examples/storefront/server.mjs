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
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
/** The three files the order page is made of, read once at start-up. Served from this origin so
 *  `default-src 'self'` admits them — see the comment at the top of `shelf.css`. */
const ASSET = {
  '/shelf.css': ['text/css; charset=utf-8', readFileSync(join(here, 'shelf.css'), 'utf8')],
  '/order.js': ['text/javascript; charset=utf-8', readFileSync(join(here, 'order.js'), 'utf8')],
};
const ORDER_PAGE = readFileSync(join(here, 'order.html'), 'utf8');

export const PORT = 4720;

/** How long the warehouse takes to pack an order. Long enough that a poll polls more than once,
 *  short enough that the suite does not wait on it. */
const PACKING_MS = 600;

const CATALOGUE = [
  { id: 1, name: 'Filter coffee, 1kg', price: 1400 },
  { id: 2, name: 'Espresso blend, 250g', price: 850 },
  { id: 3, name: 'Decaf, 250g', price: 900 },
];

// **The stylesheet is linked, not inlined, and that is a correctness fix rather than a tidy-up.**
// Every page here carries `default-src 'self'`, which blocks an inline `<style>` exactly as it
// blocks an inline `<script>`. This helper inlined one for the example's whole life: the header
// was present, `sec/csp-missing` passed, and the pages rendered with none of their own CSS.
const page = (title, body) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>` +
  '<link rel="stylesheet" href="/shelf.css"></head>' +
  `<body>${body}</body></html>`;

export function startStorefront(port = PORT) {
  const orders = new Map();
  const baskets = new Map();
  // Keyed by `Idempotency-Key`, which is the whole point of the header: the key is the client's
  // statement that two presses are one intention, so the server is what has to remember it.
  const placed = new Map();
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;
    const json = (status, body, extra = {}) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff', ...extra });
      res.end(JSON.stringify(body));
    };
    const html = (status, body, policy = "default-src 'self'") => {
      // A Content-Security-Policy on every document. `sec/csp-missing` is a **serious** finding and
      // applies to anything served as `text/html`, so without this the crawl below fails honestly.
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': policy });
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
        const order = { id: orders.size + 1, ref: body.ref ?? null, itemId: found.id, qty, total: found.price * qty, status: 'placed' };
        orders.set(order.id, order);
        json(201, order);
      });
    }
    // ---- The checkout, which is where a request stops being a URL and starts being a document ----
    //
    // The three routes below exist because the rest of this server does not need headers or a body
    // worth reading, and a reader learning tflw needs both: `POST /items` is two fields, and every
    // header on it is tflw's default. Here a request carries who is ordering, where it is going and
    // how it is being paid for, and **three different headers each decide something** — one grants
    // access, one decides whether a second press charges the card twice, and one is handed back so
    // a caller can find this request in a log. None of them is decoration.
    if (req.method === 'POST' && path === '/baskets') {
      return read((body) => {
        const lines = Array.isArray(body.lines) ? body.lines : [];
        const priced = [];
        for (const line of lines) {
          const found = CATALOGUE.find((i) => i.id === line.itemId);
          if (!found) return json(400, { error: `no such item ${line.itemId}` });
          const qty = Number(line.qty ?? 1);
          priced.push({ itemId: found.id, name: found.name, unitPrice: found.price, qty, lineTotal: found.price * qty });
        }
        const subtotal = priced.reduce((n, l) => n + l.lineTotal, 0);
        // One coupon, spelled one way. A shop with a coupon table would be a different example.
        const discount = body.coupon === 'SHELF10' ? Math.floor(subtotal / 10) : 0;
        const basket = {
          id: `bsk_${baskets.size + 1}`,
          currency: 'GBP',
          customer: { email: body.customer?.email ?? null, name: body.customer?.name ?? null },
          lines: priced,
          subtotal,
          discount,
          total: subtotal - discount,
        };
        baskets.set(basket.id, basket);
        json(201, basket);
      });
    }
    if (req.method === 'POST' && path === '/orders/checkout') {
      // `Authorization` first, and before the body is even read: a shop that validates the address
      // of a caller it then turns away has told a stranger which postcodes it accepts.
      const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
      if (!bearer) return json(401, { error: 'a bearer token is required to check out' }, { 'www-authenticate': 'Bearer' });
      // `X-Request-Id` is echoed on every answer below, including the refusals — a correlation id
      // that only survives the happy path is no use on the day you need it.
      const echo = { 'x-request-id': req.headers['x-request-id'] ?? 'req-unknown' };
      return read((body) => {
        const key = req.headers['idempotency-key'];
        // A replay is the SAME answer, not a fresh one — 200 rather than 201, because nothing was
        // created this time. Without this a double-press is a second order and a second charge.
        if (key && placed.has(key)) return json(200, placed.get(key), { ...echo, 'idempotent-replay': 'true' });

        const shipping = body.shipping ?? {};
        const errors = [];
        for (const field of ['line1', 'city', 'postcode']) {
          if (typeof shipping[field] !== 'string' || shipping[field].trim() === '') {
            errors.push({ field: `shipping.${field}`, message: 'this is needed to deliver the order' });
          }
        }
        if (errors.length > 0) return json(422, { errors }, echo);

        const basket = baskets.get(body.basketId);
        if (!basket) return json(404, { error: `no such basket ${body.basketId}` }, echo);

        const id = orders.size + 1;
        const order = {
          id,
          ref: `ORD-${1000 + id}`,
          status: 'confirmed',
          basketId: basket.id,
          currency: basket.currency,
          total: basket.total,
          contact: { email: body.contact?.email ?? null, phone: body.contact?.phone ?? null },
          shipping,
          payment: { method: body.payment?.method ?? null, last4: body.payment?.last4 ?? null },
          notes: body.notes ?? null,
        };
        orders.set(id, order);
        if (key) placed.set(key, order);
        json(201, order, { ...echo, location: `/orders/${id}` });
      });
    }
    // ---- fulfilment: the one thing here that finishes after the answer, not with it -------------
    //
    // `POST /orders/:id/fulfil` accepts the work and says so — `202`, not `201`, because nothing
    // is packed yet — and `GET /orders/:id` is the handle you watch. That is what `wait until api`
    // is for, and a shop with no such route has nothing to point it at. The warehouse takes
    // `PACKING_MS`; the poll is what turns that into a test.
    const fulfil = /^\/orders\/(\d+)\/fulfil$/.exec(path);
    if (req.method === 'POST' && fulfil) {
      const order = orders.get(Number(fulfil[1]));
      if (!order) return json(404, { error: 'no such order' });
      order.packedAt = Date.now() + PACKING_MS;
      return json(202, { id: order.id, status: 'packing' }, { location: `/orders/${order.id}` });
    }
    const one = /^\/orders\/(\d+)$/.exec(path);
    if (req.method === 'GET' && one) {
      const order = orders.get(Number(one[1]));
      if (!order) return json(404, { error: 'no such order' });
      const { packedAt, ...rest } = order;
      const status = packedAt === undefined ? order.status : packedAt <= Date.now() ? 'shipped' : 'packing';
      return json(200, { ...rest, status });
    }
    // ---- the order page, and the three things it is made of --------------------------------------
    //
    // **This page is where the browser half of the language becomes runnable.** The rest of this
    // shop is two documents and a form, which is enough for `open`, `click` and `expect text` and
    // nothing else — so nineteen of the twenty-two browser statements tflw can write had no
    // surface in this example to be written against, and the docs photographed a test using three
    // of them beside a sentence claiming twenty-two (`M234`). Every control on it is a thing a
    // small shop does; none of it is a widget put there to be tested.
    if (req.method === 'GET' && ASSET[path]) {
      const [type, body] = ASSET[path];
      res.writeHead(200, { 'content-type': type, 'x-content-type-options': 'nosniff' });
      return res.end(body);
    }
    if (req.method === 'GET' && path === '/order') {
      // `connect-src` names the delivery supplier because the page really does call it, and a
      // policy that forbade it would make the un-stubbed reading (`unavailable`) a CSP refusal
      // rather than a supplier being down. Naming one host is the point of the directive.
      return html(200, ORDER_PAGE, "default-src 'self'; connect-src 'self' https://delivery.example.test");
    }
    if (req.method === 'GET' && path === '/terms') {
      return html(200, page('Terms of sale',
        '<h1>Terms of sale for The Coffee Shelf</h1>' +
        '<p>Coffee is roasted to order and posted within two working days.</p>' +
        '<p><a href="/order">Back to your order</a></p>'));
    }
    if (req.method === 'GET' && path === '/order.csv') {
      // `Content-Disposition: attachment` is what makes this a download rather than a navigation,
      // which is the difference `download as file` is written around.
      res.writeHead(200, {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="order.csv"',
        'x-content-type-options': 'nosniff',
      });
      return res.end('item,qty,price\nDecaf 250g,1,9.00\nEspresso blend 250g,1,8.50\n');
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
