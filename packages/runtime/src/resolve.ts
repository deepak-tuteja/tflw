// Resolve a parsed tflw.config into the concrete settings the interpreter runs against:
// active-env selection (P#28), defaults+env merge, per-service base URLs (P#29).

import type { ConfigFile, EnvBlock, EvidenceLevel, LogDestination, LogLevel, RedactPattern, TeardownLevel, TimeoutTarget } from '@tflw/lang';
import { DEFAULT_TIMEOUTS, type AuthorizedTarget, type ResolvedConfig, type ResolvedHeader } from './types.js';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface EnvSelection {
  /** `--env` flag (highest precedence). */
  readonly flag?: string | undefined;
  /** `TFLW_ENV` environment variable (middle precedence). */
  readonly envVar?: string | undefined;
}

/** Pick the active env: `--env` > `TFLW_ENV` > the `default`-marked block > the sole env. */
export function selectEnv(config: ConfigFile, sel: EnvSelection): EnvBlock {
  const byName = (name: string): EnvBlock | undefined => config.envs.find((e) => e.name === name);
  if (sel.flag) {
    const env = byName(sel.flag);
    if (!env) throw new ConfigError(`unknown env "${sel.flag}" (from --env). Available: ${envNames(config)}`);
    return env;
  }
  if (sel.envVar) {
    const env = byName(sel.envVar);
    if (!env) throw new ConfigError(`unknown env "${sel.envVar}" (from TFLW_ENV). Available: ${envNames(config)}`);
    return env;
  }
  const defaults = config.envs.filter((e) => e.isDefault);
  if (defaults.length === 1) return defaults[0]!;
  if (config.envs.length === 1) return config.envs[0]!;
  if (config.envs.length === 0) throw new ConfigError('tflw.config declares no `env` blocks');
  throw new ConfigError(`no active env: pass --env or mark one env \`default\`. Available: ${envNames(config)}`);
}

function envNames(config: ConfigFile): string {
  return config.envs.map((e) => e.name).join(', ') || '(none)';
}

export function resolveConfig(config: ConfigFile, env: EnvBlock): ResolvedConfig {
  let apiBaseUrl: string | null = null;
  let webBaseUrl: string | null = null;
  const services: Record<string, string> = {};
  const headers: ResolvedHeader[] = [];
  // `D768`/`D769` — five grammar targets in, four resolved fields out. Written as-declared here,
  // across both tiers, and narrowed at the `return` below; `step` is read there and never leaves
  // this function. `undefined` is load-bearing: it is what distinguishes "never written" from
  // "written to the default value", which is the whole of the `api ?? step ?? default` rule.
  const written: { [K in TimeoutTarget]?: number } = {};
  let reportDir = './report';
  let workers = 1;
  let insecure = false;
  let certPath: string | null = null;
  let keyPath: string | null = null;
  let allowHosts: string[] | null = null;
  const authorizedTargets: AuthorizedTarget[] = [];
  let evidenceLevel: EvidenceLevel = 'full';
  // `D781` — `always` is the default, and it is the whole milestone: a workload's `after` hooks used
  // to run only for a test carrying a `cleanup` line, and even then not on the iterations that
  // failed. The safe behaviour is now the one you get without writing anything.
  let teardown: TeardownLevel = 'always';
  const redactPatterns: RedactPattern[] = [];
  let viewport: { width: number; height: number } | null = null;
  let logDestination: LogDestination | 'none' = 'both';
  let logLevel: LogLevel = 'debug';

  const applyEntries = (entries: EnvBlock['entries']): void => {
    for (const entry of entries) {
      switch (entry.type) {
        case 'ApiServiceDecl':
          if (entry.service === null) apiBaseUrl = trimSlash(entry.url.value);
          else services[entry.service] = trimSlash(entry.url.value);
          break;
        case 'WebDecl':
          webBaseUrl = trimSlash(entry.url.value);
          break;
        case 'HeaderDecl':
          headers.push({ name: entry.name.value, value: entry.value, service: entry.service });
          break;
        case 'TimeoutDecl':
          // Same-key-wins per key, applied to the *written* target — which is why `D772`'s case
          // resolves the way it does: `defaults: timeout api 10s` beside `env: timeout step 20s`
          // gives api 10s and browser 20s. The env's broader key does not reset the narrower one it
          // inherited, because they are not the same key.
          written[entry.target] = entry.ms;
          break;
        case 'WorkersDecl':
          workers = entry.count;
          break;
        case 'ReportDecl':
          reportDir = entry.dir.value;
          break;
        case 'InsecureDecl':
          insecure = entry.value;
          break;
        case 'CertDecl':
          certPath = entry.path.value;
          break;
        case 'KeyDecl':
          keyPath = entry.path.value;
          break;
        case 'AllowHostsDecl':
          // Accumulates (like `header`), not override — a baseline in `defaults` plus more per env.
          allowHosts = [...(allowHosts ?? []), ...entry.hosts.map((h) => h.value)];
          break;
        case 'AuthorizedTargetDecl':
          // Accumulates like `allow hosts`, and for the same reason (SPEC §3.7): a suite that scans
          // one host in every env declares it once in `defaults` rather than repeating it per env.
          //
          // M130b/D330 changes nothing here: `probe mutating` rides along on the row, and two rows
          // for one origin that disagree are resolved *at the lookup* (`mayProbeMutating`, which
          // ORs across every matching row) rather than by folding them here. The accumulation rule
          // is deliberately untouched — every declaration still travels to the report with its own
          // reason, which is the half of D291 that makes the claim auditable.
          //
          // M134a/D372 adds two more sub-clauses and changes nothing here either, which is the
          // point of D311's prediction: the opt-ins ride along on the row and are ORed at their own
          // lookup (`grantedClasses`), so a third and fourth clause cost this file one field each.
          authorizedTargets.push({
            target: entry.target.value,
            reason: entry.reason.value,
            probeMutating: entry.probeMutating,
            probeOversized: entry.probeOversized,
            probeTraversal: entry.probeTraversal,
            probeCiphers: entry.probeCiphers,
          });
          break;
        case 'EvidenceDecl':
          evidenceLevel = entry.level;
          break;
        case 'TeardownDecl':
          teardown = entry.level;
          break;
        case 'RedactDecl':
          redactPatterns.push(...entry.patterns);
          break;
        case 'ViewportDecl':
          viewport = { width: entry.width, height: entry.height };
          break;
        case 'LogDestinationDecl':
          logDestination = entry.destination;
          break;
        case 'LogLevelDecl':
          logLevel = entry.level;
          break;
      }
    }
  };

  if (config.defaults) applyEntries(config.defaults.entries);
  applyEntries(env.entries); // env overrides defaults (same-key-wins)

  // A `cert` without a `key` (or vice versa) can't be caught at parse time — `defaults` and `env`
  // are two separate blocks, so e.g. `cert` in `defaults` + `key` only in one `env` looks fine to
  // the checker but is only visible here, once both are merged (decision 3b, enterprise arc).
  if ((certPath === null) !== (keyPath === null)) {
    throw new ConfigError(
      `env "${env.name}": \`cert\` and \`key\` must be set together (mTLS needs both) — found ${certPath === null ? '`key` without `cert`' : '`cert` without `key`'}`,
    );
  }
  const mtls = certPath !== null && keyPath !== null ? { certPath, keyPath } : null;

  const requiredEnv = config.requires.flatMap((r) => r.names);
  const exclude = config.excludes.flatMap((e) => e.paths.map((p) => p.value));
  // `M147d`/`M137f-02` (D642) — the env scope clause, applied in the one place that decides what a
  // session *is* under an env. Everything downstream already reads `resolved.sessions`: the roster
  // `TF028` checks, the `privileged` subset `TF063` reasons about, and all five of the runtime's
  // establishment paths (`test`/`crawl`/`scenario`/`probePrincipalFor`). So env-scoping is this
  // filter and nothing else, and no consumer can disagree with another about which sessions exist.
  //
  // `envs === null` is a session written without the clause, which belongs to every env — the
  // pre-D642 behaviour, kept for every session already written.
  const inScope = config.sessions.filter((s) => s.envs === null || s.envs.some((e) => e.name === env.name));
  const sessions = new Map(inScope.map((s) => [s.name, s] as const));
  /** Declared, but not here (`M137f-02`) — what `TF028` needs to name the envs it *is* scoped to. */
  const sessionsOutOfScope = new Map(
    config.sessions.filter((s) => !sessions.has(s.name)).map((s) => [s.name, (s.envs ?? []).map((e) => e.name)] as const),
  );

  return {
    envName: env.name,
    apiBaseUrl,
    services,
    webBaseUrl,
    headers,
    timeouts: {
      api: written.api ?? written.step ?? DEFAULT_TIMEOUTS.api,
      browser: written.browser ?? written.step ?? DEFAULT_TIMEOUTS.browser,
      expect: written.expect ?? DEFAULT_TIMEOUTS.expect,
      wait: written.wait ?? DEFAULT_TIMEOUTS.wait,
    },
    reportDir,
    workers,
    insecure,
    requiredEnv,
    exclude,
    sessions,
    sessionsOutOfScope,
    mtls,
    allowHosts,
    authorizedTargets,
    // M131a/D340 — **always empty here, deliberately.** The public-target affirmation is a fact
    // about the command line, and this function's entire input is `tflw.config`. There is no
    // `case 'AllowPublicTargetDecl'` above and there must never be one: D21 §3.2(3) is the layer
    // that says a committed config cannot make CI scan the internet by itself, so a config key
    // granting it would not be a feature, it would be the removal of this control. `cli.ts`
    // overlays the real values.
    allowPublicTargets: [],
    evidenceLevel,
    teardown,
    redactPatterns,
    viewport,
    logDestination,
    logLevel,
  };
}

/** Names in `require env …` that are absent from `process.env`. One error should list them all. */
export function missingRequiredEnv(config: ResolvedConfig, environ: NodeJS.ProcessEnv): string[] {
  return config.requiredEnv.filter((name) => environ[name] === undefined || environ[name] === '');
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
