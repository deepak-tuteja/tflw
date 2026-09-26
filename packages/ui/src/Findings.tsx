// The security kind (`M192` U5): the run's findings, as `RunReport.findings` holds them, in the
// order and the words `report.html` and the console use — `sortFindings`, `findingsSummaryLine`
// and the two label tables moved to `@tflw/runtime`'s pure `scan-words.ts` for exactly this
// consumer, and the remediation KB read from `@tflw/reporter`'s source. Grouped by rule because
// that is the reader's first question here (*what kind of weakness*), flat within a rule in the
// report's own order; a withheld finding reads as withheld without disappearing (`D386`). With a
// second directory open (U4's *compare with*) each finding says whether the other run had it, and
// the other run's findings this one lacks are listed — a baseline diff drawn from two reports
// rather than from a file, since the file's effect is already in `withheld`.

import type { ReactNode } from 'react';
import type { RunReport, ScanFinding } from './contract';
import { findingsSummaryLine, SCAN_KIND_LABEL, sortFindings, WITHHELD_LABEL } from '../../runtime/src/scan-words.ts';
import { remediationFor, type KbEntry } from '../../reporter/src/kb.ts';
import { grantedProbeClauses } from '../../reporter/src/probe-clauses.ts';

/** KB prose carries markdown-style backtick spans (`D408`); rendered as `<code>`, never as HTML. */
function codeSpans(text: string): ReactNode[] {
  return text.split(/`([^`]+)`/).map((part, i) => (i % 2 === 1 ? <code key={i}>{part}</code> : part));
}

/** Above this many declines the list opens folded: `M192` U7's security dogfood raised 89 of them
 * and the first finding sat 5,000 px down the page. `report.html` draws them flat; the page keeps
 * every line and folds the list, the count and the sum in the summary. */
export const FOLD_DECLINES_ABOVE = 3;

/** A finding's identity for the comparison: the fingerprint when it has one, else its site. */
const keyOf = (f: ScanFinding): string => f.fingerprint ?? `${f.rule} ${f.endpoint} ${f.location ?? ''}`;

/**
 * A finding's identity for **collapsing the list** (`M211` `S6`, `M211-01`) — the whole row, with
 * its keys ordered, so two entries merge only when they are equal in every field.
 *
 * **Deliberately not `keyOf`, and the difference is the whole safety argument.** `keyOf` is the
 * fingerprint, which is `sha256(scan ∥ rule ∥ endpoint ∥ location ∥ invariant)` and excludes
 * `detail` on purpose — `detail` carries the concrete payload and a response excerpt, so hashing it
 * would move a baseline entry every time an error message was reworded. That exclusion is right for
 * a baseline and wrong for this: two occurrences of one fingerprint can carry *different evidence*
 * (tier 3's input-handling details name the payload and quote the response), and merging them would
 * discard it. Keying on the whole row cannot lose anything, because nothing that differs is merged.
 *
 * It also needs no rule for the rows that have no fingerprint at all — `D369`'s seeded findings and
 * the a11y scan's endpoint-less ones — which a fingerprint-keyed collapse would have required.
 */
const rowKey = (f: ScanFinding): string =>
  JSON.stringify(Object.keys(f).sort().map((k) => [k, (f as unknown as Record<string, unknown>)[k]]));

/**
 * One rendered row per distinct finding, carrying how many identical ones it stands for.
 *
 * **Why the page groups and the artifact does not.** A scan rule is judged once per response and
 * every judgement is recorded, which is correct and is what catches an error path that only appears
 * under load (`D1083`). But a *reader* gains nothing from the same row twice: measured on the
 * storefront example's own documented instruction, 29,381 finding rows were **one distinct row** —
 * no field varied — rendering 29,381 `<li>` and 29,381 `[accept]` buttons that all stage the same
 * single baseline entry, over 3,455,656 px. `results.json` still carries all 29,381.
 */
export function groupIdentical(list: readonly ScanFinding[]): readonly { readonly f: ScanFinding; readonly count: number }[] {
  const by = new Map<string, { f: ScanFinding; count: number }>();
  for (const f of list) {
    const k = rowKey(f);
    const seen = by.get(k);
    if (seen) seen.count += 1;
    else by.set(k, { f, count: 1 });
  }
  return [...by.values()];
}

/**
 * What `[accept]` does — `M208` `S3` (`Q1`).
 *
 * **A link into the editor, never a writer.** `M206` `Q6` refused a bare `[accept]` button because
 * it contradicts `M205`'s one-editor finding: everything editable in Auth links into Config rather
 * than being a field, and a baseline edited from a button would have no editor at all. But that
 * refusal left the feature with no page affordance, which collides with `D387`'s own adoptability
 * argument — a page that shows you a 16-character fingerprint and asks you to copy it is precisely
 * the hand-transcription `--baseline-write` exists to prevent.
 *
 * So it does what `[edit]` already does: it stages the entry into the editor's buffer and
 * **navigates there, unsaved**. The affirmation stays the author's (`D291`), there is still exactly
 * one editor, and nothing reaches disk until somebody presses save.
 *
 * `null` means this page cannot accept anything — no run env, or no `baseline` in force for it —
 * and the list says which rather than offering a button that fails.
 */
export type AcceptFinding = (finding: ScanFinding) => void;

export function Findings({
  report,
  compare,
  onAccept,
}: {
  report: RunReport;
  compare?: { readonly id: string; readonly data: RunReport } | null;
  onAccept?: AcceptFinding | null;
}) {
  const findings = report.findings ?? [];
  const coverage = report.scanCoverage ?? [];
  const targets = report.authorizedTargets ?? [];
  const otherByKey = compare ? new Map((compare.data.findings ?? []).map((f) => [keyOf(f), f])) : null;
  const mine = new Set(findings.map(keyOf));
  const gone = compare ? sortFindings((compare.data.findings ?? []).filter((f) => !mine.has(keyOf(f)))) : [];
  // Nothing to say and nothing compared: no block at all, rather than an empty heading.
  if (findings.length === 0 && coverage.length === 0 && targets.length === 0 && gone.length === 0) return null;
  const sorted = sortFindings(findings);
  const byRule = new Map<string, ScanFinding[]>();
  for (const f of sorted) byRule.set(f.rule, [...(byRule.get(f.rule) ?? []), f]);
  const blind = report.scanBlindSpot;

  return (
    <section className="findings" data-findings data-findings-count={findings.length}>
      <h2>Security findings</h2>
      {targets.map((t) => (
        <p className="muted" key={t.target} data-authorized-target={t.target}>
          ℹ authorized target <code>{t.target}</code> — <span data-user-data>{t.reason}</span>
          {grantedProbeClauses(t).map((p) => (
            <code key={p}> {p}</code>
          ))}
        </p>
      ))}
      {blind?.coverage && blind.coverage.apiSteps > 0 ? (
        <p className="muted" data-authz-coverage={`${blind.coverage.withOwner}/${blind.coverage.apiSteps}`}>
          ℹ authz coverage: {blind.coverage.withOwner} of {blind.coverage.apiSteps} api step{blind.coverage.apiSteps === 1 ? '' : 's'} in the suite sit in a test that declares an owner (
          {Math.floor((blind.coverage.withOwner / blind.coverage.apiSteps) * 100)}%) — the rest are unjudgeable by <code>authorization violations</code>, which needs <code>as &lt;session&gt;</code>.
        </p>
      ) : null}
      {blind?.declines && blind.declines.length > 0 ? (
        <details className="declines-fold" open={blind.declines.length <= FOLD_DECLINES_ABOVE} data-declines-fold={blind.declines.length}>
          <summary className="muted">
            ℹ {blind.declines.length} decline{blind.declines.length === 1 ? '' : 's'} — {blind.declines.reduce((n, d) => n + d.count, 0)}× a probe stood down, by subject
          </summary>
          {blind.declines.map((d, i) => (
            <p className="muted" key={i} data-scan-decline={d.subject}>
              ℹ {SCAN_KIND_LABEL[d.scan]} declined {d.count}×: <code>{d.subject}</code> — {d.reason}
            </p>
          ))}
        </details>
      ) : null}
      {findings.length > 0 ? (
        <p data-findings-summary>
          {findingsSummaryLine(findings)}
          {compare ? (
            <span className="muted" data-findings-compared={compare.id}>
              {' '}
              · compared with <code>{compare.id}</code>: {gone.length} it had that this run does not
            </span>
          ) : null}
        </p>
      ) : (
        <p className="muted" data-findings-summary>
          no findings — {coverage.length > 0 ? 'the rules that ran are listed below' : 'no security assertion ran'}
        </p>
      )}
      {[...byRule.entries()].map(([rule, list]) => (
        <details key={rule} open data-rule={rule} data-severity={list[0]!.severity} data-rule-count={list.length} data-rule-distinct={groupIdentical(list).length}>
          <summary>
            <span className={`sev sev-${list[0]!.severity}`}>{list[0]!.severity}</span> <code>{rule}</code>
            <span className="muted">
              {' '}
              · {list.length} finding{list.length === 1 ? '' : 's'}
              {/* `M211-01` — the count stays the number of judgements, because that is what the run
                  did and what `results.json` holds. When the rows below stand for more than they
                  number, the heading says so rather than letting a reader count the list and
                  disagree with the summary line above it. */}
              {groupIdentical(list).length < list.length ? `, ${groupIdentical(list).length} distinct` : ''}
              {list.some((f) => f.withheld) ? ` · ${list.filter((f) => f.withheld).length} withheld` : ''}
            </span>
          </summary>
          <ol className="finding-list">
            {groupIdentical(list).map(({ f, count }, i) => (
              <Finding key={`${keyOf(f)}-${i}`} f={f} count={count} other={otherByKey ? (otherByKey.get(keyOf(f)) ?? null) : undefined} otherId={compare?.id ?? null} onAccept={onAccept ?? null} />
            ))}
          </ol>
        </details>
      ))}
      {gone.length > 0 ? (
        <details open data-findings-gone={gone.length}>
          <summary>
            in <code>{compare!.id}</code> and not in this run · {gone.length}
          </summary>
          <ol className="finding-list">
            {gone.map((f, i) => (
              <li key={i} className="finding gone" data-finding-gone={keyOf(f)}>
                <span className={`sev sev-${f.severity}`}>{f.severity}</span> <code>{f.rule}</code> · {f.endpoint}
                {f.location ? ` · ${f.location}` : ''} — {f.description}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      {coverage.length > 0 ? (
        <details data-scan-coverage>
          <summary>which rules ran</summary>
          {coverage.map((c) => (
            <div key={c.scan} data-scan-census={c.scan}>
              <h4>{SCAN_KIND_LABEL[c.scan]}</h4>
              <p>
                applied:{' '}
                {c.applied.length > 0
                  ? c.applied.map((r, i) => (
                      <span key={r}>
                        {i > 0 ? ', ' : ''}
                        <code data-applied-rule={r}>{r}</code>
                      </span>
                    ))
                  : 'none'}
              </p>
              <p>did not apply:</p>
              <ul>
                {c.notApplicable.length > 0 ? (
                  c.notApplicable.map((n) => (
                    <li key={n.rule} data-na-rule={n.rule}>
                      <code>{n.rule}</code> — {n.because.join('; ')}
                    </li>
                  ))
                ) : (
                  <li>
                    <em>every rule in this pack applied somewhere in the run</em>
                  </li>
                )}
              </ul>
            </div>
          ))}
        </details>
      ) : null}
    </section>
  );
}

/** What the compared run says about this finding: absent, the same verdict, or a different one —
 * a finding the gate withheld there and not here is the baseline diff a reader is looking for. */
function comparedState(f: ScanFinding, other: ScanFinding | null): { readonly state: 'absent' | 'same' | 'differs'; readonly words: string } {
  if (!other) return { state: 'absent', words: 'not in' };
  if ((other.withheld ?? null) === (f.withheld ?? null)) return { state: 'same', words: 'also in' };
  return { state: 'differs', words: `${other.withheld ? WITHHELD_LABEL[other.withheld] : 'gating'} in` };
}

/** `other` is `undefined` with no comparison open, `null` when the compared run lacks the finding. */
function Finding({ f, count, other, otherId, onAccept }: { f: ScanFinding; count: number; other: ScanFinding | null | undefined; otherId: string | null; onAccept: AcceptFinding | null }) {
  const entry = remediationFor(f.rule);
  const where = [f.endpoint, f.location, f.invariant].filter(Boolean).join(' · ');
  const compared = other === undefined ? null : comparedState(f, other);
  return (
    <li className={`finding ${f.withheld ? 'finding-off' : 'finding-on'}`} data-finding={keyOf(f)} data-endpoint={f.endpoint} data-withheld={f.withheld ?? undefined} data-in-compared={compared?.state} data-occurrences={count}>
      <div className="finding-where">
        {where}
        {/* `M211-01` — one row per distinct finding, and this says how many judgements it stands for.
            Rendered only when it stands for more than one, so the ordinary case reads as it always
            has; the row is identical in every field to the ones it absorbed, so the number is the
            whole of what they carried. */}
        {count > 1 ? (
          <span className="finding-times" data-finding-times={count} title="identical judgements — a scan rule is judged once per response, and every one is in results.json">
            {' '}
            × {count.toLocaleString('en-US')}
          </span>
        ) : null}
        {f.via ? ` · via ${f.via} seed` : ''}
        {f.file ? (
          <span className="muted" data-finding-source={`${f.file}:${f.line ?? ''}`}>
            {' '}
            · {f.file}
            {f.line !== undefined ? `:${f.line}` : ''}
          </span>
        ) : null}
        {f.withheld ? (
          <span className="finding-withheld" data-withheld-label>
            {WITHHELD_LABEL[f.withheld]}
          </span>
        ) : null}
        {compared ? (
          <span className={`badge ${compared.state === 'same' ? '' : 'new'}`} data-since={otherId!}>
            {compared.words} {otherId}
          </span>
        ) : null}
      </div>
      <div data-finding-description>{f.description}</div>
      <div className="finding-detail" data-finding-detail>
        {f.detail}
      </div>
      {f.seeded ? (
        <div className="finding-seeded" data-seeded={f.seeded.seed}>
          seeded (seed {f.seeded.seed}) — <strong>promote this payload into the corpus</strong>: <code>{f.seeded.payload}</code>
        </div>
      ) : null}
      {f.fingerprint ? (
        <code className="finding-fp" data-fingerprint>
          {f.fingerprint}
        </code>
      ) : (
        // A finding with no fingerprint can never be accepted, and the page says why rather than
        // offering a button that would match nothing — a baseline entry with no fingerprint accepts
        // *nothing*, which is the one way this feature can make a build greener than the evidence.
        // `D369`: a seeded payload has no fingerprint by construction, because it is generated.
        <span className="finding-fp muted" data-not-baselinable>
          — not baselinable{f.seeded ? ', because it is a generated payload rather than a site' : ''}
        </span>
      )}
      {f.fingerprint && onAccept && !f.withheld ? (
        <button className="linkish" onClick={() => onAccept(f)} data-accept-finding={f.fingerprint} aria-label="accept this finding into the baseline" data-tip="stage this fingerprint into the baseline and open it — nothing is written until you save">
          [accept]
        </button>
      ) : null}
      {entry ? <Fix entry={entry} /> : null}
    </li>
  );
}

function Fix({ entry }: { entry: KbEntry }) {
  return (
    <details className="finding-fix" data-fix>
      <summary>possible fixes</summary>
      <p className="fix-title">{entry.title}</p>
      <p>{codeSpans(entry.what)}</p>
      <p>{codeSpans(entry.why)}</p>
      <p>
        <strong>Fix</strong> — {codeSpans(entry.fixGeneric)}
      </p>
      <p>
        <strong>In NestJS</strong> — {codeSpans(entry.fixNest)}
      </p>
      <p className="muted" data-cwe={entry.cwe}>
        CWE-{entry.cwe} ·{' '}
        {entry.refs.map((r, i) => (
          <span key={r.url}>
            {i > 0 ? ' · ' : ''}
            <a href={r.url} rel="noreferrer" target="_blank">
              {r.label}
            </a>
          </span>
        ))}
      </p>
    </details>
  );
}
