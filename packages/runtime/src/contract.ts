// Contract/schema validation — `expect body matches schema "Name" from "source"` (SPEC, PLAN
// decision 102a, enterprise arc cluster 3, closes TFLW-GAPS.md gap #6). Real ajv JSON-Schema
// validation (decision 13: ajv is build-time-bundled into cli.js via esbuild, the same
// zero-runtime-deps mechanism `undici` already uses for mTLS) against an API's own generated
// OpenAPI document, not the hand-rolled minimal validator apps have used as a JS-escape-hatch
// workaround before this. Kept out of `matcher.ts`: that module is pure and synchronous by
// design (P#13's closed feature set) — fetching an external document doesn't belong there, so
// this whole match is evaluated directly by `interpreter.ts`'s (now-async) `evaluateExpect`,
// bypassing `evalMatcher` entirely for this one matcher name.

// Named import, not the default: ajv's package has no package.json `exports` map, which makes
// the default-imported binding resolve ambiguously under this project's `NodeNext` module
// resolution (a known ajv/TS interop wrinkle, `new Ajv(...)` type-errors as "not constructable"
// even though it works fine at runtime). The named `Ajv` class export sidesteps the default-
// export interop path entirely.
import { Ajv, type ValidateFunction } from 'ajv';
import type { ResolvedConfig } from './types.js';
import { RuntimeError } from './eval.js';
import { sendRequest } from './http.js';
import { checkHostAllowed, ensureLeadingSlash, resolveBaseUrl } from './interpreter.js';
import { truncate, type MatchOutcome } from './matcher.js';

/** Process-lifetime cache, keyed by the resolved OpenAPI document URL — same precedent as
 * `interpreter.ts`'s existing `mtlsCredCache`: lives outside `TestCtx`/`RunOptions`, so
 * concurrent `--workers N` assertions against the same URL share one in-flight fetch+compile via
 * the shared Promise, and repeat assertions across many tests in one run never re-fetch. */
const schemaDocCache = new Map<string, Promise<Ajv>>();

/** Absolute (`http(s)://`) sources pass through; anything else is resolved against the default
 * service's base URL, the same convention a plain `api GET /path` step already uses with no
 * `<service>` prefix. A multi-service config needing a non-default service's document uses an
 * absolute URL — a documented, deliberately minimal-scope limitation. */
function resolveSchemaSourceUrl(source: string, config: ResolvedConfig): string {
  if (/^https?:\/\//i.test(source)) return source;
  return resolveBaseUrl(null, config) + ensureLeadingSlash(source);
}

/** Recursively strips OpenAPI 3.0's `nullable: true` (a keyword plain JSON-Schema/ajv doesn't
 * understand) and folds it into `type: [..., 'null']`, so a NestJS/Swagger-generated schema
 * validates a real `null` value the same way the OpenAPI spec itself says it should. */
function normalizeOpenApiSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalizeOpenApiSchema);
  if (node === null || typeof node !== 'object') return node;
  const obj = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'nullable') continue;
    out[key] = normalizeOpenApiSchema(value);
  }
  if (obj.nullable === true && typeof out.type === 'string') {
    out.type = [out.type, 'null'];
  }
  return out;
}

async function loadSchemaDoc(url: string, config: ResolvedConfig): Promise<Ajv> {
  checkHostAllowed(url, config);
  let cached = schemaDocCache.get(url);
  if (!cached) {
    cached = (async () => {
      const response = await sendRequest({ method: 'GET', url, headers: {}, timeoutMs: config.timeouts.step, followRedirects: true });
      if (response.status < 200 || response.status >= 300) {
        throw new RuntimeError(`could not load OpenAPI document at "${url}": got ${response.status}`);
      }
      const doc = response.json as { components?: { schemas?: Record<string, unknown> } } | undefined;
      const schemas = doc?.components?.schemas;
      if (!schemas) {
        throw new RuntimeError(`OpenAPI document at "${url}" has no \`components.schemas\` to validate against`);
      }
      const ajv = new Ajv({ strict: false });
      for (const [name, schema] of Object.entries(schemas)) {
        ajv.addSchema(normalizeOpenApiSchema(schema) as object, `#/components/schemas/${name}`);
      }
      return ajv;
    })();
    schemaDocCache.set(url, cached);
  }
  return cached;
}

/** Runs `expect body matches schema "schemaName" from "source"` (and its negated form).
 * Message shape mirrors `evalMatcher`'s own "expected ... but got ..." convention. */
export async function evaluateSchemaMatch(
  subjectLabel: string,
  bodyValue: unknown,
  schemaName: string,
  source: string,
  config: ResolvedConfig,
  negated: boolean,
): Promise<MatchOutcome> {
  const url = resolveSchemaSourceUrl(source, config);
  const ajv = await loadSchemaDoc(url, config);
  const key = `#/components/schemas/${schemaName}`;
  const validate: ValidateFunction | undefined = ajv.getSchema(key);
  if (!validate) {
    throw new RuntimeError(`schema "${schemaName}" not found in "${source}"'s \`components.schemas\``);
  }
  const valid = validate(bodyValue);
  const ok = negated ? !valid : valid;
  const not = negated ? 'not ' : '';
  const expectation = `${subjectLabel} ${not}to match schema "${schemaName}"`;
  if (ok) return { ok: true, message: expectation };
  const errorText = valid ? '(negated match unexpectedly succeeded)' : ajv.errorsText(validate.errors, { separator: '; ' });
  return { ok: false, message: `expected ${expectation}, but: ${truncate(errorText)}` };
}
