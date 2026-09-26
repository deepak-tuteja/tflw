// The workload kind (`M192` U4): what `LoadScenarioReport` holds, in the words the report already
// uses for it. The shape sentence, the threshold units and the duration rounding are the
// reporter's own functions imported from their source (`describeWorkload`, `threshold-format.ts`,
// `D809`'s `roundDurationMs`) — the page is a fourth sink for these numbers and `M89a`'s reason
// for one formatter was that three sinks had drifted. Nothing here is computed from the report
// that the report does not already state: the charts are the `timeline` and `histogram` fields,
// the endpoint table is `endpoints`, and a comparison is two `results.json` files read side by
// side (§2 q6 — two perf runs compare by opening two directories), the difference being the one
// number the page adds, because it is arithmetic on two stated figures and not a measurement.

import { useMemo } from 'react';
import { createColumnHelper, createSortedRowModel, rowSortingFeature, sortFn_basic, tableFeatures, useTable } from '@tanstack/react-table';
import type { LoadMetrics, WorkloadTestResult } from './contract';
import { describeWorkload } from '../../reporter/src/workload-format.ts';
import { formatThresholdActual, formatThresholdTarget } from '../../reporter/src/threshold-format.ts';
import { roundDurationMs } from '../../runtime/src/duration.ts';
import { Chart, type ChartSeries } from './Chart';
import { useTokenColors } from './theme';

export interface Comparison {
  readonly id: string;
  readonly test: WorkloadTestResult | null;
}

/** A duration as the report prints it — `D809`'s rounding, then the unit. */
export const dur = (n: number): string => `${roundDurationMs(n)} ms`;
export const pct = (fraction: number): string => `${(fraction * 100).toFixed(2)}%`;
const secs = (v: number): string => `${v}s`;

/** `this − other`, signed, in the stat's own unit; percentage points for a rate. */
function delta(a: number, b: number, kind: 'count' | 'ms' | 'rate'): string {
  const d = a - b;
  const sign = d > 0 ? '+' : d < 0 ? '−' : '±';
  const mag = Math.abs(d);
  if (kind === 'rate') return `${sign}${(mag * 100).toFixed(2)} pp`;
  if (kind === 'ms') return `${sign}${roundDurationMs(mag)} ms`;
  return `${sign}${mag}`;
}

interface Stat {
  readonly key: string;
  readonly label: string;
  readonly kind: 'count' | 'ms' | 'rate';
  readonly read: (m: LoadMetrics) => number | null;
}

const STATS: readonly Stat[] = [
  { key: 'iterations', label: 'iterations', kind: 'count', read: (m) => m.iterations },
  { key: 'failures', label: 'failures', kind: 'count', read: (m) => m.failures },
  { key: 'errorRate', label: 'error rate', kind: 'rate', read: (m) => m.errorRate },
  { key: 'assertions', label: 'assertions', kind: 'count', read: (m) => m.assertions },
  { key: 'min', label: 'min', kind: 'ms', read: (m) => m.durations.min },
  { key: 'avg', label: 'avg', kind: 'ms', read: (m) => m.durations.avg },
  { key: 'max', label: 'max', kind: 'ms', read: (m) => m.durations.max },
  { key: 'p50', label: 'p50', kind: 'ms', read: (m) => m.durations.p50 },
  { key: 'p90', label: 'p90', kind: 'ms', read: (m) => m.durations.p90 },
  { key: 'p95', label: 'p95', kind: 'ms', read: (m) => m.durations.p95 },
  { key: 'p99', label: 'p99', kind: 'ms', read: (m) => m.durations.p99 },
  { key: 'successful.iterations', label: 'successful iterations', kind: 'count', read: (m) => m.successful.iterations },
  { key: 'successful.p50', label: 'successful p50', kind: 'ms', read: (m) => m.successful.durations.p50 },
  { key: 'successful.p95', label: 'successful p95', kind: 'ms', read: (m) => m.successful.durations.p95 },
  { key: 'successful.p99', label: 'successful p99', kind: 'ms', read: (m) => m.successful.durations.p99 },
];

function fmtStat(s: Stat, v: number | null): string {
  if (v === null) return '—';
  return s.kind === 'rate' ? pct(v) : s.kind === 'ms' ? dur(v) : String(v);
}

// `M213` `S1` — the series colours are the THEME's, and they say what the series means.
//
// These were four literals (`rgb(59, 130, 246)`, `rgb(234, 88, 12)`, `rgb(220, 38, 38)`,
// `rgb(22, 163, 74)`) painted identically on all four themes, including the light one, and
// `S1`'s palette gate found them on its first run. A canvas cannot read a custom property — see
// `theme.ts` — so they are resolved rather than referenced.
//
// **The mapping is semantic, not decorative.** `p50 → p95 → p99` is a ladder from the typical
// request to the worst one, so it climbs `accent → warn → fail`: the shape of the legend now
// carries the same meaning the numbers do. Throughput is the thing going right, so it is `pass`;
// the error rate is the thing going wrong, so it is `fail` — the same token the step list paints a
// failed step with, three panes away.
const SERIES_TOKENS = ['--accent', '--warn', '--fail', '--pass'] as const;

/** Two runs' per-second points on one x axis: the union of their offsets, `null` where a run
 * has no bucket for that second. */
function timelineSeries(a: LoadMetrics, b: LoadMetrics | null, pick: (p: LoadMetrics['timeline'][number]) => number, label: string, color: string): { x: number[]; series: ChartSeries[] } {
  const xs = [...new Set([...a.timeline, ...(b?.timeline ?? [])].map((p) => p.offsetSeconds))].sort((p, q) => p - q);
  const of = (m: LoadMetrics): (number | null)[] => {
    const at = new Map(m.timeline.map((p) => [p.offsetSeconds, pick(p)]));
    return xs.map((x) => at.get(x) ?? null);
  };
  const series: ChartSeries[] = [{ label, values: of(a), color }];
  if (b) series.push({ label: `${label} (compared)`, values: of(b), color, dashed: true });
  return { x: xs, series };
}

export function Workload({ test, other }: { test: WorkloadTestResult; other?: Comparison | null }) {
  const b = other?.test ?? null;
  const m = test.metrics;
  // A new array identity on every theme change, which is what pulls each `useMemo` below — and
  // through it each `Chart`'s effect — over to the new theme's strokes. `theme.ts` says why that
  // identity is deliberate rather than a missed memo.
  const [typical, slow, bad, good] = useTokenColors(SERIES_TOKENS);

  const latency = useMemo(() => {
    const p50 = timelineSeries(m, b?.metrics ?? null, (p) => p.p50, 'p50', typical!);
    const p95 = timelineSeries(m, b?.metrics ?? null, (p) => p.p95, 'p95', slow!);
    const p99 = timelineSeries(m, b?.metrics ?? null, (p) => p.p99, 'p99', bad!);
    return { x: p50.x, series: [...p50.series, ...p95.series, ...p99.series] };
  }, [m, b, typical, slow, bad]);
  const throughput = useMemo(() => timelineSeries(m, b?.metrics ?? null, (p) => p.rps, 'requests/s', good!), [m, b, good]);
  const errors = useMemo(() => timelineSeries(m, b?.metrics ?? null, (p) => p.errorRate * 100, 'error rate', bad!), [m, b, bad]);
  const histogram = useMemo(() => {
    // Bars over the union of bucket values, in order — one bar per bucket the run recorded.
    const values = [...new Set([...m.histogram, ...(b?.metrics.histogram ?? [])].map((h) => h.value))].sort((p, q) => p - q);
    const of = (h: LoadMetrics['histogram']): (number | null)[] => {
      const at = new Map(h.map((x) => [x.value, x.count]));
      return values.map((v) => at.get(v) ?? null);
    };
    const series: ChartSeries[] = [{ label: 'iterations', values: of(m.histogram), color: typical! }];
    if (b) series.push({ label: 'iterations (compared)', values: of(b.metrics.histogram), color: slow!, dashed: true });
    return { x: values.map((_v, i) => i), values, series };
  }, [m, b, typical, slow]);
  const bucketLabel = useMemo(() => (i: number) => (histogram.values[i] === undefined ? '' : dur(histogram.values[i]!)), [histogram]);

  return (
    <section className={`test ${test.ok ? 'ok' : 'fail'}`} data-test data-kind="workload" data-name={test.name} data-ok={test.ok}>
      <h3>
        <span className={`dot ${test.ok ? 'ok' : 'fail'}`} />
        <span data-test-name>{test.name}</span>
        <span className="badge">workload</span>
      </h3>
      <p className="muted" data-workload-shape>
        {describeWorkload(test.workload)}
      </p>
      {other ? (
        <p className="muted" data-compared-with={other.id}>
          {b ? (
            <>
              compared with <code>{other.id}</code>
              {describeWorkload(b.workload) === describeWorkload(test.workload) ? '' : ` — which ran ${describeWorkload(b.workload)}`}
            </>
          ) : (
            <>
              <code>{other.id}</code> has no workload test of this name
            </>
          )}
        </p>
      ) : null}

      <table className="stats" data-stats>
        <thead>
          <tr>
            {/* `M240` `E` — the corner names its column for a screen reader and draws nothing. */}
            <th><span className="sr-only">measure</span></th>
            <th>this run</th>
            {b ? (
              <>
                <th>{other!.id}</th>
                <th>Δ</th>
              </>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {STATS.map((s) => {
            const v = s.read(m);
            const w = b ? s.read(b.metrics) : null;
            return (
              <tr key={s.key} data-stat={s.key}>
                <th>{s.label}</th>
                <td data-value>{fmtStat(s, v)}</td>
                {b ? (
                  <>
                    <td data-other>{fmtStat(s, w)}</td>
                    <td data-delta>{v === null || w === null ? '—' : delta(v, w, s.kind)}</td>
                  </>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
      {m.assertions === 0 ? (
        <p className="warn" data-no-assertions>
          this workload asserted nothing, so every figure above describes tflw sending requests rather than the target answering correctly
        </p>
      ) : null}
      {test.backOff?.warning ? (
        <p className="warn" data-backoff>
          ⚠ your load backed off — an estimated {(test.backOff.ratio * 100).toFixed(0)}% of this test's available VU time was lost to the target system slowing down; results understate real latency
        </p>
      ) : null}
      {test.teardownSkipped ? (
        <p className="warn" data-teardown-skipped>
          {test.teardownSkipped} iterations skipped their <code>after</code> hooks
        </p>
      ) : null}

      <table className="thresholds" data-thresholds>
        <tbody>
          {test.thresholds.map((t, i) => {
            const o = b?.thresholds.find((x) => x.label === t.label && x.op === t.op && x.target === t.target) ?? null;
            return (
              <tr key={i} className={t.ok ? 'ok' : 'fail'} data-threshold data-ok={t.ok} data-label={t.label}>
                <td>{t.ok ? '✓' : '✗'}</td>
                <td>{t.label}</td>
                <td data-target>
                  {t.op === 'lessThan' ? '<' : '>'} {formatThresholdTarget(t)}
                </td>
                <td data-actual>actual: {formatThresholdActual(t)}</td>
                {b ? <td data-actual-other>{o ? formatThresholdActual(o) : '—'}</td> : null}
              </tr>
            );
          })}
        </tbody>
      </table>

      {/**
        * **THESE FOUR BELONG TO A RUN, AND THAT IS A DECISION** — `M213-07`, `M232` (`D1269`).
        *
        * They are imported by `ReportView` and by nothing else, which is exactly what the row
        * reports and which reproduces literally today. It is not a gap.
        *
        * Latency over time, throughput, error rate and the response-time histogram answer *how did
        * the system behave* — a question about a **run**. The composing pane's region 2 answers
        * *what does this declaration ask for, and did it get it* — a question about a
        * **construct** — and `D1044` earns a panel by the construct. `PlanPanel` draws the row's
        * own prescribed repair, *planned-vs-achieved on one plot, explicitly not a JMeter-style
        * tree*, in region 2 on every door.
        *
        * So the row was **repaired across `M224` `C`, `M225` `E`/`F` and `M227` `B`** (`D1209`,
        * `D1221`, `D1222`, `D1230`, `D1232`, `D1233`) and nobody went back to close it. Six
        * decisions across three milestones built its repair while the row stayed open, which is
        * this arc's own finding about its ledger: a row is a claim made on a date.
        *
        * **The cost, stated rather than implied:** a reader composing a LOAD test cannot see its
        * latency distribution without opening the report. The day that is the complaint, this is
        * what gets reopened — and it names itself here so the reopening starts from an argument
        * rather than from a rediscovery.
        */}
      <div className="charts">
        <Chart id="latency" title="Latency over time" unit="ms" x={latency.x} series={latency.series} kind="line" xName="at" xLabel={secs} yLabel={dur} />
        <Chart id="throughput" title="Throughput" unit="req/s" x={throughput.x} series={throughput.series} kind="line" xName="at" xLabel={secs} yLabel={String} />
        <Chart id="errors" title="Error rate" unit="%" x={errors.x} series={errors.series} kind="area" xName="at" xLabel={secs} yLabel={pctOfPercent} />
        <Chart id="histogram" title="Response time distribution" unit="" x={histogram.x} series={histogram.series} kind="bars" xName="bucket" xLabel={bucketLabel} yLabel={String} />
      </div>

      {test.endpoints.length > 0 ? <Endpoints test={test} other={b} /> : null}
    </section>
  );
}

const pctOfPercent = (v: number): string => `${Number(v.toFixed(2))}%`;

interface EndpointRow {
  readonly identity: string;
  readonly iterations: number;
  readonly failures: number;
  readonly errorRate: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
  readonly otherP95: number | null;
  readonly otherErrorRate: number | null;
}

const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel(), sortFns: { basic: sortFn_basic } });
const helper = createColumnHelper<typeof features, EndpointRow>();
const numeric = { sortFn: 'basic' as const, sortUndefined: 'last' as const };
const columns = helper.columns([
  helper.accessor('identity', { header: 'endpoint' }),
  helper.accessor('iterations', { header: 'iterations', ...numeric }),
  helper.accessor('failures', { header: 'failures', ...numeric }),
  helper.accessor('errorRate', { header: 'error rate', ...numeric, cell: (c) => pct(c.getValue()) }),
  helper.accessor('p50', { header: 'p50', ...numeric, cell: (c) => dur(c.getValue()) }),
  helper.accessor('p95', { header: 'p95', ...numeric, cell: (c) => dur(c.getValue()) }),
  helper.accessor('p99', { header: 'p99', ...numeric, cell: (c) => dur(c.getValue()) }),
  helper.accessor('max', { header: 'max', ...numeric, cell: (c) => dur(c.getValue()) }),
]);
const compareColumns = helper.columns([
  ...columns,
  helper.accessor('otherP95', { header: 'p95 (compared)', ...numeric, cell: (c) => (c.getValue() === null ? '—' : dur(c.getValue()!)) }),
  helper.accessor('otherErrorRate', { header: 'error rate (compared)', ...numeric, cell: (c) => (c.getValue() === null ? '—' : pct(c.getValue()!)) }),
]);

/** `LoadScenarioReport.endpoints` (`M43`, `D67`–`D69`): one row per `api` step identity, sortable
 * by any column — which is what a table library is for, and why this is the page's first use of
 * one. The metrics are read straight; a row's `p95` is the endpoint's own successful-population
 * percentile exactly as the console prints it. */
function Endpoints({ test, other }: { test: WorkloadTestResult; other: WorkloadTestResult | null }) {
  const data = useMemo(
    (): EndpointRow[] =>
      test.endpoints.map((e) => {
        const o = other?.endpoints.find((x) => x.identity === e.identity)?.metrics ?? null;
        return {
          identity: e.identity,
          iterations: e.metrics.iterations,
          failures: e.metrics.failures,
          errorRate: e.metrics.errorRate,
          p50: e.metrics.durations.p50,
          p95: e.metrics.durations.p95,
          p99: e.metrics.durations.p99,
          max: e.metrics.durations.max,
          otherP95: o ? o.durations.p95 : null,
          otherErrorRate: o ? o.errorRate : null,
        };
      }),
    [test, other],
  );
  const table = useTable({ features, columns: other ? compareColumns : columns, data, enableSortingRemoval: false, sortDescFirst: false });
  return (
    <table className="endpoints" data-endpoints>
      <thead>
        {table.getHeaderGroups().map((g) => (
          <tr key={g.id}>
            {g.headers.map((h) => (
              <th key={h.id} onClick={h.column.getToggleSortingHandler()} data-sort={h.column.getIsSorted() || 'none'} className="sortable">
                <table.FlexRender header={h} />
                {h.column.getIsSorted() === 'asc' ? ' ▲' : h.column.getIsSorted() === 'desc' ? ' ▼' : ''}
              </th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map((row) => (
          <tr key={row.id} data-endpoint={row.original.identity}>
            {row.getAllCells().map((cell) => (
              <td key={cell.id} data-col={cell.column.id}>
                <table.FlexRender cell={cell} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
