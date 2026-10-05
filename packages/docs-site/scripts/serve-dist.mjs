// The built site served the way GitHub Pages serves it — under `/tflw/`, a bare path answered by its
// `.html` file and a directory by its `index.html` — for the browser gates that read `dist/`.
// `layout.test.mjs` (`M269b`) wrote it first; `M270`'s two browser gates needed the same thing.
import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DIST = fileURLToPath(new URL('../dist', import.meta.url));
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };

/** Starts the server on a free port: `{ server, base }`, `base` ending in `/tflw/`. */
export async function serveDist() {
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\/tflw/, '');
    let file = join(DIST, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    if (extname(file) === '' && existsSync(`${file}.html`)) file = `${file}.html`;
    else if (!existsSync(file) || extname(file) === '') file = join(file, 'index.html');
    if (!existsSync(file)) {
      res.writeHead(404).end('not here');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return { server, base: `http://127.0.0.1:${server.address().port}/tflw/` };
}
