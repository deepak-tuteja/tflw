// M35b investigation — same as echo-server.mjs but counts distinct TCP connections opened
// (http.Server's 'connection' event fires once per new socket, not per request) to test whether
// tflw is failing to reuse keep-alive connections the way raw fetch/undici does.
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 4099);
let connCount = 0;
let reqCount = 0;

const server = createServer((req, res) => {
  reqCount++;
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
    res.writeHead(404).end();
  });
});

server.on('connection', () => {
  connCount++;
});

server.listen(port, '127.0.0.1', () => {
  console.log(`echo-server-connlog listening on http://127.0.0.1:${port}`);
});

process.on('SIGUSR1', () => {
  console.log(JSON.stringify({ connCount, reqCount, reqPerConn: reqCount / connCount }));
});

setInterval(() => {
  console.log(JSON.stringify({ connCount, reqCount, reqPerConn: reqCount / Math.max(connCount, 1) }));
}, 2000).unref();
