// `tflw doctor` — what this machine and this project will run with (`M249` `D`, `D1370`).
//
// **Read-only and offline, by decision.** It resolves the config the way `run` does, counts the
// suite the way `run` discovers it, and asks Playwright where its browsers would be — and it sends
// no request anywhere. A doctor that probed the services would be a test run with a different exit
// code, and would be wrong exactly when the network is the problem.
//
// **Three things fail it (exit 1), and only three**, because each makes every `tflw run` here fail
// before a test can: no `tflw.config`, a Node older than 22, and browser steps in the suite with no
// browser installed. Everything else is reported and left to the reader — a proxy variable nobody
// reads, a client certificate not on disk yet (a `before all` may write it, `TF043`), an env the
// suite never uses. Those are facts, not verdicts.

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve, sep } from 'node:path';
import { lensesOfTest, parseConfigSource, parseSource } from '@tflw/lang';
import { resolveConfig, selectEnv, SUPPORTED_BROWSER_ENGINES, type BrowserEngine } from '@tflw/runtime';
import { discoverTests } from './project.js';

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
  readonly suite: { readonly files: number; readonly tests: number; readonly browserTests: number; readonly unparsed: number };
  readonly browsers: { readonly playwright: string | null; readonly installed: readonly BrowserEngine[]; readonly line: string };
  /** The reasons for exit 1, each a sentence with its remedy. */
  readonly problems: readonly string[];
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

export async function diagnose(cwd: string, opts: { readonly env?: string; readonly version: string; readonly nodeVersion?: string; readonly environ?: NodeJS.ProcessEnv }): Promise<DoctorReport> {
  const environ = opts.environ ?? process.env;
  const nodeVersion = opts.nodeVersion ?? process.version;
  const supported = Number(/^v?(\d+)/.exec(nodeVersion)?.[1] ?? 0) >= MIN_NODE_MAJOR;
  const problems: string[] = [];
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
      suite: { files: 0, tests: 0, browserTests: 0, unparsed: 0 },
      browsers: { playwright: playwright.version, installed: playwright.installed, line: browsersLine(playwright, 0) },
      problems,
    };
  };
  if (!existsSync(configPath)) return blank(`no tflw.config in ${cwd} — run \`tflw init\` here, or run doctor from the project's directory`);
  const parsed = parseConfigSource(readFileSync(configPath, 'utf8'));
  const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) return blank(`tflw.config does not parse (${errors[0]!.code}: ${errors[0]!.message}) — \`tflw check\` shows every problem`);
  let resolved;
  try {
    resolved = resolveConfig(parsed.config, selectEnv(parsed.config, { flag: opts.env, envVar: environ.TFLW_ENV }), environ);
  } catch (e) {
    return blank(`tflw.config does not resolve: ${(e as Error).message}`);
  }

  const files = await discoverTests(cwd, resolved.exclude, resolved.reportDir);
  let tests = 0;
  let browserTests = 0;
  let unparsed = 0;
  for (const file of files) {
    const { program, diagnostics } = parseSource(readFileSync(file, 'utf8'));
    if (diagnostics.some((d) => d.severity === 'error')) unparsed++;
    for (const t of program.tests) {
      tests++;
      if (lensesOfTest(t).includes('browser')) browserTests++;
    }
  }
  if (browserTests > 0 && playwright.installed.length === 0) {
    problems.push(
      playwright.version === null
        ? `${browserTests} test${browserTests === 1 ? ' drives' : 's drive'} a browser and \`playwright\` is not installed here — \`npm install -D playwright\`, then \`tflw install-browsers\``
        : `${browserTests} test${browserTests === 1 ? ' drives' : 's drive'} a browser and playwright ${playwright.version} has none downloaded — \`tflw install-browsers\``,
    );
  }

  const mtls = resolved.mtls;
  const rel = (p: string): string => relative(cwd, resolve(cwd, p)).split(sep).join('/');
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
    suite: { files: files.length, tests, browserTests, unparsed },
    browsers: { playwright: playwright.version, installed: playwright.installed, line: browsersLine(playwright, browserTests) },
    problems,
  };
}

function browsersLine(pw: { version: string | null; installed: readonly BrowserEngine[] }, browserTests: number): string {
  if (pw.version === null) return browserTests > 0 ? 'playwright not installed' : 'playwright not installed (no test needs a browser)';
  if (pw.installed.length === 0) return `playwright ${pw.version}, no browser downloaded`;
  return `playwright ${pw.version}: ${pw.installed.join(', ')}`;
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
    `suite     ${r.suite.files} file${r.suite.files === 1 ? '' : 's'}, ${r.suite.tests} test${r.suite.tests === 1 ? '' : 's'}${r.suite.browserTests > 0 ? `, ${r.suite.browserTests} in a browser` : ''}${r.suite.unparsed > 0 ? ` — ${r.suite.unparsed} file${r.suite.unparsed === 1 ? ' does' : 's do'} not parse (\`tflw check\`)` : ''}`,
    `browsers  ${r.browsers.line}`,
  ];
  if (r.problems.length > 0) lines.push('', ...r.problems.map((p) => `✗ ${p}`));
  else lines.push('', '✓ nothing here stops a run');
  return lines.join('\n');
}
