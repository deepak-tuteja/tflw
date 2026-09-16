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
