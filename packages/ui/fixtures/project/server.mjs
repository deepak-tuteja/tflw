// The fixture project's target — a `node:http` server with three items, orders, one endpoint
// that fails its first call (for the `retry 2` test), two for the workload tests (U4): a
// search that answers on a small deterministic latency ladder, so a histogram has more than one
// bucket, and a stock check that fails every fourth call, so an error-rate threshold has
// something to breach — and a login that sets a bare session cookie, for the security scan (U5). Started by `scripts/make-fixtures.mjs` and by the page gate; never by
// `tflw ui` itself. `PORT` is the one `tflw.config` names — the default, not the only port: the
// page gate passes a free one and rewrites its copy of the config, because two gates on one host
// (`M194`'s parallel sweep) were the first to run this file twice at once, and both wanted 4717.
import { createServer } from 'node:http';

export const PORT = 4717;

const items = [
  { id: 1, name: 'widget', price: 12 },
  { id: 2, name: 'gadget', price: 7 },
  { id: 3, name: 'gizmo', price: 3 },
];

export function startFixtureServer(port = PORT) {
  const orders = new Map();
  let warmups = 0;
  let searches = 0;
  let stockChecks = 0;
  const server = createServer((req, res) => {
    const send = (status, body) => {
      // `nosniff` on the JSON routes and not on the page: the security scan (U5) then passes on
      // the catalog and fails on the page, which is the pair the findings view needs.
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff' });
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;
    // The shop page, for the fixture's two browser tests (`M192` U3): a heading, a button whose
    // click reveals a line, and nothing that says "sold out" — the failing test looks for that.
    if (req.method === 'GET' && path === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fixture shop</title>' +
          '<style>body{font:16px system-ui;margin:2rem;background:#fff;color:#111}#bought{display:none;color:#080}</style></head>' +
          '<body><h1>Fixture shop</h1><p>Three items on the shelf.</p>' +
          '<button onclick="document.getElementById(\'bought\').style.display=\'block\'">Buy a widget</button>' +
          '<p id="bought">Bought one widget.</p></body></html>',
      );
    }
    if (req.method === 'GET' && path === '/items') return send(200, { items });
    let m = /^\/items\/(\d+)$/.exec(path);
    if (req.method === 'GET' && m) {
      const item = items.find((i) => i.id === Number(m[1]));
      return item ? send(200, item) : send(404, { error: 'no such item' });
    }
    if (req.method === 'POST' && path === '/orders') {
      let raw = '';
      req.setEncoding('utf8');
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const body = JSON.parse(raw || '{}');
        const item = items.find((i) => i.id === body.itemId);
        if (!item) return send(400, { error: 'no such item' });
        const order = { id: orders.size + 1, itemId: item.id, qty: body.qty, total: item.price * body.qty };
        orders.set(order.id, order);
        send(201, order);
      });
      return;
    }
    m = /^\/orders\/(\d+)$/.exec(path);
    if (req.method === 'GET' && m) {
      const order = orders.get(Number(m[1]));
      return order ? send(200, order) : send(404, { error: 'no such order' });
    }
    if (req.method === 'GET' && path === '/warmup') {
      warmups += 1;
      return warmups === 1 ? send(503, { error: 'warming up' }) : send(200, { ready: true, attempt: warmups });
    }
    if (req.method === 'GET' && path === '/search') {
      searches += 1;
      const q = url.searchParams.get('q') ?? '';
      const hits = items.filter((i) => i.name.includes(q));
      // 2, 6, 10, … 26 ms, cycling — seven rungs, so the buckets are spread, not one spike.
      const delay = 2 + (searches % 7) * 4;
      return void setTimeout(() => send(200, { q, hits }), delay);
    }
    if (req.method === 'POST' && path === '/login') {
      // A session cookie with none of its flags — a critical finding on purpose.
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff', 'set-cookie': 'session=fixture-1; Path=/' });
      return res.end(JSON.stringify({ ok: true }));
    }
    if (req.method === 'GET' && path === '/stock') {
      stockChecks += 1;
      // The failing call is the slow one (a timed-out upstream, 40 ms), so the successful-only
      // percentiles differ from the whole population's — `M192` U7: without that the two were
      // equal on this corpus and the mutation that collapses them survived the gate.
      return stockChecks % 4 === 0 ? void setTimeout(() => send(500, { error: 'stock service unavailable' }), 40) : send(200, { inStock: true, checks: stockChecks });
    }
    send(404, { error: `no route ${req.method} ${path}` });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href) {
  startFixtureServer().then(() => process.stdout.write(`fixture server on http://127.0.0.1:${PORT}\n`));
}
