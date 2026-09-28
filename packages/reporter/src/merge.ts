// `tflw merge` — several finished runs as one report (`M249` `C`, `D1369`).
//
// A sharded CI job (`--shard i/n`), or a sweep split into groups, ends with N report directories and
// one question: *did the whole thing pass, and what failed?* Until this each adopter wrote their own
// join — the sibling repository's `merge-reports` job only collected the directories side by side.
//
// **The inputs are finished runs, not files of one run.** `cli.ts`'s `mergeReports` joins per-file
// reports produced inside one invocation, which share an env, a seed and a redactor; these do not,
// so each run-level field is merged by what it means across runs:
//
//  - tests: concatenated in the order the directories were given (the shell's glob order, which is
//    what *discovery order* means for directories), each keeping its own `file`;
//  - counts: re-derived from the merged tests, never summed from the inputs' counts, so a merge can
//    not disagree with its own list;
//  - `ok`: `finalizeVerdict`, the one derivation every producer uses — an aborted or inconclusive
//    input makes the merge `ok: false` even when no test failed;
//  - findings: deduplicated by fingerprint, first seen wins, so four groups that each scanned the
//    same endpoint report it once and SARIF uploads it once;
//  - `env`/`seed`: the first input's, with `mergedFrom` naming every input, because a merged report
//    that silently claimed one env for runs made under four would be a false sentence;
//  - `startedAt`: the earliest; `durationMs`: wall-clock from the earliest start to the latest end.

import { cp, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { finalizeVerdict, mergeSelfDiagnosis, type RunReport, type ScanFinding, type ScanRuleCensus, type SelfDiagnosis } from '@tflw/runtime';

export interface MergeInput {
  /** The directory as given, for `mergedFrom`. */
  readonly dir: string;
  readonly report: RunReport;
}

function unionCoverage(all: readonly (readonly ScanRuleCensus[])[]): ScanRuleCensus[] {
  const byScan = new Map<string, { scan: ScanRuleCensus['scan']; applied: Set<string>; notApplicable: Map<string, Set<string>> }>();
  for (const list of all) {
    for (const c of list) {
      const slot = byScan.get(c.scan) ?? { scan: c.scan, applied: new Set<string>(), notApplicable: new Map<string, Set<string>>() };
      for (const r of c.applied) slot.applied.add(r);
      for (const n of c.notApplicable) {
        const because = slot.notApplicable.get(n.rule) ?? new Set<string>();
        for (const b of n.because) because.add(b);
        slot.notApplicable.set(n.rule, because);
      }
      byScan.set(c.scan, slot);
    }
  }
  return [...byScan.values()].map((s) => ({
    scan: s.scan,
    applied: [...s.applied],
    // A rule applied in any input is applied in the merge; it is not also *not applicable*.
    notApplicable: [...s.notApplicable].filter(([rule]) => !s.applied.has(rule)).map(([rule, because]) => ({ rule, because: [...because] })),
  }));
}

export function mergeRuns(inputs: readonly MergeInput[]): RunReport {
  if (inputs.length === 0) throw new Error('nothing to merge');
  const reports = inputs.map((i) => i.report);
  const first = reports[0]!;
  const tests = reports.flatMap((r) => r.tests);
  const skipped = tests.filter((t) => t.kind === 'functional' && t.skipped !== undefined).length;
  const starts = reports.map((r) => Date.parse(r.startedAt));
  const ends = reports.map((r, i) => starts[i]! + r.durationMs);
  const seen = new Set<string>();
  const findings: ScanFinding[] = [];
  for (const f of reports.flatMap((r) => r.findings ?? [])) {
    const key = f.fingerprint ?? JSON.stringify([f.rule, f.endpoint, f.detail]);
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push(f);
  }
  const coverage = unionCoverage(reports.map((r) => r.scanCoverage ?? []));
  const diagnoses = reports.map((r) => r.selfDiagnosis).filter((d): d is SelfDiagnosis => d !== undefined);
  const aborted = reports.find((r) => r.aborted);
  const envs = [...new Set(reports.map((r) => r.env))];
  const unmaskableSecrets = [...new Set(reports.flatMap((r) => r.unmaskableSecrets ?? []))];
  const authorizedTargets = reports.flatMap((r) => r.authorizedTargets ?? []).filter((t, i, all) => all.findIndex((u) => JSON.stringify(u) === JSON.stringify(t)) === i);
  return finalizeVerdict({
    ...first,
    ok: tests.every((t) => t.ok),
    env: envs.join(', '),
    startedAt: new Date(Math.min(...starts)).toISOString(),
    durationMs: Math.max(...ends) - Math.min(...starts),
    total: tests.length,
    passed: tests.filter((t) => t.ok).length - skipped,
    failed: tests.filter((t) => !t.ok).length,
    ...(skipped > 0 ? { skipped } : { skipped: undefined }),
    tests,
    insecure: reports.some((r) => r.insecure),
    findings: findings.length > 0 ? findings : undefined,
    scanCoverage: coverage.length > 0 ? coverage : undefined,
    authorizedTargets: authorizedTargets.length > 0 ? authorizedTargets : undefined,
    unmaskableSecrets: unmaskableSecrets.length > 0 ? unmaskableSecrets : undefined,
    ...(diagnoses.length > 0 ? { selfDiagnosis: mergeSelfDiagnosis(diagnoses), inconclusive: reports.some((r) => r.inconclusive) } : {}),
    ...(aborted ? { aborted: true, abortedMessage: aborted.abortedMessage } : { aborted: undefined, abortedMessage: undefined }),
    // `baseline` is a per-run audit of one document against one run's findings; a merge of several
    // audits is not an audit, so it is dropped rather than half-joined.
    baseline: undefined,
    mergedFrom: inputs.map((i) => i.dir),
  });
}

/** Copy each input's `assets/` into `out/assets/`. Asset names are content hashes, so two inputs
 * holding the same screenshot write the same file, and no two different files share a name. */
export async function copyAssets(dirs: readonly string[], out: string): Promise<void> {
  for (const dir of dirs) {
    const assets = join(dir, 'assets');
    try {
      if (!(await stat(assets)).isDirectory()) continue;
    } catch {
      continue;
    }
    for (const entry of await readdir(assets)) await cp(join(assets, entry), join(out, 'assets', entry), { recursive: true, force: false, errorOnExist: false });
  }
}
