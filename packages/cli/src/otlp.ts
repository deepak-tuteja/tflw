// `tflw export otlp` — `M242` `F` (`D1331`): a finished run as one OpenTelemetry trace, over
// OTLP/HTTP's JSON encoding, so the run lands in whatever tracing backend a team already has.
//
// **NO SDK.** OTLP/HTTP JSON is a documented wire format (the protobuf schema's JSON mapping), and a
// run is four levels of spans. The OpenTelemetry JS SDK is a tree of packages that would be the
// largest dependency this CLI carries, to write one POST.
//
// **THE TIMES ARE RECONSTRUCTED, AND EVERY SPAN SAYS SO.** No artifact records when a test or a
// step *started* — `results.json` carries the run's `startedAt` and every duration, nothing more.
// So the spans are laid end to end from `startedAt`: files in report order, tests within a file,
// steps within a test. That is exact for a sequential run and a layout, not a measurement, for a
// `--parallel` one; `tflw.timing = "reconstructed"` on every span is how a reader of the trace
// knows which it is looking at, rather than trusting a waterfall the run never measured.
import { createHash } from 'node:crypto';
import type { ReportEntry, RunReport, StepResult } from '@tflw/runtime';

interface Attr {
  readonly key: string;
  readonly value: { stringValue?: string; intValue?: string; boolValue?: boolean };
}

export interface OtlpSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly kind: 1;
  readonly startTimeUnixNano: string;
  readonly endTimeUnixNano: string;
  readonly attributes: readonly Attr[];
  readonly status: { readonly code: 1 | 2; readonly message?: string };
}

export interface OtlpDocument {
  readonly resourceSpans: readonly {
    readonly resource: { readonly attributes: readonly Attr[] };
    readonly scopeSpans: readonly { readonly scope: { readonly name: string; readonly version: string }; readonly spans: readonly OtlpSpan[] }[];
  }[];
}

const str = (key: string, v: string): Attr => ({ key, value: { stringValue: v } });
const int = (key: string, v: number): Attr => ({ key, value: { intValue: String(Math.round(v)) } });

/** Ids derived from the run and the span's path, so exporting the same run twice produces the same
 *  trace — a collector de-duplicates a re-send instead of showing the run twice. */
function hexId(bytes: number, ...parts: readonly (string | number)[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, bytes * 2);
}

const nanos = (ms: number): string => (BigInt(Math.round(ms * 1000)) * 1000n).toString();

function entryDuration(e: ReportEntry): number {
  return e.kind === 'workload' ? 0 : e.durationMs;
}

export function reportToOtlp(report: RunReport, version: string): OtlpDocument {
  const t0 = Date.parse(report.startedAt);
  const traceId = hexId(16, 'trace', report.startedAt, report.seed);
  const reconstructed = str('tflw.timing', 'reconstructed');
  const spans: OtlpSpan[] = [];
  const runId = hexId(8, traceId, 'run');
  spans.push({
    traceId, spanId: runId, name: 'tflw run', kind: 1,
    startTimeUnixNano: nanos(t0), endTimeUnixNano: nanos(t0 + report.durationMs),
    attributes: [str('tflw.env', report.env), int('tflw.seed', report.seed), int('tflw.total', report.total), int('tflw.passed', report.passed), int('tflw.failed', report.failed), int('tflw.skipped', report.skipped ?? 0), reconstructed],
    status: report.ok ? { code: 1 } : { code: 2, message: `${report.failed} of ${report.total} failed` },
  });
  const files = new Map<string, ReportEntry[]>();
  for (const e of report.tests) {
    const f = e.file ?? '(no file)';
    files.set(f, [...(files.get(f) ?? []), e]);
  }
  let cursor = t0;
  for (const [file, entries] of files) {
    const fileId = hexId(8, traceId, 'file', file);
    const fileStart = cursor;
    const fileMs = entries.reduce((ms, e) => ms + entryDuration(e), 0);
    const fileOk = entries.every((e) => e.ok);
    spans.push({
      traceId, spanId: fileId, parentSpanId: runId, name: file, kind: 1,
      startTimeUnixNano: nanos(fileStart), endTimeUnixNano: nanos(fileStart + fileMs),
      attributes: [str('tflw.file', file), reconstructed],
      status: fileOk ? { code: 1 } : { code: 2 },
    });
    let testCursor = fileStart;
    entries.forEach((e, i) => {
      const testId = hexId(8, traceId, 'test', file, i, e.name);
      const ms = entryDuration(e);
      const skipped = e.kind === 'functional' ? e.skipped : undefined;
      spans.push({
        traceId, spanId: testId, parentSpanId: fileId, name: e.name, kind: 1,
        startTimeUnixNano: nanos(testCursor), endTimeUnixNano: nanos(testCursor + ms),
        attributes: [str('tflw.kind', e.kind), str('tflw.outcome', skipped !== undefined ? 'skipped' : e.ok ? 'passed' : 'failed'), ...(skipped !== undefined ? [str('tflw.skip_reason', skipped)] : []), reconstructed],
        status: e.ok ? { code: 1 } : { code: 2, ...(e.kind !== 'workload' && e.error ? { message: e.error } : {}) },
      });
      if (e.kind === 'functional') {
        let stepCursor = testCursor;
        e.steps.forEach((s: StepResult, j) => {
          spans.push({
            traceId, spanId: hexId(8, testId, 'step', j), parentSpanId: testId, name: s.source.trim(), kind: 1,
            startTimeUnixNano: nanos(stepCursor), endTimeUnixNano: nanos(stepCursor + s.durationMs),
            attributes: [str('tflw.step', s.kind), int('tflw.line', s.line), reconstructed],
            status: s.ok ? { code: 1 } : { code: 2, ...(s.detail ? { message: s.detail } : {}) },
          });
          stepCursor += s.durationMs;
        });
      }
      testCursor += ms;
    });
    cursor += fileMs;
  }
  return {
    resourceSpans: [{
      resource: { attributes: [str('service.name', 'tflw'), str('service.version', version)] },
      scopeSpans: [{ scope: { name: 'tflw', version }, spans }],
    }],
  };
}

/** `--header K=V`, repeatable — a collector's auth. Refused by name when it has no `=`. */
export function parseHeader(raw: string): readonly [string, string] | string {
  const i = raw.indexOf('=');
  if (i <= 0) return `--header takes \`name=value\`, e.g. \`--header authorization=Bearer …\`, and was given \`${raw}\``;
  return [raw.slice(0, i).trim(), raw.slice(i + 1)];
}
