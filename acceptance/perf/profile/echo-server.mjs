// M35a (PLAN_BROWSER_PERF_SECURITY.md §2.7) — a zero-latency target for CPU-profiling tflw's own
// generator against a raw `fetch` baseline. Deliberately NOT the real testFlow-tests/Postgres
// target M34's acceptance run used: that target's network + DB-lock latency would dominate a CPU
// profile and bury the generator's own per-request overhead in noise. This server does no I/O and
// adds no artificial delay, so (almost) every CPU sample in the client process is the client's own
// work, not time spent waiting.
//
// Shape mirrors acceptance/perf/tflw/checkout-burst.tflw's own two-request pattern (GET a product,
// POST an order) so the profiled workload is representative of the real acceptance scenario, not a
// synthetic single-endpoint ping.

import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 4099);

const server = createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    if (req.method === 'GET' && req.url?.startsWith('/products')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify([{ id: 'prod_1', name: 'Bench Widget', stock: 999999 }]));
      return;
    }
    if (req.method === 'POST' && req.url === '/orders') {
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'order_1', status: 'created' }));
      return;
    }
    // M37 sanity check (PLAN_BROWSER_PERF_SECURITY.md §2.8, D46) — a zero-latency login endpoint so
    // bench-session.tflw can exercise the added per-iteration `sessionCache.ensure()` call
    // (D44) on a real (if trivial) session, isolated from any real network/DB latency of its own.
    if (req.method === 'POST' && req.url === '/login') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ token: 'bench-tok' }));
      return;
    }
    res.writeHead(404).end();
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`echo-server listening on http://127.0.0.1:${port}`);
});
