// `npm run example` — start the storefront, run the suite against it, stop the storefront.
//
// The server is started here rather than being left to the reader because an example whose first
// step is "in another terminal, run this" loses people at step one. `tflw run` is spawned as a
// process, exactly as a person would type it, so what this script does and what the README says to
// do by hand are the same thing.
//
// It runs the **branch build** (`packages/cli/dist/cli.cjs`), because that is what a reader of this
// repository has. There is no published tflw to fall back to.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStorefront, PORT } from './server.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, '..', '..', 'packages', 'cli', 'dist', 'cli.cjs');

const server = await startStorefront(PORT);
process.stdout.write(`the coffee shelf is on http://127.0.0.1:${PORT}\n\n`);
const code = await new Promise((resolve) => {
  spawn(process.execPath, [cli, 'run', ...process.argv.slice(2)], { cwd: here, stdio: 'inherit' })
    .on('exit', (c) => resolve(c ?? 1));
});
server.close();
process.exit(code);
