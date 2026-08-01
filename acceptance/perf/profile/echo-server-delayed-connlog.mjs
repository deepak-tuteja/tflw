// M36 (D41) — a slow target (artificial per-request delay) with a server-side concurrent-in-flight
// counter, ground truth for D40's client-side concurrency-ceiling hypothesis. Deliberately NOT
// zero-latency like echo-server.mjs: a fast target makes "concurrent in flight" trivially ~1
// regardless of client capability (each request completes before the next one can meaningfully
// overlap), which is why M35a-2's own "2 connections total" reading against echo-server.mjs was
// uninformative for a concurrency question, only a connection-*churn* one. A real per-request delay
// (proxying checkout-burst's real contended latency) is what makes genuine overlap observable.
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 4503);
const delayMs = Number(process.argv[3] ?? 200);

let inFlight = 0;
let maxInFlight = 0;
let totalConns = 0;
let reqCount = 0;

const server = createServer((req, res) => {
  inFlight++;
  maxInFlight = Math.max(maxInFlight, inFlight);
  reqCount++;
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    setTimeout(() => {
      if (req.method === 'GET' && req.url?.startsWith('/products')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify([{ id: 'prod_1', name: 'Bench Widget', stock: 999999 }]));
      } else if (req.method === 'POST' && req.url === '/orders') {
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 'order_1', status: 'created' }));
      } else {
        res.writeHead(404).end();
      }
      inFlight--;
    }, delayMs);
  });
});

server.on('connection', () => { totalConns++; });

server.listen(port, '127.0.0.1', () => {
  console.log(`echo-server-delayed-connlog listening on http://127.0.0.1:${port} (delay=${delayMs}ms)`);
});

process.on('SIGUSR1', () => {
  console.log(JSON.stringify({ maxInFlight, totalConns, reqCount }));
});

setInterval(() => {
  console.log(JSON.stringify({ maxInFlight, totalConns, reqCount, currentInFlight: inFlight }));
}, 2000).unref();
