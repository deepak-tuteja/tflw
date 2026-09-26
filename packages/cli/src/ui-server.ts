// `tflw ui` — the local server behind the page for a `.tflw` project (`M192` U1).
//
// The page is a projection of the file and of the report directory, never a second truth
// (`D985`), and this server is the whole of what it may touch: it reads the project (the config,
// the discovered files, the tests in them), it runs `tflw run --format ndjson` as a child and
// relays the stream (`D986` — the page is one more reader of the artefact CI reads), it lists and
// serves report directories, and it cancels a run.
//
// **It writes exactly one kind of thing, through exactly one function** (`M200` `A0-2`, `D1049`).
// Slice 1 had no write path at all and its green condition grepped this file to prove it; `A0`
// makes the page an authoring surface, so that rule is replaced rather than dropped — the grep
// now demands a single `writeFile` call site, inside `writeProjectFile` below, and nothing else.
// A capability that arrives by widening a guard until it admits the new thing leaves no guard;
// one that arrives by narrowing the guard to the new thing's own shape keeps it.
//
// **The server refuses, it does not author.** `@tflw/lang` has no dependencies and no Node
// builtins, so the page runs `parse`/`print`/`format` itself and hands this route a finished
// file. What the route adds is the part a client cannot be trusted with: the bytes on disk must
// still be the bytes the client's edit was computed against (`If-Match`, a content hash), the
// text must parse with no error diagnostic, and `format()` must already be a fixpoint on it. A
// `.tflw` file that does not parse can therefore not be written through this server at all,
// which is what `D985` is protecting — the file is the only truth, so an unreadable file is a
// truth nobody can read.
//
// The run's record is its report directory (§2 q6). `tflw run` writes one directory per project
// (`report dir`, config) and overwrites it, so a run from the page is exactly a run from the
// terminal — same command, same files — and when it ends the server copies the directory aside,
// as `<reportDir>/runs/<id>/`, so the page has a past to open. Copies, not a format: every file
// in a kept run is a file the contract already names. If a second reader ever wants history, it
// becomes a `report keep` key and this copy retires (`D986`'s rule for a need the page finds).
//
// Loopback only. The server binds `127.0.0.1` and that is the boundary (§8): a project's `.env`,
// its report evidence and a `POST /api/run` that spawns a process are not things to put on a LAN.
// Reaching it from another machine is `ssh -L`, which is how the dogfood on the box is used.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFile, readdir, stat, cp, mkdir, writeFile, rename, unlink, realpath } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { pageRunFlags } from './run-flags.js';
import { join, resolve, relative, dirname, extname, sep, basename } from 'node:path';
import { createRequire } from 'node:module';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { DEFAULT_RUNS_KEPT, parseSource, parseConfigSource, format, lensesOfTest, lensesOfCrawl, stepLensCounts, pageOpening, LENSES, type ConfigFile, type EnvBlock, type Lens, type StepLens } from '@tflw/lang';
import { parseBaseline, resolveConfig, selectEnv, type ResolvedConfig } from '@tflw/runtime';
import { discoverTests } from './project.js';
import { buildStamp, type BuildStamp } from './buildStamp.js';
import { importersOf, planDelete, planMove, resolveSpecifier, type RefactorPlan } from './ui-refactor.js';

export const UI_DEFAULT_PORT = 4141;

export interface UiServerOptions {
  /** The project directory — where `tflw.config` lives and `tflw run` runs. */
  readonly root: string;
  /** The entry `tflw run` is spawned from: `dist/cli.cjs` in the bundle, `src/cli.ts` under tsx. */
  readonly cliEntry: string;
  /** Node flags the child needs to load the entry — `['--import', 'tsx']` for the source entry,
   * nothing for the bundle. Never the parent's whole `process.execArgv`: under `node --test` that
   * carries `--test` itself, and the child would run as a test runner instead of as tflw. */
  readonly execArgv?: readonly string[];
  /** Where the page's static bundle is; defaults to `ui/` beside `cliEntry`. */
  readonly staticDir?: string;
  /** The session token (`D1316`). Minted at construction when absent; a test passes one so the
   *  URLs it builds are known before the server is. */
  readonly token?: string;
}

// ── `M239` `A`–`C` (`D1316`, `D1317`, `D1318`) — the boundary ────────────────────────────────
//
// `tflw ui` binds to loopback and, until `M239`, that was the whole of its security: any page in
// the user's browser could `POST /api/run` with a `text/plain` body, any name an attacker's DNS
// pointed at 127.0.0.1 was accepted as `Host`, and a request body of any size was read whole. The
// review (`REVIEW_ENTERPRISE_READINESS.md` S1–S3, S5–S8) forged all three by hand. Four layers,
// each a different claim, so that none is load-bearing alone:
//
//   1. `Host` names a loopback host (`127.0.0.1`, `localhost`, `::1`) — else 421. This is the
//      DNS-rebinding check, and it is on the HOSTNAME only: `ssh -L 9000:127.0.0.1:4141` is the
//      documented way to reach a remote `tflw ui`, and the browser's `Host` is then `127.0.0.1:9000`
//      while the server listens on 4141. A port check here would refuse exactly that reader.
//   2. `Origin`, when a request carries one, equals `http://<Host>` — else 403. Every fetch and
//      every form post carries it; a page on another loopback PORT (a compromised dev server) is
//      the same site to a cookie and a different origin here, which is why the token has two
//      carriers rather than one (below).
//   3. A per-start token. The page is opened with `?token=` in the URL `tflw ui` prints, which is
//      what `ssh -L` users paste anyway. The page's own `fetch` sends it as `Authorization: Bearer`
//      and the two `EventSource` streams as `?token=` (an `EventSource` cannot set a header). The
//      token-bearing page load also sets a `SameSite=Strict; HttpOnly` cookie, accepted on the two
//      surfaces the browser fetches on its own with no way to add a header: the report files a
//      reader opens in a tab or downloads (`report.html`'s own screenshots and trace link resolve
//      relatively), and the trace viewer's own assets under `/trace/`. Everything else under
//      `/api/` refuses the cookie, so a same-site page cannot spend it: `GET /api/pick` spawns a
//      browser, and an `<img src>` from another port must not be able to.
//   4. A body is JSON or it is 415 before a byte is read; a body over 1 MiB is 413.
//
// Deliberately NOT a `--host` mode: the page spawns processes and reads files, and the answer to
// "serve it to the team" is `ssh -L`, not TLS in front of this (`PLAN_M239` decision 1).

const TOKEN_COOKIE = 'tflw-ui-token';
/** One MiB — a `PUT /api/file` of the largest `.tflw` in either repository is under 100 KiB. */
export const BODY_CAP = 1 << 20;
/** Runs the server remembers (`D1277`); the report directories on disk are the durable record. */
export const RUNS_KEPT = DEFAULT_RUNS_KEPT;
/** Stdout lines buffered per run for late subscribers; a workload prints one event per sample. */
export const LINES_KEPT = 50_000;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** The hostname of a `Host` header, without its port; `null` when there is no usable one. */
export function hostnameOf(host: string | undefined): string | null {
  if (host === undefined) return null;
  const m = /^(\[[^\]]*\]|[^:\s]+)(?::\d{1,5})?$/.exec(host.trim());
  return m ? m[1]!.toLowerCase() : null;
}

function sameToken(candidate: string | null | undefined, token: string): boolean {
  if (typeof candidate !== 'string') return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** How the request proved it is the page's — or `null`. Query and header are the page's own doing;
 *  the cookie is the browser's, which is why callers ask *which*. */
export function credentialOf(req: IncomingMessage, url: URL, token: string): 'header' | 'query' | 'cookie' | null {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ') && sameToken(auth.slice('Bearer '.length).trim(), token)) return 'header';
  if (sameToken(url.searchParams.get('token'), token)) return 'query';
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === TOKEN_COOKIE && sameToken(part.slice(eq + 1).trim(), token)) return 'cookie';
  }
  return null;
}

/** The refusal the boundary makes before any route runs, or `null`. Pure over the request's
 *  headers so a test can enumerate the forgeries without a socket. */
export function boundaryRefusal(req: IncomingMessage, url: URL, token: string): { status: number; error: string } | null {
  const host = hostnameOf(req.headers.host);
  if (host === null || !LOOPBACK.has(host)) return { status: 421, error: 'tflw ui answers to 127.0.0.1 or localhost only' };
  const origin = req.headers.origin;
  if (origin !== undefined && origin.toLowerCase() !== `http://${req.headers.host!.trim().toLowerCase()}`) {
    return { status: 403, error: 'this request came from another page — tflw ui takes requests from its own page only' };
  }
  const path = url.pathname;
  const method = req.method ?? 'GET';
  const api = path.startsWith('/api/');
  if (api || path === '/trace' || path.startsWith('/trace/')) {
    const credential = credentialOf(req, url, token);
    // A navigation is a GET: the viewer's assets, a report file. Nothing the browser does on its
    // own posts, so the cookie buys no verb but that one.
    const navigational = (method === 'GET' || method === 'HEAD') && (!api || /^\/api\/reports\/[^/]+\/.+$/.test(path));
    if (credential === null || (credential === 'cookie' && !navigational)) {
      return { status: 401, error: 'this session\'s token is missing — open the URL `tflw ui` printed, which carries it' };
    }
  }
  if (api && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    const length = Number(req.headers['content-length'] ?? '0');
    if (Number.isFinite(length) && length > BODY_CAP) return { status: 413, error: `a request body is at most ${BODY_CAP >> 10} KiB` };
    const hasBody = length > 0 || req.headers['transfer-encoding'] !== undefined;
    if (hasBody && !/^application\/json\s*(;|$)/i.test(String(req.headers['content-type'] ?? ''))) {
      return { status: 415, error: 'a request body is `application/json`' };
    }
  }
  return null;
}

/** A `Content-Security-Policy` for an HTML document this server serves: `'self'` for what the
 *  page loads, and each inline `<script>` admitted by its hash rather than by `'unsafe-inline'`
 *  (`D1318`). `nonce` is for the one inline script the page's own `index.html` carries.
 *
 *  `workers` is the trace viewer's shape, and it is looser in exactly one place, measured rather
 *  than assumed (`M239` `C`, the page suite's trace test): the viewer renders every DOM snapshot
 *  in an `<iframe>` whose document is **synthesised by its service worker**, and Chromium checks
 *  `frame-src` against the response's URL, which for a synthesised response is the empty string —
 *  *"Framing '' violates … frame-src 'self' blob:"*. No source expression matches an empty URL, so
 *  the viewer's policy names no `frame-src` and no `default-src` for it to fall back to, and says
 *  the rest (`object-src`, `media-src`, `manifest-src`) explicitly instead. Script, connect and
 *  worker sources stay `'self'`, which is what the policy is for. */
export function documentPolicy(html: string, opts: { readonly nonce?: string; readonly framedBy: 'none' | 'self'; readonly workers?: boolean }): string {
  const hashes: string[] = [];
  for (const m of html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    hashes.push(`'sha256-${createHash('sha256').update(m[1]!).digest('base64')}'`);
  }
  const script = ["'self'", ...(opts.nonce ? [`'nonce-${opts.nonce}'`] : []), ...hashes, ...(opts.workers ? ['blob:'] : [])].join(' ');
  return [
    ...(opts.workers ? [`object-src 'none'`, `media-src 'self' blob:`, `manifest-src 'self'`] : [`default-src 'self'`, `frame-src 'self'`]),
    `script-src ${script}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,
    `connect-src 'self'${opts.workers ? ' blob: data:' : ''}`,
    `worker-src ${opts.workers ? "'self' blob:" : "'none'"}`,
    `frame-ancestors '${opts.framedBy}'`,
    `base-uri 'none'`,
    `form-action 'none'`,
  ].join('; ');
}

const NONCE_PLACEHOLDER = '__TFLW_NONCE__';

/** The page a token-less visit gets: one sentence, no path, and the way in. */
const NEEDS_TOKEN_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>tflw</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:40em;margin:4em auto;padding:0 1em}code{font-family:ui-monospace,monospace}</style></head>
<body><h1>tflw ui</h1><p>This page opens from the URL <code>tflw ui</code> printed, which carries this session's token.
Copy that URL from the terminal — or restart <code>tflw ui</code> and let it open the browser.</p></body></html>
`;

export interface ProjectTest {
  readonly name: string;
  readonly tags: readonly string[];
  readonly line: number;
  readonly workload: boolean;
  /**
   * Which of the four doors this test appears behind (`D1043`), **derived from the constructs it
   * carries** — never from `@load`, `@security` or any other tag, which the runtime has never read.
   * Computed by `lensesOfTest` in `@tflw/lang` so that this server and the page compute it with
   * the same code rather than with two implementations that can disagree.
   *
   * Empty is a real answer: a test of nothing but `let` and `expect {v}` does none of the four
   * kinds of work. Measured over both repositories, 22 of 761 tests are empty here, and three of
   * those are empty because their whole body is one `call` into an action declared in an imported
   * file — evidence one indirection away, which a per-test pure function cannot follow.
   */
  readonly lenses: readonly Lens[];
  /**
   * The `as <session>` names this test runs under, in source order (`M205` S5b).
   *
   * **Empty is `anonymous`, and that is a fact rather than an absence.** `anonymous` is the one
   * principal nobody declares — `checker.ts`'s `RESERVED_PRINCIPAL`, in every authorization probe
   * set without being written down — so a test with no `as` clause is not *unauthenticated by
   * omission*, it runs as a named identity the config cannot shadow. The Auth tab says so, which
   * is the whole reason this field travels: without it the page can show which sessions a project
   * *declares* and not which ones its tests actually *use*, and those two lists are different in
   * every project that has ever deleted a test.
   *
   * Order is significant and kept: `as admin, userA` lets the later-listed session win a header
   * conflict against the earlier one (SPEC §3.3), so a sorted or de-duplicated list here would be
   * a different declaration from the one in the file.
   */
  readonly sessions: readonly string[];
  /**
   * How many steps of each kind this test's body carries (`M206` `S4`) — what the Auth tab needs to
   * stop saying something false.
   *
   * `S5b`'s panel said *who this file runs as* with no qualification. SPEC §3.3 says **a session
   * does not log the browser in**: its cached state is never applied to the test's fresh browser
   * context, because a cookie jar and a browser context's storage state are two representations
   * `D10` deliberately never bridges. So a session reaches a test's **api** steps and nothing else,
   * and on the 145 tests measured behind both the API and BROWSER doors the old sentence was true
   * of half a file and false of the other half (`M206-01`).
   *
   * Counts rather than a boolean, because *this test has 9 page steps and no api step* is a
   * different thing to tell an author than *this test is a browser test*. Computed by
   * `stepLensCounts` in `@tflw/lang`, which shares its walk with `lensesOfTest` — a second
   * traversal is how the day a block type is added ends with one reader knowing and one not.
   *
   * **THREE LENSES, NOT FOUR** (`M207-01`, `M207` `S3`). `M206` `S4` typed this `Record<Lens,…>`
   * and so shipped a `load` bucket that was structurally incapable of being non-zero: the LOAD lens
   * is not carried by statements at all, it comes from `test.workload` and `test.thresholds`, which
   * are properties of the test and not of its body. Nothing read it, so nothing was broken — but a
   * LOAD panel built by copying `S4`'s pattern would have said *"0 statements do load work"* on a
   * workload test. `StepLens` is the language's own name for the narrower set, so this declaration
   * now cannot widen back without the three maps in `lenses.ts` widening first.
   */
  readonly steps: Readonly<Record<StepLens, number>>;
}

/** A `crawl` declaration — the SCANS door's own, and a sibling to `test` rather than a kind of
 *  one (`D432`). Its lenses are always `['scan']`. */
export interface ProjectCrawl {
  readonly name: string;
  readonly line: number;
  readonly lenses: readonly Lens[];
  /** As `ProjectTest.sessions` — a crawl takes `as` too, and the SCANS door is where the principal
   *  a request is issued under matters most. */
  readonly sessions: readonly string[];
}

export interface ProjectFile {
  /** Relative to the root, `/`-separated. */
  readonly path: string;
  readonly tests: readonly ProjectTest[];
  readonly crawls: readonly ProjectCrawl[];
  /** Parse diagnostics, counted — the page shows the file as unparseable, the LSP shows why. */
  readonly diagnostics: number;
  /**
   * The error half of `diagnostics` (`M211` `S2`, `M202-01`/`M202-02`).
   *
   * **Counted apart because they mean different things about the list beside them.** A file with an
   * error did not parse: `tests` below is whatever panic-mode recovery salvaged, and how much it
   * salvaged is not knowable from here — measured over nine break shapes on a 12-test corpus file,
   * an unterminated `{`, `[` or nested object leaves **1 of 12**, while a truncated step, a stray
   * `}`, an unknown keyword, a bare `expect` and a stray `test` all leave **12 of 12**. A warning
   * costs nothing: the file parsed, and the list is the file's.
   *
   * **`warnings` is latent and filed as such (`M202-02`).** Measured across both corpora, **0 of 160
   * files** carry a warning with no error, so nothing has ever taken that branch. It is one field
   * and it is here rather than left to be found live, which is `M166`'s shape.
   */
  readonly errors: number;
  /** The warning half. See `errors`. */
  readonly warnings: number;
  /**
   * Every `import`/`use` this file declares, as a project-relative path — `M218` `C`.
   *
   * **One source, two deliveries.** The server's parse is the authority for both this field and
   * `GET /api/refactor`; the page holds a copy so a right-click can disable *Delete* with its
   * reason without a round trip (`D1146`), and the route re-derives at apply time so nothing acts
   * on a stale view (`D1150`). A specifier pointing outside the project is dropped, because it is
   * not something this explorer can reason about or repair.
   */
  readonly imports: readonly string[];
  /**
   * Every `action` this file declares, and **whether calling it puts a page on screen** — `M219`
   * `B` (`D1161`).
   *
   * The BROWSER door's Compose groups a body by **session**, and a session starts at an `open` or
   * at a `call` to an action that reaches one. That question cannot be answered from the file the
   * call is written in: 17 of the corpus's 258 browser tests have no `open` at all and every one
   * of them reaches its page through a `call`, usually to an action declared somewhere else.
   *
   * **So it is computed here, once, where every other index fact is computed** — from the same
   * parse, over every file in the project, to a fixpoint (an action that calls an action that
   * opens, opens). The page asks the index; it does not re-derive. The alternative the measurement
   * offered — *any `call` starts a session* — is right in all 167 calls inside browser-bearing
   * tests **by luck**: 18 of the 22 declared actions are api-only and are simply never called from
   * a browser test. One seeding helper called from a browser test breaks it silently.
   *
   * An action in a file this index could not parse is absent rather than `false`, which is the
   * same distinction `tests` already carries after a recovery.
   */
  readonly actions: readonly ProjectAction[];
}

/** An `action` declaration, as the index sees it (`M219` `B`). */
export interface ProjectAction {
  readonly name: string;
  readonly line: number;
  /** See `ProjectFile.actions`. */
  readonly opensPage: boolean;
}

/**
 * **A directory with no `tflw.config` is a project that has not started, not an error** — `M240`
 * `B` (`D1310`). `GET /api/project` answers this shape with a 200: the directory's basename only —
 * never the absolute path, which the 404 this replaces carried in its body (`D1318` said errors
 * carry none; this extends it to the unconfigured answer) — and the build stamp, so the landing can
 * still say which tflw this is. `noProject` stays beside `configured` for the readers that asked
 * it by that name (`e2e.test.ts`, the page's own probe).
 */
export interface UnconfiguredView {
  readonly configured: false;
  readonly noProject: true;
  /** The directory's basename. */
  readonly root: string;
  readonly version: BuildStamp;
}

export interface ProjectView {
  /** `true` on every project; the unconfigured answer is `UnconfiguredView`. */
  readonly configured: true;
  readonly root: string;
  /**
   * **Which tflw this is** — `M240` `F` (`M239-10`). The same stamp `tflw spec` prints, so the
   * page's corner, a report and a bug filed against a docs page all name one build. Additive: the
   * sibling's `verify-ui.mjs` reads this route and ignores fields it does not know.
   */
  readonly version: BuildStamp;
  readonly envs: readonly { name: string; isDefault: boolean }[];
  readonly reportDir: string;
  /** `resolved.helpers` (`D1319`) — the directories a `use` may load from, so the page's checker
   *  judges a `use` the way `tflw check` will. */
  readonly helpers: readonly string[];
  /**
   * The `tflw run` flags the page may set — `M241` `D` (`D1324`). Rows of `RUN_FLAGS`, read from the
   * table the CLI parses by, so the strip's `more…` never keeps a second list of what the CLI takes.
   */
  readonly runFlags: readonly PageRunFlag[];
  readonly files: readonly ProjectFile[];
  /** Whether `/trace/` serves Playwright's trace viewer — true when `playwright-core` resolves
   * from the project (`M192` U3). The page shows *open trace* when it does and the
   * `npx playwright show-trace` line when it does not. */
  readonly traceViewer: boolean;
  /** `D1047`'s scratch file, and whether git will ignore it (`M200` `A1-5`).
   *
   * The path is fixed so that exploring an endpoint always overwrites one file rather than
   * littering a project. `scratchIgnored` is an **exact-line** check against `.gitignore`, which
   * is the same shape `tflw init` writes with — so it is right for every project `init` made and
   * a *false negative* for a project whose ignore rule is spelled another way (`*.tflw`, a
   * directory rule, a global excludes file). A false negative costs a notice the author can
   * dismiss; the alternative — shelling out to `git check-ignore` — puts a subprocess behind a
   * read route for a line of advice. */
  readonly scratchPath: string;
  readonly scratchIgnored: boolean;
  /** `PLAY_SCRATCH` — a **basename**, joined to the directory of whichever file is played
   *  (`M221` `B`, `D1184`). Sent rather than hardcoded in the page for the reason every other
   *  filename here is: a name spelled in two places is how the send scratch's own rename went
   *  half-applied. */
  readonly playScratch: string;
  /** Whether `.gitignore` carries `PLAY_SCRATCH` as a line of its own. Same exact-line test as
   *  `scratchIgnored`, and a truer one here: the entry has no slash, so git matches it at any
   *  depth — which is exactly what a per-directory scratch needs. */
  readonly playIgnored: boolean;
  /**
   * The scratch file's current hash, or `null` when there is no scratch file (`M205` S3, closing
   * `M205-05`).
   *
   * The page needs it to write: `PUT /api/file` reads `If-Match: null` as *this file should not
   * exist yet*, so a page that guesses gets a `409` on its second Send. It used to learn it by
   * asking — `getFile(scratchPath).catch(() => null)` before every write — and on a project that
   * has never been explored that is a **`GET` whose only possible answer is `404`**, which the
   * browser logs as an error whether or not the caller catches it. A page that logs one benign
   * error by routine is a page whose next real error is invisible, which is the defect
   * mac-dashboard's `M13` found the expensive way.
   *
   * Seeding it here removes the request rather than silencing it, and the page carries the etag
   * forward from each write's own response. A scratch changed by another terminal therefore
   * surfaces as the `409` that guard exists for, instead of being papered over by a re-read.
   */
  readonly scratchEtag: string | null;
  /**
   * The env's `web` base, or `null` when it declares none (`M200` `A3-6`).
   *
   * The BROWSER door reads it for two things: composing the URL `tflw pick` opens, and knowing
   * whether picking is possible at all. A project with no `web` base cannot run a browser test
   * either — `TF0..`'s *every browser step in this env would be refused before it navigates* — so
   * saying it once on the door is better than saying it per step in a terminal.
   */
  readonly webBaseUrl: string | null;
  /**
   * The active env's authorization facts, so the page's `tflw check` preview can run
   * `checkAuthorizedTargets` (`M200` `A2-3`).
   *
   * **`D1052` said the form shows what `tflw check` will say, and for SCANS it could not.**
   * `diagnose` ran `checkProgram` with no options, and `TF060` — the one diagnostic certain to
   * fire on a fresh scan project, and the whole reason `D1053`'s scaffold exists — needs the
   * env's declarations and base URL. The page had no way to learn either, so the SCANS door
   * would have previewed a clean file and written one that fails in a terminal: exactly the
   * surprise `D1052` exists to prevent, on the one door where it is guaranteed rather than
   * possible.
   *
   * Read off `resolved`, like the rest of this function, because `resolve.ts` has already
   * composed `defaults` + `env` — a second composition here is the two-copies-of-one-rule shape
   * this file keeps warning about. Shaped as `EnvAuthorizedTargets` so the page hands it to the
   * checker unchanged rather than translating, which is where a second account would creep in.
   */
  readonly authorization: {
    readonly envName: string;
    /**
     * `resolved.authorizedTargets` — **including the `probe` opt-ins**, which the first draft of
     * this type left out. They travel on the wire whether the type names them or not, so omitting
     * them would have been a type that under-describes its own JSON; and they are not noise here,
     * because `probe mutating` is what lets `has no authorization violations` re-issue a write,
     * and a SCANS form has a use for knowing it.
     *
     * **One entry per *declaration*, not per origin, and `S5b` had that wrong until it measured
     * it.** The Auth tab was first written believing `resolveConfig` folds two declarations of one
     * origin into a merged row — the opt-ins do accumulate by OR, which is what the AST's own
     * docblock says. They accumulate **at the lookup**, and `resolve.ts` says why it declines to
     * fold them here: *"every declaration still travels to the report with its own reason, which
     * is the half of D291 that makes the claim auditable."* So a config declaring one host twice
     * for two different reasons produces two rows, both true, and a page that showed one merged
     * row would have thrown away the halves that are auditable.
     *
     * `line` and `block` are `S5b`'s addition and ride on the row rather than in a parallel list,
     * which was the other thing that draft got wrong: two arrays in the same order is a coupling
     * nothing checks, and this is the same row the reader is looking at. The element stays
     * assignable to `EnvAuthorizedTargets`, so the page still hands this to `checkAuthorizedTargets`
     * unchanged and there is still no translation step to drift.
     */
    readonly targets: readonly {
      readonly target: string;
      readonly reason: string;
      readonly probeMutating: boolean;
      readonly probeOversized: boolean;
      readonly probeTraversal: boolean;
      readonly probeCiphers: boolean;
      /** The line this declaration starts on in `tflw.config` — what Auth's `[edit]` jumps to. */
      readonly line: number;
      /** `defaults`, or the name of the env block it is written in. */
      readonly block: string;
    }[];
    readonly apiBaseUrl: string | null;
    readonly services: readonly { readonly name: string; readonly url: string }[];
    /**
     * The sessions `tflw.config` declares, as the **active env** gets them (`M205` S5b, Q6).
     *
     * Read off `resolved.sessions` and `resolved.sessionsOutOfScope` rather than off
     * `parsed.config.sessions`, for the reason `resolve.ts` states where it filters them: env
     * scoping happens in exactly one place so that *no consumer can disagree with another about
     * which sessions exist*. A page that re-applied `for env` here would be the fifth
     * establishment path, and the first one that runs in a browser.
     *
     * `outOfScope` is how a declared-but-not-here session still appears: the Auth tab has to be
     * able to say *`admin` is declared for `staging`, and you are on `local`*, which is the same
     * sentence `TF028` says and the one an author needs when a test names a session that resolves
     * to nothing.
     */
    readonly sessions: readonly {
      readonly name: string;
      /** `session <name> privileged` (`D307`/`D310`) — a claim that this principal is *meant* to
       *  reach other principals' resources, so `has no authorization violations` leaves it out of
       *  the probe set instead of reporting entitled access as a finding. */
      readonly privileged: boolean;
      /** `session <name> oauth2` — the client-credentials sugar. Mutually exclusive with a body,
       *  so `steps` is 0 whenever this is true. */
      readonly oauth2: boolean;
      /** The header names its body sets — what running `as` this session adds to every request.
       *  Names only: a session header's *value* is where a token lives, and this view is served
       *  to a browser. */
      readonly headers: readonly string[];
      /** How many steps establish it. A login is a request, not a declaration, and a reader
       *  deciding whether a session is cheap needs to know there are five of them. */
      readonly steps: number;
      /** Where the declaration starts in `tflw.config` — what Config's `[edit]` jumps to. */
      readonly line: number;
      /** `null` when the active env gets this session; otherwise the envs it *is* declared for. */
      readonly outOfScope: readonly string[] | null;
    }[];
  };
}

/**
 * Where `Send` writes. One file, overwritten, never merged — it is an exploration, not a suite.
 *
 * **The leading dot is load-bearing** (`M205` Q15, closing `M205-04`). It was `scratch.tflw`, and
 * `discoverTests` found it like any other test: after one explore-then-write the sidebar read
 * `2 files - 3 behind API` for two tests the author wrote, and a bare `tflw run` issued the same
 * request twice, reporting a test nobody thinks exists. `.gitignore` listed it, which is why this
 * was invisible — **being ignored by git is not being excluded from discovery**, and the two were
 * conflated.
 *
 * A dot is the whole repair, and it is the repair because it needs no code. `project.ts`'s walk
 * already skips every dot-prefixed entry, files and directories alike, so the scratch leaves
 * discovery in **every project, old and new**, with no `exclude` key to scaffold and no new
 * branch to keep true. `extname('.scratch.tflw')` is still `.tflw`, so `resolveWritablePath`
 * accepts it unchanged and `D1049`'s one write call site is untouched. An explicit file argument
 * is resolved rather than discovered (`cli.ts`'s run path, and `discoverTests`' own docblock says
 * so), so `Send`'s `tflw run .scratch.tflw` still runs it.
 */
export const SCRATCH_PATH = '.scratch.tflw';

/**
 * **Where ▶ writes, and it is a BASENAME rather than a path** — `M221` `B` (`D1184`).
 *
 * `SCRATCH_PATH` above is a path because there is one send scratch and it can live anywhere. This
 * one cannot: `imports.ts` resolves a `use "…"` against **`dirname(filePath)`** — in its own
 * words, *"`resolve(dirname(filePath), literal)` is not a choice — it is what `buildRegistry`, the
 * checker and the CLI all do"* — so a test in `tests/ui/storefront/` played from a scratch at the
 * project root resolves every relative import four directories from where it is written. The
 * scratch therefore goes **beside the file it copies**, and what is named once is the basename.
 *
 * `send` never met this because its scratch is a cut prefix of one API request; a whole browser
 * test carrying imports is a different animal.
 *
 * **The leading dot is load-bearing here for the same reason it is above, and for free.**
 * `project.ts`'s walk skips every dot-prefixed entry **at any depth**, not only at the root
 * (`if (e.name.startsWith('.') || e.name === 'node_modules') continue;`), so a `.play.tflw` in any
 * directory is invisible to discovery in every project, old and new, with no `exclude` key to
 * scaffold. `extname` is still `.tflw`, so `resolveWritablePath` accepts it unchanged and `D1049`'s
 * one write call site is untouched.
 */
export const PLAY_SCRATCH = '.play.tflw';

/**
 * Every file `tflw init` can write, under any flag — what `runInit` reports as `created`.
 *
 * A door's scaffold belongs here the day the CLI learns to write it; `A2-4` added `--scan` and
 * this list did not move for four commits. See `runInit` for why it is an allow-list and not a
 * directory read.
 */
export const SCAFFOLDED = ['tflw.config', 'example.tflw', 'load.tflw', 'scan.tflw', '.env.example', 'package.json'] as const;

/**
 * The config file, named once (`M205` S5b).
 *
 * Four sites in this file spelled it out — the read in `readProject`, the two *is this a project*
 * guards, and `SCAFFOLDED`'s first entry — and `S5b` adds two routes that write it. A fifth and
 * sixth literal of a filename is how the scratch's own rename went half-applied (`S3`: the
 * `.gitignore` entry and the write target were one fact spelled twice), so it is one constant
 * before the write arrives rather than after. `SCAFFOLDED` keeps its literal: that list is the
 * CLI's output, and a name drifting apart from it is a thing to notice rather than to hide.
 */
export const CONFIG_PATH = 'tflw.config';

/** What `tflw run` is asked for. Every field maps to one CLI flag, and nothing else reaches the
 * argv: the page cannot run anything a terminal could not. */
export interface RunRequest {
  readonly files?: readonly string[];
  readonly tags?: readonly string[];
  readonly only?: string;
  readonly env?: string;
  readonly workers?: number;
  /** `--evidence LEVEL` (`M200` `A1-5`) — `D1047`'s Send needs `full`, because that is the level
   *  at which a step record carries its `request` and `response` (§1). Raw text, validated by
   *  `runCommand` against `EVIDENCE_LEVELS` exactly as a terminal's `--evidence` is: the page
   *  cannot ask for a level a terminal could not. */
  readonly evidence?: string;
  /**
   * `--trace` (`M220` `B`, `D1170`) — keep the browser trace even on a pass.
   *
   * **▶ is the only caller, and that is `D1169` in one field**: a play is a run you expect to
   * pass, and the thing you press it to see is the trace afterwards. It maps to the flag a
   * terminal has, like every other field here — the page still cannot ask `tflw run` for anything
   * a terminal could not.
   */
  readonly trace?: boolean;
  /**
   * `--headed` (`M220` `D`, `D1173`) — a real browser window instead of a headless one.
   *
   * **The escape hatch, and the only answer for firefox and webkit.** `tflw run` has documented it
   * since M3c and `tflw watch` already uses it; it was unreachable from the page for the cost of
   * this one field. It is run-level, exactly as the flag is.
   */
  readonly headed?: boolean;
  /**
   * The strip's `more…` — `M241` `D` (`D1324`). Keyed by the flag's own spelling (`--bail`), each a
   * row the server offered in `ProjectView.runFlags`; a boolean for a switch, text for a value.
   */
  readonly flags?: Readonly<Record<string, string | boolean>>;
}

/** One row of `RUN_FLAGS` as the page reads it. */
export interface PageRunFlag {
  readonly flag: string;
  readonly shape: 'bool' | 'value' | 'list';
  readonly subject: 'always' | 'scan' | 'browser' | 'workload' | 'cli';
  readonly label: string;
  readonly hint: string;
}

/**
 * Why a request's `flags` cannot be run, or `null` — `D1324`. Only the rows the server offered, and
 * each in its own shape: a switch is `true` or `false`, a value is text on one line. Anything else
 * is refused with its name rather than dropped, because a flag the page believed it sent and the
 * run never saw is a run that answered a different question.
 */
export function runFlagsProblem(flags: unknown): string | null {
  if (flags === undefined) return null;
  if (typeof flags !== 'object' || flags === null || Array.isArray(flags)) return '`flags` is an object of flag to value';
  const rows = new Map(pageRunFlags().map((f) => [f.flag, f]));
  for (const [flag, value] of Object.entries(flags)) {
    const row = rows.get(flag);
    if (row === undefined) return `\`${flag}\` is not a flag the page can set`;
    if (row.shape === 'bool' ? typeof value !== 'boolean' : typeof value !== 'string' || /[\r\n]/.test(value)) {
      return `\`${flag}\` takes ${row.shape === 'bool' ? 'true or false' : 'one line of text'}`;
    }
  }
  return null;
}

export type RunStatus = 'running' | 'done' | 'cancelled';

export interface RunRecord {
  readonly id: string;
  readonly startedAt: string;
  readonly request: RunRequest;
  readonly argv: readonly string[];
  status: RunStatus;
  exitCode: number | null;
  /** The signal the child died of, when it did — `null` for a plain exit. */
  signal: string | null;
  endedAt: string | null;
  /** Where the run's report directory was kept, relative to the root, once it ended. */
  kept: string | null;
  /** Stdout lines this server no longer holds for replay (`D1317`); absent until the first one. */
  dropped?: number;
}

export interface ReportEntry {
  readonly id: string;
  readonly path: string;
  readonly at: string;
  /**
   * **The ARTEFACTS in this report directory** — `results.json`, `report.html`, `junit.xml` — and
   * it was called `files` until `M232` (`M213-19`, `D1271`).
   *
   * The carry is **a field name that is a category rather than a contract**. The first consumer to
   * read it as *the `.tflw` files this run executed* matched nothing and said nothing: `files`
   * is true of both sets and wrong about one of them, so the mistake was invisible at the call
   * site and cost two walks that open report payloads to answer a question the server already had.
   */
  readonly artefacts: readonly string[];
  /**
   * **Which `.tflw` files this run executed** (`D1271`) — the question `files` looked like it
   * answered.
   *
   * Measured free: `listReports` already reads and parses every directory's `results.json` to
   * build `summary`, so this is one `.map()` over what is in hand and **zero extra I/O**. That is
   * what turned the row's tentative *"consider a `tests` field"* into a decided one.
   */
  readonly tests: readonly string[];
  readonly summary: { ok: boolean; total: number; passed: number; failed: number } | null;
  /**
   * **This run is also `report/current`** — `M229` `E` (`D1254`).
   *
   * `keepReport` copies `report/` into `report/runs/<id>` entry by entry, so the newest kept run
   * and `current` are the same bytes under two names — and the list drew both, with nothing on
   * either row saying they were one run. Measured: *"current · 1/1 · 9/20/2026, 12:41:50 PM"* above
   * *"2026-09-20T10-41-50-120Z · 1/1 · 9/20/2026, 12:41:50 PM"*.
   *
   * **`current` is a property of a run, not a run**, so it is a flag on the row rather than a row.
   * And it stays a *separate row* in the one case where it is a separate run: `tflw run` in a
   * terminal writes `report/` and nothing keeps it, so there is no `runs/<id>` to carry the flag.
   * That is why this is decided by comparing the evidence rather than by taking the newest — the
   * plan's own warning was that folding on position hides a run instead of a duplicate.
   */
  readonly current?: boolean;
}

/** The argv `tflw run` gets for a request — pure, so a test can hold the mapping still. */
export function runArgv(req: RunRequest): string[] {
  const argv = ['run', '--format', 'ndjson', '--no-color'];
  if (req.env) argv.push('--env', req.env);
  if (req.workers !== undefined) argv.push('--workers', String(req.workers));
  // One `--tag a,b`, the CLI's own spelling (comma-joined, AND across the list).
  if (req.tags && req.tags.length > 0) argv.push('--tag', req.tags.join(','));
  if (req.only) argv.push('--only', req.only);
  if (req.evidence) argv.push('--evidence', req.evidence);
  // A boolean flag, so it is pushed on `true` alone — `false` and absent are the same request,
  // which is what keeps an ordinary run's argv byte-identical to what it was before `M220`.
  if (req.trace) argv.push('--trace');
  if (req.headed) argv.push('--headed');
  // `D1324` — the `more…` rows, from the table the CLI parses by. A value is written `--flag=value`,
  // the spelling the CLI keeps for exactly this: a value that starts with `--` stays a value.
  for (const row of pageRunFlags()) {
    const v = req.flags?.[row.flag];
    if (v === undefined || v === false || v === '') continue;
    argv.push(row.shape === 'bool' ? row.flag : `${row.flag}=${String(v)}`);
  }
  for (const f of req.files ?? []) argv.push(f);
  return argv;
}

/**
 * `tflw init [--load|--scan]` for a door — `M200` `A0-5` (`D1051`), amended by `A2-4` (`D1053`).
 *
 * The door decides what a new project is scaffolded with, which is the second half of `D1042`'s
 * "a door decides where you land and what the new-test button scaffolds, and nothing else".
 *
 * **`D1051` said "what it decides with is one flag, because `tflw init` has one flag", and `A2-4`
 * gave it a second.** That sentence is amended here rather than deleted, because the shape it
 * described was right and only its arithmetic moved: SCANS now gets `--scan` and therefore a
 * `scan.tflw` plus the commented `authorized target` `D1053` argues for. BROWSER still has no
 * scaffold of its own and still gets the plain project — stated rather than papered over, because
 * a door that pretended otherwise would be a brochure.
 */
/**
 * The absolute URL `tflw pick` opens for a path the author typed — `M200` `A3-6` (`D1055`).
 *
 * **`tflw pick` reads no config and requires an absolute URL, by its own design.** Its doc comment
 * says so: it *"has no notion of a `web` base URL"*, unlike `open "/path"` inside a `.tflw` file,
 * which resolves against one. So the gap between what an author types in a browser form — a path,
 * because that is what `open` takes — and what the command needs has to be closed by somebody, and
 * closing it here is the same shape as `A2-3`'s `authorization` block: the server hands the page a
 * fact composed from the config it already read, rather than the page assembling a second account
 * of what the config says.
 *
 * `null` when the env declares no `web` base, which is not a failure to report but a question to
 * answer: there is no page to pick from, and the door says so instead of spawning a browser at a
 * URL it invented.
 */
export function pickUrl(webBaseUrl: string | null, path: string): string | null {
  if (webBaseUrl === null) return null;
  const trimmed = path.trim();
  // Already absolute: the author pasted a whole URL, which `pick` takes verbatim. Anything else is
  // a path and joins the base, with exactly one slash between them however either was written.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  return `${webBaseUrl.replace(/\/+$/, '')}/${trimmed.replace(/^\/+/, '')}`;
}

/** What `tflw pick` gets — one URL and nothing else, so the page cannot ask for a session a
 *  terminal could not open. */
export function pickArgv(url: string): string[] {
  return ['pick', url];
}

/** What `tflw record` gets — `pickArgv`'s sibling, and the same rule: one URL and nothing else, so
 *  the page cannot ask for a session a terminal could not open (`M213` `S5`). */
export function recordArgv(url: string): string[] {
  return ['record', url];
}

export function initArgv(door: Lens): string[] {
  if (door === 'load') return ['init', '--load'];
  if (door === 'scan') return ['init', '--scan'];
  return ['init'];
}

/** The project as the page sees it: config envs, the discovered files, the tests in each. */
/** The build stamp, read once per process: under a bundle it is constants, under `tsx` one read of
 *  `package.json`, and a project read should not pay it again. */
let stampOnce: Promise<BuildStamp> | null = null;
const stamp = (): Promise<BuildStamp> => (stampOnce ??= buildStamp());

export async function readProject(root: string, envName?: string | null): Promise<ProjectView> {
  const configText = await readFile(join(root, CONFIG_PATH), 'utf8');
  const parsed = parseConfigSource(configText);
  const envs = parsed.config.envs.map((e) => ({ name: e.name, isDefault: e.isDefault }));
  /**
   * **The env the page is pointing at** — `M228` `F` (`D1248`).
   *
   * This took no argument until now, and the comment that stood here said the env did not matter:
   * *"the page reads `exclude`/`report dir` only — a URL override does not change either"*. That
   * was true when it was written and stopped being true at `A2-3`, which added `authorization` —
   * a **per-env** fact — and again at `M228` `A` (`D1240`), which hands that object to `diagnose`
   * so the pane can preview `TF060`.
   *
   * The consequence was a live contradiction of `D1052`. `RunStrip`'s `env` select changed what
   * `tflw run --env` graded and changed nothing about what the pane predicted, so an env with
   * different `authorized target` declarations produced exactly the surprise this function's own
   * docblock says the option exists to prevent: *the SCANS door would have previewed a clean file
   * and written one that fails in a terminal.* Same surprise, reached by a different route.
   *
   * **An unknown name falls back to the default rather than throwing.** The page's select is
   * populated from `envs` below, so it cannot offer a name the config does not hold; a mismatch
   * means the config changed under the page, and the page re-reads on every config write. Raising
   * here would take `GET /api/project` down for a stale dropdown value — the same failure mode
   * `ConfigPanel`'s header warns about, where a page allowed to write the config can lock itself
   * out of reading it.
   */
  const asked = envName != null && parsed.config.envs.some((e) => e.name === envName) ? envName : undefined;
  const env = selectEnv(parsed.config, asked === undefined ? { envVar: process.env.TFLW_ENV } : { flag: asked });
  const resolved = resolveConfig(parsed.config, env);
  const files: ProjectFile[] = [];
  /**
   * **`opensPage`, folded across the whole project** — `M219` `B` (`D1161`).
   *
   * Gathered while the files are read and resolved afterwards, because the answer is transitive
   * and an action's callee is usually in another file: `pageOpening` says *this body has an `open`*
   * and *this body calls these names*, and the fixpoint below turns the pair into one boolean per
   * action. Names are project-wide, which is how a `use "actions.tflw"` reaches one — an over-wide
   * resolution rather than a per-file one, and over-wide is the direction `D1076` tolerates.
   *
   * **The loop terminates because the set only grows**: each pass adds at least one name or stops,
   * and there are finitely many names. `checkActionCycles` already refuses a cyclic action, so the
   * cycle case is one the checker has red before this runs — but this does not depend on that, and
   * deliberately: an index that hung on a file the checker rejects would be a page that never
   * loads for the author trying to fix it.
   */
  const declared: { name: string; opens: boolean; calls: readonly string[] }[] = [];
  const perFile = new Map<string, { name: string; line: number }[]>();
  for (const file of await discoverTests(root, resolved.exclude, resolved.reportDir)) {
    const source = await readFile(file, 'utf8');
    const { program, diagnostics } = parseSource(source);
    const path = relative(root, file).split(sep).join('/');
    perFile.set(path, program.actions.map((a) => ({ name: a.name, line: a.span.start.line })));
    for (const a of program.actions) {
      const { opens, calls } = pageOpening(a.body);
      declared.push({ name: a.name, opens, calls });
    }
    files.push({
      path: relative(root, file).split(sep).join('/'),
      tests: program.tests.map((t) => ({
        name: t.name.value,
        tags: t.tags,
        line: t.span.start.line,
        workload: t.workload !== null,
        lenses: lensesOfTest(t),
        sessions: t.sessions,
        steps: stepLensCounts(t),
      })),
      // `crawls` is absent, not empty, on a program that declares none (`ast.ts:44` — it keeps
      // 31 parser goldens asserting what they were written to assert).
      crawls: (program.crawls ?? []).map((c) => ({ name: c.name.value, line: c.span.start.line, lenses: lensesOfCrawl(c), sessions: c.sessions })),
      imports: [...program.imports, ...program.uses]
        .map((d) => resolveSpecifier(relative(root, file).split(sep).join('/'), d.path.value))
        .filter((p): p is string => p !== null),
      diagnostics: diagnostics.length,
      errors: diagnostics.filter((d) => d.severity === 'error').length,
      warnings: diagnostics.filter((d) => d.severity === 'warning').length,
      actions: [],
    });
  }
  const opensPage = new Set(declared.filter((a) => a.opens).map((a) => a.name));
  for (;;) {
    const before = opensPage.size;
    for (const a of declared) {
      if (!opensPage.has(a.name) && a.calls.some((c) => opensPage.has(c))) opensPage.add(a.name);
    }
    if (opensPage.size === before) break;
  }
  const indexed: ProjectFile[] = files.map((f) => ({
    ...f,
    actions: (perFile.get(f.path) ?? []).map((a) => ({ ...a, opensPage: opensPage.has(a.name) })),
  }));
  const authorization = {
    envName: resolved.envName,
    targets: locateTargets(resolved.authorizedTargets, parsed.config, env),
    apiBaseUrl: resolved.apiBaseUrl,
    services: Object.entries(resolved.services).map(([name, url]) => ({ name, url })),
    sessions: sessionViews(parsed.config, resolved),
  };
  return { configured: true, root, version: await stamp(), envs, reportDir: resolved.reportDir, helpers: resolved.helpers, runFlags: pageRunFlags().map(({ flag, shape, subject, label, hint }) => ({ flag, shape, subject, label: label!, hint: hint ?? '' })), files: indexed, traceViewer: traceViewerDir(root) !== null, scratchPath: SCRATCH_PATH, scratchIgnored: isIgnored(root, SCRATCH_PATH), playScratch: PLAY_SCRATCH, playIgnored: isIgnored(root, PLAY_SCRATCH), scratchEtag: scratchEtagOf(root), authorization, webBaseUrl: resolved.webBaseUrl ?? null };
}

/**
 * The scratch file's hash, or `null` when it is not there (`M205` S3).
 *
 * Synchronous and beside `scratchIsIgnored` on purpose: both are one small read of one known path
 * at the edge of a route that already reads every test file in the project, and splitting them
 * across two shapes would suggest a difference that is not there.
 */
function scratchEtagOf(root: string): string | null {
  try {
    return etagOf(readFileSync(join(root, SCRATCH_PATH), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Give each resolved `authorized target` the line it is written on — what Auth's `[edit]` needs.
 *
 * **It matches by position, and that is sound here for a reason worth stating.**
 * `resolveConfig` pushes one row per `AuthorizedTargetDecl` as it walks `defaults` and then the
 * active env, in that order, accumulating rather than folding — its own comment says so twice and
 * says why (*"every declaration still travels to the report with its own reason"*). This walks the
 * same two blocks in the same order and collects the same declarations, so row *i* of one is
 * declaration *i* of the other. It cannot match by `target` instead: a config that declares one
 * origin twice is exactly the case this exists to render, and both rows would claim both lines.
 *
 * The length check is not defensive padding — it is the one thing that would make the pairing
 * wrong. If `resolveConfig` ever *did* fold rows, the counts would disagree and this returns the
 * resolved rows unlocated rather than pointing an `[edit]` at somebody else's line. Auth renders
 * a row with no line as a fact with no link, which is the truthful degradation.
 */
function locateTargets(
  targets: ResolvedConfig['authorizedTargets'],
  config: ConfigFile,
  env: EnvBlock,
): ProjectView['authorization']['targets'] {
  const sites: { line: number; block: string }[] = [];
  const collect = (entries: EnvBlock['entries'], block: string): void => {
    for (const entry of entries) {
      if (entry.type === 'AuthorizedTargetDecl') sites.push({ line: entry.span.start.line, block });
    }
  };
  if (config.defaults) collect(config.defaults.entries, 'defaults');
  collect(env.entries, env.name);
  const paired = sites.length === targets.length;
  return targets.map((t, i) => ({ ...t, line: paired ? sites[i]!.line : 0, block: paired ? sites[i]!.block : '' }));
}

/**
 * The declared sessions, as the active env gets them — `ProjectView.authorization.sessions`.
 *
 * **It walks `config.sessions` and asks `resolved` about each, rather than walking `resolved`.**
 * The two differ in exactly the case the Auth tab exists to show: a session declared `for env
 * staging` is absent from `resolved.sessions` while you are on `local`, and a list built from
 * `resolved` alone would render that as *this session does not exist* — which is the wrong
 * sentence and sends the reader to fix the test rather than the env clause. Declaration order is
 * the file's order for the same reason `sessions` on a test keeps source order: it is the order
 * a reader will find them in when they follow the `[edit]` link.
 */
function sessionViews(config: ConfigFile, resolved: ResolvedConfig): ProjectView['authorization']['sessions'] {
  return config.sessions.map((s) => ({
    name: s.name,
    privileged: s.privileged,
    oauth2: s.oauth2 !== null,
    // Names, never values. A session header is where a bearer token lives, and this object is
    // serialised to a browser — `redact` protects a *report*, and there is no redactor on this
    // route. The page has no use for the value either: Auth answers *what does running as this
    // add to my request*, which a header name answers and a secret does not.
    headers: s.body.flatMap((step) => (step.type === 'HeaderStmt' ? [step.name.value] : [])),
    steps: s.body.length,
    line: s.span.start.line,
    outOfScope: resolved.sessions.has(s.name) ? null : (resolved.sessionsOutOfScope.get(s.name) ?? []),
  }));
}

/**
 * Whether `.gitignore` carries an entry as a line of its own (`A1-5`, generalised by `M221` `B`).
 *
 * **It took the scratch path and now takes the entry**, because `M221` added a second scratch and
 * a second copy of a six-line function is how the first one's rename went half-applied. The play
 * scratch is a **basename** (`PLAY_SCRATCH`), and this test is *more* accurate for it than for the
 * path: a `.gitignore` line with no slash is git's own match-at-any-depth pattern, so the exact
 * line `\`.play.tflw\`` really does ignore every one of them.
 *
 * The same exact-line test `tflw init`'s own `ensureGitignore` writes with, and deliberately no
 * more: a project whose rule is `*.tflw` or a directory pattern gets a **false negative**, which
 * costs a dismissible notice. The accurate answer is `git check-ignore`, and putting a subprocess
 * behind a read route to render one line of advice is a worse trade than being wrong quietly in
 * the safe direction.
 */
function isIgnored(root: string, entry: string): boolean {
  try {
    const text = readFileSync(join(root, '.gitignore'), 'utf8');
    return text.split('\n').some((line) => line.trim() === entry);
  } catch {
    return false;
  }
}

/** Playwright's own trace viewer — the static page `npx playwright show-trace` serves — resolved
 * through the project the traces belong to, which is where its `playwright` is (`M192` U3, §2
 * q8: the archive is handed to Playwright's viewer, not to a viewer of tflw's). Served by this
 * process under `/trace/` so that a page reached over `ssh -L` opens a trace in the reader's own
 * browser, and nothing is spawned; the viewer fetches the archive from `/api/reports/…`, the same
 * origin. `null` when the project has no `playwright-core`, which is also a project that could
 * not have written a trace. */
export function traceViewerDir(root: string): string | null {
  try {
    const manifest = createRequire(join(root, 'package.json')).resolve('playwright-core/package.json');
    const dir = join(dirname(manifest), 'lib', 'vite', 'traceViewer');
    return existsSync(join(dir, 'index.html')) ? dir : null;
  } catch {
    return null;
  }
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ndjson': 'application/x-ndjson; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.sarif': 'application/json; charset=utf-8',
  '.tflw': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.zip': 'application/zip',
  '.map': 'application/json; charset=utf-8',
  // The trace viewer's own files (`M192` U3).
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

function contentType(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

/** A path under `base`, or null when the request escapes it — the one check every file route
 * runs, written once. `resolve` normalises `..`; the prefix test is on the separator boundary so
 * `report-evil/` cannot pass as `report/`. */
export function safeJoin(base: string, requested: string): string | null {
  const full = resolve(base, requested);
  const root = resolve(base);
  return full === root || full.startsWith(root + sep) ? full : null;
}

/** The identity of a file's bytes, for `If-Match`. A content hash and not an mtime: two writes
 *  inside one filesystem timestamp tick are indistinguishable by mtime, and a hash also survives
 *  a checkout that rewrites timestamps without changing content. Short because it is compared,
 *  never searched. */
export function etagOf(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

export interface FileWriteRefusal {
  readonly status: 400 | 404 | 409 | 422;
  readonly error: string;
  /** The diagnostic that stopped it, when the refusal is `422` and the text does not parse. */
  readonly code?: string;
  readonly line?: number;
}

/**
 * Resolve a client-supplied project-relative path to a `.tflw` file inside the root.
 *
 * Three refusals, each for its own reason: outside the root (the boundary this whole server is),
 * not a `.tflw` file (this route exists to write tests, and `tflw.config` or a `.env` reached
 * through it would be a different capability wearing this one's clothes), and an absolute or
 * drive-qualified path (which `resolve` would honour rather than join).
 */
export function resolveWritablePath(root: string, requested: string): string | FileWriteRefusal {
  if (requested.length === 0) return { status: 400, error: 'no path' };
  if (requested.includes('\0')) return { status: 400, error: 'not a path' };
  const full = safeJoin(root, requested);
  if (full === null) return { status: 400, error: 'outside the project' };
  if (extname(full) !== '.tflw') return { status: 400, error: 'only a .tflw file can be written here' };
  return full;
}

/**
 * The only function in this file that writes. Everything it refuses, it refuses *before* opening
 * anything for writing, so a rejected request leaves the file exactly as it was.
 *
 * `ifMatch` is the hash the client's edit was computed against: `null` means "this file should
 * not exist yet", which is how a new test file is created and how two pages racing to create the
 * same one are separated. A mismatch is `409` and carries the current hash, so the client can
 * re-read and re-apply rather than guess.
 *
 * The write itself goes to a sibling temp file and is renamed over the target. `rename` within a
 * directory is atomic on every filesystem tflw runs on, so a reader — `tflw run` in another
 * terminal, most likely — sees either the old file or the new one and never a half-written one.
 */
export async function writeProjectFile(
  root: string,
  requested: string,
  text: string,
  ifMatch: string | null,
): Promise<{ readonly path: string; readonly etag: string } | FileWriteRefusal> {
  const resolved = resolveWritablePath(root, requested);
  if (typeof resolved !== 'string') return resolved;

  // Parse before anything else: the page is the author, and this is the claim the page cannot be
  // trusted to make about itself.
  const { diagnostics } = parseSource(text);
  const error = diagnostics.find((d) => d.severity === 'error');
  if (error) {
    return { status: 422, error: error.message, code: error.code, line: error.span.start.line };
  }
  // And it must already be what `format` would write. Not a courtesy: it means the bytes the page
  // holds and the bytes on disk are the same bytes, so the next `If-Match` the page sends is
  // computed over something that exists. A server that silently reformatted would hand back an
  // etag for a file the page has never seen.
  const formatted = format(text);
  if (!formatted.ok) return { status: 422, error: formatted.reason ?? 'the text cannot be formatted' };
  if (formatted.formatted !== text) return { status: 422, error: 'the text is not formatted — run format() before sending it' };

  let current: string | null;
  try {
    current = await readFile(resolved, 'utf8');
  } catch {
    current = null;
  }
  if (current === null && ifMatch !== null) return { status: 404, error: 'no such file — omit If-Match to create it' };
  if (current !== null && ifMatch === null) return { status: 409, error: 'the file already exists — send its If-Match to replace it' };
  if (current !== null && etagOf(current) !== ifMatch) {
    return { status: 409, error: 'the file changed on disk since it was read' };
  }

  await atomicWrite(resolved, text);
  return { path: relative(root, resolved).split(sep).join('/'), etag: etagOf(text) };
}

/**
 * Write `text` to `full`, atomically — a sibling temp file renamed over the target.
 *
 * `rename` within a directory is atomic on every filesystem tflw runs on, so a reader — `tflw run`
 * in another terminal, most likely — sees either the old file or the new one and never a
 * half-written one. Extracted when `S5b` added the config route, and extracted rather than copied
 * **because atomicity is the property, not the file kind**: two capabilities write here now
 * (`D1049`'s `.tflw` route and `M205` Q5's config route) and a second copy of this is a second
 * chance to forget the `unlink` on the failure path.
 *
 * It is deliberately not a widening of `resolveWritablePath`, which is the thing Q5 refused: what
 * may be written is still decided by each caller, separately, before it gets here.
 */
async function atomicWrite(full: string, text: string): Promise<void> {
  await mkdir(dirname(full), { recursive: true });
  const temp = `${full}.tflw-ui-${randomBytes(6).toString('hex')}`;
  try {
    await writeFile(temp, text, 'utf8');
    await rename(temp, full);
  } catch (e) {
    await unlink(temp).catch(() => {});
    throw e;
  }
}

/**
 * Write `tflw.config` — `M205` Q5, closing `M205-03`.
 *
 * **A separate route rather than a wider `resolveWritablePath`, and the refusal it keeps intact is
 * the point.** That function turns away everything but a `.tflw` file because *"`tflw.config` or a
 * `.env` reached through it would be a different capability wearing this one's clothes"* — and
 * that is still true. So the config is a second capability with its own name, its own validation
 * and its own call site, which leaves `D1049`'s one-write-call-site property holding for `.tflw`
 * and makes *may this page edit the project's configuration* a question something could answer
 * later without also answering *may this page write tests*.
 *
 * **What it refuses.** The text must parse as the config dialect — `parseConfigSource` runs the
 * lexer, the declaration-only parser and `validateConfig`, so a `422` here covers a stray brace
 * and an `env` block with two `api` lines alike. That is the same bar `writeProjectFile` sets for
 * a test, and it is set here for a sharper reason: a config that does not parse takes
 * `GET /api/project` down with it, so a page allowed to write one could lock itself out of the
 * project it is editing.
 *
 * **What it does NOT refuse is formatting**, and the difference from `writeProjectFile` is not an
 * oversight. That route requires text `format` would already have produced, because the page there
 * is a *form* whose bytes come out of the printer, and a server that silently reformatted would
 * hand back an etag for a file the page has never seen. Here the page is a text editor and the
 * author's own bytes are the subject; nothing reformats them, the file on disk is byte-for-byte
 * what was sent, and so the etag returned is computed over exactly what the page holds. Refusing
 * an unformatted config would mean refusing to save a file `tflw fmt` would happily fix.
 *
 * `ifMatch` is required rather than optional, which is the other difference: a test file may be
 * *created* by a write, and `tflw.config` always already exists — a project with no config is not
 * a project, and `GET /api/project` answers `404` before this route is reachable.
 */
export async function writeConfigFile(
  root: string,
  text: string,
  ifMatch: string | null,
): Promise<{ readonly path: string; readonly etag: string } | FileWriteRefusal> {
  const full = join(root, CONFIG_PATH);
  const { diagnostics } = parseConfigSource(text);
  const error = diagnostics.find((d) => d.severity === 'error');
  if (error) {
    return { status: 422, error: error.message, code: error.code, line: error.span.start.line };
  }
  let current: string;
  try {
    current = await readFile(full, 'utf8');
  } catch {
    return { status: 404, error: `no ${CONFIG_PATH} here — this directory is not a tflw project yet` };
  }
  if (ifMatch === null) return { status: 409, error: `${CONFIG_PATH} already exists — send its If-Match to replace it` };
  if (etagOf(current) !== ifMatch) return { status: 409, error: `${CONFIG_PATH} changed on disk since it was read` };

  await atomicWrite(full, text);
  return { path: CONFIG_PATH, etag: etagOf(text) };
}

/**
 * Which project document an address names — `tflw.config`, or the baseline a named block declares
 * (`M208` `S2`, `Q2`/`D1060`).
 *
 * **The client names an env, never a path.** That is the whole safety argument for this route and
 * it is the same one `resolveWritablePath` makes by refusing everything but a `.tflw`: a page that
 * could hand this server a filename would be a general read-write-any-file capability wearing a
 * baseline's clothes. Here the *config* says which file, the server reads the config, and the only
 * thing that crosses the wire is a word that already appears in it. A path the page never chose is
 * a path the page cannot abuse.
 *
 * `safeJoin` still runs, because the config is authored by a person and `baseline "../../secrets"`
 * is a thing a person can type. The refusal is the project boundary, not the author's intent.
 *
 * `null` document (the address has no `@` segment) is `tflw.config` itself, which is what every
 * address written before `M208` means.
 */
export async function resolveBaselineDoc(
  root: string,
  asked: { readonly block: string } | { readonly env: string },
): Promise<{ readonly declaredIn: string; readonly path: string; readonly full: string } | FileWriteRefusal> {
  let configText: string;
  try {
    configText = await readFile(join(root, CONFIG_PATH), 'utf8');
  } catch {
    return { status: 404, error: `no ${CONFIG_PATH} here — this directory is not a tflw project yet` };
  }
  const { config } = parseConfigSource(configText);
  if ('env' in asked) {
    const found = blockForEnv(config, asked.env);
    if (found === null) {
      return {
        status: 404,
        error: config.envs.some((e) => e.name === asked.env)
          ? `no \`baseline\` is declared for env \`${asked.env}\` — declare one in ${CONFIG_PATH} to accept findings into it`
          : `${CONFIG_PATH} declares no env \`${asked.env}\``,
      };
    }
    return resolveBaselineDoc(root, { block: found });
  }
  const { block } = asked;
  const entries =
    block === 'defaults' ? (config.defaults?.entries ?? null) : (config.envs.find((e) => e.name === block)?.entries ?? null);
  if (entries === null) {
    return { status: 404, error: `${CONFIG_PATH} declares no ${block === 'defaults' ? '`defaults` block' : `env \`${block}\``}` };
  }
  // The LAST declaration, which is the one `resolveConfig` keeps — a block with two is `TF081` and
  // the page should show what a run would read, not what the author wrote first.
  const declared = [...entries].reverse().find((e) => e.type === 'BaselineDecl');
  if (declared === undefined) {
    return { status: 404, error: `${block === 'defaults' ? '`defaults`' : `env \`${block}\``} declares no \`baseline\`` };
  }
  const requested = declared.path.value;
  const full = safeJoin(root, requested);
  if (full === null) return { status: 400, error: `\`baseline "${requested}"\` resolves outside the project` };
  return { declaredIn: block, path: requested, full };
}

/**
 * Which **block** holds the baseline a run under this env grades against — `M208` `S3`.
 *
 * This is the address `[accept]` has to link to, and it is not always the env's own: a config that
 * declares `baseline` in `defaults` and not in `env prod` grades a `prod` run against the
 * `defaults` document, so `@defaults` is the document and `@prod` names nothing.
 *
 * **It is the same rule `resolveConfig` applies, written once more — so it is graded against
 * `resolveConfig` rather than against this comment.** Two implementations of one rule is the shape
 * `M169d5` is filed under, where a parity check agreed with itself while 43 wrong sites published;
 * `ui-server.test.ts` resolves every fixture both ways and compares the paths, so a change to
 * either side turns it red from either direction. The reason this cannot simply *call*
 * `resolveConfig` is that `resolveConfig` answers with a **path** and an address needs a **block**:
 * the path is the fact a run uses and the block is the fact a URL can name, and only the AST has
 * the second.
 *
 * `null` means no baseline is in force for that env at all, which is a real answer and not a
 * failure — it is every project that has not adopted triage.
 */
export function blockForEnv(config: ConfigFile, env: string): string | null {
  const has = (entries: readonly { type: string }[] | undefined): boolean => (entries ?? []).some((e) => e.type === 'BaselineDecl');
  if (has(config.envs.find((e) => e.name === env)?.entries)) return env;
  if (has(config.defaults?.entries)) return 'defaults';
  return null;
}

/**
 * Write a baseline document back — the editor half of `M208`, and `D1049` held at its own shape.
 *
 * **A third write capability, named for what it writes**, exactly as `writeConfigFile` was a
 * second. `D1049`'s property is *one write call site for `.tflw`*, and it is untouched here: this
 * route cannot name a `.tflw` file, cannot name any file at all, and reaches disk only through a
 * path `tflw.config` itself declares.
 *
 * **What it refuses is `parseBaseline`'s own bar**, which is the strictest one in this repository
 * for a documented reason: every failure mode of a baseline makes a build *greener*, so a document
 * that parses to *accepted nothing* is indistinguishable from a codebase that fixed everything.
 * The page is the author here and this is the claim the page cannot be trusted to make about
 * itself — the same sentence `writeProjectFile` carries.
 *
 * **`ifMatch === null` means create**, unlike `writeConfigFile` and like `writeProjectFile`. The
 * difference is real rather than an inconsistency: a project with no `tflw.config` is not a
 * project, so a config always already exists — while a *declared* baseline that has never been
 * written is the ordinary state of a project adopting triage, and `[accept]` on the first finding
 * is precisely the gesture that should create it.
 */
export async function writeBaselineDoc(
  root: string,
  block: string,
  text: string,
  ifMatch: string | null,
): Promise<{ readonly path: string; readonly etag: string } | FileWriteRefusal> {
  const doc = await resolveBaselineDoc(root, { block });
  if ('status' in doc) return doc;
  try {
    parseBaseline(text, doc.path);
  } catch (e) {
    return { status: 422, error: e instanceof Error ? e.message : String(e) };
  }
  let current: string | null;
  try {
    current = await readFile(doc.full, 'utf8');
  } catch {
    current = null;
  }
  if (current === null) {
    if (ifMatch !== null) return { status: 409, error: `${doc.path} is not there — send no If-Match to create it` };
  } else {
    if (ifMatch === null) return { status: 409, error: `${doc.path} already exists — send its If-Match to replace it` };
    if (etagOf(current) !== ifMatch) return { status: 409, error: `${doc.path} changed on disk since it was read` };
  }
  await mkdir(dirname(doc.full), { recursive: true });
  await atomicWrite(doc.full, text);
  return { path: doc.path, etag: etagOf(text) };
}

/**
 * `[Discard]` removes the scratch file — `M200` `A2-6`, closing §7's oldest open fork (`D1054`).
 *
 * **`A1-5` emptied it, and the measurement says emptying is not dropping.** An emptied
 * `scratch.tflw` is still a file, so `discoverTests` still found it, so `readProject` still
 * returned it and the landing's footer still counted it: a project with one test read
 * `2 files` forever after somebody explored an endpoint once and changed their mind. Nothing
 * clears it, because nothing else writes that path. Measured on a scaffolded project — `files=1`
 * before Send, `files=2` after, and **still `files=2` after Discard**.
 *
 * `M205` Q15's leading dot takes discovery out of that argument — a `.scratch.tflw` is invisible
 * to the walk whether it is empty or full — and Discard survives it intact, because counting was
 * never the whole reason. What is left is the one that does not depend on discovery: an author
 * who explored and changed their mind asked for the file to be **gone**, and a file that is empty
 * is still a file in their tree, in their editor's tab strip and in `git status`. The
 * measurement above is kept as written rather than trimmed to what still holds, because it is
 * what settled the fork.
 *
 * The fork was argued from the server's write surface and never from what the author sees, which
 * is how it came out wrong. `D1049`'s gate is *one `writeFile` call site*, and it stands here
 * untouched: this route does not write, and it takes **no path** — `SCRATCH_PATH` is a constant
 * of this module, so there is no parameter to point somewhere else. A general `DELETE /api/file`
 * would have been the widening `D1049` refuses; a verb that can only ever drop the scratch buffer
 * is the same guard narrowed to the new capability's own shape.
 *
 * `ifMatch` is kept for the reason `A1-5` had it: a scratch file that changed under the page is a
 * run in another terminal, and dropping it silently would be the one destructive surprise this
 * route can produce. Absent is success, not `404` — Discard's promise is that the file is gone,
 * and it is.
 */
export async function dropScratch(
  root: string,
  ifMatch: string | null,
): Promise<{ readonly removed: boolean } | FileWriteRefusal> {
  const resolved = resolveWritablePath(root, SCRATCH_PATH);
  // Unreachable — `SCRATCH_PATH` is a `.tflw` constant — but the refusal is relayed rather than
  // asserted away, so a future change to that constant fails loudly instead of deleting elsewhere.
  if (typeof resolved !== 'string') return resolved;

  let current: string | null;
  try {
    current = await readFile(resolved, 'utf8');
  } catch {
    current = null;
  }
  if (current === null) return { removed: false };
  if (ifMatch !== null && etagOf(current) !== ifMatch) {
    return { status: 409, error: 'the file changed on disk since it was read' };
  }
  await unlink(resolved);
  return { removed: true };
}

/**
 * Every `.tflw` in the project, as text — the input `ui-refactor` plans against.
 *
 * It re-reads rather than reusing `readProject`'s parse, because a plan must be computed against
 * the bytes on disk **now**: the page's view can be seconds old, and the one thing a destructive
 * route must not do is act on a project that has changed under it.
 */
async function projectTexts(root: string, exclude: readonly string[] | undefined, reportDir: string | undefined): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const file of await discoverTests(root, exclude, reportDir)) {
    out.set(relative(root, file).split(sep).join('/'), await readFile(file, 'utf8'));
  }
  return out;
}

/**
 * **Can this exact file be got back?** — `M218` `D` (`D1154`).
 *
 * `git ls-files --error-unmatch` answers *is this path tracked at HEAD*, which is the question that
 * matters. Checking for a `.git` directory was rejected at scoping as answering a different one: a
 * file created five minutes ago and never committed is exactly as gone inside a repository as
 * outside one, so a `.git`-based answer would reassure precisely the reader about to lose work.
 *
 * Three outcomes, and `'unknown'` is a real one rather than a failure — no git on `PATH`, or not a
 * repository at all. The dialog then says the flat *this cannot be undone*, which is never false.
 */
async function recoverability(root: string, path: string): Promise<'tracked' | 'untracked' | 'unknown'> {
  return await new Promise((done) => {
    let child: ChildProcess;
    try {
      child = spawn('git', ['ls-files', '--error-unmatch', '--', path], { cwd: root, stdio: 'ignore' });
    } catch {
      done('unknown');
      return;
    }
    // A timeout, because this sits in front of a dialog: a git that hangs on a network-backed
    // worktree must not hang the confirm with it.
    const timer = setTimeout(() => { child.kill(); done('unknown'); }, 2000);
    child.on('error', () => { clearTimeout(timer); done('unknown'); });
    child.on('close', (code) => {
      clearTimeout(timer);
      // 0 tracked, 1 not tracked; 128 is "not a git repository", which is `unknown` and not a no.
      done(code === 0 ? 'tracked' : code === 1 ? 'untracked' : 'unknown');
    });
  });
}

/**
 * Apply a plan. **Writes only after every member has been validated** (`D1151`) — `planMove`
 * returns an empty edit set when anything refused, so this can never see a half-good plan.
 *
 * `before` is the text each file held when the plan was computed, and it decides the `If-Match`
 * each write sends: a file already in it is being **rewritten** and carries its current etag, a
 * file absent from it is the move's destination and carries `null`, which is `writeProjectFile`'s
 * own *this should not exist yet*. The first draft sent `null` for every member, which is correct
 * for exactly one of them and a `409` for every importer.
 *
 * **The honest limit.** The apply routes read, plan and write inside one request, so the window in
 * which another writer could change a file between the read and the write is microseconds wide —
 * but it is not zero, and this does not pretend otherwise: a member whose etag no longer matches
 * refuses, and an earlier member may already have been written. That is the one partial state this
 * round can produce, it needs a concurrent writer to reach, and `409` names the file it stopped at.
 */
async function applyPlan(root: string, plan: RefactorPlan, before: ReadonlyMap<string, string>): Promise<{ ok: true } | FileWriteRefusal> {
  if (plan.refusals.length > 0) return { status: 409, error: plan.refusals.join('; ') };
  for (const edit of plan.edits) {
    const current = before.get(edit.path);
    const written = await writeProjectFile(root, edit.path, edit.text, current === undefined ? null : etagOf(current));
    if (!('etag' in written)) return written;
  }
  for (const gone of plan.removes) {
    const resolved = resolveWritablePath(root, gone);
    if (typeof resolved !== 'string') return resolved;
    await unlink(resolved).catch(() => {});
  }
  return { ok: true };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

const PREREAD = new WeakMap<IncomingMessage, string>();

async function readBody(req: IncomingMessage): Promise<string> {
  const pre = PREREAD.get(req);
  if (pre !== undefined) return pre;
  return (await readBodyCapped(req)) ?? '';
}

/** The body, or `null` once it passes `BODY_CAP` — at which point the socket is dropped rather
 *  than drained, because draining is the cost the cap exists to refuse. */
async function readBodyCapped(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > BODY_CAP) {
      req.destroy();
      return null;
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function sendFile(res: ServerResponse, path: string, headers: (body: Buffer) => Record<string, string> = () => ({})): Promise<boolean> {
  let s;
  try {
    s = await stat(path);
  } catch {
    return false;
  }
  if (!s.isFile()) return false;
  const body = await readFile(path);
  res.writeHead(200, { 'content-type': contentType(path), 'content-length': body.length, 'cache-control': 'no-store', ...headers(body) });
  res.end(body);
  return true;
}

/** `report.html` and the trace viewer's documents: a policy admitting exactly their own inline
 *  scripts, and nothing else on the report tree. */
function reportHeaders(path: string): (body: Buffer) => Record<string, string> {
  if (extname(path) !== '.html') return () => ({});
  return (body) => ({ 'content-security-policy': documentPolicy(body.toString('utf8'), { framedBy: 'none' }) });
}

const REPORT_MEMBERS = ['results.json', 'report.html', 'junit.xml', 'events.ndjson', 'findings.sarif', '.last-run.json'];

interface LiveRun {
  readonly record: RunRecord;
  readonly child: ChildProcess;
  /** Every stdout line so far — a subscriber that arrives late replays from here. */
  readonly lines: string[];
  readonly stderr: string[];
  readonly subscribers: Set<ServerResponse>;
  ended: Promise<void>;
}

export class UiServer {
  readonly server: Server;
  /** This session's token (`D1316`) — in the URL `tflw ui` prints, and nowhere else. */
  readonly token: string;
  private readonly runs = new Map<string, LiveRun>();
  private readonly staticDir: string;

  constructor(private readonly opts: UiServerOptions) {
    this.staticDir = opts.staticDir ?? join(dirname(opts.cliEntry), 'ui');
    this.token = opts.token ?? randomBytes(32).toString('base64url');
    this.server = createServer((req, res) => {
      this.handle(req, res).catch((e: unknown) => {
        // `D1318` — the page gets a sentence and the terminal gets the error. A Node message
        // routinely carries an absolute path and a stack, and the review (S7) read both off the
        // page of an empty directory.
        process.stderr.write(`tflw ui: ${req.method ?? 'GET'} ${req.url ?? '/'} failed — ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
        if (!res.headersSent) json(res, 500, { error: 'tflw ui hit an error answering this; the terminal it runs in has the details' });
        else res.end();
      });
    });
  }

  listen(port: number): Promise<number> {
    return new Promise((resolvePort, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, '127.0.0.1', () => {
        const address = this.server.address();
        if (address === null || typeof address === 'string') return reject(new Error('expected a TCP address'));
        resolvePort(address.port);
      });
    });
  }

  async close(): Promise<void> {
    for (const run of this.runs.values()) if (run.record.status === 'running') run.child.kill('SIGINT');
    this.server.closeAllConnections();
    await new Promise<void>((resolveClose, reject) => this.server.close((e) => (e ? reject(e) : resolveClose())));
  }

  /** The run's argv and its report directory, for the record and the copy. */
  private reportDirFor(): Promise<string> {
    return readProject(this.opts.root).then((p) => resolve(this.opts.root, p.reportDir));
  }

  /**
   * Run `tflw init` in the project root and report what it made.
   *
   * Everything it says is the CLI's own words — the created-file list on success, the refusal on
   * failure — because the page's account of what a project is has to be the tool's account or it
   * is a second one.
   */
  async runInit(door: Lens): Promise<{ readonly ok: boolean; readonly created: readonly string[]; readonly output: string; readonly exitCode: number | null }> {
    const argv = initArgv(door);
    const child = spawn(process.execPath, [...(this.opts.execArgv ?? []), this.opts.cliEntry, ...argv], {
      cwd: this.opts.root,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout!.setEncoding('utf8');
    child.stderr!.setEncoding('utf8');
    child.stdout!.on('data', (c: string) => { output += c; });
    child.stderr!.on('data', (c: string) => { output += c; });
    const exitCode = await new Promise<number | null>((done) => child.on('close', (code) => done(code)));
    // What is on disk afterwards, not what the child claimed: the page is a projection of the
    // files (`D985`), and that holds for the files it just asked for as much as for any other.
    //
    // **`SCAFFOLDED` IS THE LIST OF EVERY NAME `tflw init` CAN WRITE, AND IT IS A LIST BECAUSE
    // THIS ROUTINE MUST NOT REPORT ARBITRARY FILES.** `A2-6` found it holding four of five: the
    // names were written in `A0-5` when `load.tflw` was the only door-specific scaffold, `A2-4`
    // taught the CLI `--scan` without adding `scan.tflw` here, and so the SCANS door wrote the
    // file and told the page it had not — a projection reading the disk through a list that had
    // stopped describing it. Reading the *directory* instead was the obvious repair and is the
    // wrong one: `init` runs in a directory the author may already keep files in, and `created`
    // would start naming them. So the list stays, and the gate on it is that a door's scaffold is
    // asserted **on disk** before it is asserted here (`ui-server.test.ts`), which is the order
    // that can tell "not written" from "not reported".
    const created: string[] = [];
    for (const name of SCAFFOLDED) {
      if (existsSync(join(this.opts.root, name))) created.push(name);
    }
    return { ok: exitCode === 0, created, output: output.trim(), exitCode };
  }

  /** `runs keep N` from this project's `tflw.config` (`M241` `E`, `D1325`), read at each run so an
   *  edit in Config takes effect on the next one; the default when the file says nothing or cannot
   *  be read — a run is never refused over how much history to keep. */
  private async runsKept(): Promise<number> {
    try {
      const text = await readFile(join(this.opts.root, 'tflw.config'), 'utf8');
      return parseConfigSource(text).config.runs?.keep.value ?? DEFAULT_RUNS_KEPT;
    } catch {
      return DEFAULT_RUNS_KEPT;
    }
  }

  async startRun(request: RunRequest): Promise<RunRecord> {
    const keep = await this.runsKept();
    const id = new Date().toISOString().replace(/[:.]/g, '-');
    const argv = runArgv(request);
    const child = spawn(process.execPath, [...(this.opts.execArgv ?? []), this.opts.cliEntry, ...argv], {
      cwd: this.opts.root,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const record: RunRecord = { id, startedAt: new Date().toISOString(), request, argv, status: 'running', exitCode: null, signal: null, endedAt: null, kept: null };
    const live: LiveRun = { record, child, lines: [], stderr: [], subscribers: new Set(), ended: Promise.resolve() };
    this.runs.set(id, live);
    // `D1317` — the last `keep` (`runs keep N`, `D1325`; 50 by default), oldest ended run first; a
    // running one is never dropped.
    if (this.runs.size > keep) {
      for (const [oldId, old] of this.runs) {
        if (this.runs.size <= keep) break;
        if (old.record.status !== 'running') this.runs.delete(oldId);
      }
    }

    let buffered = '';
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => {
      buffered += chunk;
      let nl = buffered.indexOf('\n');
      while (nl !== -1) {
        const line = buffered.slice(0, nl);
        buffered = buffered.slice(nl + 1);
        if (line.length > 0) this.emit(live, line);
        nl = buffered.indexOf('\n');
      }
    });
    child.stderr!.setEncoding('utf8');
    child.stderr!.on('data', (chunk: string) => live.stderr.push(chunk));

    live.ended = new Promise<void>((done) => {
      child.on('close', (code, signal) => {
        if (buffered.length > 0) this.emit(live, buffered);
        record.exitCode = code;
        record.signal = signal;
        record.endedAt = new Date().toISOString();
        // `cancelled` is the server's own knowledge — `cancel()` marked it before signalling — and
        // not inferred from the signal: a child killed from outside (an OOM, a `kill` in a shell)
        // is `done` with its signal recorded, which is a different fact from the page asking.
        if (record.status === 'running') record.status = 'done';
        this.keep(live)
          .catch((e: unknown) => live.stderr.push(`could not keep the report directory: ${e instanceof Error ? e.message : String(e)}\n`))
          .finally(() => {
            for (const res of live.subscribers) {
              res.write(`event: end\ndata: ${JSON.stringify({ status: record.status, exitCode: record.exitCode, kept: record.kept })}\n\n`);
              res.end();
            }
            live.subscribers.clear();
            done();
          });
      });
    });
    return record;
  }

  private emit(live: LiveRun, line: string): void {
    live.lines.push(line);
    // `D1317` — bounded. Spliced in blocks so a long workload does not pay a shift per line; the
    // record on disk is whole, this buffer is what a late subscriber replays.
    if (live.lines.length > LINES_KEPT + 1000) {
      live.lines.splice(0, live.lines.length - LINES_KEPT);
      live.record.dropped = (live.record.dropped ?? 0) + 1000;
    }
    for (const res of live.subscribers) res.write(`data: ${line}\n\n`);
  }

  /** The page itself (`D1316`). `?token=` proves the visit and sets the cookie the navigational
   *  surfaces spend; a cookie alone redirects to a URL that carries the token, so a reload of a
   *  bare `http://127.0.0.1:4141/` works in a browser that has opened the page once; nothing at
   *  all gets one sentence and no path. The nonce is per response, and the bundle's `index.html`
   *  carries the placeholder on its one inline script. */
  private async sendPage(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const credential = credentialOf(req, url, this.token);
    if (credential === 'cookie') {
      res.writeHead(302, { location: `/?token=${this.token}`, 'cache-control': 'no-store' });
      res.end();
      return;
    }
    if (credential === null) {
      res.writeHead(401, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'" });
      res.end(NEEDS_TOKEN_PAGE);
      return;
    }
    const file = join(this.staticDir, 'index.html');
    let html: string;
    try {
      html = await readFile(file, 'utf8');
    } catch {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`tflw ui: the page's bundle is not built. \`npm run build\` in the tflw checkout produces it.\n`);
      return;
    }
    const nonce = randomBytes(16).toString('base64url');
    const body = Buffer.from(html.replaceAll(NONCE_PLACEHOLDER, nonce), 'utf8');
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': body.length,
      'cache-control': 'no-store',
      'set-cookie': `${TOKEN_COOKIE}=${this.token}; Path=/; HttpOnly; SameSite=Strict`,
      'content-security-policy': documentPolicy(html, { nonce, framedBy: 'none' }),
    });
    res.end(body);
  }

  /** `D1317` — why a run request's `files` cannot be run, or `null`. Judged after `realpath`, so
   *  a symlink out of the project is outside it. */
  private async outsideRoot(files: readonly unknown[]): Promise<string | null> {
    let root: string;
    try {
      root = await realpath(this.opts.root);
    } catch {
      return 'the project directory is gone';
    }
    for (const f of files) {
      if (typeof f !== 'string') return '`files` is a list of paths';
      let real: string;
      try {
        real = await realpath(resolve(this.opts.root, f));
      } catch {
        return `no \`${f}\` in the project`;
      }
      if (real !== root && !real.startsWith(root + sep)) return `\`${f}\` is outside the project — a run from the page stays inside it`;
    }
    return null;
  }

  /** Copy the report directory aside as `runs/<id>/` — the run's record, kept. Only the members
   * the contract names and the directories beside them; `runs/` itself is never copied into
   * itself. Skipped when the run wrote nothing (a usage error exits before any artefact) —
   * judged by `results.json`'s mtime against the run's start, not by its presence: a directory the
   * previous run left is present too, and `M192` U7's gate kept one as the record of a run that
   * had refused its own argv, then opened it as that run's report. */
  private async keep(live: LiveRun): Promise<void> {
    const reportDir = await this.reportDirFor();
    let written: Date;
    try {
      written = (await stat(join(reportDir, 'results.json'))).mtime;
    } catch {
      return;
    }
    if (written.getTime() < Date.parse(live.record.startedAt)) return;
    const dest = join(reportDir, 'runs', live.record.id);
    await mkdir(dest, { recursive: true });
    // Entry by entry rather than one `cp` of the directory: `fs.cp` refuses a destination inside
    // its source (`ERR_FS_CP_EINVAL`), and `runs/` is inside `report/` by design.
    for (const entry of await readdir(reportDir, { withFileTypes: true })) {
      if (entry.name === 'runs') continue;
      await cp(join(reportDir, entry.name), join(dest, entry.name), { recursive: true });
    }
    live.record.kept = relative(this.opts.root, dest).split(sep).join('/');
  }

  cancel(id: string): boolean {
    const live = this.runs.get(id);
    if (!live || live.record.status !== 'running') return false;
    live.record.status = 'cancelled';
    // SIGINT, the terminal's own gesture — `tflw run` handles it (EXIT_ABORTED, D-M32) and still
    // writes what it has, which is what makes the cancelled run's record openable.
    live.child.kill('SIGINT');
    return true;
  }

  private async listReports(): Promise<ReportEntry[]> {
    /** Two report directories hold the same evidence — order-independent, because `readdir` is. */
    const sameMembers = (a: readonly string[], b: readonly string[]): boolean => {
      if (a.length !== b.length) return false;
      const left = [...a].sort();
      const right = [...b].sort();
      return left.every((m, i) => m === right[i]);
    };
    const reportDir = await this.reportDirFor();
    const entries: ReportEntry[] = [];
    const describe = async (id: string, dir: string): Promise<{ entry: ReportEntry; results: string | null } | null> => {
      const present: string[] = [];
      for (const m of REPORT_MEMBERS) if (existsSync(join(dir, m))) present.push(m);
      if (present.length === 0) return null;
      let summary: ReportEntry['summary'] = null;
      let tests: string[] = [];
      let at = '';
      let results: string | null = null;
      try {
        const resultsPath = join(dir, 'results.json');
        at = (await stat(resultsPath)).mtime.toISOString();
        results = await readFile(resultsPath, 'utf8');
        const r = JSON.parse(results) as { ok: boolean; total: number; passed: number; failed: number; tests?: readonly { file?: unknown }[] };
        summary = { ok: r.ok, total: r.total, passed: r.passed, failed: r.failed };
        /* `D1271`, and the whole cost of it: the payload is already parsed for `summary` above.
           Deduplicated because a file with four tests in it appears four times, and a caller
           asking *did this run touch my file* wants the set. */
        tests = [...new Set((r.tests ?? []).map((x) => x.file).filter((f): f is string => typeof f === 'string'))].sort();
      } catch {
        // A directory with a report.html and no results.json is still a report; it just has no summary.
      }
      return { entry: { id, path: relative(this.opts.root, dir).split(sep).join('/'), at, artefacts: present, tests, summary }, results };
    };
    const current = await describe('current', reportDir);
    let kept: string[] = [];
    try {
      kept = (await readdir(join(reportDir, 'runs'))).sort().reverse();
    } catch {
      // no runs kept yet
    }
    /**
     * **Which kept run IS `current`** — `M229` `E` (`D1254`).
     *
     * The evidence decides it, not the position: the same `results.json` **and** the same member
     * list, because that is what `keepReport` copied — every entry of `report/` except `runs` — and
     * both are already in hand, so the comparison costs nothing. A timestamp would have been the
     * cheap answer and the wrong one (`cp` does not preserve mtimes, so the copy's is the copy's),
     * and *the newest* would have been cheaper still and wrong in the case that matters: a
     * `tflw run` in a terminal writes `report/` and keeps nothing, so `current` is then a run with
     * no row of its own, and folding it into the newest would hide it behind an unrelated run.
     *
     * **THE MEMBER LIST IS THE HALF THE SIBLING'S SWEEP ADDED, AND IT FOUND IT BY BEING A
     * CONSUMER.** `results.json` alone folds two directories that are the same *run* and not the
     * same *evidence*: `testFlow-tests`' `verify-ui.mjs` plants a stale `findings.sarif` into
     * `report/` and then reads `/api/reports` to watch it appear and go — which is `M192-03`'s own
     * grader — and the fold closed the only window it had. That is not a gate to loosen. A
     * `report/` carrying a member its kept copy does not is precisely the state `M192-03` filed,
     * so it is a row of its own and the list is right to say so.
     *
     * A report with no `results.json` is never folded. It cannot be compared, and `D1076`'s
     * direction is the safe one here: two rows for one run is a tidiness complaint, one row for two
     * runs is a lost run.
     */
    let foldedInto: string | null = null;
    if (current !== null && current.results !== null) {
      for (const id of kept) {
        const e = await describe(id, join(reportDir, 'runs', id));
        if (e !== null && e.results === current.results && sameMembers(e.entry.artefacts, current.entry.artefacts)) {
          foldedInto = id;
          break;
        }
      }
    }
    if (current !== null && foldedInto === null) entries.push({ ...current.entry, current: true });
    for (const id of kept) {
      const e = await describe(id, join(reportDir, 'runs', id));
      if (e) entries.push(id === foldedInto ? { ...e.entry, current: true } : e.entry);
    }
    return entries;
  }

  /** The project's `.tflw` texts, discovered with the config's own `exclude`/`report dir` so a
   *  plan sees exactly the files the sidebar does. */
  private async texts(): Promise<Map<string, string>> {
    const configText = await readFile(join(this.opts.root, CONFIG_PATH), 'utf8');
    const parsed = parseConfigSource(configText);
    const env = selectEnv(parsed.config, { envVar: process.env.TFLW_ENV });
    const resolved = resolveConfig(parsed.config, env);
    return await projectTexts(this.opts.root, resolved.exclude, resolved.reportDir);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // A request line starting `//` parses as protocol-relative and threw here, which the old catch
    // turned into a 500 with Node's message; a browser sends one for a `//?x` link. Collapsed, and
    // anything else that cannot be a URL is the client's 400.
    let url: URL;
    try {
      url = new URL((req.url ?? '/').replace(/^\/{2,}/, '/'), 'http://127.0.0.1');
    } catch {
      return json(res, 400, { error: 'not a URL this server can read' });
    }
    const path = url.pathname;
    const method = req.method ?? 'GET';

    // `D1318` — on every response, JSON included; the documents below replace the policy with
    // theirs. `setHeader` before `writeHead` so the routes' own header objects merge over these.
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
    const refusal = boundaryRefusal(req, url, this.token);
    if (refusal !== null) return json(res, refusal.status, { error: refusal.error });
    if (path.startsWith('/api/') && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      // Read once, here, under the cap — so a route's own `catch { 400 }` cannot turn an over-cap
      // body into "not JSON". `readBody` hands the routes this text.
      const text = await readBodyCapped(req);
      if (text === null) return json(res, 413, { error: `a request body is at most ${BODY_CAP >> 10} KiB` });
      PREREAD.set(req, text);
    }

    /* **An unconfigured directory, route by route** — `M240` `B` (`D1310`). "There is no project
       here" is a different answer from "this project is broken", and the landing has to tell them
       apart to know whether to offer to create one (`M200` `A0-5`). It used to be a 404 on
       `/api/project` alone, carrying the absolute root in its body, while `/api/reports` reached
       `readProject` and died with an `ENOENT` (logged on every landing over an empty directory).
       Now: the project route answers the unconfigured shape with a 200, the lists answer empty,
       `/api/init` and the in-memory run list work, and every route that would read or write the
       project answers 409 with one sentence — until `init` has run. */
    const unconfigured = !existsSync(join(this.opts.root, CONFIG_PATH));
    if (unconfigured && path.startsWith('/api/')) {
      if (path === '/api/project' && method === 'GET') {
        const view: UnconfiguredView = { configured: false, noProject: true, root: basename(this.opts.root), version: await stamp() };
        return json(res, 200, view);
      }
      if (path === '/api/reports' && method === 'GET') return json(res, 200, []);
      const allowed = path === '/api/init' || path === '/api/runs' || path.startsWith('/api/runs/') || path === '/api/config';
      if (!allowed) return json(res, 409, { error: 'this directory has no tflw.config yet — init first' });
    }
    if (path === '/api/project' && method === 'GET') {
      try {
        // `?env=` — `D1248`. Absent means *whatever the config calls default*, which is what every
        // caller before `M228` `F` got and what the page sends until somebody picks one.
        return json(res, 200, await readProject(this.opts.root, url.searchParams.get('env')));
      } catch (e) {
        return json(res, 400, { error: e instanceof Error ? e.message : String(e) });
      }
    }

    // `GET /api/file?path=x.tflw` — the source and its etag. Slice 1 never served a file's text
    // (`readProject` reads every file and returns only its tests), so the page had nothing to
    // edit and nothing to compute an edit against.
    if (path === '/api/file' && method === 'GET') {
      const requested = url.searchParams.get('path') ?? '';
      const resolved = resolveWritablePath(this.opts.root, requested);
      if (typeof resolved !== 'string') return json(res, resolved.status, { error: resolved.error });
      let text: string;
      try {
        text = await readFile(resolved, 'utf8');
      } catch {
        return json(res, 404, { error: `no ${requested}` });
      }
      return json(res, 200, { path: relative(this.opts.root, resolved).split(sep).join('/'), text, etag: etagOf(text) });
    }

    if (path === '/api/file' && method === 'PUT') {
      let request: { path?: unknown; text?: unknown };
      try {
        request = JSON.parse(await readBody(req)) as { path?: unknown; text?: unknown };
      } catch {
        return json(res, 400, { error: 'the write request is not JSON' });
      }
      if (typeof request.path !== 'string' || typeof request.text !== 'string') {
        return json(res, 400, { error: 'a write needs `path` and `text`' });
      }
      // `If-Match: *` is not accepted. HTTP reads it as "any current representation", which is
      // precisely the check this route exists to make — a client that cannot name the version it
      // edited has not read the file, and letting it through would make the 409 unreachable.
      const header = req.headers['if-match'];
      const ifMatch = typeof header === 'string' && header !== '*' ? header.replaceAll('"', '') : null;
      if (header === '*') return json(res, 400, { error: 'If-Match must name a version, not `*`' });
      const result = await writeProjectFile(this.opts.root, request.path, request.text, ifMatch);
      if ('status' in result) {
        const { status, ...rest } = result;
        return json(res, status, rest);
      }
      return json(res, 200, result);
    }

    // `GET /api/config` — `tflw.config`'s text and the version the next write is checked against
    // (`M205` S5b). Its own route rather than a field on `ProjectView`, because the Config tab is
    // the only reader and the project view is fetched on every refresh: a config is a file you
    // open, not a fact the shell needs.
    if (path === '/api/config' && method === 'GET') {
      let text: string;
      try {
        text = await readFile(join(this.opts.root, CONFIG_PATH), 'utf8');
      } catch {
        return json(res, 404, { error: `no ${CONFIG_PATH} here — this directory is not a tflw project yet`, noProject: true });
      }
      return json(res, 200, { path: CONFIG_PATH, text, etag: etagOf(text) });
    }

    // `PUT /api/config` — Q5, closing `M205-03`. See `writeConfigFile` for why this is a second
    // capability and not a wider `resolveWritablePath`.
    if (path === '/api/config' && method === 'PUT') {
      let request: { text?: unknown };
      try {
        request = JSON.parse(await readBody(req)) as { text?: unknown };
      } catch {
        return json(res, 400, { error: 'the write request is not JSON' });
      }
      if (typeof request.text !== 'string') return json(res, 400, { error: 'a config write needs `text`' });
      // `If-Match: *` is refused here for the reason it is refused above: it means *any current
      // representation*, which is exactly the check this header exists to make. There is no
      // create case for a config, so an absent header is a `409` from `writeConfigFile` rather
      // than the `null`-means-create the file route reads it as.
      const header = req.headers['if-match'];
      if (header === '*') return json(res, 400, { error: 'If-Match must name a version, not `*`' });
      const ifMatch = typeof header === 'string' ? header.replaceAll('"', '') : null;
      const result = await writeConfigFile(this.opts.root, request.text, ifMatch);
      if ('status' in result) {
        const { status, ...rest } = result;
        return json(res, status, rest);
      }
      return json(res, 200, result);
    }

    // `GET /api/baseline?doc=<defaults|env-name>` — a project document that is not `tflw.config`
    // (`M208` `S2`). The query names a **block of the config**, never a path; `resolveBaselineDoc`
    // is what turns it into a file, and it does so by reading the config rather than by trusting
    // the page.
    //
    // A declared document that is not on disk is `200` with `text: null`, not `404`. The
    // declaration is the thing the address names and it is really there — what is absent is the
    // file, which is the ordinary state of a project adopting triage and the state `[accept]`
    // exists to end. A `404` would have made *no such env* and *not written yet* the same answer,
    // and only one of them is a mistake.
    if (path === '/api/baseline' && method === 'GET') {
      // Two ways to ask, and they are different questions. `doc=` names a **block** and is what the
      // address carries; `env=` asks *which document would a run under this env grade against*,
      // which is what `[accept]` needs and is not always the env's own block — a config declaring
      // `baseline` only in `defaults` grades every env against that one (`blockForEnv`). The answer
      // carries `declaredIn`, so the page can build the `@block` address from it rather than
      // deriving the fallback a second time.
      const block = url.searchParams.get('doc');
      const env = url.searchParams.get('env');
      if ((block ?? '') === '' && (env ?? '') === '') {
        return json(res, 400, { error: 'which document? pass `doc=defaults`, `doc=<env>`, or `env=<env>`' });
      }
      const doc = await resolveBaselineDoc(this.opts.root, block ? { block } : { env: env! });
      if ('status' in doc) {
        const { status, ...rest } = doc;
        return json(res, status, rest);
      }
      let text: string | null;
      try {
        text = await readFile(doc.full, 'utf8');
      } catch {
        text = null;
      }
      return json(res, 200, { path: doc.path, declaredIn: doc.declaredIn, text, etag: text === null ? null : etagOf(text) });
    }

    // `PUT /api/baseline?doc=…` — see `writeBaselineDoc`. `If-Match` absent means *create*, which
    // is the difference from `PUT /api/config` and is the case `[accept]` on a first finding hits.
    if (path === '/api/baseline' && method === 'PUT') {
      // A **write** names a block and only a block: `env=` is a question about resolution and the
      // page has already had it answered by the `GET` above. A write that re-resolved could land in
      // a different document from the one the editor is showing.
      const block = url.searchParams.get('doc') ?? '';
      if (block === '') return json(res, 400, { error: 'which document? pass `doc=defaults` or `doc=<env>`' });
      let request: { text?: unknown };
      try {
        request = JSON.parse(await readBody(req)) as { text?: unknown };
      } catch {
        return json(res, 400, { error: 'the write request is not JSON' });
      }
      if (typeof request.text !== 'string') return json(res, 400, { error: 'a baseline write needs `text`' });
      const header = req.headers['if-match'];
      if (header === '*') return json(res, 400, { error: 'If-Match must name a version, not `*`' });
      const ifMatch = typeof header === 'string' ? header.replaceAll('"', '') : null;
      const result = await writeBaselineDoc(this.opts.root, block, request.text, ifMatch);
      if ('status' in result) {
        const { status, ...rest } = result;
        return json(res, status, rest);
      }
      return json(res, 200, result);
    }

    // `GET /api/pick?path=…` — a `tflw pick` session, streamed (`M200` `A3-6`, `D1055`).
    //
    // **ONE ROUTE, AND THE STREAM *IS* THE SESSION.** The obvious shape was three — start, stream,
    // stop — with a registry of live picks keyed by id. This is one, because binding the child's
    // life to the connection makes two whole classes of bug unconstructible rather than handled:
    // there is no id to leak, and **an orphan is impossible**, since a session that is never
    // streamed is never started. That property is worth more here than anywhere else in this
    // server: `tflw pick` opens a REAL, VISIBLE browser, and an orphaned one is a process somebody
    // has to find and kill on a machine they may be sharing.
    //
    // The response is `text/event-stream` and the body is the child's stdout, a line at a time,
    // unclassified. Which lines are locators is the page's question, and it has `@tflw/lang` to
    // answer it with — `pick` prints two banner lines and then one bare locator per click, and a
    // server that filtered by matching the banner text would be coupled to that wording.
    if ((path === '/api/pick' || path === '/api/record') && method === 'GET') {
      if (!existsSync(join(this.opts.root, CONFIG_PATH))) return json(res, 404, { error: 'not a tflw project here', noProject: true });
      let view: ProjectView;
      try {
        view = await readProject(this.opts.root);
      } catch (e) {
        return json(res, 400, { error: e instanceof Error ? e.message : String(e) });
      }
      const target = pickUrl(view.webBaseUrl, url.searchParams.get('path') ?? '');
      if (target === null) {
        return json(res, 409, { error: `env \`${view.authorization.envName}\` declares no \`web\` base, so there is no page to pick from — add \`web "http://localhost:3000"\` to tflw.config` });
      }

      /* **One route, two commands** (`M213` `S5`). Everything around the child — the config read,
         the URL composition, the line framing, the `SIGINT` on disconnect — is identical, and
         `D1106` is precisely the decision that what differs is *what the browser does with a
         click*, which is the command's business and not this route's. Duplicating the route to
         change one array element would be the two-implementations-of-one-picture failure at the
         server. */
      const argv = path === '/api/record' ? recordArgv(target) : pickArgv(target);
      const child = spawn(process.execPath, [...(this.opts.execArgv ?? []), this.opts.cliEntry, ...argv], {
        cwd: this.opts.root,
        env: { ...process.env, FORCE_COLOR: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });

      let buffered = '';
      child.stdout!.setEncoding('utf8');
      child.stdout!.on('data', (chunk: string) => {
        buffered += chunk;
        let nl = buffered.indexOf('\n');
        while (nl !== -1) {
          res.write(`data: ${JSON.stringify(buffered.slice(0, nl))}\n\n`);
          buffered = buffered.slice(nl + 1);
          nl = buffered.indexOf('\n');
        }
      });
      // stderr is the command's own diagnosis — no browser installed, no display, a URL it will
      // not take — and is the only thing the page can show when a session never starts. It goes
      // through as a named event rather than mixed into the locator lines.
      child.stderr!.setEncoding('utf8');
      child.stderr!.on('data', (chunk: string) => res.write(`event: problem\ndata: ${JSON.stringify(chunk)}\n\n`));
      child.on('close', (code) => {
        res.write(`event: end\ndata: ${JSON.stringify({ exitCode: code })}\n\n`);
        res.end();
      });
      // **`SIGINT`, not `SIGKILL`** — `pick` installs a handler that closes the browser session
      // (`M105`), so the signal the page sends is the one a terminal sends, and the window goes
      // with it. Killing the process outright would leave the browser it launched behind, which is
      // the exact failure this route's shape exists to prevent.
      req.on('close', () => {
        if (child.exitCode === null) child.kill('SIGINT');
      });
      return;
    }

    // `DELETE /api/scratch` — drop `D1047`'s scratch buffer (`M200` `A2-6`, `D1054`).
    //
    // No path, by construction: the one file this verb can reach is `SCRATCH_PATH`. See
    // `dropScratch` for why that is what keeps `D1049` intact rather than widened.
    if (path === '/api/scratch' && method === 'DELETE') {
      const header = req.headers['if-match'];
      if (header === '*') return json(res, 400, { error: 'If-Match must name a version, not `*`' });
      const ifMatch = typeof header === 'string' ? header.replaceAll('"', '') : null;
      const result = await dropScratch(this.opts.root, ifMatch);
      if ('status' in result) {
        const { status, ...rest } = result;
        return json(res, status, rest);
      }
      return json(res, 200, result);
    }

    // `POST /api/init` — create a project here (`M200` `A0-5`, `D1051`).
    //
    // **Spawned, not written.** This server writes through exactly one call site (`D1049`) and
    // that one writes `.tflw` files; a project is a `tflw.config`, an example, a `.env.example`
    // and a `package.json`. Rather than widen the write gate until it admits all of those, the
    // page asks the CLI to do it — the same way running is `tflw run` spawned — so the scaffolds
    // the page creates are byte-for-byte the scaffolds a terminal creates, and there is one
    // implementation of what a tflw project is.
    //
    // It needs no guard of its own against overwriting: `tflw init` refuses when a `tflw.config`
    // is already there and exits non-zero, and that refusal is relayed verbatim.
    if (path === '/api/init' && method === 'POST') {
      let request: { door?: unknown };
      try {
        request = JSON.parse(await readBody(req)) as { door?: unknown };
      } catch {
        return json(res, 400, { error: 'the init request is not JSON' });
      }
      if (typeof request.door !== 'string' || !LENSES.includes(request.door as Lens)) {
        return json(res, 400, { error: `a door is one of ${LENSES.join(', ')}` });
      }
      const result = await this.runInit(request.door as Lens);
      return json(res, result.ok ? 200 : 409, result);
    }

    if (path === '/api/run' && method === 'POST') {
      let request: RunRequest;
      try {
        const body = await readBody(req);
        request = body.length === 0 ? {} : (JSON.parse(body) as RunRequest);
      } catch {
        return json(res, 400, { error: 'the run request is not JSON' });
      }
      // `D1317` — the page runs files of this project and nothing else. `tflw run` itself takes any
      // path, which is right for a terminal and wrong for a route.
      const outside = await this.outsideRoot(request.files ?? []);
      if (outside !== null) return json(res, 400, { error: outside });
      const flagProblem = runFlagsProblem(request.flags);
      if (flagProblem !== null) return json(res, 400, { error: flagProblem });
      const record = await this.startRun(request);
      return json(res, 202, record);
    }

    if (path === '/api/runs' && method === 'GET') {
      return json(res, 200, [...this.runs.values()].map((r) => r.record).reverse());
    }

    const runMatch = /^\/api\/runs\/([^/]+)\/(events|cancel|stderr)$/.exec(path);
    if (runMatch) {
      const [, id, verb] = runMatch;
      const live = this.runs.get(id!);
      if (!live) return json(res, 404, { error: `no run ${id}` });
      if (verb === 'cancel' && method === 'POST') return json(res, 200, { cancelled: this.cancel(id!) });
      if (verb === 'stderr' && method === 'GET') return json(res, 200, { stderr: live.stderr.join('') });
      if (verb === 'events' && method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        for (const line of live.lines) res.write(`data: ${line}\n\n`);
        if (live.record.status !== 'running') {
          res.write(`event: end\ndata: ${JSON.stringify({ status: live.record.status, exitCode: live.record.exitCode, kept: live.record.kept })}\n\n`);
          res.end();
          return;
        }
        live.subscribers.add(res);
        req.on('close', () => live.subscribers.delete(res));
        return;
      }
      return json(res, 405, { error: `${method} ${path}` });
    }

    if (path === '/api/reports' && method === 'GET') {
      return json(res, 200, await this.listReports());
    }

    const reportFile = /^\/api\/reports\/([^/]+)\/(.+)$/.exec(path);
    if (reportFile && method === 'GET') {
      const id = decodeURIComponent(reportFile[1]!);
      const rest = reportFile[2]!;
      const reportDir = await this.reportDirFor();
      // The id is one path segment under `runs/`, or `current`; decoded first so that an encoded
      // `../` is judged as what it decodes to, not as a harmless literal that happens not to exist.
      if (id !== 'current' && (id.includes('/') || id.includes('\\') || safeJoin(join(reportDir, 'runs'), id) !== join(reportDir, 'runs', id))) {
        return json(res, 400, { error: 'not a report id' });
      }
      const base = id === 'current' ? reportDir : join(reportDir, 'runs', id);
      const file = safeJoin(base, decodeURIComponent(rest));
      if (file === null) return json(res, 400, { error: 'outside the report directory' });
      if (await sendFile(res, file, reportHeaders(file))) return;
      return json(res, 404, { error: `no ${rest} in ${id}` });
    }

    // ── `M218` — what a move or a delete would do, and then doing it ─────────────────────────
    //
    // **One function answers both questions** (`D1150`): `GET` previews, `POST`/`DELETE` apply, and
    // all three call `planMove`/`planDelete`. The apply routes re-read and re-plan rather than
    // trusting anything the page sends back, so a preview the reader left open for a minute cannot
    // be replayed against a project that has moved on.
    if (path === '/api/refactor' && method === 'GET') {
      const op = url.searchParams.get('op');
      try {
        const files = await this.texts();
        if (op === 'delete') {
          const target = url.searchParams.get('path') ?? '';
          const plan = planDelete(files, target);
          return json(res, 200, { ...plan, recovery: await recoverability(this.opts.root, target) });
        }
        if (op === 'move') {
          const from = url.searchParams.get('from') ?? '';
          const to = url.searchParams.get('to') ?? '';
          return json(res, 200, planMove(files, from, to));
        }
        return json(res, 400, { error: `unknown op ${op ?? '(none)'} — \`move\` or \`delete\`` });
      } catch (e) {
        return json(res, 400, { error: e instanceof Error ? e.message : String(e) });
      }
    }

    if (path === '/api/move' && method === 'POST') {
      try {
        const body = JSON.parse(await readBody(req)) as { from?: string; to?: string };
        const files = await this.texts();
        const plan = planMove(files, body.from ?? '', body.to ?? '');
        const done = await applyPlan(this.opts.root, plan, files);
        if (!('ok' in done)) return json(res, done.status, { error: done.error, refusals: plan.refusals });
        return json(res, 200, { moved: plan.subject, to: plan.to, rewrote: plan.edits.length - 1 });
      } catch (e) {
        return json(res, 400, { error: e instanceof Error ? e.message : String(e) });
      }
    }

    if (path === '/api/file' && method === 'DELETE') {
      try {
        const target = url.searchParams.get('path') ?? '';
        const files = await this.texts();
        const plan = planDelete(files, target);
        const done = await applyPlan(this.opts.root, plan, files);
        if (!('ok' in done)) return json(res, done.status, { error: done.error, importers: plan.importers });
        return json(res, 200, { deleted: target });
      } catch (e) {
        return json(res, 400, { error: e instanceof Error ? e.message : String(e) });
      }
    }

    if (path.startsWith('/api/')) return json(res, 404, { error: `no route ${method} ${path}` });

    // Playwright's trace viewer, from the project's own `playwright-core` (`traceViewerDir`).
    if (path === '/trace' || path.startsWith('/trace/')) {
      // `D1317` (S8) — the viewer fetches whatever `?trace=` names, so the name is judged here,
      // before anything else: a report file of this project, on this server, or nothing.
      const trace = url.searchParams.get('trace');
      if (trace !== null) {
        let named: URL | null = null;
        try {
          named = new URL(trace, 'http://127.0.0.1');
        } catch {
          named = null;
        }
        if (named === null || !LOOPBACK.has(named.hostname) || !/^\/api\/reports\/[^/]+\/.+$/.test(named.pathname)) {
          return json(res, 400, { error: 'the trace viewer opens this project\'s report files only' });
        }
      }
      const dir = traceViewerDir(this.opts.root);
      if (dir === null) return json(res, 404, { error: 'no playwright-core resolves from the project, so there is no trace viewer to serve; `npx playwright show-trace <archive>` opens one' });
      const wanted = path === '/trace' || path === '/trace/' ? 'index.html' : path.slice('/trace/'.length);
      const file = safeJoin(dir, decodeURIComponent(wanted));
      if (file === null) return json(res, 400, { error: 'outside the trace viewer' });
      // The viewer runs a service worker over `blob:` snapshots, which is what `workers` admits;
      // it is framed by the page, and by nothing else. **Every file under `/trace/` carries that
      // policy, not only the documents** — a service worker takes its policy from ITS OWN
      // SCRIPT'S response, and under the locked-down default (`default-src 'none'`) every
      // `fetch` inside `sw.bundle.js` failed as `ERR_FAILED` and no snapshot ever rendered.
      // Measured by the page suite's trace test before this line existed.
      const viewerHeaders = (p: string) => (body: Buffer) => ({ 'content-security-policy': documentPolicy(extname(p) === '.html' ? body.toString('utf8') : '', { framedBy: 'self', workers: true }) });
      if (await sendFile(res, file, viewerHeaders(file))) return;
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found\n');
      return;
    }

    // The page. A request for a path with no extension is the app's own routing, and gets
    // index.html; everything else is a file under the bundle or a 404.
    if (method !== 'GET' && method !== 'HEAD') return json(res, 405, { error: `${method} ${path}` });
    const wanted = path === '/' || extname(path) === '' ? 'index.html' : path.slice(1);
    if (wanted === 'index.html') return this.sendPage(req, res, url);
    const file = safeJoin(this.staticDir, wanted);
    if (file !== null && (await sendFile(res, file))) return;
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found\n');
  }
}

/** `tflw ui [dir] [--port N] [--no-open]` — parsed here so the mapping is testable without a
 * socket; returns the exit code for a usage error, or the options. */
export function parseUiArgs(argv: readonly string[], cwd: string): { root: string; port: number; open: boolean } | { usage: string } {
  let root = cwd;
  let port = UI_DEFAULT_PORT;
  let open = true;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--port') {
      const v = argv[++i];
      if (v === undefined || !/^\d+$/.test(v) || Number(v) > 65535) return { usage: `--port takes a number 0-65535, got ${v ?? 'nothing'}` };
      port = Number(v);
    } else if (a === '--no-open') {
      open = false;
    } else if (a.startsWith('--')) {
      return { usage: `unknown flag \`${a}\` for \`tflw ui\`` };
    } else {
      root = resolve(cwd, a);
    }
  }
  return { root, port, open };
}

/** Open the URL in the machine's browser — best effort, never awaited, never fatal. */
export function openInBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? ['open', url] : process.platform === 'win32' ? ['cmd', '/c', 'start', '', url] : ['xdg-open', url];
  try {
    spawn(cmd[0]!, cmd.slice(1), { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // no browser to open is not an error the server should die of
  }
}
