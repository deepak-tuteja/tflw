// What the page reads, typed by its writers (`M192` U2). The wire shapes are the server's own
// (`packages/cli/src/ui-server.ts`) and the artefacts are the runtime's (`RunReport` is
// `results.json` verbatim, `RunEvent` is one line of the stream) — imported as types so that the
// page cannot drift into a second account of either (`D985`, `D986`). Nothing here reaches the
// bundle; type imports are erased.

export type { ProjectView, ProjectFile, ProjectTest, ProjectCrawl, RunRecord, RunRequest, RunStatus, ReportEntry as ReportDir } from '../../cli/src/ui-server.ts';
// `Lens` is the language's own (`D1043`): the page derives a lens with the same function the
// server does, so the type has to be the same type too.
export type { Lens } from '@tflw/lang';
export type { RunReport, ReportEntry, TestResult, WorkloadTestResult, CrawlResult, StepResult, StepKind, AttemptResult, TraceAsset, RunEvent, LoadMetrics, LoadThresholdResult, LoadWorkloadReport, ScanFinding, ScanRuleCensus } from '@tflw/runtime';

/** The server's own `event: end` on a run's stream — not a `RunEvent`, the run is over. */
export interface EndEvent {
  readonly status: 'done' | 'cancelled';
  readonly exitCode: number | null;
  /** `report/runs/<id>`, or null when the run wrote no report. */
  readonly kept: string | null;
  /** Stdout lines the server no longer holds for replay (`D1277`); absent until the first. */
  readonly dropped?: number;
}
