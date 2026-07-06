// Resolve a parsed tflw.config into the concrete settings the interpreter runs against:
// active-env selection (P#28), defaults+env merge, per-service base URLs (P#29).

import type { ConfigFile, EnvBlock } from '@tflw/lang';
import { DEFAULT_TIMEOUTS, type ResolvedConfig, type ResolvedHeader, type ResolvedTimeouts } from './types.js';

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
  const timeouts: { step: number; expect: number; wait: number } = { ...DEFAULT_TIMEOUTS };
  let reportDir = './report';
  let workers = 1;
  let insecure = false;

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
          timeouts[entry.target] = entry.ms;
          break;
        case 'WorkersDecl':
          workers = entry.count;
          break;
        case 'ReportDecl':
          reportDir = entry.dir;
          break;
        case 'InsecureDecl':
          insecure = entry.value;
          break;
      }
    }
  };

  if (config.defaults) applyEntries(config.defaults.entries);
  applyEntries(env.entries); // env overrides defaults (same-key-wins)

  const requiredEnv = config.requires.flatMap((r) => r.names);
  const sessions = new Map(config.sessions.map((s) => [s.name, s] as const));

  return {
    envName: env.name,
    apiBaseUrl,
    services,
    webBaseUrl,
    headers,
    timeouts: timeouts as ResolvedTimeouts,
    reportDir,
    workers,
    insecure,
    requiredEnv,
    sessions,
  };
}

/** Names in `require env …` that are absent from `process.env`. One error should list them all. */
export function missingRequiredEnv(config: ResolvedConfig, environ: NodeJS.ProcessEnv): string[] {
  return config.requiredEnv.filter((name) => environ[name] === undefined || environ[name] === '');
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
