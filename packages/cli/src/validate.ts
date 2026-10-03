// The checks `tflw run` makes before its first request (`M267`, `D1431`), printing nothing.
//
// `loadAndValidate` (`cli.ts`) is the printing half every command starts in — `run`, `check`,
// `watch`, `migrate`, the load worker. `tflw doctor` calls `validateProject` directly and reports
// what it hears its own way, so doctor's verdict is these checks and not a second copy of them.
// A second copy is the failure this module exists to prevent: it would agree with `run` on the day
// it was written and drift from it on the first rule added afterwards.

import { readFile, stat } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import {
  checkAllowHostsCoversBaseUrls,
  checkCodeFlowSessions,
  checkConfigBracedEnvRefs,
  checkConfigDeclaredEnvRefs,
  checkProgram,
  checkSessionBody,
  parseConfigSource,
  parseSource,
  suggest,
  type Diagnostic,
  type Program,
} from '@tflw/lang';
import { checkConfigFiles, ConfigError, resolveConfig, resolveImportedActions, resolveMissingFiles, selectEnv } from '@tflw/runtime';
import { buildEnviron } from './env.js';
import { discoverTests } from './project.js';

/** Parsed + checker-clean state shared by `tflw run` and `tflw check` (decision 75) — everything
 * `tflw run` needs before it actually executes anything. */
export interface ValidatedProject {
  readonly resolved: ReturnType<typeof resolveConfig>;
  readonly parsedConfig: ReturnType<typeof parseConfigSource>;
  /** `tflw.config`'s own source lines (`M111`, `FU-06`) — carried out beside `resolved` because
   * this is the one place the config's *text* is read, and the runtime needs it to render a
   * `session` step's source from the document that step's span actually indexes. Without it the
   * runtime has only the test file's lines and slices session steps out of that. */
  readonly configLines: readonly string[];
  readonly environ: NodeJS.ProcessEnv;
  readonly parsedFiles: { file: string; source: string; program: Program }[];
  /** Every module a `use` names, once, with the files naming it — what `tflw check` prints
   *  (`D1319`), so a reviewer sees the code a run would execute without opening a file. */
  readonly helpersUsed: readonly { readonly module: string; readonly files: readonly string[] }[];
  /** How many `severity: 'warning'` diagnostics were printed on the way here (M97e, D147). Carried
   * out because `checkCommand`'s summary line is otherwise written from `parsedFiles.length` alone
   * and says `no problems found` — which, the first time a shipped diagnostic actually took the
   * warning branch, printed that sentence to stdout directly above a warning on stderr. */
  readonly warningCount: number;
}

/** What `validateProject` reports, in the order it finds it. It prints nothing itself. */
export interface ValidationSink {
  /** A refusal before anything is checked — no config, an `--env` the config does not declare, a
   *  file argument that is not a `.tflw` file, no test files. One sentence with its remedy. */
  refused(message: string): void;
  /** `tflw.config`'s diagnostics: the parse failure, or the env-level checks (which may be warnings
   *  only, and then validation goes on). */
  configDiagnostics(diagnostics: readonly Diagnostic[], configText: string): void;
  /** One file's parse and checker diagnostics, once for every file checked; `[]` for a clean one. */
  fileDiagnostics(file: string, source: string, diagnostics: readonly Diagnostic[]): void;
}

export interface ValidateOptions {
  /** The positional files; `[]` means every `.tflw` file discovery finds. */
  readonly files: readonly string[];
  /** `--env`. */
  readonly env: string | undefined;
  /** `TFLW_ENV`, read by the caller so a test can pass its own. */
  readonly envVar: string | undefined;
  /** `.env` overlaid by the process; read from `cwd` when absent. */
  readonly environ?: NodeJS.ProcessEnv;
  /** `--allow-public-target` (M131a, D340/D345), for `TF065`/`TF066`. */
  readonly allowPublicTargets?: readonly string[];
  /** `--no-helpers` (`D1319`): `'none'` reports every `use` as `TF083`. */
  readonly helperPolicy?: 'config' | 'none';
}

/**
 * `M252` (`D1398`, `G19`) — a file argument, spelled the way `cwd` is. `process.cwd()` is always
 * the real path, so a file named through a symlinked directory (macOS's `/var` for
 * `/private/var`, a symlinked checkout) made every `relative(cwd, file)` climb out and back in —
 * and `TF083` judged every `use "./helpers/…"` outside `helpers`, because the path it judged was
 * `../../…/var/…`. Only the directory goes through `realpath`: a test file that is itself a
 * symlink keeps its own name and place, which is where its `use` and `import` resolve from.
 */
export function canonicalFile(cwd: string, f: string): string {
  const full = resolve(cwd, f);
  try {
    return join(realpathSync(dirname(full)), basename(full));
  } catch {
    return full; // a directory that is not there: `checkFileArgs` has already said so
  }
}

/**
 * `unknownFlag`'s other half. Every parser's fall-through branch splits two ways — a `--`-prefixed
 * token, which M61 made a usage error, and everything else, which went into the file list
 * unexamined. So the second half kept the whole of the original defect (review finding `B6-11`,
 * cluster C5): the file list is `readFile`d several layers later, and a mistyped path surfaced as a
 * raw Node `ENOENT` naming an absolute path that does not exist, a directory as `EISDIR: illegal
 * operation on a directory, read` — which does not name the directory at all — and `tflw run
 * tflw.config` as a wall of grammar diagnostics against a file that was never a test.
 *
 * In `tflw watch` it was worse than untidy. `runOne`'s promise chain has no `.catch`, so that same
 * `readFile` rejection escaped as an **unhandled rejection**: Node printed a stack trace and killed
 * the process, so `tflw watch a.tflww` died during its first run having never watched anything, and
 * never printed the line that says it is watching. Validating here fixes that too, because a usage
 * error in this function is a *returned* refusal rather than a throw.
 *
 * Checked in one place because `run`, `check`, `migrate` and `watch` all reach their file list
 * through `loadAndValidate` — the same reasoning as `unknownFlag`: the rule belongs to the argument
 * surface, not to one command. Discovery runs only to build the suggestion list, on the error path,
 * so an ordinary `tflw run a.tflw` still stats its one file and walks nothing.
 *
 * A directory is refused rather than descended into: `--help`, the README and SPEC all spell the
 * positional as `[files...]`, and making it mean "files or directories" is grammar-freeze surface,
 * not a diagnostics fix. The message names the `.tflw` files inside it so the refusal is one
 * copy-paste from what the user meant.
 */
export async function fileArgsProblem(cwd: string, typed: readonly string[], exclude: readonly string[], reportDir?: string): Promise<string | undefined> {
  // `reportDir` passed for the same reason as in `discoverTests`: a repro tflw wrote is not something the
  // user meant to type, so it must not appear in a `did you mean` list either.
  const discovered = async (): Promise<string[]> => (await discoverTests(cwd, exclude, reportDir)).map((f) => relative(cwd, f).split('\\').join('/'));
  for (const arg of typed) {
    const full = resolve(cwd, arg);
    let stats;
    try {
      stats = await stat(full);
    } catch {
      const hint = suggest(arg, await discovered());
      return (
        `no test file \`${arg}\` — nothing exists at that path.` +
          (hint ? `\n  did you mean \`${hint}\`?` : '') +
          `\n  pass no file arguments at all and tflw uses every \`.tflw\` file under the current directory.`
      );
    }
    if (stats.isDirectory()) {
      // Walked from the directory itself rather than filtered out of `discovered()`, because that
      // filter computed a different claim than the sentence below makes. `relative(cwd, full)` is
      // `''` for the current directory, so the prefix tested was `/` and no cwd-relative path could
      // ever match it: `tflw check .` answered "no `.tflw` files were found under it" standing in a
      // directory holding six. The same false negative covered every directory *outside* `cwd`
      // (nothing discovered under `cwd` starts with `../`) and every directory the config
      // `exclude`s. `exclude` is deliberately not passed on here: this list answers "what could you
      // have typed instead", and an explicit file arg inside an excluded path still runs (see
      // `discoverTests`) — so an excluded directory's files are exactly the ones worth naming.
      const inside = (await discoverTests(full)).map((f) => relative(cwd, f).split('\\').join('/'));
      return (
        `\`${arg}\` is a directory — tflw takes \`.tflw\` files here, not directories.` +
          (inside.length > 0
            ? `\n  name the files instead: ${inside.slice(0, 3).map((f) => `\`${f}\``).join(' ')}${inside.length > 3 ? ` (and ${inside.length - 3} more)` : ''}`
            : `\n  no \`.tflw\` files were found under it.`) +
          `\n  pass no file arguments at all and tflw uses every \`.tflw\` file under the current directory.`
      );
    }
    if (!arg.endsWith('.tflw')) {
      return (
        `\`${arg}\` is not a \`.tflw\` test file.` +
          `\n  tflw would try to parse it as one, and report every line of it as a grammar error.` +
          `\n  test files end in \`.tflw\`; \`tflw.config\` is configuration, not a test.`
      );
    }
  }
  return undefined;
}

export async function validateProject(cwd: string, opts: ValidateOptions, sink: ValidationSink): Promise<ValidatedProject | undefined> {
  const { files: filesArg, env: envFlag, allowPublicTargets = [], helperPolicy = 'config' } = opts;
  // 1. Load + parse tflw.config (declaration-only dialect).
  const configPath = join(cwd, 'tflw.config');
  let configText: string;
  try {
    configText = await readFile(configPath, 'utf8');
  } catch {
    sink.refused(`no \`tflw.config\` found in ${cwd}. Run \`tflw init\` to scaffold one.`);
    return undefined;
  }
  const parsedConfig = parseConfigSource(configText);
  if (parsedConfig.diagnostics.length > 0) {
    sink.configDiagnostics(parsedConfig.diagnostics, configText);
    return undefined;
  }

  // 2. Select the active env and resolve the concrete settings.
  // 3, moved ahead of 2's resolution by `M197` (D1024): a config URL's `env NAME default` override
  //    reads the same environment `env()` does — `.env` overlaid by the process — so the two agree
  //    about what "the environment" is; reading it is harmless (no network, no gate), and only
  //    `runCommand` gates on `missingRequiredEnv` below.
  const environ = opts.environ ?? (await buildEnviron(cwd));

  let resolved;
  let activeEnvBlock;
  try {
    const envBlock = selectEnv(parsedConfig.config, { flag: envFlag, envVar: opts.envVar });
    activeEnvBlock = envBlock;
    resolved = resolveConfig(parsedConfig.config, envBlock, environ);
  } catch (e) {
    if (e instanceof ConfigError) {
      sink.refused(e.message);
      return undefined;
    }
    throw e;
  }

  // Validate `api <service>` references inside `session` blocks against the active env's declared
  // services (decision 66) — a config-level check, done once (not per test file, unlike the
  // per-file `checkServices` below), since `session` blocks live in `tflw.config`, not a test file.
  // `allow hosts` vs. the active env's own base URLs (M85, `TF036`) joins it for the same reason
  // and with the same scope — it is a `tflw.config` rule about the env that was just selected, not
  // about every env the file happens to declare (see `checkAllowHostsCoversBaseUrls`).
  //
  // M116 (D148, D151) adds two things here. `envBaseUrls` is what `TF051` decides against — two
  // booleans read off the env that was just selected, not the URLs themselves (see `EnvBaseUrls`).
  // And `collectConfigFileReferences` brings `cert`/`key` and a `session` body's own paths under
  // `TF043`, resolved against the *config's* directory rather than any test file's.
  const envBaseUrls = { envName: resolved.envName, api: resolved.apiBaseUrl !== null, web: resolved.webBaseUrl !== null };
  // M124/D236 — `TF055`'s config half, resolved here for the same reason and read the same way: one
  // number off the env that was just selected, not the whole `timeouts` record, because the rule
  // compares against exactly one budget.
  const envTimeouts = { envName: resolved.envName, wait: resolved.timeouts.wait };
  // M125b1/D263 — `TF058`'s config half. Read off the **resolved** config rather than re-walked from
  // the `defaults`/`env` blocks, because `resolve.ts:96` already accumulates the two the way SPEC
  // §3.7 says they compose (`allowHosts = [...(allowHosts ?? []), ...entry.hosts]`), and a second
  // accumulation here is the "two copies of a matching rule" that `checkAllowHostsCoversBaseUrls`
  // has a paragraph warning about one function away.
  //
  // `?? []` is load-bearing and is the opposite of the usual defaulting: `resolved.allowHosts` is
  // `null` when no env or `defaults` block declared the key, which is *exactly* the state `TF058`
  // reports. Passing `undefined` through here would say "nobody resolved a config" about a config
  // this function has, by that point, definitely read.
  const envAllowHosts = { envName: resolved.envName, hosts: resolved.allowHosts ?? [] };
  // M128b/D291 — `TF060`'s config half. Read off the resolved config for the same reason
  // `envAllowHosts` is: `resolve.ts` already accumulates `defaults` + `env` the way SPEC §3.7 says
  // they compose, and a second accumulation here is the "two copies of a matching rule" that
  // `checkAllowHostsCoversBaseUrls` has a paragraph warning about.
  //
  // The base URL is passed as the *literal* the env declared, not a normalized one, so the
  // diagnostic quotes back the string the author actually wrote. `resolved.apiBaseUrl` is already
  // interpolation-resolved, which is what makes an `api "https://{API_HOST}/v1"` env checkable here
  // at all rather than skipped — the interpolation happened before this line.
  //
  // M131a/D343 adds `services`, and it is the field that closes the hole this milestone found while
  // scoping: `TF060` gated only the default `api` base, so a scan against a declared `@service`
  // origin required no declaration and no affirmation — a different host, entirely ungated. Read
  // off `resolved.services` for the same reason the rest of this object is read off `resolved`:
  // `resolve.ts` has already composed `defaults` + `env`, and a second composition here is the
  // "two copies of a matching rule" this file keeps warning about.
  const envAuthorizedTargets = {
    envName: resolved.envName,
    targets: resolved.authorizedTargets,
    apiBaseUrl: resolved.apiBaseUrl,
    services: Object.entries(resolved.services).map(([name, url]) => ({ name, url })),
  };
  const configEnvDiags = [
    // **`resolved.sessions`, not `parsedConfig.config.sessions` — this is the line `M137f-02` is
    // about** (`M147d`, D642). A `session` body names services, and services are per-env, so
    // checking *every* declared session against *this* env's service map is what forced a session's
    // origin into env blocks that never touch it: `TF026` before a single assertion ran, and then
    // `TF060` and `TF065` behind it, because declaring the service made the file checkable in an env
    // that had not affirmed the target. Reading the env-filtered roster means a session scoped
    // elsewhere is not this env's business, which is the whole repair.
    ...checkSessionBody(Array.from(resolved.sessions.values()), Object.keys(resolved.services), envBaseUrls, envTimeouts),
    ...checkAllowHostsCoversBaseUrls(parsedConfig.config, activeEnvBlock),
    // M156a/M156b (`D775`, `D778`) — `TF077` and `TF078` over the config dialect, and this is the
    // half the rule was built from: a `session` body's `body { password: env(PW) }` and an `oauth`
    // block's `client secret env(SECRET)` are the two commonest `env()` positions anywhere, and a
    // rule that only saw test files would miss them.
    //
    // **`parsedConfig.config`, not `resolved.sessions` — the opposite of the line above.** That one
    // reads the env-filtered roster because a session scoped to another env is not this env's
    // business. This one reads the whole file, and since `M266` (`D1424`) it reads the declarations
    // off the file too: what declares an `env(PW)` depends on where it is written — an `env` block,
    // a session scoped `for env`, or neither — and never on `--env`, so an `env(PW)` in a session
    // scoped elsewhere is reported under every env or none, not only when its author runs that env.
    ...checkConfigDeclaredEnvRefs(parsedConfig.config),
    ...checkConfigBracedEnvRefs(parsedConfig.config),
    // `M248` (`D1354`) — `TF093`/`TF094`, whole file for the reason `checkCodeFlowSessions` gives.
    ...checkCodeFlowSessions(parsedConfig.config),
    ...(await checkConfigFiles(parsedConfig.config, cwd)),
  ];
  // **Gate on errors, not on "any diagnostic".** This branch used to `return EXIT_USAGE` for
  // anything at all, which was correct while every config diagnostic was an error and became a
  // latent `A4-05` the moment one was not. `TF043`'s run tier is exactly that case (D147): a
  // `cert` a `before all` hook creates is a *prediction*, and a prediction must not make a valid
  // suite unrunnable. Same rule the per-file stage below already applies, now stated in both.
  const configEnvErrors = configEnvDiags.filter((d) => d.severity === 'error');
  if (configEnvDiags.length > 0) {
    sink.configDiagnostics(configEnvDiags, configText);
    if (configEnvErrors.length > 0) return undefined;
  }

  // 4. Discover the test files. Anything named explicitly is checked first (M82, C5/`B6-11`) —
  //    every path below this line assumes a readable `.tflw`, and the `readFile` that finds out
  //    otherwise is 15 lines down with no handler above it.
  if (filesArg.length > 0) {
    const bad = await fileArgsProblem(cwd, filesArg, resolved.exclude, resolved.reportDir);
    if (bad !== undefined) {
      sink.refused(bad);
      return undefined;
    }
  }
  const files = filesArg.length > 0 ? filesArg.map((f) => canonicalFile(cwd, f)) : await discoverTests(cwd, resolved.exclude, resolved.reportDir);
  if (files.length === 0) {
    sink.refused('no `.tflw` test files given or found (looked for *.tflw under the current directory).');
    return undefined;
  }

  // Validate every file before running any (P#46): a parse/check error in one file must never
  // let the others execute with real side effects. Parse+check each file up front; only start
  // running once every file is clean.
  const knownSessions = Array.from(resolved.sessions.keys());
  // M130b/D307 — the subset, derived from the same map the roster comes from so the two cannot
  // disagree about which sessions exist.
  const privilegedSessions = knownSessions.filter((name) => resolved.sessions.get(name)?.privileged === true);
  const parsedFiles: { file: string; source: string; program: Program }[] = [];
  let hadErrors = false;
  // Seeded with the config stage's own warnings (M116/D151), not zeroed: a `cert` that is not
  // there is a warning the run summary has to count, or `1 warning` printed above a `no problems
  // found` summary — the exact inconsistency `TF043`'s first tier was reviewed for.
  let warningCount = configEnvDiags.length - configEnvErrors.length;
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const parsed = parseSource(source);
    // `M147c`/`M140-03` — resolved once and *both* of its answers used. This call already read and
    // parsed every imported file; until now the caller took the actions and threw away the fact
    // that one of them had not parsed, which is how `tflw check` came to print `no problems found`
    // for a file whose `import` target cannot parse. `importsWithErrors` carries that fact to
    // `TF073` the same way `missingFiles` carries `resolveMissingFiles`'s to `TF043`.
    const imports = await resolveImportedActions(file, parsed.program);
    // One composed pass list, shared with the language server and the docs-site editor demo (M60)
    // — those two used to assemble their own shorter lists and silently drifted behind this one.
    const checkDiags = checkProgram(parsed.program, {
      knownServices: Object.keys(resolved.services),
      knownSessions,
      privilegedSessions,
      outOfScopeSessions: { envName: resolved.envName, declaredElsewhere: resolved.sessionsOutOfScope },
      // `M246` (`TF086`) — the active env's signers, with the scoped-elsewhere set for the hint.
      knownSigners: Array.from(resolved.signers?.keys() ?? []),
      ...(resolved.envNames ? { knownEnvs: resolved.envNames } : {}),
      activeEnv: resolved.envName,
      outOfScopeSigners: { envName: resolved.envName, declaredElsewhere: resolved.signersOutOfScope ?? new Map() },
      importedActions: imports.actions,
      ...(imports.elements === undefined ? {} : { importedElements: imports.elements }),
      importsWithErrors: imports.unparseable,
      // `TF043` (M97c, D144, `A4-07`) — the `stat`s happen here, in the caller, for the same reason
      // `importedActions` does: `@tflw/lang` does no I/O. Before this, `tflw check` printed `no
      // problems found` for a file whose `import` named nothing, and `tflw run` then printed
      // `✗ t.tflw (crashed) (0 ms)` and not one word more, `--verbose` included.
      //
      // **The past tense covers the missing-file trigger only.** A helper that *exists* and then
      // throws on load still prints exactly `✗ t.tflw (crashed)` and nothing else, under `--verbose`
      // as well; "could not load JS helper module … <the real message>" reaches `report/results.json`
      // and no stream. `TF043` cannot help — the file is there. Tracked as `M144-04`, and it is a
      // report-honesty defect rather than a checker one, which is why it did not close with `A4-07`.
      missingFiles: await resolveMissingFiles(file, parsed.program),
      // M116/D148 — the same two booleans the config stage above computed once. `TF051` is the
      // only rule here that can be wrong about a *whole suite* at once, which is why it is
      // derived from the resolved env rather than re-read per file.
      envBaseUrls,
      // M124/D236 — `TF055`. Derived from the resolved env, once, like `envBaseUrls` above: the
      // hold window is written per step but the budget it has to fit inside is a whole-suite fact.
      envTimeouts,
      // M125b1/D263 — `TF057`/`TF058`. Same shape and the same once-per-run derivation, and the
      // same reason: which hosts a suite may reach is a whole-suite fact that a per-step diagnostic
      // has to be told.
      envAllowHosts,
      // M131a/D340 — `TF065`/`TF066`. The one option in this list that describes the *invocation*
      // rather than the project, which is exactly what D21 §3.2(3) asks for: the affirmation has to
      // come from somewhere a committed `tflw.config` cannot reach.
      allowPublicTargets,
      // M128b/D291 — `TF060`. Same derivation and the same reason again: whether this suite is
      // permitted to scan its target is a whole-suite fact, and the per-assertion diagnostic that
      // reports it has to be told.
      envAuthorizedTargets,
      // M156a/D775 — `TF077`. Read off `resolved` like the four above it, but **not** the env's own
      // set: a test file reads the top-level names only (`M266`, `D1425`), because a test runs
      // under every env and the language has no per-env test. That list is the same under every
      // env, so `--env` still cannot change what this rule says. The per-env sets only word the
      // hint when a test reads a name some env does declare.
      requiredEnv: resolved.requiredEnvEveryEnv,
      requiredEnvByEnv: resolved.requiredEnvByEnv,
      // `M239` `D` (`D1319`) — `TF083`. `cwd` IS the config's directory (`M97c-03`, above), so the
      // file's path relative to it is the path the rule judges the `use` literal against.
      helpers: { dirs: resolved.helpers, file: relative(cwd, file).split(sep).join('/'), refuseAll: helperPolicy === 'none' },
    });
    const diagnostics = [...parsed.diagnostics, ...checkDiags];
    // Only `severity: 'error'` blocks a file from running — a `'warning'` (decision 38's
    // deprecation notices, `tflw migrate`'s own input) is advisory: printed/handed to the caller,
    // but the file still runs. This branch used to be documented here as unreachable in practice,
    // no shipped diagnostic having used `'warning'`. **`TF043`'s run tier is its first real user**
    // (D147): a file a *step* opens may be created by an earlier step, so "not there at check time"
    // is a prediction, and a prediction must not make a valid suite unrunnable. Worth noting what
    // that means for the code below — it had never once executed against a real diagnostic before
    // the tests added in D147, so it was scaffolding believed to work, not scaffolding known to.
    const errors = diagnostics.filter((d) => d.severity === 'error');
    const warnings = diagnostics.filter((d) => d.severity === 'warning');
    warningCount += warnings.length;
    // `sink.fileDiagnostics` hears every file, a clean one with an empty batch (M70, B6-07): a
    // structured consumer has to tell "checked, clean" from "not checked", and with no errors the
    // batch is exactly the warnings, since `Severity` has only the two values.
    sink.fileDiagnostics(file, source, diagnostics);
    if (errors.length > 0) {
      hadErrors = true;
      continue;
    }
    parsedFiles.push({ file, source, program: parsed.program });
  }
  if (hadErrors) return undefined;

  const byModule = new Map<string, string[]>();
  for (const { file, program } of parsedFiles) {
    for (const u of program.uses) {
      const module = relative(cwd, resolve(dirname(file), u.path.value)).split(sep).join('/');
      const from = relative(cwd, file).split(sep).join('/');
      const list = byModule.get(module) ?? [];
      if (!list.includes(from)) list.push(from);
      byModule.set(module, list);
    }
  }
  const helpersUsed = [...byModule].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([module, files]) => ({ module, files }));
  return { resolved, parsedConfig, configLines: configText.split(/\r?\n/), environ, parsedFiles, warningCount, helpersUsed };
}
