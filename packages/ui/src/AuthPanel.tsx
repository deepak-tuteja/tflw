// The Auth tab (`M205` S5b, Q6) — who this file's tests run as, and what they are permitted to
// reach.
//
// IT READS AND NEVER WRITES, AND THAT IS THE RULE'S SECOND CLAUSE DOING WORK. A tab is a stage of
// one file's life or *a project fact that file resolves against*, and this is the second kind: the
// sessions and the authorized targets live in `tflw.config`, not in the `.tflw` file the strip
// faces. Config is the one editor for that file (the user's own refinement during the grilling —
// two editors over one file is the drift class this codebase files most often), so everything
// editable here is an `[edit]` link into Config at the line that declares it, never a field.
//
// WHAT IT SHOWS THAT NEITHER OTHER TAB CAN. Source shows the file and Config shows the config;
// this is the join between them, and the join is where the mistakes are. A session named by a test
// and declared for another env resolves to nothing and the test runs anonymous — `TF028` says so
// at `tflw check` time, and until this tab there was nowhere on the page to see it at all.

import type { ReactNode } from 'react';
import { RESERVED_PRINCIPAL } from '@tflw/lang';
import type { Lens, ProjectView } from './contract';

type Session = ProjectView['authorization']['sessions'][number];
type Target = ProjectView['authorization']['targets'][number];

export interface AuthPanelProps {
  readonly project: ProjectView;
  /** The file the strip is facing. Auth is scoped to it: the project's other sessions are shown,
   *  but under a heading that says they are not this file's. */
  readonly path: string;
  /** Jump to Config, focused on a line — `hashForTab`'s third segment. */
  readonly onEdit: (line: number) => void;
  /**
   * Which door you came through (`M207` `S3`).
   *
   * The panel is one panel and the **facts are the same on all four** — one `tflw.config`, one
   * file, one set of sessions. What varies is which caveat about those facts matters where, and
   * each of the three below is a recorded property of the runtime rather than a per-door opinion:
   * BROWSER's is `D10`, LOAD's is `M146a`, SCANS' is `D307`/`D310`. A door that had its own panel
   * would be four accounts of one config; a panel with no door would have to state all three
   * caveats to every reader, which is how the shipped version came to state BROWSER's to everyone.
   */
  readonly door: Lens;
}

/** The four `probe` opt-ins as **what they grant**, which is Q6's answer: a checkbox cannot
 *  express this declaration, and neither can the clause's own name. Each sentence is the
 *  permission, in the tense a reader is deciding about. */
const PROBES: readonly [keyof Target, string][] = [
  ['probeMutating', 'an authorization probe may re-issue a POST/PUT/PATCH/DELETE here under another principal'],
  ['probeOversized', 'an input scan may send a 64 KiB value at this host’s inputs'],
  ['probeTraversal', 'an input scan may send `../`-shaped payloads here — it attempts a read, never a write'],
  ['probeCiphers', 'the TLS probe may open one handshake per candidate cipher suite here'],
];

export function AuthPanel({ project, path, onEdit, door }: AuthPanelProps) {
  const { envName, sessions, targets } = project.authorization;
  const file = project.files.find((f) => f.path === path) ?? null;

  // Every `as` name this file carries, in first-appearance order, with the tests that carry it.
  // First-appearance rather than sorted, for the reason the wire field keeps source order: the
  // order sessions are written in is the order a header conflict resolves in.
  const used = new Map<string, string[]>();
  for (const t of file?.tests ?? []) for (const name of t.sessions) used.set(name, [...(used.get(name) ?? []), t.name]);
  for (const c of file?.crawls ?? []) for (const name of c.sessions) used.set(name, [...(used.get(name) ?? []), `${c.name} (a crawl)`]);

  const declared = new Map(sessions.map((s) => [s.name, s]));
  const anonymousTests = (file?.tests ?? []).filter((t) => t.sessions.length === 0);
  const unused = sessions.filter((s) => !used.has(s.name));

  // `M206` `S4` — what a session actually reaches in this file. Summed over the file's tests from
  // the counts the server derived with `stepLensCounts`, so the page and the server classify a
  // step with the same code rather than with two accounts that can disagree (`D1043`'s habit).
  const apiSteps = (file?.tests ?? []).reduce((n, t) => n + t.steps.api, 0);
  const pageSteps = (file?.tests ?? []).reduce((n, t) => n + t.steps.browser, 0);
  /** The tests where the old sentence was worst: both kinds in one body, identity established
   *  twice, and a panel claiming one session covered it. */
  const mixed = (file?.tests ?? []).filter((t) => t.steps.api > 0 && t.steps.browser > 0);

  // `M207` `Q4` — the two sets `probeSetFor` (`interpreter.ts:5111`) divides the env's sessions
  // into. Derived here from the same wire field the SCANS door reads, so the page cannot disagree
  // with the runtime about who gets probed; `anonymous` is appended because it is the one principal
  // the set always contains and the config never declares.
  const excluded = sessions.filter((s) => s.privileged).map((s) => s.name);
  const probeSet = [...sessions.filter((s) => !s.privileged).map((s) => s.name), RESERVED_PRINCIPAL];

  return (
    <div className="authoring auth-panel" data-api-auth={file ? file.path : ''}>
      <header className="authoring-head">
        <h2>who this file runs as</h2>
        <p className="muted">
          The project facts <code>{path || 'this file'}</code> resolves against, in env <code>{envName}</code> — read here, edited in{' '}
          <em>Config</em>. Switch env with <code>--env</code> or <code>TFLW_ENV</code> and this page answers for that one.
        </p>
      </header>

      {/* `M207` `Q2` — RETITLED AND REFRAMED ONE DAY AFTER `M206` `S4` SHIPPED IT, deliberately.

          `S4` called this *what a session reaches here* and built it to answer a browser file that
          DOES log in. Measured across the corpora, **94% of files name no session at all** — 20 of
          the sibling's 319 tests, 9 of its 84 files, and zero in either the fixture or
          `examples/storefront`. So on the commonest file in every project the old title presupposed
          something that is not there, and the honest answer is that nothing here declares an
          identity and every request runs as `anonymous`.

          The anonymous case is therefore the HEADLINE and each door's caveat hangs off it, rather
          than the caveat being the frame. Editing a one-day-old mutation-checked block was the
          cheaper of the two options on the table: propagating a mis-framing to two more doors costs
          more than correcting it once. */}
      <section className="auth-block" data-auth-reach={`${apiSteps}/${pageSteps}`} data-auth-door={door}>
        <h3>identity in force here</h3>

        {used.size === 0 ? (
          <p data-auth-identity="anonymous">
            <strong>Nothing here declares an identity.</strong> No test in <code>{path || 'this file'}</code> carries an{' '}
            <code>as</code> clause, so every request it sends runs as <code>{RESERVED_PRINCIPAL}</code> — the built-in principal,
            not a missing one. A test opts into a credential by naming it: <code>test "…" as admin</code>.
          </p>
        ) : (
          <p data-auth-identity="named">
            <strong>
              {used.size} {used.size === 1 ? 'session is' : 'sessions are'} named by this file
            </strong>{' '}
            — {[...used.keys()].map((n) => <code key={n}>{n}</code>).reduce<ReactNode[]>((acc, el, i) => (i === 0 ? [el] : [...acc, ', ', el]), [])}. Every test
            that names none of them runs as <code>{RESERVED_PRINCIPAL}</code>.
          </p>
        )}

        <ul className="auth-list">
          {/* *api work* rather than *api steps*, because the count is the doors' own classification
              and an `expect status equals 200` does api work without being a request. Saying
              "steps a session folds into" would be the overclaim this panel was built to remove. */}
          <li data-auth-reach-api={apiSteps}>
            <strong>{apiSteps}</strong> {apiSteps === 1 ? 'statement does' : 'statements do'} api work — a session's headers and cookie
            jar fold into the requests among them
          </li>
          <li className={pageSteps > 0 ? 'warn' : ''} data-auth-reach-page={pageSteps}>
            <strong>{pageSteps}</strong> {pageSteps === 1 ? 'statement does' : 'statements do'} page work —{' '}
            {pageSteps === 0 ? 'none here' : 'identity on the page is established by the page'}
          </li>
        </ul>

        {/* THE DOOR'S OWN CAVEAT. One per door, each a recorded property of the runtime, and each
            the thing an author of THAT kind of work assumes wrongly. None of them is shown to a
            reader who did not come through the door it belongs to — which is the whole correction
            `Q2` makes, since the BROWSER one was being shown to all four. */}
        {door === 'browser' && pageSteps > 0 ? (
          <p className="muted" data-auth-no-bridge>
            <strong>A session does not log the browser in.</strong> Its cached state is never applied to the test's fresh browser
            context — a cookie jar and a browser context's storage state are two representations <code>D10</code> deliberately never
            bridges (SPEC §3.3). Whatever this file runs <em>as</em> below is a fact about its api steps only.
            {mixed.length === 0 ? null : (
              <>
                {' '}
                <span data-auth-mixed={mixed.length}>
                  {mixed.length} {mixed.length === 1 ? 'test' : 'tests'} here {mixed.length === 1 ? 'carries' : 'carry'} both kinds —{' '}
                  <em>{mixed.map((t) => t.name).join(', ')}</em> — so {mixed.length === 1 ? 'it establishes' : 'they establish'} identity
                  twice: an API login for the api steps, a form login for the page.
                </span>
              </>
            )}
          </p>
        ) : null}

        {/* `Q3`. Two facts, and the second is the analogue of BROWSER's refusal: true, deliberate,
            recorded, and the opposite of what an author assumes. `runScenarioTask` establishes each
            named session BEFORE VU scheduling begins, so `across 50 users as admin` is fifty VUs on
            one login; and `M146a`/`B3-20` keeps a re-established session's own requests out of the
            run's numbers — *"their latencies are missing from the run's numbers and their endpoints
            have no bucket"* — which matters because `threshold p95 duration` is computed over
            exactly the set that excludes them. */}
        {door === 'load' && used.size > 0 ? (
          <p className="muted" data-auth-load-caveat>
            <strong>Many users, one identity.</strong> A named session is established once, before the VUs are scheduled, so{' '}
            <code>across 50 users as admin</code> is fifty virtual users sharing a single login. Each iteration re-reads it fresh
            from the shared cache (<code>D44</code>), so a mid-run refresh reaches every VU and racing VUs dedupe to at most one
            real re-login (<code>M37</code>/<code>D45</code>).{' '}
            <strong>A re-login's own requests are absent from this run's numbers.</strong> The decision to re-establish is in the
            report and the requests it sent are not — their latencies are missing and their endpoints have no bucket
            (<code>M146a</code>) — so a <code>threshold p95 duration</code> here is computed over a set that excludes them.
          </p>
        ) : null}

        {/* `Q4`. This door INVERTS the block's premise: the identity in force is not one, it is all
            of them. `probeSetFor` builds the set of every declared session plus the built-in
            `anonymous`, and `has no authorization violations` replays each request as each of them.
            And `privileged` sessions are excluded from that set by design (`D307`/`D310`) — so a
            green result says nothing about what a privileged principal could reach, which is
            literally what this block is for. Both sets are named. */}
        {door === 'scan' ? (
          <p className="muted" data-auth-scan-caveat data-auth-probe-set={probeSet.length} data-auth-probe-excluded={excluded.length}>
            <strong>Here the identity in force is not one — it is all of them.</strong>{' '}
            <code>has no authorization violations</code> replays each request as every principal in the probe set:{' '}
            {probeSet.map((n) => <code key={n}>{n}</code>).reduce<ReactNode[]>((acc, el, i) => (i === 0 ? [el] : [...acc, ', ', el]), [])}.
            {excluded.length === 0 ? (
              <> No session here is <code>privileged</code>, so the probe set is every session this env declares.</>
            ) : (
              <>
                {' '}
                <strong>
                  {excluded.length === 1 ? 'One session is' : `${excluded.length} sessions are`} excluded from it
                </strong>
                : {excluded.map((n) => <code key={n}>{n}</code>).reduce<ReactNode[]>((acc, el, i) => (i === 0 ? [el] : [...acc, ', ', el]), [])} —{' '}
                <code>privileged</code> means this principal is <em>supposed</em> to reach other principals' resources, so reporting
                the access it is entitled to would be a false finding (<code>D307</code>/<code>D310</code>). The consequence is the
                one worth reading here: <strong>a green result says nothing about what those principals could reach.</strong>
              </>
            )}
          </p>
        ) : null}
      </section>

      {/* THE ENUMERATION, AND IT DOES NOT RENDER WHEN THERE IS NOTHING TO ENUMERATE (`M207` `S3`).

          Before the reframe this block carried the sentence *"None — every test here runs as
          anonymous"*, which was the panel's only statement of that fact. `Q2` makes it the
          headline, so keeping the empty state here would say it twice on 94% of files — the
          duplicate-over-one-file class `Q1` refused between Compose and Auth, one block apart
          instead of one tab. The heading goes with it rather than standing over nothing: a heading
          with no rows under it is a claim that rows were expected. */}
      {used.size === 0 ? null : (
        <section className="auth-block" data-auth-sessions={used.size}>
          <h3>sessions this file’s tests run as</h3>
          <ul className="auth-list">
            {[...used].map(([name, tests]) => (
              <SessionRow key={name} name={name} tests={tests} session={declared.get(name) ?? null} envName={envName} onEdit={onEdit} />
            ))}
          </ul>
        </section>
      )}

      {/* `anonymous` is shown whether or not a test uses it, because it is the one principal that
          is never declared and therefore the one a reader cannot discover by looking at the
          config. `RESERVED_PRINCIPAL` is imported rather than spelled: the checker refuses a
          session by this name, and a page with its own copy of the string would go on claiming
          the reservation after somebody changed it. */}
      <section className="auth-block" data-auth-anonymous={anonymousTests.length}>
        <h3>
          <code>{RESERVED_PRINCIPAL}</code> — the principal nobody declares
        </h3>
        <p className="muted">
          Built in, and reserved: <code>tflw check</code> refuses a session by this name, because one would either shadow it or be
          shadowed by it in silence. It is the identity a test with no <code>as</code> clause runs as, and the one every{' '}
          <code>has no authorization violations</code> assertion probes with — which is how that assertion tests authorization
          rather than authentication.
        </p>
        <p className="muted" data-auth-anonymous-tests>
          {file === null
            ? 'no file open'
            : anonymousTests.length === 0
              ? `Every test in ${file.path} names a session, so nothing here runs as ${RESERVED_PRINCIPAL}.`
              : `${anonymousTests.length} of ${file.tests.length} tests in ${file.path} run as ${RESERVED_PRINCIPAL}: ${anonymousTests.map((t) => t.name).join(', ')}`}
        </p>
      </section>

      {/* `M207` `S5` — THE FACTS ARE HERE AND THE JUSTIFICATION IS ON THE DOOR THAT OWNS IT.

          This block opened with a paragraph explaining *why* the language demands an
          `authorized target`, beginning *"A scan issues requests nobody wrote…"*. Every sentence of
          it was true. The problem was that a **project-scoped block explained itself in one door's
          terms on all four** — prose written when Auth existed only on the API door (`M205` `S5b`)
          and generalised by propagation rather than by decision. It is `M207-02`'s family one level
          out, and `Q1` had already settled the principle for the other half of this same subject:
          Auth states what is in force, SCANS' Compose states the reason.

          So the rows stay — target, block, reason, granted probes, `[edit]` — under a heading, and
          the argument for the mechanism lives where somebody is about to use it. */}
      <section className="auth-block" data-auth-targets={targets.length}>
        <h3>authorized targets in force</h3>
        {targets.length === 0 ? (
          <p className="muted" data-auth-no-targets>
            None. Every security assertion and every <code>crawl</code> in this project is refused before it sends anything.
          </p>
        ) : (
          <ul className="auth-list">
            {targets.map((t, i) => (
              <TargetRow key={`${t.block}:${t.line}:${i}`} target={t} repeated={targets.filter((o) => o.target === t.target).length} onEdit={onEdit} />
            ))}
          </ul>
        )}
      </section>

      {unused.length === 0 ? null : (
        <section className="auth-block muted" data-auth-unused={unused.length}>
          <h3>declared here, not used by this file</h3>
          <ul className="auth-list">
            {unused.map((s) => (
              <li key={s.name} data-auth-unused-session={s.name}>
                <code>{s.name}</code>
                {s.outOfScope === null ? '' : ` — ${scopeNote(s, envName)}`}{' '}
                <button className="linkish" onClick={() => onEdit(s.line)} data-auth-edit={`session:${s.name}`} title={`open tflw.config at line ${s.line}`}>
                  [edit]
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** A session a test names. Three states, and the two that are not *fine* are the reason this tab
 *  exists: undeclared (the test runs anonymous and `TF028` says so), and declared for another env
 *  (same outcome, completely different repair). */
function SessionRow({ name, tests, session, envName, onEdit }: {
  readonly name: string;
  readonly tests: readonly string[];
  readonly session: Session | null;
  readonly envName: string;
  readonly onEdit: (line: number) => void;
}) {
  const resolves = session !== null && session.outOfScope === null;
  return (
    <li className={resolves ? '' : 'warn'} data-auth-session={name} data-auth-session-resolves={String(resolves)}>
      <header>
        <code>{name}</code>
        {session?.privileged ? <span className="chip" title="excluded from the authorization probe set — this principal is *meant* to reach other principals’ resources">privileged</span> : null}
        {session?.oauth2 ? <span className="chip" title="an OAuth2 client-credentials grant, not a hand-written login">oauth2</span> : null}
        {session === null ? null : (
          <button className="linkish" onClick={() => onEdit(session.line)} data-auth-edit={`session:${name}`} title={`open tflw.config at line ${session.line}`}>
            [edit]
          </button>
        )}
      </header>
      <p data-auth-session-what>
        {session === null
          ? `is not declared in tflw.config — these tests run as ${RESERVED_PRINCIPAL}, and \`tflw check\` refuses the file`
          : session.outOfScope !== null
            ? scopeNote(session, envName)
            : session.oauth2
              ? 'obtains a bearer token from its token URL before the run and sends it on every request made under it'
              : session.headers.length > 0
                ? `adds ${session.headers.map((h) => `\`${h}\``).join(', ')} to every request made under it, after ${session.steps} establishing step${session.steps === 1 ? '' : 's'}`
                : `${session.steps} establishing step${session.steps === 1 ? '' : 's'}, and no \`header\` line — what it carries is whatever cookies those steps set`}
      </p>
      <p className="muted" data-auth-session-tests={tests.length}>
        used by {tests.join(', ')}
      </p>
    </li>
  );
}

/** Declared for other envs — the sentence `TF028` says, in the place the reader is looking. */
function scopeNote(session: Session, envName: string): string {
  const envs = session.outOfScope ?? [];
  return envs.length === 0
    ? `is declared \`for env\` nothing this config names, so no env gets it`
    : `is declared for ${envs.map((e) => `\`${e}\``).join(', ')} and you are on \`${envName}\` — it resolves to nothing here`;
}

/**
 * One `authorized target` **declaration**, with its `probe` opt-ins rendered as what they grant.
 *
 * One row per declaration and not per origin, because that is what the config is: `resolveConfig`
 * accumulates rather than folds, so that *"every declaration still travels to the report with its
 * own reason, which is the half of D291 that makes the claim auditable."* Two rows naming one
 * origin is a real and readable state — two people authorized the same host for two reasons — and
 * merging them here would have shown a reason nobody wrote.
 *
 * It is also where the reader needs a warning, because the *effective* permission is not the row.
 * The opt-ins OR across every declaration of the origin at the moment they are looked up, so a
 * row showing none of them may still be reachable by a mutating probe granted three lines up. A
 * reader deciding whether a scan may write somewhere has to be told that, and the only place it
 * can be said is next to a row that does not say it by itself.
 */
function TargetRow({ target, repeated, onEdit }: {
  readonly target: Target;
  /** How many declarations in force name this same origin, this one included. */
  readonly repeated: number;
  readonly onEdit: (line: number) => void;
}) {
  const granted = PROBES.filter(([key]) => target[key] === true);
  return (
    <li data-auth-target={target.target} data-auth-target-line={target.line}>
      <header>
        <code>{target.target}</code>
        <span className="chip" title="where this declaration is written">{target.block}</span>
        {target.line > 0 ? (
          <button className="linkish" onClick={() => onEdit(target.line)} data-auth-edit={`target:${target.line}`} title={`open tflw.config at line ${target.line}`}>
            [edit]
          </button>
        ) : null}
      </header>
      <p data-auth-target-reason>“{target.reason}”</p>
      <ul className="auth-probes" data-auth-probes={granted.length}>
        {granted.length === 0 ? (
          <li className="muted">read-only probes only — no mutating request, oversized input, traversal payload or cipher handshake</li>
        ) : (
          granted.map(([key, grant]) => (
            <li key={String(key)} data-auth-probe={String(key)}>
              {grant}
            </li>
          ))
        )}
      </ul>
      {repeated > 1 ? (
        <p className="muted" data-auth-target-repeated={repeated}>
          this origin is authorized {repeated} times, each with its own reason — and the <code>probe</code> opt-ins are ORed across
          all of them when they are looked up, so what is permitted here is not only what this row lists
        </p>
      ) : null}
    </li>
  );
}
