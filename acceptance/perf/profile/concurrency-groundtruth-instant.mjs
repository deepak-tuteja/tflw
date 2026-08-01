// Ground-truth check (D41, M36): does Node's global fetch() actually hold N requests concurrently
// in flight against one origin, or does something (undici's default per-origin connection pool)
// serialize them below N? Server tracks true concurrent in-flight count server-side (increment on
// request-received, decrement on response-sent, with an artificial per-request delay so overlap is
// observable) — client just fires N fetches via Promise.all with zero stagger (maximum possible
// concurrency, upper bound case).
import { createServer } from 'node:http';

const PORT = 4501;
const N = 30;
const DELAY_MS = 50; // hold each request open briefly so overlapping requests are observable

let inFlight = 0;
let maxInFlight = 0;
let totalConns = 0;

const server = createServer((req, res) => {
  inFlight++;
  maxInFlight = Math.max(maxInFlight, inFlight);
  setTimeout(() => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
    inFlight--;
  }, DELAY_MS);
});
server.on('connection', () => { totalConns++; });

await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));

const start = performance.now();
await Promise.all(
  Array.from({ length: N }, () => fetch(`http://127.0.0.1:${PORT}/`)),
);
const wallMs = performance.now() - start;

console.log(JSON.stringify({ N, DELAY_MS, maxInFlight, totalConns, wallMs, expectedWallMsIfFullyConcurrent: DELAY_MS, expectedWallMsIfSerialized: N * DELAY_MS }, null, 2));

server.close();
