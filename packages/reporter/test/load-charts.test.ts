// M32 (PLAN_REPORTS_PERF_SECURITY.md R3) — the inline-SVG chart geometry `load-report.html` embeds.
// Each render function is pure (data in, an SVG string out), so these tests assert on the actual
// geometry (points/heights), not just "some markup appeared."

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HistogramBucket, TimelinePoint } from '@tflw/runtime';
import { renderLatencyOverTimeChart, renderThroughputChart, renderErrorRateChart, renderHistogramChart } from '../src/load-charts.js';

function point(overrides: Partial<TimelinePoint>): TimelinePoint {
  return { offsetSeconds: 0, count: 1, failures: 0, rps: 1, errorRate: 0, min: 10, mean: 10, max: 10, p50: 10, p95: 10, p99: 10, ...overrides };
}

test('renderLatencyOverTimeChart on an empty timeline shows a "no data" placeholder, not a broken chart', () => {
  const svg = renderLatencyOverTimeChart([]);
  assert.match(svg, /no iterations recorded/);
  assert.doesNotMatch(svg, /<svg/);
});

test('renderLatencyOverTimeChart plots three series (p50/p95/p99), one polyline point per timeline point', () => {
  const timeline = [point({ offsetSeconds: 0, p50: 10, p95: 20, p99: 30 }), point({ offsetSeconds: 1, p50: 15, p95: 25, p99: 35 })];
  const svg = renderLatencyOverTimeChart(timeline);
  const polylines = [...svg.matchAll(/<polyline class="(series-p50|series-p95|series-p99)" points="([^"]+)"/g)];
  assert.equal(polylines.length, 3);
  for (const [, , points] of polylines) {
    assert.equal(points!.trim().split(' ').length, 2, 'one point per timeline entry');
  }
});

test('renderLatencyOverTimeChart: the highest series value maps to the top of the plot area (smaller y)', () => {
  const timeline = [point({ offsetSeconds: 0, p50: 10, p95: 50, p99: 100 })];
  const svg = renderLatencyOverTimeChart(timeline);
  const p50Y = Number(svg.match(/series-p50" points="[\d.]+,([\d.]+)/)![1]);
  const p99Y = Number(svg.match(/series-p99" points="[\d.]+,([\d.]+)/)![1]);
  assert.ok(p99Y < p50Y, `p99 (higher value) must plot nearer the top: p99Y=${p99Y} p50Y=${p50Y}`);
});

test('renderThroughputChart renders one rps series', () => {
  const svg = renderThroughputChart([point({ offsetSeconds: 0, rps: 5 }), point({ offsetSeconds: 1, rps: 9 })]);
  assert.match(svg, /class="series-rps"/);
  assert.doesNotMatch(svg, /series-p50/);
});

test('renderErrorRateChart on an empty timeline shows a placeholder', () => {
  assert.match(renderErrorRateChart([]), /no iterations recorded/);
});

test('renderErrorRateChart renders a filled area (polygon), closed back to the baseline', () => {
  const svg = renderErrorRateChart([point({ offsetSeconds: 0, errorRate: 0.1 }), point({ offsetSeconds: 1, errorRate: 0.5 })]);
  const polygon = svg.match(/<polygon class="series-error-area" points="([^"]+)"/);
  assert.ok(polygon, 'expected a filled polygon');
  const points = polygon![1]!.trim().split(' ');
  // 2 data points + 2 baseline-closing points (start and end)
  assert.equal(points.length, 4);
});

test('renderHistogramChart on empty buckets shows a placeholder', () => {
  assert.match(renderHistogramChart([]), /no iterations recorded/);
});

test('renderHistogramChart renders one bar per bucket, sorted ascending by value, tallest bar for the highest count', () => {
  const buckets: HistogramBucket[] = [
    { value: 100, count: 1 },
    { value: 10, count: 50 },
    { value: 50, count: 5 },
  ];
  const svg = renderHistogramChart(buckets);
  const bars = [...svg.matchAll(/<rect class="series-histogram" x="([\d.]+)" y="([\d.]+)" width="[\d.]+" height="([\d.]+)"><title>([\d.]+)ms/g)];
  assert.equal(bars.length, 3);
  // sorted ascending by value: 10, 50, 100
  assert.deepEqual(bars.map((b) => b[4]), ['10', '50', '100']);
  // x increases left to right in the same sorted order
  assert.ok(Number(bars[0]![1]) < Number(bars[1]![1]));
  assert.ok(Number(bars[1]![1]) < Number(bars[2]![1]));
  // the bucket with count=50 (the max) has the tallest bar (largest height)
  const heights = bars.map((b) => Number(b[3]));
  assert.equal(heights.indexOf(Math.max(...heights)), 0, 'value=10 (count=50, the max) must have the tallest bar');
});
