// The page's only door to the server (`M192` U2): one function per route, and the stream.

import type { EndEvent, ProjectView, ReportDir, RunEvent, RunRecord, RunReport, RunRequest } from './contract';

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export const getProject = () => getJson<ProjectView>('/api/project');
export const getRuns = () => getJson<RunRecord[]>('/api/runs');
export const getReports = () => getJson<ReportDir[]>('/api/reports');
export const getResults = (reportId: string) => getJson<RunReport>(`/api/reports/${encodeURIComponent(reportId)}/results.json`);
export const reportFileUrl = (reportId: string, file: string) => `/api/reports/${encodeURIComponent(reportId)}/${file}`;

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
