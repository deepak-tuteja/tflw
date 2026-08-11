// The JS/TS escape hatch (P#11, SPEC §11): `use "./helpers/sign.ts"` imports a plain module,
// whose exported functions are called like native actions (`sign payload({body})` → `signPayload`,
// camelCase of the multi-word call name). `.ts` helpers load via Node's own native type-stripping
// dynamic `import()` (Node >= 22, P#43) — no `tsx`/esbuild runtime dependency, so a published
// API-only project stays small forever. Node's stripper only erases type syntax, so a few
// TS-only *runtime* constructs (enums, namespaces, parameter properties) aren't supported; those
// fail with a teaching error naming the actual construct instead of a raw Node stack trace.
import { pathToFileURL } from 'node:url';

const moduleCache = new Map<string, Promise<Record<string, unknown>>>();

export async function loadHelperModule(absPath: string): Promise<Record<string, unknown>> {
  let pending = moduleCache.get(absPath);
  if (!pending) {
    pending = importHelper(absPath);
    moduleCache.set(absPath, pending);
  }
  return pending;
}

async function importHelper(absPath: string): Promise<Record<string, unknown>> {
  try {
    return (await import(pathToFileURL(absPath).href)) as Record<string, unknown>;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/not supported in strip-only mode/.test(message)) {
      throw new Error(
        `${absPath}: ${message}. JS/TS helpers (SPEC §11) load via Node's native type stripping, ` +
          'which only erases type syntax — it cannot compile enums, namespaces, or parameter ' +
          'properties. Rewrite the construct in erasable-syntax TS (e.g. a plain object instead of ' +
          'an enum, a regular constructor assignment instead of a parameter property).',
      );
    }
    throw err;
  }
}

let restatedTypelessModule = false;

/** Reset for tests, which need to observe the first-time print more than once per process. */
export function resetTypelessModuleRestatement(): void {
  restatedTypelessModule = false;
}

/**
 * Replace Node's raw `MODULE_TYPELESS_PACKAGE_JSON` warning with one tflw sentence, for the length
 * of the helper-loading loop only (M125b2, `FU-15`, D259). Returns the uninstaller.
 *
 * Following the documented `.ts` escape hatch in a project with no `"type": "module"` printed four
 * lines of raw Node warning — `(node:355928) [MODULE_TYPELESS_PACKAGE_JSON] …` through
 * ``(Use `node --trace-warnings ...` …)`` — *above* the results. It was the only stack-trace-
 * flavoured output that got past the diagnostics layer, and it appears above them because `use`
 * modules load eagerly at program-load time, before any test executes.
 *
 * **Capture and delegate, not remove and reprint.** Three approaches were measured; only this one
 * works without collateral. A plain `process.on('warning', …)` does not suppress anything — the
 * handler fires *and* Node still prints. `removeAllListeners('warning')` does suppress, but then
 * tflw owns every process warning in the run, so an `ExperimentalWarning` or a `DeprecationWarning`
 * from a dependency reaches the user only if tflw remembered to re-implement Node's format for it.
 * Capturing Node's own `onWarning` — `process.listeners('warning')` holds exactly one function at
 * startup, and it is that — and calling it for everything we don't claim makes "don't eat a warning
 * you needed" a property of the code rather than a promise in a review comment. Delegation reprints
 * every other warning in Node's own voice byte for byte, ``(Use `node --trace-deprecation …`)``
 * tail included.
 *
 * **Scoped, not global.** Installed immediately around the helper-loading loop and uninstalled
 * after, rather than at CLI start: the narrow window is what keeps `tflw watch`'s long-lived
 * process from accumulating handlers across saves, and it is the only window in which this
 * particular warning can be emitted at all.
 *
 * The restatement is derived from the warning's `code` and nothing else. It deliberately does not
 * parse the file path or the `package.json` path out of Node's prose — the same coupling
 * `blockedPorts.ts` refuses for the same reason.
 */
export function interceptTypelessModuleWarning(): () => void {
  const captured = process.listeners('warning') as ((warning: Error) => void)[];
  process.removeAllListeners('warning');
  const handler = (warning: Error & { code?: string }): void => {
    if (warning.code === 'MODULE_TYPELESS_PACKAGE_JSON') {
      if (restatedTypelessModule) return;
      restatedTypelessModule = true;
      process.stderr.write(
        '⚠ tflw: a JS/TS helper was loaded as an ES module because the nearest `package.json` sets no `"type"` — ' +
          'it works, and Node re-parses the file to get there. Add `"type": "module"` to `package.json` to drop that ' +
          'overhead (`tflw init` now scaffolds one; SPEC.md §11).\n',
      );
      return;
    }
    for (const fn of captured) fn(warning);
  };
  process.on('warning', handler);
  return () => {
    process.off('warning', handler);
    for (const fn of captured) process.on('warning', fn);
  };
}

/** `sign payload` → `signPayload` — the naming convention bridging `.tflw` call syntax to JS exports. */
export function camelCaseName(words: string): string {
  const parts = words.split(' ').filter(Boolean);
  return parts.map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1))).join('');
}
