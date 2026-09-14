// The fixture project's target — a `node:http` server with three items, orders, and one endpoint
// that fails its first call (for the `retry 2` test). Started by `scripts/make-fixtures.mjs` and
// by the page gate; never by `tflw ui` itself. `PORT` is the one `tflw.config` names.
import { createServer } from 'node:http';

export const PORT = 4717;

const items = [
  { id: 1, name: 'widget', price: 12 },
  { id: 2, name: 'gadget', price: 7 },
  { id: 3, name: 'gizmo', price: 3 },
];

export function startFixtureServer() {
  const orders = new Map();
  let warmups = 0;
  const server = createServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
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
    send(404, { error: `no route ${req.method} ${path}` });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href) {
  startFixtureServer().then(() => process.stdout.write(`fixture server on http://127.0.0.1:${PORT}\n`));
}
