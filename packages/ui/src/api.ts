// The page's only door to the server (`M192` U2): one function per route, and the stream.

import type { EndEvent, ProjectView, ReportDir, RunEvent, RunRecord, RunReport, RunRequest } from './contract';

/**
 * This session's token (`M239` `A`, `D1276`) — read off the URL `tflw ui` printed and opened. Every
 * `fetch` below sends it as `Authorization: Bearer`; the two `EventSource`s, which cannot set a
 * header, carry it as `?token=`. The page load that carried it also set the cookie the browser
 * spends on its own navigations (a report file opened in a tab, the trace viewer's assets), so
 * `reportFileUrl` and the `/trace/` frame need nothing from here. The hash router keeps
 * `location.search` on every rewrite, which is what keeps the token on the URL across a reload.
 */
export const token = (): string => (typeof window === 'undefined' ? '' : (new URLSearchParams(window.location.search).get('token') ?? ''));
const authed = (init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${token()}` } });
const withToken = (url: string): string => `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token())}`;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, authed({ cache: 'no-store' }));
  if (!res.ok) throw new Error(`${url}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** `null` when this directory holds no `tflw.config` — which the landing offers to fix, and which
 *  is a different answer from a project that does not read (`M200` `A0-5`). */
export async function getProject(env?: string | null): Promise<ProjectView | null> {
  /* **`?env=` — `M228` `F` (`D1248`).** `authorization` is a per-env fact and the pane hands it to
     the checker (`D1240`), so a page whose env select moved while this route ignored the pick was
     predicting `TF060` against a different env than the one it was about to run. `null` means
     *whatever the config calls default*, which is what the page sends until somebody picks. */
  const res = await fetch(env == null ? '/api/project' : `/api/project?env=${encodeURIComponent(env)}`, authed({ cache: 'no-store' }));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`/api/project: ${res.status} ${(await res.json() as { error?: string }).error ?? ''}`);
  return (await res.json()) as ProjectView;
}

/** Create a project here, by spawning `tflw init` — the terminal's own scaffolds (`D1051`). */
export async function initProject(door: string): Promise<{ ok: boolean; created: string[]; output: string }> {
  const res = await fetch('/api/init', authed({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ door }) }));
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
  const res = await fetch('/api/file', authed({
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...(ifMatch === null ? {} : { 'if-match': ifMatch }) },
    body: JSON.stringify({ path, text }),
  }));
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
  const res = await fetch('/api/config', authed({
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'if-match': ifMatch },
    body: JSON.stringify({ text }),
  }));
  const body = (await res.json()) as { etag?: string; error?: string; code?: string; line?: number };
  if (res.ok && body.etag) return { ok: true, etag: body.etag };
  return { ok: false, status: res.status, error: body.error ?? `${res.status}`, code: body.code, line: body.line };
}

/**
 * A project document that is not `tflw.config` — the baseline a config block declares (`M208` `S2`).
 *
 * `text: null` is *declared but not written yet*, which is a real and ordinary state rather than a
 * failure: a project adopting triage declares the document before anything has been accepted into
 * it. `etag: null` travels with it, and `putBaseline` reads that absence as *create*.
 */
export interface DocumentView {
  readonly path: string;
  /** The config block that declares it — `defaults` or an env name. */
  readonly declaredIn: string;
  readonly text: string | null;
  readonly etag: string | null;
}

/** The document `doc` names — `defaults` or an env name, never a path. See `resolveBaselineDoc`
 *  for why the page may not name a file here. */
export const getBaseline = (doc: string) => getJson<DocumentView>(`/api/baseline?doc=${encodeURIComponent(doc)}`);

/**
 * The document a run under `env` grades against — `M208` `S3`, and a different question from the
 * one above.
 *
 * It is not always the env's own block: a config declaring `baseline` only in `defaults` grades
 * every env against that one. The answer's `declaredIn` is the block, which is what an address can
 * name — so `[accept]` builds `#/<door>/config/@<declaredIn>/L<n>` from the server's answer rather
 * than deriving the fallback a second time in the page.
 */
export const getBaselineForEnv = (env: string) => getJson<DocumentView>(`/api/baseline?env=${encodeURIComponent(env)}`);

/**
 * Write a baseline document back.
 *
 * **`ifMatch: null` means create**, unlike `putConfig` and like `putFile`. A config that does not
 * exist is not a project; a *declared* baseline that has not been written is where every project
 * adopting triage starts, and `[accept]` on the first finding is the gesture that ends it.
 */
export async function putBaseline(
  doc: string,
  text: string,
  ifMatch: string | null,
): Promise<{ ok: true; etag: string } | { ok: false; status: number; error: string }> {
  const res = await fetch(`/api/baseline?doc=${encodeURIComponent(doc)}`, authed({
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...(ifMatch === null ? {} : { 'if-match': ifMatch }) },
    body: JSON.stringify({ text }),
  }));
  const body = (await res.json()) as { etag?: string; error?: string };
  if (res.ok && body.etag) return { ok: true, etag: body.etag };
  return { ok: false, status: res.status, error: body.error ?? `${res.status}` };
}

/**
 * Drop the scratch file — what `[Discard]` does (`D1054`).
 *
 * `ifMatch` is the version the page last read; a mismatch comes back as `409` so the page can say
 * the file moved rather than delete somebody else's work. A scratch that is already gone is
 * `{ removed: false }` and not a failure — the promise is that it is not there.
 */
export async function dropScratch(ifMatch: string | null): Promise<{ ok: true; removed: boolean } | { ok: false; status: number; error: string }> {
  const res = await fetch('/api/scratch', authed({
    method: 'DELETE',
    headers: ifMatch === null ? {} : { 'if-match': ifMatch },
  }));
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
  return sessionStream('/api/pick', path, on, 'the pick session could not be started');
}

/**
 * A `tflw record` session — `M213` `S5` (`D1095`).
 *
 * `pickLocators`'s sibling and, at this layer, identical: the same route shape, the same framing,
 * the same *opening the stream starts it and closing it ends it*. What differs is what the browser
 * does with a click, which is `D1106`'s decision and is the command's business rather than this
 * function's. Lines arrive unclassified for `pick`'s reason, and `record` has banners of its own.
 */
export function recordActions(
  path: string,
  on: { line: (text: string) => void; problem: (text: string) => void; end: () => void },
): () => void {
  return sessionStream('/api/record', path, on, 'the recording could not be started');
}

function sessionStream(
  route: string,
  path: string,
  on: { line: (text: string) => void; problem: (text: string) => void; end: () => void },
  refusal: string,
): () => void {
  const source = new EventSource(withToken(`${route}?path=${encodeURIComponent(path)}`));
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
    on.problem(`${refusal} — check that this env declares a \`web\` base`);
    on.end();
  };
  return () => {
    source.close();
    on.end();
  };
}

export async function startRun(request: RunRequest): Promise<RunRecord> {
  const res = await fetch('/api/run', authed({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) }));
  if (!res.ok) throw new Error(`POST /api/run: ${res.status} ${await res.text()}`);
  return (await res.json()) as RunRecord;
}

export async function cancelRun(id: string): Promise<void> {
  await fetch(`/api/runs/${encodeURIComponent(id)}/cancel`, authed({ method: 'POST' }));
}

export async function getStderr(id: string): Promise<string> {
  return (await getJson<{ stderr: string }>(`/api/runs/${encodeURIComponent(id)}/stderr`)).stderr;
}

/** The run's stream: every line the child wrote (replayed first, then live), and the server's
 * `end`. Returns the unsubscribe. A line that is not JSON is the child's own noise and is passed
 * to `onNoise` rather than dropped — the page shows what the terminal would have. */
export function subscribe(id: string, on: { event: (e: RunEvent) => void; noise: (line: string) => void; end: (e: EndEvent) => void }): () => void {
  const source = new EventSource(withToken(`/api/runs/${encodeURIComponent(id)}/events`));
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

// ── `M218` — moving and deleting a file ────────────────────────────────────────────────────────

/** One file the plan would write, and the sentence the dialog shows for it. */
export interface PlanEdit {
  readonly path: string;
  readonly text: string;
  readonly why: string;
}

/**
 * What a move or a delete would do — `GET /api/refactor` (`D1150`).
 *
 * The **same** server function computes this and performs the operation, which is `D1141`
 * generalised: `M217-01` was a dialog previewing bytes that were not the bytes that landed, and a
 * preview computed by one path and applied by another is that defect with a project-wide radius.
 *
 * `recovery` is `delete` only, and is about **this file** rather than about the project
 * (`D1154`): `untracked` means git cannot bring it back, and `unknown` means git could not be
 * asked at all — no repository, or no git — in which case the dialog says the flat *this cannot be
 * undone*, which is never false.
 */
export interface RefactorPlan {
  readonly op: 'move' | 'delete';
  readonly subject: string;
  readonly to: string | null;
  readonly importers: readonly string[];
  readonly edits: readonly PlanEdit[];
  readonly removes: readonly string[];
  readonly refusals: readonly string[];
  readonly recovery?: 'tracked' | 'untracked' | 'unknown';
}

export const planDelete = (path: string) => getJson<RefactorPlan>(`/api/refactor?op=delete&path=${encodeURIComponent(path)}`);
export const planMove = (from: string, to: string) =>
  getJson<RefactorPlan>(`/api/refactor?op=move&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);

/** Apply a move. The server re-reads and re-plans; nothing the page holds is trusted back. */
export async function moveFile(from: string, to: string): Promise<{ ok: true; rewrote: number } | { ok: false; error: string }> {
  const res = await fetch('/api/move', authed({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from, to }) }));
  const body = (await res.json()) as { rewrote?: number; error?: string };
  return res.ok ? { ok: true, rewrote: body.rewrote ?? 0 } : { ok: false, error: body.error ?? `${res.status}` };
}

/** Apply a delete. Refused with `409` when anything imports it (`D1153`). */
export async function deleteFile(path: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch(`/api/file?path=${encodeURIComponent(path)}`, authed({ method: 'DELETE' }));
  if (res.ok) return { ok: true };
  const body = (await res.json()) as { error?: string };
  return { ok: false, error: body.error ?? `${res.status}` };
}
