// `tflw doctor` — what this machine and this project will run with (`M249` `D`, `D1370`).
//
// **Read-only and offline, by decision.** It resolves the config the way `run` does, counts the
// suite the way `run` discovers it, and asks Playwright where its browsers would be — and it sends
// no request anywhere. A doctor that probed the services would be a test run with a different exit
// code, and would be wrong exactly when the network is the problem.
//
// **It fails (exit 1) exactly when `tflw run` with the same flags would refuse before its first
// test** (`M267`, `D1431`-`D1434`): no `tflw.config`; a Node older than 22; the project not
// validating under this env — the checks `run` makes, called through `validateProject` rather than
// copied, so a `TF060` or a file that does not parse fails doctor as it fails `run`; browser tests
// and the engine `run` will launch not downloaded; `--forbid-insecure` beside an `insecure true`
// env; and (`M266`, `D1430`) a `require env` name this env requires that is not set. Everything else
// is reported and left to the reader — a proxy variable nobody reads, a client certificate not on
// disk yet (a `before all` may write it, `TF043`), an env the suite never uses. Those are facts,
// not verdicts. Between the two sit warnings (`D1435`): probable mistakes that never change the
// exit code — a `.env` git does not ignore, the warnings `tflw check` would print, `insecure true`.
//
// What `run` refuses that doctor does not judge, by decision (`D1434`): a malformed flag value and a
// filter that selects nothing (`--tag`, `--kind`, `--only`, `--failed`) are the invocation's
// mistakes and `run` names them instantly; a `--log-file` that cannot be opened and a demo service
// that cannot start are found by writing a file and starting a server, which doctor never does.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve, sep } from 'node:path';
import { lensesOfTest, parseConfigSource, parseSource, type Diagnostic } from '@tflw/lang';
import { missingRequiredEnv, requiredBy, resolveConfig, selectEnv, SUPPORTED_BROWSER_ENGINES, type BrowserEngine } from '@tflw/runtime';
import { discoverTests } from './project.js';
import { canonicalFile, validateProject } from './validate.js';

export const MIN_NODE_MAJOR = 22;

export interface DoctorReport {
  /** False exactly when `problems` is non-empty. */
  readonly ok: boolean;
  readonly tflw: string;
  readonly node: { readonly version: string; readonly supported: boolean };
  readonly config: { readonly path: string | null; readonly env: string | null; readonly envs: readonly string[] };
  /** The resolved `api` bases, keyed by service name; `''` is the unnamed `api`. */
  readonly services: Readonly<Record<string, string>>;
  readonly web: string | null;
  readonly proxy: { readonly variables: Readonly<Record<string, string>>; readonly line: string };
  readonly tls: { readonly insecure: boolean; readonly clientCert: { readonly cert: string; readonly key: string; readonly onDisk: boolean } | null; readonly line: string };
  readonly suite: { readonly files: number; readonly tests: number; readonly browserTests: number };
  /** `M267` (`D1432`) — what `tflw check` with the same env and flags reports: its counts, and the
   *  first error, which is the one the problem line quotes. */
  readonly checks: { readonly errors: number; readonly warnings: number; readonly first: { readonly code: string; readonly file: string; readonly line: number; readonly message: string } | null };
  /** `engine` is the one `run` will launch (`D1433`): `--browser`, or Chromium. */
  readonly browsers: { readonly playwright: string | null; readonly installed: readonly BrowserEngine[]; readonly engine: BrowserEngine; readonly line: string };
  /** `M266` (`D1430`) — the names this env requires before a run, by name and whether each is set.
   *  `env` is the env block that requires it, or `null` for a top-level line (every env). Never a value. */
  readonly secrets: { readonly required: readonly { readonly name: string; readonly env: string | null; readonly set: boolean }[]; readonly line: string };
  /** The reasons for exit 1, each a sentence with its remedy. */
  readonly problems: readonly string[];
  /** `M267` (`D1435`) — probable mistakes that never change the exit code, each with its remedy. */
  readonly warnings: readonly string[];
}

/** The `run` flags doctor takes (`D1434`): each can make `run` refuse before its first test. */
export interface DoctorRunFlags {
  readonly env?: string;
  /** Positional files: validation and the suite narrow to them, as `run`'s do. */
  readonly files?: readonly string[];
  readonly browser?: BrowserEngine;
  readonly allowPublicTargets?: readonly string[];
  readonly forbidInsecure?: boolean;
  readonly noHelpers?: boolean;
}

const PROXY_VARS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy'];

function playwrightState(cwd: string): { version: string | null; installed: BrowserEngine[] } {
  try {
    const req = createRequire(join(cwd, 'noop.js'));
    const manifest = JSON.parse(readFileSync(req.resolve('playwright/package.json'), 'utf8')) as { version?: string };
    const pw = req('playwright') as Record<string, { executablePath(): string } | undefined>;
    const installed = SUPPORTED_BROWSER_ENGINES.filter((e) => {
      try {
        const path = pw[e]?.executablePath();
        return typeof path === 'string' && path !== '' && existsSync(path);
      } catch {
        return false;
      }
    });
    return { version: manifest.version ?? 'unknown version', installed };
  } catch {
    return { version: null, installed: [] };
  }
}

/**
 * Whether git ignores `path` in `cwd` (`D1436`): git's own answer, so nested files, negations and
 * global excludes agree with what `git add` would do. `null` outside a repository or without git —
 * no warning then, since nothing is about to be committed.
 */
export function gitIgnores(cwd: string, path: string): boolean | null {
  const r = spawnSync('git', ['check-ignore', '-q', '--', path], { cwd, stdio: 'ignore' });
  return r.status === 0 ? true : r.status === 1 ? false : null;
}

export async function diagnose(
  cwd: string,
  opts: DoctorRunFlags & { readonly version: string; readonly nodeVersion?: string; readonly environ?: NodeJS.ProcessEnv; readonly runEnviron?: NodeJS.ProcessEnv },
): Promise<DoctorReport> {
  const environ = opts.environ ?? process.env;
  // `M266` — what `run` resolves against: the shell with the project's `.env` under it. The proxy
  // line keeps reading `environ`, because Node's fetch reads the process's own variables, not `.env`.
  const runEnviron = opts.runEnviron ?? environ;
  const nodeVersion = opts.nodeVersion ?? process.version;
  const supported = Number(/^v?(\d+)/.exec(nodeVersion)?.[1] ?? 0) >= MIN_NODE_MAJOR;
  const problems: string[] = [];
  const warnings: string[] = [];
  const engine: BrowserEngine = opts.browser ?? 'chromium';
  if (!supported) problems.push(`Node ${nodeVersion} is older than ${MIN_NODE_MAJOR} — tflw needs Node ${MIN_NODE_MAJOR} or newer; install a current LTS`);

  const variables = Object.fromEntries(PROXY_VARS.filter((v) => environ[v]).map((v) => [v, environ[v]!]));
  const proxyLine =
    Object.keys(variables).length === 0
      ? 'none set — requests go straight to each service'
      : `${Object.keys(variables).join(', ')} set; tflw has no proxy setting of its own, and Node's fetch uses these only when NODE_USE_ENV_PROXY=1${environ.NODE_USE_ENV_PROXY === '1' ? ' (it is)' : ' (it is not)'} — never for an mTLS service`;

  const playwright = playwrightState(cwd);
  const configPath = join(cwd, 'tflw.config');
  const blank = (problem: string | null): DoctorReport => {
    if (problem) problems.push(problem);
    return {
      ok: problems.length === 0,
      tflw: opts.version,
      node: { version: nodeVersion, supported },
      config: { path: null, env: null, envs: [] },
      services: {},
      web: null,
      proxy: { variables, line: proxyLine },
      tls: { insecure: false, clientCert: null, line: 'no config to read' },
      suite: { files: 0, tests: 0, browserTests: 0 },
      checks: { errors: 0, warnings: 0, first: null },
      browsers: { playwright: playwright.version, installed: playwright.installed, engine, line: browsersLine(playwright, 0, engine) },
      secrets: { required: [], line: 'no config to read' },
      problems,
      warnings,
    };
  };
  if (!existsSync(configPath)) return blank(`no tflw.config in ${cwd} — run \`tflw init\` here, or run doctor from the project's directory`);
  const parsed = parseConfigSource(readFileSync(configPath, 'utf8'));
  const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) return blank(`tflw.config does not parse (${errors[0]!.code}: ${errors[0]!.message}) — \`tflw check\` shows every problem`);
  let resolved;
  try {
    resolved = resolveConfig(parsed.config, selectEnv(parsed.config, { flag: opts.env, envVar: runEnviron.TFLW_ENV }), runEnviron);
  } catch (e) {
    return blank(`tflw.config does not resolve: ${(e as Error).message}`);
  }

  const rel = (p: string): string => relative(cwd, resolve(cwd, p)).split(sep).join('/');

  // `M267` (`D1431`, `D1432`) — the checks `run` makes before its first request, made by the same
  // function. A refusal (no test files at all) is a problem as it stands; diagnostics are counted,
  // and the first error is quoted with the command that lists the rest.
  const named = opts.files ?? [];
  let refusal: string | null = null;
  let checkErrors = 0;
  let checkWarnings = 0;
  let first: DoctorReport['checks']['first'] = null;
  const note = (file: string, diagnostics: readonly Diagnostic[]): void => {
    for (const d of diagnostics) {
      if (d.severity === 'warning') checkWarnings++;
      else {
        checkErrors++;
        first ??= { code: d.code, file, line: d.span.start.line, message: d.message };
      }
    }
  };
  await validateProject(
    cwd,
    { files: named, env: opts.env, envVar: runEnviron.TFLW_ENV, environ: runEnviron, allowPublicTargets: opts.allowPublicTargets ?? [], helperPolicy: opts.noHelpers ? 'none' : 'config' },
    {
      refused: (message) => {
        refusal = message;
      },
      configDiagnostics: (diagnostics) => note('tflw.config', diagnostics),
      fileDiagnostics: (file, _source, diagnostics) => note(rel(file), diagnostics),
    },
  );
  const checkCommand = [
    'tflw check',
    ...(parsed.config.envs.length > 0 ? [`--env ${resolved.envName}`] : []),
    ...(opts.allowPublicTargets ?? []).map((t) => `--allow-public-target ${t}`),
    ...(opts.noHelpers ? ['--no-helpers'] : []),
    ...named,
  ].join(' ');
  if (refusal !== null) problems.push(refusal);
  const firstError = first as DoctorReport['checks']['first'];
  if (firstError !== null) {
    problems.push(
      `\`${checkCommand}\` reports ${checkErrors} error${checkErrors === 1 ? '' : 's'}, so \`tflw run\` refuses before its first test — the first: ${firstError.code} at ${firstError.file}:${firstError.line}, ${firstError.message}`,
    );
  }
  if (checkWarnings > 0) warnings.push(`\`${checkCommand}\` reports ${checkWarnings} warning${checkWarnings === 1 ? '' : 's'} — they do not stop a run`);

  const files = named.length > 0 ? named.map((f) => canonicalFile(cwd, f)).filter((f) => existsSync(f)) : await discoverTests(cwd, resolved.exclude, resolved.reportDir);
  let tests = 0;
  let browserTests = 0;
  for (const file of files) {
    const { program } = parseSource(readFileSync(file, 'utf8'));
    for (const t of program.tests) {
      tests++;
      if (lensesOfTest(t).includes('browser')) browserTests++;
    }
  }
  // `D1433` — the engine `run` will launch, not any engine: with only Firefox downloaded, a plain
  // `run` still launches Chromium and its first browser test fails.
  if (browserTests > 0 && !playwright.installed.includes(engine)) {
    const drive = `${browserTests} test${browserTests === 1 ? ' drives' : 's drive'} a browser`;
    const install = `\`tflw install-browsers${engine === 'chromium' ? '' : ` --browser ${engine}`}\``;
    const others = playwright.installed;
    problems.push(
      playwright.version === null
        ? `${drive} and \`playwright\` is not installed here — \`npm install -D playwright\`, then ${install}`
        : others.length === 0
          ? `${drive} and playwright ${playwright.version} has none downloaded — ${install}`
          : `${drive} and ${engine}, the engine \`tflw run\`${opts.browser === undefined ? '' : ` --browser ${engine}`} launches, is not downloaded (${others.join(', ')} ${others.length === 1 ? 'is' : 'are'}) — ${install}, or run with \`--browser ${others[0]}\``,
    );
  }
  if (opts.forbidInsecure && resolved.insecure) {
    problems.push(`env ${resolved.envName} has \`insecure true\` and \`--forbid-insecure\` was given, so \`tflw run\` refuses — remove \`insecure true\` from the env, or drop the flag`);
  } else if (resolved.insecure) {
    warnings.push(`env ${resolved.envName} has \`insecure true\`: certificates are not verified — \`tflw run --forbid-insecure\` refuses such an env, for a CI step`);
  }
  if (existsSync(join(cwd, '.env')) && gitIgnores(cwd, '.env') === false) {
    warnings.push('`.env` is not ignored by git, so the secrets in it can be committed — add `.env` to `.gitignore`');
  }

  const notSet = missingRequiredEnv(resolved, runEnviron);
  const required = resolved.requiredEnv.map((name) => ({ name, env: requiredBy(resolved, name) === '' ? null : resolved.envName, set: !notSet.includes(name) }));
  if (notSet.length > 0) {
    problems.push(
      `${notSet.map((n) => `${n}${requiredBy(resolved, n)}`).join(', ')} ${notSet.length === 1 ? 'is' : 'are'} required by \`require env\` and not set — \`tflw run\` refuses before its first request; set ${notSet.length === 1 ? 'it' : 'them'} in your environment or a local .env file`,
    );
  }
  const secretsLine =
    required.length === 0
      ? 'none required'
      : `${required.map((r) => `${r.name}${r.env ? ` (env ${r.env} only)` : ''}`).join(', ')} — ${notSet.length === 0 ? 'all set' : `not set: ${notSet.join(', ')}`}`;

  const mtls = resolved.mtls;
  const clientCert = mtls ? { cert: rel(mtls.certPath), key: rel(mtls.keyPath), onDisk: existsSync(resolve(cwd, mtls.certPath)) && existsSync(resolve(cwd, mtls.keyPath)) } : null;
  const tlsLine = [
    resolved.insecure ? 'insecure true — certificates are NOT verified for this env' : 'certificates verified',
    clientCert ? `client certificate ${clientCert.cert} + ${clientCert.key}${clientCert.onDisk ? '' : ' (not on disk yet — fine if a `before all` writes it)'}` : 'no client certificate',
  ].join('; ');

  return {
    ok: problems.length === 0,
    tflw: opts.version,
    node: { version: nodeVersion, supported },
    config: { path: 'tflw.config', env: resolved.envName, envs: parsed.config.envs.map((e) => e.name) },
    services: { ...(resolved.apiBaseUrl ? { '': resolved.apiBaseUrl } : {}), ...resolved.services },
    web: resolved.webBaseUrl,
    proxy: { variables, line: proxyLine },
    tls: { insecure: resolved.insecure, clientCert, line: tlsLine },
    suite: { files: files.length, tests, browserTests },
    checks: { errors: checkErrors, warnings: checkWarnings, first: firstError },
    browsers: { playwright: playwright.version, installed: playwright.installed, engine, line: browsersLine(playwright, browserTests, engine) },
    secrets: { required, line: secretsLine },
    problems,
    warnings,
  };
}

function browsersLine(pw: { version: string | null; installed: readonly BrowserEngine[] }, browserTests: number, engine: BrowserEngine): string {
  if (pw.version === null) return browserTests > 0 ? 'playwright not installed' : 'playwright not installed (no test needs a browser)';
  if (pw.installed.length === 0) return `playwright ${pw.version}, no browser downloaded`;
  return `playwright ${pw.version}: ${pw.installed.join(', ')}${browserTests > 0 ? ` · run uses ${engine}` : ''}`;
}

export function renderDoctor(r: DoctorReport): string {
  const services = Object.entries(r.services);
  const lines = [
    `tflw ${r.tflw} · Node ${r.node.version}${r.node.supported ? '' : ` (needs ${MIN_NODE_MAJOR}+)`}`,
    `config    ${r.config.path ?? 'none'}${r.config.env ? ` · env ${r.config.env}${r.config.envs.length > 1 ? ` (of ${r.config.envs.join(', ')})` : ''}` : ''}`,
    ...(services.length > 0 ? services.map(([name, url], i) => `${i === 0 ? 'services ' : '         '} ${name === '' ? 'api' : `api ${name}`} ${url}`) : []),
    ...(r.web ? [`web       ${r.web}`] : []),
    `proxy     ${r.proxy.line}`,
    `tls       ${r.tls.line}`,
    `secrets   ${r.secrets.line}`,
    `suite     ${r.suite.files} file${r.suite.files === 1 ? '' : 's'}, ${r.suite.tests} test${r.suite.tests === 1 ? '' : 's'}${r.suite.browserTests > 0 ? `, ${r.suite.browserTests} in a browser` : ''}`,
    `browsers  ${r.browsers.line}`,
  ];
  lines.push('');
  if (r.warnings.length > 0) lines.push(...r.warnings.map((w) => `⚠ ${w}`));
  if (r.problems.length > 0) lines.push(...r.problems.map((p) => `✗ ${p}`));
  else lines.push('✓ nothing here stops a run');
  return lines.join('\n');
}

/** `M267` (`D1437`) — one verdict per env the config declares. */
export interface DoctorAllEnvsReport {
  /** False when any env's verdict is. */
  readonly ok: boolean;
  readonly tflw: string;
  readonly node: { readonly version: string; readonly supported: boolean };
  readonly envs: readonly { readonly name: string; readonly ok: boolean; readonly problems: readonly string[]; readonly warnings: readonly string[] }[];
}

/**
 * `doctor --all-envs`: `diagnose` once per declared env, each with the same flags. A config with no
 * `env` blocks has one row, the env `run` resolves to. Callers handle a missing config first — with
 * nothing to read there are no envs to list, and the single report says so better.
 */
export async function diagnoseAllEnvs(
  cwd: string,
  opts: Omit<DoctorRunFlags, 'env'> & { readonly version: string; readonly nodeVersion?: string; readonly environ?: NodeJS.ProcessEnv; readonly runEnviron?: NodeJS.ProcessEnv },
): Promise<DoctorAllEnvsReport> {
  const declared = parseConfigSource(readFileSync(join(cwd, 'tflw.config'), 'utf8')).config.envs.map((e) => e.name);
  const reports = declared.length > 0 ? await Promise.all(declared.map((env) => diagnose(cwd, { ...opts, env }))) : [await diagnose(cwd, opts)];
  const envs = reports.map((r, i) => ({ name: declared[i] ?? r.config.env ?? 'default', ok: r.ok, problems: r.problems, warnings: r.warnings }));
  return { ok: envs.every((e) => e.ok), tflw: reports[0]!.tflw, node: reports[0]!.node, envs };
}

export function renderAllEnvs(r: DoctorAllEnvsReport): string {
  const width = Math.max(...r.envs.map((e) => e.name.length));
  const more = (n: number): string => (n > 1 ? ` (+${n - 1} more)` : '');
  const rows = r.envs.map((e) => {
    const verdict =
      e.problems.length > 0 ? `✗ ${e.problems[0]}${more(e.problems.length)}` : e.warnings.length > 0 ? `✓ ⚠ ${e.warnings[0]}${more(e.warnings.length)}` : '✓';
    return `${e.name.padEnd(width)}  ${verdict}`;
  });
  const failing = r.envs.filter((e) => !e.ok).length;
  return [
    `tflw ${r.tflw} · Node ${r.node.version}${r.node.supported ? '' : ` (needs ${MIN_NODE_MAJOR}+)`}`,
    '',
    ...rows,
    '',
    failing === 0
      ? `✓ nothing here stops a run, under any of ${r.envs.length} env${r.envs.length === 1 ? '' : 's'}`
      : `✗ ${failing} of ${r.envs.length} env${r.envs.length === 1 ? '' : 's'} cannot run from here — \`tflw doctor --env <name>\` shows one in full`,
  ].join('\n');
}
