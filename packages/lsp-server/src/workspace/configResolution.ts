// Loads and resolves a project's `tflw.config` (PLAN_M13_LSP.md Phase 3): the one piece of I/O
// every other capability needs — `checkServices`/`checkSessions` (test-file diagnostics) need the
// active env's known services/sessions; `checkSessionServices` (decision A: config files get real
// diagnostics too) needs them for the config file itself; go-to-def on a session name needs the
// `SessionDecl` span `collectConfigSymbols` produces.
//
// `tflw.env` (decision B) is threaded in here, mirroring `--env`/`TFLW_ENV`'s precedence in
// `@tflw/runtime`'s `selectEnv` — zero changes to `resolve.ts` itself, per the plan.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseConfigSource, checkSessionServices, collectConfigSymbols, type ConfigFile, type Diagnostic, type SymbolTable } from '@tflw/lang';
import { ConfigError, selectEnv, resolveConfig, type ResolvedConfig } from '@tflw/runtime';

/** Synthetic code for a project-level resolution failure (no active env, `--env`-equivalent
 * pointing at an unknown env) — not one of `@tflw/lang`'s `Codes` (those are lex/parse/check
 * codes; this is a project-config-resolution concern specific to the editor boundary, so it's kept
 * local rather than extending the shared registry for one editor-only case). */
const CONFIG_RESOLUTION_ERROR_CODE = 'TFLSP001';

export interface ProjectConfig {
  readonly configPath: string;
  readonly configText: string;
  readonly config: ConfigFile;
  readonly symbols: SymbolTable;
  /** Parse + `validateConfig` + `checkSessionServices` diagnostics (decision A) — a config-load
   * failure below (bad env selection) is *not* folded in here since it has no useful span; it
   * surfaces only via `resolutionError`. */
  readonly diagnostics: readonly Diagnostic[];
  /** Set when `selectEnv`/`resolveConfig` failed (e.g. no `default` env, ambiguous envs, an
   * unknown `tflw.env` setting) — `resolved`/known services/sessions are unavailable in that case,
   * so test-file checks fall back to an empty known-set (degrades to "no false positives", not a
   * crash — same spirit as Phase 2's pure-function fallbacks). */
  readonly resolutionError?: string;
  readonly resolved?: ResolvedConfig;
}

/** Loads, parses, and resolves the `tflw.config` at `root` for `envSetting` (the `tflw.env`
 * workspace setting, decision B) — no caching: `tflw.config` is small and read only once per
 * debounced reparse tick of a document that actually needs it (a session/service check, or a hover
 * on `tflw.config` itself), not on every keystroke of unrelated files. */
export async function loadProjectConfig(root: string, envSetting: string | undefined): Promise<ProjectConfig> {
  const configPath = join(root, 'tflw.config');
  const configText = await readFile(configPath, 'utf8');
  const parsed = parseConfigSource(configText);
  const symbols = collectConfigSymbols(parsed.config, configText);

  let resolved: ResolvedConfig | undefined;
  let resolutionError: string | undefined;
  let sessionServiceDiags: Diagnostic[] = [];
  try {
    const envBlock = selectEnv(parsed.config, { flag: undefined, envVar: envSetting ?? process.env.TFLW_ENV });
    resolved = resolveConfig(parsed.config, envBlock);
    sessionServiceDiags = checkSessionServices(parsed.config.sessions, Object.keys(resolved.services));
  } catch (e) {
    if (e instanceof ConfigError) resolutionError = e.message;
    else throw e;
  }

  return {
    configPath,
    configText,
    config: parsed.config,
    symbols,
    diagnostics: [...parsed.diagnostics, ...sessionServiceDiags],
    ...(resolutionError !== undefined ? { resolutionError } : {}),
    ...(resolved !== undefined ? { resolved } : {}),
  };
}

/** A one-line synthetic diagnostic for `resolutionError`, anchored to the whole config file (no
 * more precise span exists — `ConfigError` carries a message only) — surfaced so an editor doesn't
 * silently show zero diagnostics on a config that can't actually resolve any env. */
export function resolutionErrorDiagnostic(project: ProjectConfig): Diagnostic | null {
  if (!project.resolutionError) return null;
  return { code: CONFIG_RESOLUTION_ERROR_CODE, severity: 'error', message: project.resolutionError, span: project.config.span };
}
