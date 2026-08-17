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
 * the shared Promise, and repeat assertions across many tests in one run never re-fetch. Only
 * *successes* are cached for the process lifetime: a rejected entry evicts itself (see
 * `loadSchemaDoc`), so the cache never turns a transient outage into a permanent one. */
const schemaDocCache = new Map<string, Promise<LoadedSchemaDoc>>();

/**
 * The parsed document, in the two slices its two readers want (`M137c`, `D460`).
 *
 * Deliberately minimal and open rather than a full OpenAPI model: `expect body matches schema` wants
 * `components.schemas` and nothing else, `crawl … seed openapi` wants `paths` and nothing else, and
 * the operation-level shapes the crawl's enumerator reads are declared where it reads them
 * (`crawlSurface.ts`) rather than here. A document is untrusted input off the network either way, so
 * every field is optional and every reader narrows what it uses.
 */
export interface OpenApiDocument {
  readonly paths?: Readonly<Record<string, unknown>>;
  readonly components?: { readonly schemas?: Readonly<Record<string, unknown>> };
  /** `M137c1` (`D480`). Read only by `documentServerBasePath`, and the reason it has to be read at all
   *  is that a document's `paths` are relative to **this**, not to whatever base a suite configured.
   *  Optional because the specification makes it so: absent or empty means a server of `/`. */
  readonly servers?: readonly unknown[];
}

/** A fetched-and-compiled OpenAPI document, plus what it cost to get — carried so the assertion
 * that triggered the fetch can say so in its own detail line (review finding `A12-03`).
 *
 * `document` is `D460`: the raw parsed document, kept rather than discarded. Until `M137c` this
 * interface held only the compiled `ajv` instance, so `paths` was read on the way past and thrown
 * away — which made a perfectly ordinary document (routes, no component schemas) a hard failure for
 * anything that wanted the routes. It is the *unnormalized* document on purpose: `nullable` is folded
 * per-schema at `addSchema` time below, and a reader that needs the same treatment for an inline
 * schema calls `normalizeOpenApiSchema` on that schema itself. Normalizing the whole document once
 * here would rewrite parts of it nobody validates against, to save a call nobody is making. */
interface LoadedSchemaDoc {
  readonly ajv: Ajv;
  readonly durationMs: number;
  readonly schemaCount: number;
  readonly document: OpenApiDocument;
}

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
 * validates a real `null` value the same way the OpenAPI spec itself says it should.
 *
 * Exported since `M137c` (`D460`): the crawl's request synthesis reads the same NestJS-generated
 * schemas to build a body, so it has to understand `nullable` identically. One function rather than
 * two, because two would drift and the drift would be invisible — a synthesizer that thought a field
 * was non-nullable would send a value the validator would have accepted as `null`. */
export function normalizeOpenApiSchema(node: unknown): unknown {
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

/** Returns the compiled document and whether this call was the one that fetched it. `fetched` is
 * what makes the round-trip visible downstream: `interpreter.ts:1884` states the principle in as
 * many words — *"a retry is visible evidence in the report, never a silent, invisible extra round-
 * trip (P#5/P#16)"* — and a fetch an assertion performs on the user's behalf is held to the same
 * standard (review finding `A12-03`), the more so because it is `checkHostAllowed`-gated and
 * therefore already understood to be security-relevant. */
async function loadSchemaDoc(url: string, config: ResolvedConfig): Promise<{ doc: LoadedSchemaDoc; fetched: boolean }> {
  checkHostAllowed(url, config);
  let cached = schemaDocCache.get(url);
  const fetched = !cached;
  if (!cached) {
    cached = (async () => {
      const start = performance.now();
      const response = await sendRequest({ method: 'GET', url, headers: {}, timeoutMs: config.timeouts.step, followRedirects: true, allowHosts: config.allowHosts });
      if (response.status < 200 || response.status >= 300) {
        throw new RuntimeError(`could not load OpenAPI document at "${url}": got ${response.status}`);
      }
      const parsed: unknown = response.json;
      // What "usable document" means here, and it is the only thing this loader now insists on: a
      // JSON object came back. `response.json` is `undefined` for a body that did not parse, which
      // is what a `text/plain` 200 from a misrouted path looks like — and saying *that* is what the
      // caller needs, rather than a sentence about validation (`D460`).
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new RuntimeError(`OpenAPI document at "${url}" is not a JSON object`);
      }
      const document = parsed as OpenApiDocument;
      // `?? {}` is `D460`'s move: **a document with `paths` and no `components.schemas` is legal**,
      // and until `M137c` this line threw on one. It threw while *seeding*, about *validation* — an
      // error naming a feature the caller was not using, for a document that was fine. The
      // requirement did not disappear; it moved to `evaluateSchemaMatch`, the one reader that cannot
      // work without it, where it can also say which schema was being looked for.
      const schemas = document.components?.schemas ?? {};
      const ajv = new Ajv({ strict: false });
      for (const [name, schema] of Object.entries(schemas)) {
        ajv.addSchema(normalizeOpenApiSchema(schema) as object, `#/components/schemas/${name}`);
      }
      return { ajv, durationMs: Math.round(performance.now() - start), schemaCount: Object.keys(schemas).length, document };
    })();
    // Cache the *in-flight* promise (that's the point — concurrent assertions share one fetch),
    // but evict it the moment it rejects (M63, review finding A12-02). Caching a rejection made a
    // transient failure permanent for the life of the process: a server that 500s once and is
    // healthy a millisecond later failed every subsequent assertion in the run with the *first*
    // one's status — a message describing an exchange those assertions never had. Their tell was
    // a 1 ms duration: no I/O happened. Worst under `tflw watch`, where the process outlives the
    // outage and no amount of re-saving clears it.
    //
    // The `.catch` is attached to a copy, not to `cached` — `cached` must stay the original
    // promise so every awaiting caller still sees the rejection. This handler only cleans up, and
    // returning nothing from it marks the copy handled, so the eviction itself never becomes an
    // unhandled rejection.
    void cached.catch(() => {
      schemaDocCache.delete(url);
    });
    schemaDocCache.set(url, cached);
  }
  return { doc: await cached, fetched };
}

/**
 * `crawl "…" / seed openapi "/openapi.json"` — the documented surface, fetched (`M137c`, `D460`).
 *
 * A four-line function on purpose. Everything a crawl needs from a document fetch was already built
 * here for `expect body matches schema`, and each piece is something the crawl inherits for the same
 * reason the assertion had it:
 *
 * - **`checkHostAllowed`** inside `loadSchemaDoc` — `D342`'s permission door, already applied to a
 *   document fetch. A crawl fetching its own document needs exactly this and nothing crawl-specific.
 * - **The reject-evicting, URL-keyed, process-lifetime cache** — including the `A12-02` lesson about
 *   what caching a rejection cost. A second cache alongside it would re-earn that from scratch.
 * - **`resolveSchemaSourceUrl`** — so `seed openapi "/openapi.json"` resolves against the default
 *   service's base URL, *the same convention a plain `api GET /path` step already uses*. That
 *   convention was decided for the schema source and is not re-decided for the seed.
 *
 * Returns the provenance numbers as well as the document, because `D435` requires the crawl to
 * disclose its planned volume before it sends anything, and "read 84 paths out of a document fetched
 * from <url> in 12ms" is the first half of that sentence.
 */
export async function loadOpenApiDocumentForCrawl(
  source: string,
  config: ResolvedConfig,
): Promise<{ readonly url: string; readonly document: OpenApiDocument; readonly durationMs: number; readonly fetched: boolean }> {
  const url = resolveSchemaSourceUrl(source, config);
  const { doc, fetched } = await loadSchemaDoc(url, config);
  return { url, document: doc.document, durationMs: doc.durationMs, fetched };
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
  const { doc, fetched } = await loadSchemaDoc(url, config);
  const { ajv } = doc;
  // `D460` — the requirement `loadSchemaDoc` used to enforce, now stated by the reader that actually
  // has it. Same sentence it always was, so an author who has seen this error before sees it again,
  // and now with the provenance clause every other outcome of this matcher carries.
  if (doc.schemaCount === 0) {
    throw new RuntimeError(`OpenAPI document at "${url}" has no \`components.schemas\` to validate against${provenance(url, doc, fetched)}`);
  }
  const key = `#/components/schemas/${schemaName}`;
  const validate: ValidateFunction | undefined = ajv.getSchema(key);
  if (!validate) {
    throw new RuntimeError(`schema "${schemaName}" not found in "${source}"'s \`components.schemas\`${provenance(url, doc, fetched)}`);
  }
  const valid = validate(bodyValue);
  const ok = negated ? !valid : valid;
  const not = negated ? 'not ' : '';
  const expectation = `${subjectLabel} ${not}to match schema "${schemaName}"`;
  if (ok) return { ok: true, message: `${expectation}${provenance(url, doc, fetched)}` };
  const errorText = valid ? '(negated match unexpectedly succeeded)' : ajv.errorsText(validate.errors, { separator: '; ' });
  return { ok: false, message: `expected ${expectation}, but: ${truncate(errorText)}${provenance(url, doc, fetched)}` };
}

/** `A12-03` — the round-trip, said out loud, in the detail text of the step that caused it. A
 * trailing clause on the existing message rather than a step of its own: it reaches report.html,
 * `results.json`, `--format ndjson` and `junit.xml` in one move, and changes no event shape, so
 * nothing consuming the stream as a contract (cluster C4) has to learn a new step kind for it.
 *
 * The distinction between the two forms is the useful part. `fetched` names the URL, the cost, and
 * how many schemas came back — evidence that this assertion, and not some earlier one, paid for the
 * document. A cache hit says so explicitly, which is also what gives `A12-02`'s reject-eviction an
 * artifact trail at last: previously the *only* signal that assertions 2 and 3 did no I/O was their
 * `1 ms` duration. */
function provenance(url: string, doc: LoadedSchemaDoc, fetched: boolean): string {
  if (!fetched) return ` (schema document from cache: "${url}")`;
  const plural = doc.schemaCount === 1 ? '' : 's';
  return ` (fetched schema document "${url}" — ${doc.schemaCount} schema${plural}, ${doc.durationMs}ms)`;
}
