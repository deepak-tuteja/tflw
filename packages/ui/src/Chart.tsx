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
  /**
   * **How tall the plot is** — `M227` `A` (`D1230`).
   *
   * A number is the height in pixels, and `HEIGHT` is what the four report charts have always
   * had. `'fill'` sizes from the host element instead, which is the only contract that works in a
   * **sized, resizable** region: a constant cannot use the height a reader drags for and cannot
   * give it back when the reader takes it away.
   *
   * Measured, and this is why it is not cosmetic: `M226` put the plan in a full-width footer, so
   * the plot went from ~723 px wide to **1042 at the same 180** — 4.0:1 to 5.8:1, a letterbox
   * bought for free by a change that never touched the chart.
   *
   * `FILL_MIN` is where filling stops. Below it the panel scrolls instead, because a 40 px plot
   * is not a smaller picture, it is a different and worse one.
   */
  readonly height?: number | 'fill';
  /**
   * **Draw the y-axis from zero** — `M227` `A` (`D1233`).
   *
   * For a *plan* the height is a quantity the author declared — `8 users`, `15 arrivals a second`
   * — and it only means anything measured from nothing. uPlot's auto-range draws a constant as a
   * hairline floating mid-panel: `hold 4 users for 2s` measured **8 ink rows of 180**, at y 71-78,
   * against an axis reading about 3.9 to 4.1. No amount of height fixes that; a baseline does.
   *
   * Off by default, and deliberately so for the report's own charts: a latency series is a
   * *measurement* whose variation is the point, and zero-basing it flattens exactly what it exists
   * to show.
   */
  readonly zeroBased?: boolean;
}

const HEIGHT = 180;

/** The floor under `height: 'fill'` — see `ChartProps.height`. */
const FILL_MIN = 120;

/** A series colour at a fraction of its opacity, for an area or a bar.
 *
 * This was two chained `String.replace`s in place, correct for exactly the shape the four literal
 * series colours had — `rgb(r, g, b)` — and wrong for anything else. `M213` `S1` made the colours
 * come from the theme (`theme.ts`), and a theme is free to declare a token with an alpha already on
 * it; `'rgba(1, 2, 3, 0.5)'.replace(')', ', 0.25)')` produces a five-argument `rgba` that the
 * canvas rejects silently, leaving the area unfilled with nothing said. No token does that today,
 * which is exactly why it is worth handling now rather than when one does. */
function tint(color: string, alpha: number): string {
  const rgba = /^rgba?\(([^)]+)\)$/.exec(color.trim());
  if (!rgba) return color;
  const [r, g, b] = rgba[1]!.split(',').map((p) => p.trim());
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function Chart({ id, title, unit, x, series, kind, xName, xLabel, yLabel, height = HEIGHT, zeroBased = false }: ChartProps) {
  const host = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el || x.length === 0) return;
    /* `'fill'` reads the host, which is a flex item with `flex: 1 1 0; min-height: 0` — so its
       height is imposed by the panel above it rather than by the plot inside it, and the reading
       is not circular. */
    const tall = (): number => (height === 'fill' ? Math.max(FILL_MIN, el.clientHeight) : height);
    const opts: uPlot.Options = {
      width: Math.max(320, el.clientWidth),
      height: tall(),
      // The x values are the report's own keys (seconds, or a bucket's ms) — never a clock. A
      // one-point run spans one unit rather than uPlot's default hundred.
      scales: {
        x: { time: false, range: (_u, min, max) => [min, max > min ? max : min + 1] },
        ...(zeroBased ? { y: { range: (_u, _min, max) => [0, max > 0 ? max * 1.05 : 1] } } : {}),
      },
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
          fill: kind === 'area' ? tint(s.color, 0.25) : kind === 'bars' ? tint(s.color, 0.5) : undefined,
          paths: kind === 'bars' ? uPlot.paths.bars!({ size: [0.6, 24] }) : undefined,
          points: { show: kind !== 'bars' && x.length <= 60 },
          value: (_u, v) => (v == null ? '–' : yLabel(v)),
        })),
      ],
    };
    const data: uPlot.AlignedData = [x as number[], ...series.map((s) => s.values as (number | null)[])];
    plot.current = new uPlot(opts, data, el);
    /* **uPlot's root is the canvas PLUS its legend**, and `tall()` measures the host — so handing
       the canvas the whole host puts the legend past the bottom of it. Measured on the served page
       the first time `fill` ran: host 165, uPlot root 193, and the legend's five rows 18 px below
       the footer's own edge — the very defect this round exists to remove, reintroduced by its
       fix. So a fill pass lays out once, reads what spilled, and gives that much back. */
    const fit = (): void => {
      const plt = plot.current;
      if (plt === null) return;
      const w = Math.max(320, el.clientWidth);
      if (height !== 'fill') {
        plt.setSize({ width: w, height: tall() });
        return;
      }
      /* The legend is measured directly rather than inferred from `el.scrollHeight`. The first
         draft did infer it, and read a spill of zero on a page where the legend was demonstrably
         28 px past the host — `setSize` writes the PLOT's height, the root becomes plot + legend,
         and the difference does not reliably surface as scroll on an `overflow: visible` box. A
         quantity you can point at beats one you derive from an edge case. */
      const legend = el.querySelector('.u-legend');
      const reserve = legend === null ? 0 : Math.ceil(legend.getBoundingClientRect().height);
      plt.setSize({ width: w, height: Math.max(FILL_MIN, tall() - reserve) });
    };
    fit();
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    return () => {
      ro.disconnect();
      plot.current?.destroy();
      plot.current = null;
    };
  }, [x, series, kind, xName, xLabel, yLabel, height, zeroBased]);

  return (
    <figure className="chart" data-chart={id} data-points={x.length} data-series={series.length} data-chart-fill={height === 'fill' ? 'yes' : undefined}>
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
