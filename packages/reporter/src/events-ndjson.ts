// report/events.ndjson — a permanent artifact mirroring the live `--format ndjson` stream (PLAN
// decision 111, M17). Written whenever NDJSON mode is active, same footing as every other
// artifact in report/ — the event stream survives even when the invoking process didn't capture
// stdout.

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { RunEvent } from '@tflw/runtime';

export async function writeEventsNdjson(events: readonly RunEvent[], dir: string): Promise<string> {
  const outDir = resolve(dir);
  await mkdir(outDir, { recursive: true });
  const path = join(outDir, 'events.ndjson');
  const body = events.map((e) => JSON.stringify(e)).join('\n');
  await writeFile(path, events.length > 0 ? body + '\n' : '', 'utf8');
  return path;
}
