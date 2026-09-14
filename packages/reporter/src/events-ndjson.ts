// report/events.ndjson — a permanent artifact mirroring the live `--format ndjson` stream (PLAN
// decision 111, M17). Written whenever NDJSON mode is active, same footing as every other
// artifact in report/ — the event stream survives even when the invoking process didn't capture
// stdout.
//
// `M192b` (closing `M192-01`): written one line at a time through a stream, never as one string.
// The dogfood corpus at `evidence full` over a bloated database produced a 612 MB stream — a
// response body travels three times, in its `step:end`, inside its `test:end`, inside the file's
// `run:end` — and `events.map(JSON.stringify).join('\n')` asked V8 for one string past its
// ~512 MB limit: `RangeError: Invalid string length`, exit 2 after 326 of 326 passed, and the
// tail of the stream a page was reading gone. The events are still redacted after the whole run
// (M63: the redactor is only complete then) — what changed is that no line ever meets another in
// memory. `events` is any iterable, so a caller can hand over a generator that redacts as it goes.

import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { RunEvent } from '@tflw/runtime';

export async function writeEventsNdjson(events: Iterable<RunEvent>, dir: string): Promise<string> {
  const outDir = resolve(dir);
  await mkdir(outDir, { recursive: true });
  const path = join(outDir, 'events.ndjson');
  const sink = createWriteStream(path, { encoding: 'utf8' });
  const failed = new Promise<never>((_, reject) => sink.once('error', reject));
  for (const event of events) {
    // Backpressure honoured: a `false` from `write` means the OS buffer is full, and waiting for
    // `drain` is what keeps the process's memory flat on a stream the size of the one above.
    if (!sink.write(JSON.stringify(event) + '\n')) await Promise.race([once(sink, 'drain'), failed]);
  }
  await Promise.race([new Promise<void>((done) => sink.end(done)), failed]);
  return path;
}
