// One uPlot chart (`M192` U4). The page draws what `LoadMetrics` already holds — the per-second
// `timeline` and the bucketed `histogram` that `report.html`'s SVGs are built from — and nothing
// it computes itself: a percentile cannot be re-derived from a chart's points (`timeline.ts`'s R4
// rule), so each series is a field of the report read straight. uPlot rather than the SVG
// builder because a run can hold thousands of seconds and a comparison doubles every series.
//
// The legend is live: hovering the plot shows each series' value at that x, formatted with the
// series' own unit. That is the one place the chart states a number as text, and it is what the
// page gate reads — the drawn pixels are checked for presence, the values through the legend.

import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

export interface ChartSeries {
  readonly label: string;
  readonly values: readonly (number | null)[];
  readonly color: string;
  /** The comparison run's series — same colour, dashed. */
  readonly dashed?: boolean;
}

export interface ChartProps {
  /** `data-chart` — the gate's handle. */
  readonly id: string;
  readonly title: string;
  readonly unit: string;
  readonly x: readonly number[];
  readonly series: readonly ChartSeries[];
  readonly kind: 'line' | 'area' | 'bars';
  /** What x is, in the legend (`at` for seconds, `bucket` for a histogram). */
  readonly xName: string;
  /** How an x value reads on the axis and in the legend. */
  readonly xLabel: (v: number) => string;
  /** How a y value reads in the legend. */
  readonly yLabel: (v: number) => string;
}

const HEIGHT = 180;

export function Chart({ id, title, unit, x, series, kind, xName, xLabel, yLabel }: ChartProps) {
  const host = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el || x.length === 0) return;
    const opts: uPlot.Options = {
      width: Math.max(320, el.clientWidth),
      height: HEIGHT,
      // The x values are the report's own keys (seconds, or a bucket's ms) — never a clock. A
      // one-point run spans one unit rather than uPlot's default hundred.
      scales: { x: { time: false, range: (_u, min, max) => [min, max > min ? max : min + 1] } },
      axes: [
        { values: (_u, vals) => vals.map(xLabel), stroke: 'currentColor', grid: { show: false } },
        { values: (_u, vals) => vals.map(yLabel), stroke: 'currentColor', size: 56 },
      ],
      legend: { live: true },
      cursor: { drag: { x: false, y: false } },
      series: [
        { label: xName, value: (_u, v) => (v == null ? '–' : xLabel(v)) },
        ...series.map((s): uPlot.Series => ({
          label: s.label,
          stroke: s.color,
          width: kind === 'bars' ? 1 : 2,
          dash: s.dashed ? [6, 4] : undefined,
          fill: kind === 'area' ? s.color.replace(')', ', 0.25)').replace('rgb(', 'rgba(') : kind === 'bars' ? s.color.replace(')', ', 0.5)').replace('rgb(', 'rgba(') : undefined,
          paths: kind === 'bars' ? uPlot.paths.bars!({ size: [0.6, 24] }) : undefined,
          points: { show: kind !== 'bars' && x.length <= 60 },
          value: (_u, v) => (v == null ? '–' : yLabel(v)),
        })),
      ],
    };
    const data: uPlot.AlignedData = [x as number[], ...series.map((s) => s.values as (number | null)[])];
    plot.current = new uPlot(opts, data, el);
    const ro = new ResizeObserver(() => plot.current?.setSize({ width: Math.max(320, el.clientWidth), height: HEIGHT }));
    ro.observe(el);
    return () => {
      ro.disconnect();
      plot.current?.destroy();
      plot.current = null;
    };
  }, [x, series, kind, xName, xLabel, yLabel]);

  return (
    <figure className="chart" data-chart={id} data-points={x.length} data-series={series.length}>
      <figcaption>
        {title} <span className="muted">{unit ? `(${unit})` : ''}</span>
      </figcaption>
      {x.length === 0 ? (
        <p className="muted" data-chart-empty>
          no iterations recorded
        </p>
      ) : (
        <div ref={host} className="chart-host" />
      )}
    </figure>
  );
}
