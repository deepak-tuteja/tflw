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
  { id: 'connects', syntax: '`connects`', appliesTo: '`request`', example: '`expect request connects`', status: 'shipped' },
  { id: 'fails', syntax: '`fails` / `fails matching "<regex>"`', appliesTo: '`request`', example: '`expect request fails matching "certificate"`', status: 'shipped' },
] as const;

/** One row of SPEC §7's new generators quick-reference table (§7.2/§7.3 previously had no table,
 * prose only). `syntax`/`example` are markdown-ready cell text. */
export interface GeneratorEntry {
  readonly id: string;
  readonly family: 'unique' | 'random' | 'transform';
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
  { id: 'transform-base64', family: 'transform', syntax: '`base64 encode(...)` / `base64 decode(...)`', notes: 'pure deterministic value transform, not a fresh-value generator (decision 98)', example: '`base64 encode("{email}:{password}")`' },
  { id: 'transform-hex', family: 'transform', syntax: '`hex encode(...)` / `hex decode(...)`', notes: 'pure deterministic value transform, not a fresh-value generator (decision 98)', example: '`hex encode("{token}")`' },
  { id: 'transform-url', family: 'transform', syntax: '`url encode(...)` / `url decode(...)`', notes: 'pure deterministic value transform, not a fresh-value generator (decision 98)', example: '`url encode("{query}")`' },
] as const;

/** One CLI flag, entered by hand (decision 16.4 — `cli.ts`'s arg parsing has nothing to
 * introspect). Feeds `packages/docs-site`'s `Reference/cli.md` (replacing README's old flag
 * table, decision 16.10) and a later LSP's signature help. */
export interface CliFlagEntry {
  readonly flag: string;
  readonly command: 'run' | 'check' | 'global';
  readonly effect: string;
}

/** One row of SPEC §17's diagnostic codes table (decision 20.3, docs-site polish cluster 9) — the
 * single source of truth for what a `TF0xx` code *means* going forward. `packages/lang/src/
 * diagnostic.ts`'s `Codes` object stays the source of the code constants themselves (and every
 * per-occurrence `message`/`hint` stays call-site-specific, generated at each checker/parser call
 * site — this manifest is only the canonical, code-general explanation, not a replacement for
 * either). `meaning`/`example` are markdown-ready cell text. */
export interface DiagnosticEntry {
  readonly code: string;
  readonly meaning: string;
  readonly example: string;
}

export const DIAGNOSTICS: readonly DiagnosticEntry[] = [
  { code: 'TF001', meaning: 'Lexer: a character that cannot begin any token.', example: '`let y = $oops` → `unexpected character "$"`' },
  { code: 'TF002', meaning: 'Lexer: a string literal has no closing quote before end of line.', example: '`test "open string`' },
  { code: 'TF003', meaning: 'Lexer: indentation does not line up with any enclosing block.', example: 'a dedent that lands between two open indent levels' },
  { code: 'TF010', meaning: 'Parser: a token appeared where the grammar didn\'t allow it (the catch-all "unexpected token" code — covers many distinct shapes: a missing path after `api GET`, a multi-word call missing its parens, a malformed table row cell count, etc.).', example: '`api GET` (no path) → `expected a path like `/orders`, found end of line`' },
  { code: 'TF011', meaning: 'Parser: an unrecognised statement keyword where a step was expected.', example: '`expct status equals 200` → `did you mean `expect`?`' },
  { code: 'TF012', meaning: 'Parser: an unknown HTTP method after `api`.', example: '`api FETCH /health` → `did you mean `PATCH`?`' },
  { code: 'TF013', meaning: 'Parser: an unrecognised `expect`/`capture` subject.', example: '`expect statuss equals 200` → `did you mean `status`?`' },
  { code: 'TF014', meaning: 'Parser: an unrecognised matcher after a subject.', example: '`expect status eq 200` → `did you mean` one of `equals, contains, matches, is …, has …`' },
  { code: 'TF015', meaning: 'Parser: a `test`/`action`/hook block has no indented body.', example: 'a `before file` block with no steps under it' },
  { code: 'TF016', meaning: 'Parser: top-level content that isn\'t a `test`/`action`/`import`/`use`/`before`/`after`.', example: 'a bare `expect …` line outside any block' },
  { code: 'TF020', meaning: 'Parser (config): an unrecognised key inside a config block.', example: '`headr "Accept" is "…"` → `did you mean `header`?`' },
  { code: 'TF021', meaning: 'Parser (config): a `test` appears in the declaration-only config dialect.', example: '`test "not allowed here"` inside `tflw.config`' },
  { code: 'TF022', meaning: 'Parser (config): top-level config content that isn\'t `defaults`/`env`/`session`/`require`.', example: '`workers 3` at the top level of `tflw.config` (belongs inside a block)' },
  { code: 'TF023', meaning: 'Parser (config): a duration with an unknown unit.', example: '`timeout step 5x` → `expected ms, s, or m`' },
  { code: 'TF024', meaning: 'Checker (config): more than one `env` marked `default`, or a duplicate env name.', example: 'two `env … default` blocks in one `tflw.config`' },
  { code: 'TF025', meaning: 'Checker (config): a key used in the wrong block.', example: '`web "…"` inside `defaults` (belongs in an `env` block)' },
  { code: 'TF026', meaning: 'Checker: an `api <service>`/`wait until api <service>` name not declared in the active env — checked in test/action/hook bodies **and** inside `session` blocks (decision 66).', example: '`api billng POST /auth/login` → `did you mean `billing`?`' },
  { code: 'TF027', meaning: 'Checker: a `{col}` reference not among an inline `with each` table\'s declared columns.', example: 'referencing `{prcie}` when the table\'s header column is `price`' },
  { code: 'TF028', meaning: 'Checker: a `test … as <session>[, <session>...]` name not declared by any `session` block — one diagnostic per unknown name.', example: '`test "…" as ghost` with no `session ghost` declared' },
  { code: 'TF029', meaning: 'Checker (config): a duplicate `session` name.', example: 'two `session admin` blocks in one `tflw.config`' },
  { code: 'TF030', meaning: 'Checker: a `{var}`/bare-identifier reference provably never bound anywhere reachable in its scope — conservative (decision 57): only flags a name that\'s *definitely* unreachable, never one that merely might be.', example: '`capture body.ok as orderId` then `api GET /orders/{orderid}` → `unknown variable "orderid"`, did-you-mean `orderId`' },
  { code: 'TF031', meaning: 'Checker: a `request` assertion (`connects`/`fails`) combined with a response-based assertion (`status`/`header`/`body`/`duration`) on the same request, or used at all inside `wait until api` (decision 18).', example: '`expect request connects` followed by `expect status equals 200` on the same `api` step → `can\'t be combined with `request connects`/`fails` on the same request`' },
  { code: 'TF032', meaning: 'Checker: an `upload … type "…"` value that is a non-interpolated literal not shaped like `type/subtype` (decision 22/M19) — a light regex, not an IANA vocabulary check, so it only catches an obvious typo before the run.', example: '`upload "./f.png" as "avatar" type "imagepng"` → `invalid content type "imagepng", expected a "type/subtype" shape like "image/png"`' },
] as const;

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
  { flag: '`--failed`', command: 'run', effect: 'replays only the previous run\'s failing tests (state in `report/.last-run.json`); falls back to the full suite with a note if nothing failed last time' },
  { flag: '`--bail`', command: 'run', effect: 'stops after the first failing test\'s final (post-retry) verdict; under `--workers > 1`, in-flight files still finish' },
  { flag: '`--format ndjson`', command: 'run', effect: 'streams the event log as one JSON object per line to stdout (plus `report/events.ndjson`) instead of human text; always full detail regardless of `--verbose`' },
  { flag: '`--no-timestamps`', command: 'run', effect: 'omits the `HH:MM:SS.mmm` prefix every console line otherwise gets by default' },
  { flag: '`--log-file <path>`', command: 'run', effect: 'duplicates console output to a file, always plain text (ANSI stripped) regardless of stdout\'s own color state' },
  { flag: '`--format json`', command: 'check', effect: 'prints the target file\'s `Diagnostic[]` as JSON instead of text — for editor integrations' },
  { flag: '`--version`, `-v`', command: 'global', effect: 'print the installed version' },
  { flag: '`--help`, `-h`', command: 'global', effect: 'print usage' },
] as const;
