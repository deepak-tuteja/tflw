// The page's only door to the server (`M192` U2): one function per route, and the stream.

import type { EndEvent, ProjectView, ReportDir, RunEvent, RunRecord, RunReport, RunRequest } from './contract';

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** `null` when this directory holds no `tflw.config` — which the landing offers to fix, and which
 *  is a different answer from a project that does not read (`M200` `A0-5`). */
export async function getProject(): Promise<ProjectView | null> {
  const res = await fetch('/api/project', { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`/api/project: ${res.status} ${(await res.json() as { error?: string }).error ?? ''}`);
  return (await res.json()) as ProjectView;
}

/** Create a project here, by spawning `tflw init` — the terminal's own scaffolds (`D1051`). */
export async function initProject(door: string): Promise<{ ok: boolean; created: string[]; output: string }> {
  const res = await fetch('/api/init', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ door }) });
  return (await res.json()) as { ok: boolean; created: string[]; output: string };
}
export const getRuns = () => getJson<RunRecord[]>('/api/runs');
export const getReports = () => getJson<ReportDir[]>('/api/reports');
export const getResults = (reportId: string) => getJson<RunReport>(`/api/reports/${encodeURIComponent(reportId)}/results.json`);
export const reportFileUrl = (reportId: string, file: string) => `/api/reports/${encodeURIComponent(reportId)}/${file}`;

/** A file's source and the version the next write will be checked against (`D1049`). */
export interface FileView {
  readonly path: string;
  readonly text: string;
  readonly etag: string;
}

export const getFile = (path: string) => getJson<FileView>(`/api/file?path=${encodeURIComponent(path)}`);

/**
 * Write a whole file back. `ifMatch` is the etag the edit was computed against, or `null` to
 * create a file that should not exist yet.
 *
 * The server refuses three things and each needs different words from the page, so the refusal
 * comes back whole rather than as a thrown string: `409` the file moved under us, `422` the text
 * does not parse (with the diagnostic's code and line), `422` it is not formatted.
 */
export async function putFile(path: string, text: string, ifMatch: string | null): Promise<{ ok: true; etag: string } | { ok: false; status: number; error: string; code?: string; line?: number }> {
  const res = await fetch('/api/file', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...(ifMatch === null ? {} : { 'if-match': ifMatch }) },
    body: JSON.stringify({ path, text }),
  });
  const body = (await res.json()) as { etag?: string; error?: string; code?: string; line?: number };
  if (res.ok && body.etag) return { ok: true, etag: body.etag };
  return { ok: false, status: res.status, error: body.error ?? `${res.status}`, code: body.code, line: body.line };
}

/**
 * `tflw.config`'s text and the version the next write is checked against (`M205` S5b).
 *
 * A route of its own rather than a field on `ProjectView`: the Config tab is the only reader, the
 * project view is re-read after every write, and a config is a file you open rather than a fact
 * the shell needs on every refresh.
 */
export const getConfig = () => getJson<FileView>('/api/config');

/**
 * Write `tflw.config` back — Q5, closing `M205-03`.
 *
 * **`ifMatch` is not optional here**, and the type says so. `putFile` reads `null` as *this file
 * should not exist yet*, which is how a new test file is created; a config that does not exist is
 * not a project, so there is no create case and a page that had no etag to send has not read the
 * file it is claiming to edit.
 *
 * Refusals come back whole rather than thrown, for `putFile`'s reason: `409` the file moved under
 * us, `422` the text does not parse — and `422` here is the one the author will actually meet,
 * because the config dialect is small and a typo in it is a parse error rather than a wrong test.
 */
export async function putConfig(text: string, ifMatch: string): Promise<{ ok: true; etag: string } | { ok: false; status: number; error: string; code?: string; line?: number }> {
  const res = await fetch('/api/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'if-match': ifMatch },
    body: JSON.stringify({ text }),
  });
  const body = (await res.json()) as { etag?: string; error?: string; code?: string; line?: number };
  if (res.ok && body.etag) return { ok: true, etag: body.etag };
  return { ok: false, status: res.status, error: body.error ?? `${res.status}`, code: body.code, line: body.line };
}

/**
 * Drop the scratch file — what `[Discard]` does (`D1054`).
 *
 * `ifMatch` is the version the page last read; a mismatch comes back as `409` so the page can say
 * the file moved rather than delete somebody else's work. A scratch that is already gone is
 * `{ removed: false }` and not a failure — the promise is that it is not there.
 */
export async function dropScratch(ifMatch: string | null): Promise<{ ok: true; removed: boolean } | { ok: false; status: number; error: string }> {
  const res = await fetch('/api/scratch', {
    method: 'DELETE',
    headers: ifMatch === null ? {} : { 'if-match': ifMatch },
  });
  const body = (await res.json()) as { removed?: boolean; error?: string };
  if (res.ok) return { ok: true, removed: body.removed ?? false };
  return { ok: false, status: res.status, error: body.error ?? `${res.status}` };
}

/**
 * A `tflw pick` session — `M200` `A3-6` (`D1055`).
 *
 * **Opening the stream is what starts the session, and closing it is what ends it.** There is no
 * start call and no stop call: the route binds the child's life to the connection, so the
 * unsubscribe this returns closes the browser `pick` opened. That is the property that matters —
 * a real, visible browser process that nothing can orphan.
 *
 * Lines arrive unclassified, because `pick` prints two banner lines before the first locator and a
 * server that filtered by matching their wording would be coupled to it. The caller classifies,
 * with the grammar.
 */
export function pickLocators(
  path: string,
  on: { line: (text: string) => void; problem: (text: string) => void; end: () => void },
): () => void {
  const source = new EventSource(`/api/pick?path=${encodeURIComponent(path)}`);
  source.onmessage = (m: MessageEvent<string>) => on.line(JSON.parse(m.data) as string);
  source.addEventListener('problem', (m) => on.problem(JSON.parse((m as MessageEvent<string>).data) as string));
  source.addEventListener('end', () => {
    source.close();
    on.end();
  });
  // A route that refuses — no `web` base, not a project — answers JSON rather than a stream, and
  // `EventSource` reports that only as a generic error. It is surfaced as a problem rather than
  // swallowed, because a picker that silently does nothing is worse than one that says why.
  source.onerror = () => {
    source.close();
    on.problem('the pick session could not be started — check that this env declares a `web` base');
    on.end();
  };
  return () => {
    source.close();
    on.end();
  };
}

export async function startRun(request: RunRequest): Promise<RunRecord> {
  const res = await fetch('/api/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
  if (!res.ok) throw new Error(`POST /api/run: ${res.status} ${await res.text()}`);
  return (await res.json()) as RunRecord;
}

export async function cancelRun(id: string): Promise<void> {
  await fetch(`/api/runs/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
}

export async function getStderr(id: string): Promise<string> {
  return (await getJson<{ stderr: string }>(`/api/runs/${encodeURIComponent(id)}/stderr`)).stderr;
}

/** The run's stream: every line the child wrote (replayed first, then live), and the server's
 * `end`. Returns the unsubscribe. A line that is not JSON is the child's own noise and is passed
 * to `onNoise` rather than dropped — the page shows what the terminal would have. */
export function subscribe(id: string, on: { event: (e: RunEvent) => void; noise: (line: string) => void; end: (e: EndEvent) => void }): () => void {
  const source = new EventSource(`/api/runs/${encodeURIComponent(id)}/events`);
  source.onmessage = (m: MessageEvent<string>) => {
    try {
      on.event(JSON.parse(m.data) as RunEvent);
    } catch {
      on.noise(m.data);
    }
  };
  source.addEventListener('end', (m) => {
    on.end(JSON.parse((m as MessageEvent<string>).data) as EndEvent);
    source.close();
  });
  return () => source.close();
}
