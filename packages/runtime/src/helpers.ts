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

/** `sign payload` → `signPayload` — the naming convention bridging `.tflw` call syntax to JS exports. */
export function camelCaseName(words: string): string {
  const parts = words.split(' ').filter(Boolean);
  return parts.map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1))).join('');
}
