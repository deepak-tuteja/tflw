/** Own `process.stderr` for the duration of one run and hand back what was written to it.
 *
 * The speculative progress lines (`D269`/`D937`) are written straight to the stream rather than
 * through the reporter — that is the whole point of them, `C4`/`B3-05` — so observing one means
 * replacing the stream's `write` while it happens.
 *
 * THIS IS A PROCESS-WIDE SWAP, which is why it lives here rather than in one test file: two tests
 * using it at the same time would capture each other's output. Tests inside a file run in sequence
 * so that is safe, but tests that use this must not be made concurrent with each other, and two of
 * them that each wait on the wall clock belong in two FILES — `node --test` gives each file its own
 * process, and that is the only cheap way to overlap them (`M182a`).
 *
 * `browser-diagnosis.test.ts` still carries its own copy; it predates this and is left alone rather
 * than migrated inside a milestone that has no other reason to touch it. */
export async function captureStderr<T>(fn: () => Promise<T>): Promise<{ result: T; stderr: string }> {
  const chunks: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  (process.stderr as { write: unknown }).write = (chunk: string | Uint8Array): boolean => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  };
  try {
    const result = await fn();
    return { result, stderr: chunks.join('') };
  } finally {
    (process.stderr as { write: unknown }).write = original;
  }
}
