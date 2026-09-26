// `tflw run`'s flags as one table — `M241` `D` (`D1324`).
//
// `parseRunArgs` was a hand-written chain of thirty-one `if`s, and the page's run strip spoke eight
// of those flags through a second list (`runArgv`). A flag added to the CLI reached the page only
// if someone remembered the second list, and nothing said which flags the page could not reach.
// So the flags are rows here: the parser reads the table, the server hands the page the rows it may
// set (`pageRunFlags`), and `runArgv` builds a request's argv from the same rows. A new flag is one
// row, and the page learns it from the server rather than from a copy.
//
// `subject` is who can spend the flag, which is what the strip's `more…` renders by (`D1250`: the
// lens set of the RUN, never the door): `always`, or only while a scan, a browser test or a
// workload is in the run. `cli` is a flag the page never sets — output shape, logging, colour and
// the triage file writer belong to a terminal, and the page's own run reads ndjson.

export type RunFlagShape = 'bool' | 'value' | 'list';
export type RunFlagSubject = 'always' | 'scan' | 'browser' | 'workload' | 'cli';

export interface RunFlag {
  /** The spelling, with its dashes: `--fail-on`. */
  readonly flag: string;
  /** The `RunArgs` field it parses into. */
  readonly key: string;
  readonly shape: RunFlagShape;
  readonly subject: RunFlagSubject;
  /** What the page's `more…` says beside the control — present exactly when the page may set it. */
  readonly label?: string;
  readonly hint?: string;
}

export const RUN_FLAGS: readonly RunFlag[] = [
  { flag: '--env', key: 'env', shape: 'value', subject: 'cli' },
  { flag: '--seed', key: 'seedRaw', shape: 'value', subject: 'browser', label: 'seed', hint: 'the random seed a run replays — the one a failed run printed' },
  { flag: '--now', key: 'nowRaw', shape: 'value', subject: 'always', label: 'now', hint: 'the instant `now` and `today` read, as an ISO date-time' },
  { flag: '--tag', key: 'tagRaw', shape: 'value', subject: 'cli' },
  { flag: '--only', key: 'only', shape: 'value', subject: 'cli' },
  { flag: '--parallel', key: 'parallelRaw', shape: 'value', subject: 'always', label: 'parallel', hint: 'how many files run at once' },
  { flag: '--workers', key: 'workersRaw', shape: 'value', subject: 'cli' },
  { flag: '--skip-workload', key: 'skipWorkload', shape: 'bool', subject: 'workload', label: 'skip workload', hint: 'run each load test once, as a functional test, without its workload' },
  { flag: '--no-color', key: 'noColor', shape: 'bool', subject: 'cli' },
  { flag: '--verbose', key: 'verbose', shape: 'bool', subject: 'cli' },
  { flag: '--forbid-insecure', key: 'forbidInsecure', shape: 'bool', subject: 'cli' },
  { flag: '--allow-public-target', key: 'allowPublicTargets', shape: 'list', subject: 'cli' },
  { flag: '--evidence', key: 'evidenceRaw', shape: 'value', subject: 'always', label: 'evidence', hint: 'what a run keeps for each request — `failed`, `all` or `none`' },
  { flag: '--teardown', key: 'teardownRaw', shape: 'value', subject: 'cli' },
  { flag: '--failed', key: 'failed', shape: 'bool', subject: 'cli' },
  { flag: '--shard', key: 'shardRaw', shape: 'value', subject: 'cli' },
  { flag: '--bail', key: 'bail', shape: 'bool', subject: 'always', label: 'bail', hint: 'stop at the first failure' },
  { flag: '--format', key: 'formatRaw', shape: 'value', subject: 'cli' },
  { flag: '--no-timestamps', key: 'noTimestamps', shape: 'bool', subject: 'cli' },
  { flag: '--log-file', key: 'logFile', shape: 'value', subject: 'cli' },
  { flag: '--browser', key: 'browserRaw', shape: 'value', subject: 'browser', label: 'browser', hint: 'which engine the browser tests drive — chromium, firefox or webkit' },
  { flag: '--headed', key: 'headed', shape: 'bool', subject: 'cli' },
  { flag: '--no-helpers', key: 'noHelpers', shape: 'bool', subject: 'cli' },
  { flag: '--trace', key: 'trace', shape: 'bool', subject: 'cli' },
  { flag: '--update-snapshots', key: 'updateSnapshots', shape: 'bool', subject: 'cli' },
  { flag: '--log-output', key: 'logOutputRaw', shape: 'value', subject: 'cli' },
  { flag: '--log-level', key: 'logLevelRaw', shape: 'value', subject: 'cli' },
  { flag: '--fail-on', key: 'failOnRaw', shape: 'value', subject: 'scan', label: 'fail on', hint: 'the least severe finding that fails the run' },
  { flag: '--baseline', key: 'baseline', shape: 'value', subject: 'scan', label: 'baseline', hint: 'the accepted-findings document this run reads' },
  { flag: '--baseline-write', key: 'baselineWrite', shape: 'value', subject: 'cli' },
  { flag: '--probe-seeded', key: 'probeSeededRaw', shape: 'value', subject: 'cli' },
];

/** The rows the page's `more…` renders — every flag with a label. */
export function pageRunFlags(): readonly RunFlag[] {
  return RUN_FLAGS.filter((f) => f.label !== undefined);
}

/**
 * Read `argv` against the table. Values land on their row's `key`; a bare word is a file. What
 * each value MEANS is still judged by the caller, which is where it always was — this only
 * replaces the chain of `if`s that decided which variable a word went into.
 */
export function readRunFlags(
  argv: string[],
  value: (argv: string[], i: number, flag: string) => string,
  inline: (arg: string, flag: string) => string,
  unknown: (arg: string) => never,
): { readonly files: string[]; readonly values: Record<string, string | boolean | string[]> } {
  const files: string[] = [];
  const values: Record<string, string | boolean | string[]> = {};
  const byFlag = new Map(RUN_FLAGS.map((f) => [f.flag, f]));
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) {
      files.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    const row = byFlag.get(eq === -1 ? a : a.slice(0, eq));
    if (row === undefined || (row.shape === 'bool' && eq !== -1)) unknown(a);
    if (row.shape === 'bool') {
      values[row.key] = true;
      continue;
    }
    const v = eq === -1 ? value(argv, ++i, a) : inline(a, row.flag);
    if (row.shape === 'list') values[row.key] = [...((values[row.key] as string[] | undefined) ?? []), v];
    else values[row.key] = v;
  }
  return { files, values };
}

/**
 * `--tag` as a selection (`M242` `B`, `D1327`). A plain tag includes and the includes are an OR —
 * `--tag smoke,api` runs what carries either, as it always has. A `!`-prefixed tag excludes and the
 * exclusions are an AND — `--tag !slow,!flaky` runs what carries neither — so a skip that is really
 * "not in this job" is written on the command line and never as a `skip` in the file. Only
 * exclusions means "everything, less these".
 */
export function tagsKeep(selected: readonly string[] | undefined, carried: readonly string[]): boolean {
  if (!selected) return true;
  const include = selected.filter((t) => !t.startsWith('!'));
  const exclude = selected.filter((t) => t.startsWith('!')).map((t) => t.slice(1));
  if (exclude.some((t) => carried.includes(t))) return false;
  return include.length === 0 || include.some((t) => carried.includes(t));
}

/**
 * `--shard i/n` (`M242` `E`, `D1330`): this run takes every `n`th file of the sorted discovered
 * list, starting at the `i`th — file `k` (from 0) runs in shard `k mod n + 1`. Round-robin rather
 * than contiguous blocks, so a directory of slow files is spread across shards instead of landing
 * in one. The shards of one `n` are disjoint and together are the whole list, which is the one
 * property a CI matrix needs. Returns the refusal as a sentence when the value is not that shape.
 */
export function parseShard(raw: string): { readonly index: number; readonly count: number } | string {
  const m = /^(\d+)\/(\d+)$/.exec(raw.trim());
  if (!m) return `--shard takes \`i/n\` — e.g. \`--shard 2/4\` for the second of four — and was given \`${raw}\``;
  const index = Number(m[1]);
  const count = Number(m[2]);
  if (count < 1) return `--shard ${raw}: there is no zeroth way to split a suite — n is at least 1`;
  if (index < 1 || index > count) return `--shard ${raw}: i counts from 1 to n, so a shard of ${count} is 1/${count} to ${count}/${count}`;
  return { index, count };
}

/** Whether the file at `position` in the sorted list belongs to this shard. */
export function inShard(position: number, shard: { readonly index: number; readonly count: number }): boolean {
  return position % shard.count === shard.index - 1;
}
