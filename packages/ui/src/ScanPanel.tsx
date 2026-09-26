// What this declaration's scan assertions are gated by — `M228` `A` (`D1239`).
//
// **A region-2 segment, earned by the construct and not granted by the door** (`D1044`, `D1209`).
// A declaration carrying a severity matcher earns it wherever it is opened, which is how a scan
// assertion written on the API door — 25 of the corpus's 96 are in files nobody calls a scan file
// — gets the same answer as one opened behind SCANS. A door-keyed version of this rule would be
// green under every mutation that made it construct-keyed, which is `M223` `F`'s vacuity lesson
// and the reason its gate is taken on **API**.
//
// **THIS IS A VIEW, NOT A SECOND EDITOR, AND `M207` `Q1` IS WHY — AND THE PLAN HAD IT WRONG.**
// `D1239` was scoped as *the targets in force with their reasons*, which is an **inventory**, and
// `M207` `Q1` reserved the inventory for Auth: *Auth answers what is in force, Compose answers
// what your next write will hit.* An inventory here would have been a second copy of Auth's list
// one tab away, which is the duplicate-over-one-file class `M205` refused for the config editor —
// and the gate that guards it (`SCANS' Compose predicts and Auth enumerates`) would have passed
// anyway, because it names the element Auth draws with and this file would have drawn its own.
//
// So the table is the **other axis**: one row per place a scan in this env can reach — the default
// `api` base and each declared service — and, for each, whether a declaration covers it. That is
// `TF060`'s own condition read forward instead of backward, it is a different table from Auth's
// rather than the same one reworded, and it answers the question the author actually has while
// writing: *will the assertion I am about to write be refused, and against what?*
//
// It is read off `scanCoverage`, which is the checker's own `scannableOrigins` +
// `targetCoversBaseUrl` returned rather than turned into a message — so the panel and the
// diagnostics list above it cannot disagree. Two implementations of one rule is what this
// repository files findings about.
//
// **`D291` is untouched.** The panel links to Config; the `authorized target` affirmation is the
// author's to type, and nothing here writes one.
//
// It inherits `ScanForm`'s two states intact, and `M207` `S5`'s measurement is why both are kept:
// every project on this machine declares a target — `testFlow-tests` 2, `packages/ui/fixtures/
// project` 1, `examples/storefront` 1 — so the warning renders in none of them, and a panel that
// said the reason only in the broken branch would say it nowhere anybody here can see.
import type { MatcherName } from '@tflw/lang';
import { scanCoverage } from '@tflw/lang';
import type { ProjectView } from './contract';
import { MATCHER_LABEL } from './parts';

/** The `authorization` block, straight off `ProjectView` — the same object the page hands the
 *  checker (`D1240`), so the panel and the diagnostics cannot disagree about what is in force.
 *  It stays assignable to `EnvAuthorizedTargets`, which is what keeps that true rather than
 *  asserted: there is no translation step here to drift. */
export type Authorization = ProjectView['authorization'];

/** The four `probe` opt-ins as **what they grant** — `M207` `Q6`'s answer, lifted from `AuthPanel`
 *  verbatim rather than reworded, because two spellings of one permission is how the two surfaces
 *  would start to disagree. */
const PROBES: readonly [string, string][] = [
  ['probeMutating', 'an authorization probe may re-issue a POST/PUT/PATCH/DELETE here under another principal'],
  ['probeOversized', 'an input scan may send a 64 KiB value at this host’s inputs'],
  ['probeTraversal', 'an input scan may send `../`-shaped payloads here — it attempts a read, never a write'],
  ['probeCiphers', 'the TLS probe may open one handshake per candidate cipher suite here'],
];

/**
 * **The families this declaration actually claims, counted.**
 *
 * `MATCHER_LENS` is the language's own table and the one `lensesOfTest` decides the door with, so
 * a family that reached this list without reaching the door is impossible by construction rather
 * than by a test. `has no a11y violations` is deliberately absent from it — it takes the `page`
 * subject, a crawl body cannot hold it, and a11y is not a fifth door.
 */
export function scanFamilies(matchers: readonly MatcherName[]): readonly { readonly matcher: MatcherName; readonly count: number }[] {
  const counts = new Map<MatcherName, number>();
  for (const m of matchers) counts.set(m, (counts.get(m) ?? 0) + 1);
  return [...counts].map(([matcher, count]) => ({ matcher, count }));
}

/** The checker's labels carry **terminal** emphasis — `` `api` ``, `` `@orders` `` — because they
 *  are written for a message printed in a shell. On the page they render as literal backticks
 *  beside a `<code>` element that is already doing that job, so they are dropped here rather than
 *  reworded upstream: the string's other reader is a terminal and that spelling is right there. */
const plain = (text: string): string => text.replace(/`/g, '');

export function ScanPanel({ authorization, matchers, onAuth, onConfig }: {
  readonly authorization: Authorization;
  /** Every scan matcher this declaration carries, in source order — `statementsOf` is what walks
   *  for them, so the nested ones inside a `within` are here too and nothing walks twice. */
  readonly matchers: readonly MatcherName[];
  readonly onAuth: () => void;
  readonly onConfig: () => void;
}) {
  const targets = authorization.targets ?? [];
  const authorized = targets.length > 0;
  const families = scanFamilies(matchers);
  const coverage = scanCoverage(authorization);

  return (
    <div className="scan-panel" data-compose-scan={authorized ? 'authorized' : 'none'} data-compose-scan-targets={targets.length}>
      {/* **What this declaration claims**, first, because it is the half the reader came for: the
          panel is about the assertions under the cursor and only then about the config behind
          them. Counted rather than listed, since a test repeating one family five times is five
          rows of the same six words. */}
      <p className="scan-claims" data-compose-scan-families={families.length}>
        this declaration asserts{' '}
        {families.map((f, i) => (
          <span key={f.matcher}>
            {i === 0 ? '' : ', '}
            <code data-compose-scan-family={f.matcher}>{MATCHER_LABEL[f.matcher]}</code>
            {f.count === 1 ? '' : ` ×${f.count}`}
          </span>
        ))}
        {families.length === 1 ? ' — and that is what puts it at the SCANS door.' : ' — and those are what put it at the SCANS door.'}
      </p>

      {/* **The env's half, said to be the env's** — `M228` `F` (`D1247`).
          Everything below this line is identical for every declaration in the project, because
          `TF060` is a per-env gate and the coverage table is `scanCoverage` over the env's
          declarations. Only the claims line above it moves with the cursor. The user read the
          whole panel as boilerplate for exactly that reason — *"i see this same text for all
          tests"* — and the information was right; what was missing was the sentence saying which
          half is about the env rather than about their test.

          **A heading and not a fold.** The paragraph is what a reader who has never met `TF060`
          needs, and `M207` `S5`'s measurement is that every project on this machine renders only
          the healthy branch — folding it away by default would trade `D1076` for tidiness against
          the one reader it is written for. */}
      <h2 className="scan-env" data-compose-scan-env={authorization.envName}>
        env <code>{authorization.envName}</code>
      </h2>

      {/* **`M207` `S5`'s reason, IN BOTH STATES, and the wording is the form's moved verbatim.**
          Not a paraphrase, and the first draft of this panel made it one — which would have been
          the very loss `S5` was written to prevent, since its measurement is that all three
          projects on this machine declare a target and so render only the healthy branch. A
          sentence rewritten on the way across is a sentence whose gate stops being about the same
          claim. */}
      <p className="muted" data-compose-scan-why data-compose-scan-why-targets={targets.length}>
        A scan issues requests nobody wrote, so the language makes you name what it may be pointed at, with a reason, in the file a
        reviewer reads (<code>TF060</code>). The reason is not optional and not a courtesy — it is printed in the run summary and
        embedded in every report.{' '}
        {authorized ? (
          <>
            <strong>
              {targets.length} authorized {targets.length === 1 ? 'target is' : 'targets are'} in force
            </strong>{' '}
            in env <code>{authorization.envName}</code>, and the rows below are where a scan here can reach.{' '}
          </>
        ) : null}
        {/* `Q1`'s link, outside the branch above on purpose: Auth answers *what is in force*, and
            **none** is an answer to that question. A link that appeared only once something was
            authorized would be missing in exactly the state a reader most needs to go and look. */}
        {/* Tipped since `M240` `A`: the census (`D1256`) reached this control for the first time when
            SCANS stopped landing on the first file and landed on a scan test. */}
        <button className="linkish" onClick={onAuth} data-compose-scan-auth-link data-tip="the Auth tab — which targets this project may scan, and the reason each was authorized">
          what is in force here
        </button>
      </p>

      {authorized ? null : (
        <p className="warn" data-compose-scan-unauthorized>
          env <code>{authorization.envName}</code> declares no <code>authorized target</code>, so every assertion above is{' '}
          <code>TF060</code> until <code>tflw.config</code> declares one. That line is an affirmation that you are permitted to scan
          this host, so nobody but you can write it — <code>tflw init --scan</code> leaves it commented out for
          exactly that reason.{' '}
          <button className="linkish" onClick={onConfig} data-compose-scan-config-link>
            add it in Config
          </button>
        </p>
      )}

      {/* **Where a scan here can reach, and what authorizes it.** One row per scannable origin,
          not per declaration — see the header. `covered` is `TF060`'s condition one origin at a
          time: the rule flags every scan assertion in the file the moment any row is uncovered,
          which is why the rows are shown rather than a verdict. */}
      <ul className="scan-targets" data-compose-scan-reach={coverage.length}>
        {coverage.map((row) => {
          const target = row.covered === null ? null : targets.find((t) => t.target === row.covered) ?? null;
          const granted = target === null ? [] : PROBES.filter(([key]) => (target as unknown as Record<string, boolean>)[key] === true);
          return (
            <li
              key={`${row.label}:${row.url}`}
              className={row.covered === null ? 'warn' : ''}
              data-compose-scan-reach-url={row.url}
              data-compose-scan-covered={row.covered === null ? 'no' : 'yes'}
            >
              <div className="row">
                <code className="scan-target">{row.url}</code>
                <span className="muted scan-block">{plain(row.label)}</span>
              </div>
              {target === null ? (
                <p className="scan-reason" data-compose-scan-uncovered>
                  {row.origin === null
                    ? 'this address has no origin to authorize — an authorized target names a scheme, host and port'
                    : 'no authorized target covers this — every scan assertion in the file is TF060 until one does'}
                </p>
              ) : (
                <p className="muted scan-reason">
                  authorized at <code>{target.block === 'defaults' ? 'defaults' : `env ${target.block}`}</code> line {target.line} — <span data-user-data>{target.reason}</span>
                </p>
              )}
              {/* **The opt-ins, and their absence said out loud.** `probe oversized` and
                  `probe traversal` are sub-clauses of `authorized target` and occur **0 times** in
                  any `.tflw` file in either repository, because they are not written there — so
                  `has no input-handling violations` is inert without them and reports *not probed*
                  rather than sending anything. A reader who has never met the clause cannot learn
                  that from a passing run. */}
              {target === null ? null : granted.length === 0 ? (
                <p className="muted scan-probes" data-compose-scan-probes-none>
                  no <code>probe</code> opt-in — an input scan here reports <em>not probed</em> rather than sending anything
                </p>
              ) : (
                <ul className="scan-probes">
                  {granted.map(([key, says]) => (
                    <li key={key} data-compose-scan-probe={key}>
                      {says}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

    </div>
  );
}
