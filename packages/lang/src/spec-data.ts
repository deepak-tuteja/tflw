// The canonical structured manifest of matcher/generator/CLI-flag signatures (PLAN decision 103,
// enterprise arc cluster 4, decision 16.4). Hand-authored — there's no `GeneratorName` union or
// CLI-flag type to introspect (generators parse via dedicated `parseUniqueExpr`/`parseRandomExpr`
// functions in parser.ts, not a typed list; `cli.ts`'s arg parsing is hand-rolled). This is the
// single source of truth going forward: `scripts/gen-spec-tables.mjs` renders the matcher and
// generator tables straight into SPEC.md between marker comments (replacing/augmenting what used
// to be hand-maintained prose tables); `packages/docs-site`'s Reference pages and a later LSP's
// hover/signature-help (PLAN_ENTERPRISE.md decision 17.7) import this module directly.

/** One row of SPEC §6.2's matcher table. `syntax`/`appliesTo`/`example` are markdown-ready cell
 * text (inline backticks already embedded where the original hand-written table had them) so the
 * generated table is byte-identical to what it replaces. */
export interface MatcherEntry {
  readonly id: string;
  readonly syntax: string;
  readonly appliesTo: string;
  readonly example: string;
  readonly status: 'shipped' | 'planned';
}

export const MATCHERS: readonly MatcherEntry[] = [
  { id: 'equals', syntax: '`equals`', appliesTo: 'any value', example: '`expect status equals 201`', status: 'shipped' },
  { id: 'contains', syntax: '`contains`', appliesTo: 'strings, arrays', example: '`expect body.msg contains "created"`', status: 'shipped' },
  { id: 'matches-regex', syntax: '`matches "<regex>"`', appliesTo: 'strings', example: '`expect header "content-type" matches "json"`', status: 'shipped' },
  { id: 'matches-subset', syntax: '`matches subset {...}`', appliesTo: 'objects', example: '`expect body matches subset { type: "about:blank", status: 422 }`', status: 'shipped' },
  { id: 'matches-schema', syntax: '`matches schema "Name" from "src"`', appliesTo: 'objects', example: '`expect body matches schema "ProductResponseDto" from "/openapi.json"`', status: 'shipped' },
  { id: 'greater-less-than', syntax: '`is greater than` / `is less than`', appliesTo: 'numbers, `duration`', example: '`expect body.total is less than 100`', status: 'shipped' },
  { id: 'has-count', syntax: '`has count N`', appliesTo: 'arrays, UI lists', example: '`expect body.items has count 3`', status: 'shipped' },
  { id: 'has-value', syntax: '`has value`', appliesTo: 'UI fields', example: '`expect field "Email" has value "a@b.c"`', status: 'planned' },
  { id: 'state-word', syntax: '`is visible/hidden/enabled/disabled/checked`', appliesTo: 'UI locators', example: '`expect button "Pay" is enabled`', status: 'planned' },
] as const;

/** One row of SPEC §7's new generators quick-reference table (§7.2/§7.3 previously had no table,
 * prose only). `syntax`/`example` are markdown-ready cell text. */
export interface GeneratorEntry {
  readonly id: string;
  readonly family: 'unique' | 'random';
  readonly syntax: string;
  readonly notes: string;
  readonly example: string;
}

export const GENERATORS: readonly GeneratorEntry[] = [
  { id: 'unique-prefix', family: 'unique', syntax: '`unique("prefix")`', notes: 'collision-safe across tests/workers/retries', example: '`unique("Widget")`' },
  { id: 'unique-email', family: 'unique', syntax: '`unique email`', notes: 'collision-safe across tests/workers/retries', example: '`unique email`' },
  { id: 'unique-number', family: 'unique', syntax: '`unique number`', notes: 'collision-safe across tests/workers/retries', example: '`unique number`' },
  { id: 'unique-like', family: 'unique', syntax: '`unique like "ORD-######"`', notes: '`#` = digit; pattern fill, collision-safe', example: '`unique like "ORD-######"`' },
  { id: 'unique-uuid', family: 'unique', syntax: '`unique uuid`', notes: 'v4-shaped; trailing digits are the run-wide counter, so distinctness is guaranteed, not probabilistic', example: '`unique uuid`' },
  { id: 'random-number', family: 'random', syntax: '`random number A to B` / `random decimal A to B`', notes: 'seed-reproducible; rejects a reversed range as a runtime error', example: '`random number 1 to 100`' },
  { id: 'random-date', family: 'random', syntax: '`random date in past` / `in future` / `between A and B`', notes: 'seed- and run-clock-reproducible (`--seed`/`--now`)', example: '`random date in past`' },
  { id: 'random-of', family: 'random', syntax: '`random of "a", "b", ...`', notes: 'seed-reproducible pick from an inline list', example: '`random of "red", "blue", "green"`' },
  { id: 'random-string', family: 'random', syntax: '`random string N`', notes: 'seed-reproducible alnum string of length N', example: '`random string 12`' },
  { id: 'random-like', family: 'random', syntax: '`random like "SKU-####-??"`', notes: '`#` = digit, `?` = letter; seed-reproducible pattern fill', example: '`random like "SKU-####-??"`' },
  { id: 'random-uuid', family: 'random', syntax: '`random uuid`', notes: 'v4, collisions allowed (not collision-guaranteed like `unique uuid`)', example: '`random uuid`' },
  { id: 'random-password', family: 'random', syntax: '`random password [N]`', notes: 'default length 12, min 4; satisfies a validation policy, not fake-identity realism', example: '`random password 16`' },
] as const;

/** One CLI flag, entered by hand (decision 16.4 — `cli.ts`'s arg parsing has nothing to
 * introspect). Feeds `packages/docs-site`'s `Reference/cli.md` (replacing README's old flag
 * table, decision 16.10) and a later LSP's signature help. */
export interface CliFlagEntry {
  readonly flag: string;
  readonly command: 'run' | 'check' | 'global';
  readonly effect: string;
}

export const CLI_FLAGS: readonly CliFlagEntry[] = [
  { flag: '`--env <name>`', command: 'run', effect: 'selects a named `env` block from `tflw.config` instead of the `default` one — e.g. run the same suite against `staging`' },
  { flag: '`--tag <name>[,<name>...]`', command: 'run', effect: 'only runs tests carrying any of the listed `@name`s (comma-separated OR; combines with `--only` as AND)' },
  { flag: '`--only <name>`', command: 'run', effect: 'runs a single test by its exact declared name (composes with `--tag`\'s OR-list as AND)' },
  { flag: '`--workers <n>`', command: 'run', effect: 'runs test files concurrently across `n` workers (default 1)' },
  { flag: '`--seed <n>`', command: 'run', effect: 'fixes every `random`-family value for the run, so a failure is reproducible byte-for-byte' },
  { flag: '`--now <iso>`', command: 'run', effect: 'pins the run\'s notion of "now" to an exact instant (combine with `--seed` to reproduce a run\'s exact absolute generated values)' },
  { flag: '`--no-color`', command: 'run', effect: 'disables ANSI color in CLI output — useful for CI logs or piping to a file' },
  { flag: '`--verbose`', command: 'run', effect: 'additionally prints one line per step (pass or fail); buffered per-file under `--workers > 1` so concurrent files never interleave' },
  { flag: '`--forbid-insecure`', command: 'run', effect: 'CI policy gate — fails before any test runs if `insecure true` is active for the env actually running' },
  { flag: '`--evidence <level>`', command: 'run', effect: 'overrides `tflw.config`\'s `evidence` key (`full`/`headers-only`/`none`) for this run only' },
  { flag: '`--format json`', command: 'check', effect: 'prints the target file\'s `Diagnostic[]` as JSON instead of text — for editor integrations' },
  { flag: '`--version`, `-v`', command: 'global', effect: 'print the installed version' },
  { flag: '`--help`, `-h`', command: 'global', effect: 'print usage' },
] as const;
