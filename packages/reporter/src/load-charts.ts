// M32 (PLAN_REPORTS_PERF_SECURITY.md R3) — hand-rendered inline `<svg>` for `load-report.html`.
// No charting library: report data is already aggregated (per-second buckets over minutes is
// hundreds of points, not millions — R4), so there's no interactivity to justify canvas/WebGL or
// 40-100KB of third-party JS in every self-contained artifact. Every function here is pure (data
// in, an SVG string out) — easy to unit-test the geometry directly without parsing HTML.

import type { HistogramBucket, TimelinePoint } from '@tflw/runtime';

const WIDTH = 640;
const HEIGHT = 160;
const PAD_LEFT = 42;
const PAD_RIGHT = 12;
const PAD_TOP = 12;
const PAD_BOTTOM = 22;

/** Maps `value` from `[domainMin, domainMax]` into `[rangeMin, rangeMax]`, clamped. A zero-width
 * domain (every point identical, or a single point) maps everything to `rangeMin` rather than
 * dividing by zero. */
function scale(value: number, domainMin: number, domainMax: number, rangeMin: number, rangeMax: number): number {
  if (domainMax - domainMin === 0) return rangeMin;
  const t = (value - domainMin) / (domainMax - domainMin);
  return rangeMin + t * (rangeMax - rangeMin);
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function noData(title: string): string {
  return `<div class="chart-empty"><h3>${esc(title)}</h3><p>no iterations recorded</p></div>`;
}

interface Series {
  readonly label: string;
  readonly cssClass: string;
  readonly values: readonly number[];
}

/** A multi-series line chart over `timeline`'s `offsetSeconds` — used for latency-over-time
 * (p50/p95/p99) here, but general enough for any "N numeric series over the same x axis" shape. */
function renderLineChart(title: string, timeline: readonly TimelinePoint[], series: readonly Series[], yUnit: string): string {
  if (timeline.length === 0) return noData(title);
  const xs = timeline.map((p) => p.offsetSeconds);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const allValues = series.flatMap((s) => s.values);
  const yMin = 0;
  const yMax = Math.max(1, ...allValues);

  const plotX = (x: number): number => scale(x, xMin, xMax, PAD_LEFT, WIDTH - PAD_RIGHT);
  const plotY = (y: number): number => scale(y, yMin, yMax, HEIGHT - PAD_BOTTOM, PAD_TOP);

  const polylines = series
    .map((s) => {
      const points = xs.map((x, i) => `${fmt(plotX(x))},${fmt(plotY(s.values[i]!))}`).join(' ');
      return `<polyline class="${s.cssClass}" points="${points}" fill="none" />`;
    })
    .join('\n    ');

  const legend = series.map((s) => `<span class="legend-item ${s.cssClass}">${esc(s.label)}</span>`).join('');

  return `<div class="chart">
  <h3>${esc(title)} <span class="chart-unit">(${esc(yUnit)})</span></h3>
  <div class="legend">${legend}</div>
  <svg viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${esc(title)}">
    <line class="axis" x1="${PAD_LEFT}" y1="${HEIGHT - PAD_BOTTOM}" x2="${WIDTH - PAD_RIGHT}" y2="${HEIGHT - PAD_BOTTOM}" />
    <text class="axis-label" x="${PAD_LEFT}" y="${PAD_TOP}">${fmt(yMax)}</text>
    <text class="axis-label" x="${PAD_LEFT}" y="${HEIGHT - PAD_BOTTOM - 2}">0</text>
    <text class="axis-label" x="${WIDTH - PAD_RIGHT}" y="${HEIGHT - 4}" text-anchor="end">${fmt(xMax)}s</text>
    ${polylines}
  </svg>
</div>`;
}

export function renderLatencyOverTimeChart(timeline: readonly TimelinePoint[]): string {
  return renderLineChart('Latency over time', timeline, [
    { label: 'p50', cssClass: 'series-p50', values: timeline.map((p) => p.p50) },
    { label: 'p95', cssClass: 'series-p95', values: timeline.map((p) => p.p95) },
    { label: 'p99', cssClass: 'series-p99', values: timeline.map((p) => p.p99) },
  ], 'ms');
}

export function renderThroughputChart(timeline: readonly TimelinePoint[]): string {
  return renderLineChart('Throughput', timeline, [{ label: 'requests/s', cssClass: 'series-rps', values: timeline.map((p) => p.rps) }], 'req/s');
}

/** An area chart (filled polygon under the line) for error rate — visually distinct from the line
 * charts above so a reader doesn't mistake "small area near zero" for "small line near zero." */
export function renderErrorRateChart(timeline: readonly TimelinePoint[]): string {
  const title = 'Error rate';
  if (timeline.length === 0) return noData(title);
  const xs = timeline.map((p) => p.offsetSeconds);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const values = timeline.map((p) => p.errorRate * 100);
  const yMax = Math.max(1, ...values);

  const plotX = (x: number): number => scale(x, xMin, xMax, PAD_LEFT, WIDTH - PAD_RIGHT);
  const plotY = (y: number): number => scale(y, 0, yMax, HEIGHT - PAD_BOTTOM, PAD_TOP);
  const baseline = HEIGHT - PAD_BOTTOM;

  const linePoints = xs.map((x, i) => `${fmt(plotX(x))},${fmt(plotY(values[i]!))}`);
  const areaPoints = [`${fmt(plotX(xMin))},${fmt(baseline)}`, ...linePoints, `${fmt(plotX(xMax))},${fmt(baseline)}`].join(' ');

  return `<div class="chart">
  <h3>${esc(title)} <span class="chart-unit">(%)</span></h3>
  <svg viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${esc(title)}">
    <line class="axis" x1="${PAD_LEFT}" y1="${baseline}" x2="${WIDTH - PAD_RIGHT}" y2="${baseline}" />
    <text class="axis-label" x="${PAD_LEFT}" y="${PAD_TOP}">${fmt(yMax)}%</text>
    <text class="axis-label" x="${WIDTH - PAD_RIGHT}" y="${HEIGHT - 4}" text-anchor="end">${fmt(xMax)}s</text>
    <polygon class="series-error-area" points="${areaPoints}" />
  </svg>
</div>`;
}

/** A response-time distribution histogram — bars, one per bucket, from `LoadMetrics.histogram`
 * (R4: the same bucketed data `percentile()` reads, small enough to inline directly). */
export function renderHistogramChart(buckets: readonly HistogramBucket[]): string {
  const title = 'Response time distribution';
  if (buckets.length === 0) return noData(title);
  const sorted = [...buckets].sort((a, b) => a.value - b.value);
  const maxCount = Math.max(...sorted.map((b) => b.count));
  const barWidth = (WIDTH - PAD_LEFT - PAD_RIGHT) / sorted.length;
  const baseline = HEIGHT - PAD_BOTTOM;

  const bars = sorted
    .map((b, i) => {
      const barHeight = scale(b.count, 0, maxCount, 0, HEIGHT - PAD_TOP - PAD_BOTTOM);
      const x = PAD_LEFT + i * barWidth;
      const y = baseline - barHeight;
      return `<rect class="series-histogram" x="${fmt(x)}" y="${fmt(y)}" width="${fmt(Math.max(0.5, barWidth - 1))}" height="${fmt(barHeight)}"><title>${fmt(b.value)}ms × ${b.count}</title></rect>`;
    })
    .join('\n    ');

  return `<div class="chart">
  <h3>${esc(title)} <span class="chart-unit">(ms → count)</span></h3>
  <svg viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${esc(title)}">
    <line class="axis" x1="${PAD_LEFT}" y1="${baseline}" x2="${WIDTH - PAD_RIGHT}" y2="${baseline}" />
    <text class="axis-label" x="${PAD_LEFT}" y="${PAD_TOP}">${maxCount}</text>
    <text class="axis-label" x="${PAD_LEFT}" y="${HEIGHT - 4}">${fmt(sorted[0]!.value)}ms</text>
    <text class="axis-label" x="${WIDTH - PAD_RIGHT}" y="${HEIGHT - 4}" text-anchor="end">${fmt(sorted[sorted.length - 1]!.value)}ms</text>
    ${bars}
  </svg>
</div>`;
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export const CHART_STYLE = `
.chart{margin:12px 0;padding:10px 12px;background:var(--card);border:1px solid var(--line);border-radius:8px}
.chart h3{margin:0 0 4px;font-size:13px}
.chart-unit{color:var(--mut);font-weight:400;font-size:11px}
.chart-empty{margin:12px 0;padding:10px 12px;background:var(--card);border:1px solid var(--line);border-radius:8px;color:var(--mut)}
.chart-empty h3{margin:0 0 4px;font-size:13px;color:var(--fg)}
.chart-empty p{margin:0;font-size:12px}
.legend{display:flex;gap:10px;margin-bottom:4px;font-size:11px}
.legend-item{display:flex;align-items:center;gap:4px;color:var(--mut)}
.legend-item::before{content:'';display:inline-block;width:10px;height:2px;background:currentColor}
.legend-item.series-p50{color:var(--info)}.legend-item.series-p95{color:var(--warn)}.legend-item.series-p99{color:var(--fail)}
svg{width:100%;height:auto;overflow:visible}
.axis{stroke:var(--line);stroke-width:1}
.axis-label{fill:var(--mut);font-size:9px}
.series-p50{stroke:var(--info);stroke-width:1.5}
.series-p95{stroke:var(--warn);stroke-width:1.5}
.series-p99{stroke:var(--fail);stroke-width:1.5}
.series-rps{stroke:var(--ok);stroke-width:1.5}
.series-error-area{fill:var(--fail);fill-opacity:.35;stroke:var(--fail);stroke-width:1}
.series-histogram{fill:var(--info)}
`;
