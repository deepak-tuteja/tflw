// The documented surface, read and turned into requests (`M137c`, `D435`/`D436`).
//
// `seed openapi "/openapi.json"` has two halves and this file is the second one. The fetch is
// `contract.ts`'s, reused whole (`D460`); what happens next is here: an OpenAPI document in, one
// concrete sendable request per operation out, plus a list of the operations that produced none and
// why. **Pure** — no config, no network, no clock — because everything interesting about synthesis is
// a judgement about a document, and a judgement about a document should be testable by handing it one.
//
// Two properties this module exists to keep, both of them `D436`'s:
//
//  1. **Everything enumerated is accounted for.** `requests.length + skipped.length` is the operation
//     count of the document, so `D435`'s disclosure line is arithmetic rather than an estimate. A
//     surface that quietly dropped what it could not build would report a smaller denominator and
//     look like better coverage — `M134a`'s lesson, that the tell for a scan which judged less than it
//     appears to is a *green* report.
//  2. **Every invented value is named.** `D370`'s warning about this seed is verbatim: *"a schema tells
//     you an endpoint accepts a `status` field; it does not tell you a request that reaches real code,
//     carries real auth, and got a `2xx`."* Synthesis cannot make that warning false. What it can do
//     is say which parts of a request tflw made up, so that a `404` on a route whose id we invented
//     reads as *we guessed an id* rather than as *this route is missing*.

import type { HttpMethod } from '@tflw/lang';
import { normalizeOpenApiSchema, type OpenApiDocument } from './contract.js';
import { isSafeMethod } from './authzProbe.js';

/** One operation, as a request the crawl can actually send. */
export interface CrawlRequestPlan {
  readonly method: HttpMethod;
  /** The path **as the document templates it** — `/products/{id}`. This is the operation's identity:
   *  what `exclude` matches, what the report groups by, and what stays stable when the invented `id`
   *  changes. `R8`'s fingerprint already normalises ids out of an endpoint for the same reason. */
  readonly template: string;
  /** The path with values filled in — `/products/1?limit=1`. Ready to hand to `sendRequest`. */
  readonly path: string;
  /** The synthesized JSON body, absent when the operation documents none as required. */
  readonly body?: unknown;
  /** Absent exactly when `body` is. */
  readonly contentType?: string;
  /** `isSafeMethod`'s answer, carried rather than re-derived so the send site and the disclosure line
   *  cannot disagree about which requests are writes. */
  readonly mutating: boolean;
  /** What synthesis had to invent for this request to be sendable at all, named in words an author
   *  can read: ``path parameter `id` ``, ``body field `name` ``. Empty when the document supplied
   *  every value itself, which is the only case where a response means what it appears to mean. */
  readonly invented: readonly string[];
}

/** An operation that produced no request, and why — the input to `D436`'s blind-spot entries. */
export interface CrawlSurfaceSkip {
  /** `'*'` when the reason applies to every operation under one path template (an `exclude` match),
   *  the verb otherwise. Not an `HttpMethod`: a document is free to describe `trace`, and a skip is
   *  where an unsupported verb is reported rather than silently dropped. */
  readonly method: string;
  readonly template: string;
  readonly reason: string;
}

export interface CrawlSurface {
  readonly requests: readonly CrawlRequestPlan[];
  readonly skipped: readonly CrawlSurfaceSkip[];
}

/** The verbs tflw can express, in the order a report reads best. `trace` is deliberately absent — see
 *  `enumerateOpenApiSurface`, which reports it as a skip rather than ignoring it. */
const VERBS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

/** Everything an OpenAPI path item can hold that is not an operation. Enumerating operations by
 *  *including* known verbs rather than by *excluding* these is what keeps a document that adds a new
 *  metadata key from being read as a route. */
const PATH_ITEM_KEYS = new Set(['summary', 'description', 'servers', 'parameters', '$ref']);

/**
 * `D480` — the path prefix a document's own `servers` entry declares, `''` for a document served at
 * the root.
 *
 * **This exists because a document's `paths` are relative to its server, never to whatever base a
 * suite happened to configure**, and until `M137c1` the crawl joined them onto `api` — so an app
 * behind a global prefix (`setGlobalPrefix('v1')`, a Spring `context-path`, a Rails `scope`) had every
 * synthesized request dialled at `/v1/v1/…`, answered `404`, judged nothing, and **passed**. Measured
 * against this project's own dogfood target: 31 sent, 0 reached, exit 0.
 *
 * The specification is unambiguous and is the whole rule: a document with no `servers`, or an empty
 * one, defaults to a server whose url is `/`. Absent, `[]` and `/` are therefore one case, not three.
 *
 * **An absolute `servers[0].url` contributes its path and nothing else.** A document that names
 * `https://api.example.com/v2` while the suite is pointed at staging is describing where the API lives
 * *under a host*, and the host is the operator's choice — honouring the document's origin would walk a
 * crawl off the machine somebody authorized, on the strength of a field that survives a copy-paste.
 *
 * Multiple servers take the first, for the reason `synthesizeValue` already takes the first `oneOf`
 * branch: it is the one the document's author wrote first. Server **variables** take their declared
 * defaults; a template with no default left to substitute falls back to the root, because a base
 * containing a literal `{region}` is a request nobody can interpret.
 *
 * Path-item-level and operation-level `servers` are **not** read (they stay in `PATH_ITEM_KEYS`, which
 * is where they were already being skipped). Deferred on a condition, per `D336`: **the first document
 * this arc meets that overrides its server per operation.**
 */
export function documentServerBasePath(document: OpenApiDocument): string {
  const servers = document.servers;
  const first = Array.isArray(servers) && servers.length > 0 ? asObject(servers[0]) : undefined;
  const declared = typeof first?.url === 'string' ? first.url : '/';
  const substituted = substituteServerVariables(declared, asObject(first?.variables));
  if (substituted === undefined) return '';

  let pathname: string;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(substituted)) {
    try {
      pathname = new URL(substituted).pathname;
    } catch {
      return '';
    }
  } else {
    pathname = substituted.startsWith('/') ? substituted : `/${substituted}`;
  }
  // `/` and `''` are the same base, and a trailing slash would double the separator against a path
  // that already carries a leading one. Normalised here so every caller can concatenate blindly.
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === '/' ? '' : trimmed;
}

/** `{name}` → the variable's `default`. Returns `undefined` when a placeholder is left unresolved,
 *  which the caller reads as *fall back to the root*: a base URL containing a literal brace is worse
 *  than no base at all, because it fails at the socket rather than in the report. */
function substituteServerVariables(url: string, variables: Record<string, unknown> | undefined): string | undefined {
  if (!url.includes('{')) return url;
  const out = url.replace(/\{([^}]*)\}/g, (match, name: string) => {
    const declared = asObject(variables?.[name.trim()]);
    const fallback = declared?.default;
    return typeof fallback === 'string' || typeof fallback === 'number' ? String(fallback) : match;
  });
  return out.includes('{') ? undefined : out;
}

/**
 * `D436` — the whole documented surface, as requests and as accounted-for absences.
 *
 * Order is the document's own: a generated document lists paths in controller-registration order,
 * which is the order an author recognises, and a crawl that reordered them would make two runs of one
 * suite diff for no reason anyone can act on (`D409`'s rule, applied to routes instead of rules).
 */
export function enumerateOpenApiSurface(document: OpenApiDocument, excludes: readonly string[] = []): CrawlSurface {
  const requests: CrawlRequestPlan[] = [];
  const skipped: CrawlSurfaceSkip[] = [];

  for (const [template, pathItemValue] of Object.entries(document.paths ?? {})) {
    const pathItem = asObject(pathItemValue);
    if (!pathItem) {
      skipped.push({ method: '*', template, reason: 'the document describes it as something other than a path item' });
      continue;
    }
    // Checked once per template rather than once per operation, and reported as one row: the author
    // wrote one pattern, so one sentence back. The pattern that matched is named because an author
    // with three `exclude` lines needs to know which of them swallowed the route — an exclusion is
    // the one entry in this channel that is somebody's instruction rather than tflw's limitation.
    const excludedBy = excludes.find((pattern) => matchesRoutePattern(template, pattern));
    if (excludedBy !== undefined) {
      skipped.push({ method: '*', template, reason: `excluded by this crawl's \`exclude "${excludedBy}"\`` });
      continue;
    }

    const shared = readParameters(pathItem.parameters, document);

    for (const [key, operationValue] of Object.entries(pathItem)) {
      if (PATH_ITEM_KEYS.has(key)) continue;
      const verb = VERBS.find((v) => v.toLowerCase() === key.toLowerCase());
      if (!verb) {
        skipped.push({ method: key.toUpperCase(), template, reason: 'tflw has no step for this method, so a crawl cannot send it' });
        continue;
      }
      const operation = asObject(operationValue);
      if (!operation) {
        skipped.push({ method: verb, template, reason: 'the document describes it as something other than an operation' });
        continue;
      }
      const plan = planOperation(verb, template, operation, shared, document);
      if ('reason' in plan) skipped.push({ method: verb, template, reason: plan.reason });
      else requests.push(plan);
    }
  }

  return { requests, skipped };
}

/** One operation, either as a request or as the reason there isn't one. */
function planOperation(
  method: HttpMethod,
  template: string,
  operation: Record<string, unknown>,
  shared: readonly Parameter[],
  document: OpenApiDocument,
): CrawlRequestPlan | { readonly reason: string } {
  // An operation's own parameters override the path item's of the same name+location, per OpenAPI.
  const params = mergeParameters(shared, readParameters(operation.parameters, document));

  // **A required header or cookie parameter is a refusal, not something to invent.** Every other
  // synthesized value is data; a header is credential-shaped, and the crawl's entire reachability
  // story rests on the credential being the declared principal's and nothing else. A request
  // carrying a header tflw made up has an auth story no reader can reconstruct — and if the invented
  // header happened to matter, the response would be about tflw's guess rather than about the app.
  const invented: string[] = [];
  const credentialish = params.find((p) => p.required && (p.location === 'header' || p.location === 'cookie'));
  if (credentialish) {
    return { reason: `it requires a \`${credentialish.name}\` ${credentialish.location} the crawl will not invent (a header is credential-shaped, so synthesizing one would send a request whose identity is tflw's guess)` };
  }

  const path = fillPath(template, params, document, invented);
  if ('reason' in path) return path;

  const body = synthesizeBody(operation, document, invented);
  if ('reason' in body) return body;

  return {
    method,
    template,
    path: path.value,
    ...(body.value === undefined ? {} : { body: body.value, contentType: 'application/json' }),
    mutating: !isSafeMethod(method),
    invented,
  };
}

// ---- the path ------------------------------------------------------------------------------------

/** `{name}` segments filled from the `path` parameters, plus every **required** `query` parameter.
 *
 * `D467`'s rule, and it is the line that keeps `invented` short enough to read: **synthesis invents a
 * value only where the request cannot be made without one.** A path parameter is required by
 * definition; a required query parameter is required by declaration; an optional one is a value the
 * document says the app does not need, so inventing it would add surface the crawl cannot interpret —
 * a `400` from `?limit=notanumber` we chose ourselves is not a finding about anything. An optional
 * parameter that carries its own `example`/`default`/`enum` is a value the *document* supplied rather
 * than one tflw made up, so those are sent and are not counted as invented. */
function fillPath(
  template: string,
  params: readonly Parameter[],
  document: OpenApiDocument,
  invented: string[],
): { readonly value: string } | { readonly reason: string } {
  let failure: string | undefined;
  // Percent-encoded per segment, the same reason `inputCorpus.ts` learned to: an unencoded `/` or
  // `..` in a synthesized value stops being a value and becomes part of the route, and `new URL`
  // normalises it away before the request leaves the process — so the request sent is not the request
  // planned, and nothing says so.
  const path = template.replace(/\{([^}]+)\}/g, (_match, rawName: string) => {
    const name = rawName.trim();
    const declared = params.find((p) => p.location === 'path' && p.name === name);
    if (!declared) {
      // A templated segment the document never describes. Fillable anyway, and worth filling: a
      // slightly-wrong document is common and a crawl that refused one would report a smaller
      // surface than the app has. Named as invented *and* as undocumented, since the two together
      // are what tell a reader the guess had nothing behind it.
      invented.push(`path parameter \`${name}\` (which the document does not describe)`);
      return '1';
    }
    const value = synthesizeValue(declared.schema, document, []);
    if ('reason' in value) {
      failure ??= `its \`${name}\` path parameter cannot be synthesized: ${value.reason}`;
      return '';
    }
    if (!declared.documented) invented.push(`path parameter \`${name}\``);
    return encodeURIComponent(scalarText(value.value));
  });
  if (failure !== undefined) return { reason: failure };

  const query: string[] = [];
  for (const p of params) {
    if (p.location !== 'query') continue;
    if (!p.required && !p.documented) continue;
    const value = synthesizeValue(p.schema, document, []);
    if ('reason' in value) {
      if (!p.required) continue;
      return { reason: `its \`${p.name}\` query parameter cannot be synthesized: ${value.reason}` };
    }
    if (!p.documented) invented.push(`query parameter \`${p.name}\``);
    query.push(`${encodeURIComponent(p.name)}=${encodeURIComponent(scalarText(value.value))}`);
  }

  return { value: query.length > 0 ? `${path}?${query.join('&')}` : path };
}

/** A parameter value has to go in a URL, so an object or array one has to become text. Only ever
 *  reached for a document that types a path/query parameter as a container, which the OpenAPI
 *  serialization rules cover in five styles tflw does not implement — JSON is the honest fallback and
 *  it is at least round-trippable, where a bare `[object Object]` is not. */
function scalarText(value: unknown): string {
  if (value === null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// ---- the body ------------------------------------------------------------------------------------

/**
 * `requestBody` → a JSON body, or the reason there is none.
 *
 * **`D467`'s invent-only-what-is-required rule stops at the body's edge, and that boundary is the
 * decision.** Inside the body it holds as written — optional properties are skipped. The body *itself*
 * is sent whenever the document describes a JSON schema for one, `required: true` or not, because the
 * two cases are not alike:
 *
 * - An optional **query parameter** is a value a complete request does not need. Inventing one adds
 *   surface the crawl cannot interpret: a `400` from a `?limit=` we chose is a fact about our guess.
 * - An optional **body** is the request's substance rather than an addition to it. Sending `POST
 *   /orders` with no body because a generator omitted one flag produces a `400` that means nothing —
 *   the crawl records the route as unreachable and moves on, having tested the app's validator. That
 *   is `D436`'s named false negative, reached by being cautious in the wrong place.
 *
 * Where there is no schema at all, `required` is the only signal left, so it decides: a required body
 * gets an empty object because *some* body has to go, an optional one gets nothing.
 */
function synthesizeBody(
  operation: Record<string, unknown>,
  document: OpenApiDocument,
  invented: string[],
): { readonly value: unknown } | { readonly reason: string } {
  const resolved = resolveNode(operation.requestBody, document, []);
  if ('reason' in resolved) return { reason: `its request body cannot be read: ${resolved.reason}` };
  const requestBody = asObject(resolved.value);
  if (!requestBody) return { value: undefined };

  const content = asObject(requestBody.content) ?? {};
  const types = Object.keys(content);
  if (types.length === 0) {
    if (requestBody.required !== true) return { value: undefined };
    invented.push('an empty request body (the document declares one as required but describes no content)');
    return { value: {} };
  }
  // `application/json` or any `+json` structured suffix (`application/merge-patch+json` is real and
  // common on `PATCH`). Anything else — multipart uploads, form encoding, octet-stream — is a body
  // shape synthesis does not build, and saying so is more useful than sending JSON to a route that
  // documented it would not accept any.
  const jsonType = types.find((t) => t === 'application/json' || t.endsWith('+json'));
  if (jsonType === undefined) {
    return { reason: `its request body is ${types.map((t) => `\`${t}\``).join(', ')}, and the crawl synthesizes JSON only` };
  }
  const schema = asObject(content[jsonType])?.schema;
  if (schema === undefined) {
    if (requestBody.required !== true) return { value: undefined };
    invented.push(`an empty \`${jsonType}\` body (the document describes no schema for it)`);
    return { value: {} };
  }
  const value = synthesizeValue(schema, document, [], invented, true);
  if ('reason' in value) return { reason: `its request body cannot be synthesized: ${value.reason}` };
  return { value: value.value };
}

// ---- values --------------------------------------------------------------------------------------

/**
 * One value for one schema, or the reason there isn't one.
 *
 * The document's own words come first — `example`, then `default`, then the head of an `enum` — and
 * only then is anything chosen by type. That order is the difference between a crawl that sends what
 * the API's authors said a request looks like and one that sends `"tflw"` at everything.
 *
 * `refPath` is the `$ref` chain taken to reach here, and it is what makes a **required** cycle a
 * refusal instead of a hang. `Category.parent: Category` is ordinary in a generated document; if that
 * property is *optional* nothing happens, because optional properties are skipped. If it is required
 * the schema describes an infinitely deep object, so there is no request to build — a fact about the
 * document, reported as one, rather than a recursion limit reported as an opinion.
 */
function synthesizeValue(
  rawSchema: unknown,
  document: OpenApiDocument,
  refPath: readonly string[],
  invented?: string[],
  /** True for the body's own top level only. The body's **top-level** required fields are named in
   *  `invented` and nested ones are not, deliberately: the list answers *what did tflw make up*, at a
   *  granularity somebody scans in a report line, and the exact nesting is visible in the body the
   *  report and the repro already carry. A list that walked into every leaf of a deep DTO would be
   *  longer than the request. */
  bodyRoot = false,
): { readonly value: unknown } | { readonly reason: string } {
  const resolved = resolveNode(rawSchema, document, refPath);
  if ('reason' in resolved) return resolved;
  const schema = asObject(normalizeOpenApiSchema(resolved.value));
  if (!schema) return { value: 'tflw' };

  if (schema.example !== undefined) return { value: schema.example };
  if (schema.default !== undefined) return { value: schema.default };
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return { value: schema.enum[0] };

  // `allOf` is a merge, which is what it means; `oneOf`/`anyOf` take the first branch, which is a
  // choice — and the first is the one a document's author wrote first.
  if (Array.isArray(schema.allOf)) {
    const merged: Record<string, unknown> = {};
    for (const member of schema.allOf) {
      const part = synthesizeValue(member, document, resolved.refPath, invented, bodyRoot);
      if ('reason' in part) return part;
      if (part.value !== null && typeof part.value === 'object' && !Array.isArray(part.value)) Object.assign(merged, part.value);
    }
    return { value: merged };
  }
  const branches = Array.isArray(schema.oneOf) ? schema.oneOf : Array.isArray(schema.anyOf) ? schema.anyOf : undefined;
  if (branches && branches.length > 0) return synthesizeValue(branches[0], document, resolved.refPath, invented, bodyRoot);

  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== 'null') ?? 'null' : schema.type;
  const properties = asObject(schema.properties);

  if (type === 'object' || (type === undefined && properties)) {
    const out: Record<string, unknown> = {};
    const required = Array.isArray(schema.required) ? schema.required.filter((k): k is string => typeof k === 'string') : [];
    for (const key of required) {
      const propertySchema = properties?.[key];
      const child = synthesizeValue(propertySchema, document, resolved.refPath, invented);
      if ('reason' in child) return { reason: `\`${key}\` ${child.reason}` };
      out[key] = child.value;
      if (invented && bodyRoot) invented.push(`body field \`${key}\``);
    }
    return { value: out };
  }
  if (type === 'array') {
    const minItems = typeof schema.minItems === 'number' ? schema.minItems : 0;
    if (minItems <= 0) return { value: [] };
    const item = synthesizeValue(schema.items, document, resolved.refPath, invented);
    if ('reason' in item) return { reason: `its items ${item.reason}` };
    return { value: Array.from({ length: minItems }, () => item.value) };
  }
  if (type === 'integer' || type === 'number') {
    const min = typeof schema.minimum === 'number' ? schema.minimum : 1;
    return { value: type === 'integer' ? Math.ceil(min) : min };
  }
  // `false`, not `true`, and the reason is the same one `SAFE_METHODS`' comment gives: of the two
  // wrong answers only one of them does something to somebody's data. A synthesized `force: true` or
  // `deleteAll: true` is a flag nobody asked to set.
  if (type === 'boolean') return { value: false };
  if (type === 'null') return { value: null };
  return { value: synthesizeString(schema) };
}

/** A string that satisfies whatever the schema said about it, preferring a shape the app will accept
 *  over a shape that merely type-checks: a `format` a validator enforces (`email`, `uuid`, `date`) is
 *  a `400` waiting to happen if ignored, and a `400` is indistinguishable from a hardened endpoint,
 *  which is exactly the false negative `D436` rejected an alternative to avoid.
 *
 *  The unconstrained case is the literal `tflw`, and that choice is load-bearing rather than cute:
 *  every payload in Tier 3's injection corpus is `tflw` plus exactly one metacharacter, so a
 *  synthesized value and the control it is compared against are the same string, and a response that
 *  differs between them differs because of the metacharacter. */
function synthesizeString(schema: Record<string, unknown>): string {
  const format = typeof schema.format === 'string' ? schema.format : '';
  const base =
    format === 'email' ? 'tflw@example.invalid'
    : format === 'uuid' ? '00000000-0000-4000-8000-000000000000'
    : format === 'date' ? '2020-01-01'
    : format === 'date-time' ? '2020-01-01T00:00:00.000Z'
    : format === 'uri' || format === 'url' ? 'https://example.invalid/tflw'
    : format === 'password' ? 'tflw-password'
    : 'tflw';
  const minLength = typeof schema.minLength === 'number' ? schema.minLength : 0;
  return base.length >= minLength ? base : base + 'x'.repeat(minLength - base.length);
}

// ---- parameters ----------------------------------------------------------------------------------

interface Parameter {
  readonly name: string;
  readonly location: 'path' | 'query' | 'header' | 'cookie';
  readonly required: boolean;
  readonly schema: unknown;
  /** True when the document itself supplied a value — an `example` on the parameter, or an
   *  `example`/`default`/`enum` on its schema. `D467`'s optional-parameter rule reads this: a value
   *  the document gave is not a value tflw invented, so it is sent and is not disclosed as a guess. */
  readonly documented: boolean;
}

function readParameters(raw: unknown, document: OpenApiDocument): Parameter[] {
  if (!Array.isArray(raw)) return [];
  const out: Parameter[] = [];
  for (const entry of raw) {
    const resolved = resolveNode(entry, document, []);
    if ('reason' in resolved) continue;
    const p = asObject(resolved.value);
    if (!p || typeof p.name !== 'string') continue;
    const location = p.in;
    if (location !== 'path' && location !== 'query' && location !== 'header' && location !== 'cookie') continue;
    const schema = p.example !== undefined ? { example: p.example } : p.schema;
    const schemaObject = asObject(p.schema);
    out.push({
      name: p.name,
      location,
      // A path parameter is required whether or not it says so — the template cannot be filled
      // without it, and a document that omits the flag is describing a route that still has a hole.
      required: p.required === true || location === 'path',
      schema,
      documented:
        p.example !== undefined ||
        schemaObject?.example !== undefined ||
        schemaObject?.default !== undefined ||
        (Array.isArray(schemaObject?.enum) && schemaObject.enum.length > 0),
    });
  }
  return out;
}

/** OpenAPI's rule: an operation's own parameter overrides a path item's of the same name **and**
 *  location. Same name in two locations is two parameters. */
function mergeParameters(shared: readonly Parameter[], own: readonly Parameter[]): Parameter[] {
  const key = (p: Parameter) => `${p.location} ${p.name}`;
  const overridden = new Set(own.map(key));
  return [...shared.filter((p) => !overridden.has(key(p))), ...own];
}

// ---- `$ref` --------------------------------------------------------------------------------------

/** Follows internal `$ref` pointers, returning the chain taken so a cycle is a refusal rather than a
 *  hang. External refs (anything not starting `#/`) are refused by name: resolving one means fetching
 *  a second document, which is a second `checkHostAllowed` decision and so a feature rather than a
 *  detail. */
function resolveNode(
  node: unknown,
  document: OpenApiDocument,
  refPath: readonly string[],
): { readonly value: unknown; readonly refPath: readonly string[] } | { readonly reason: string } {
  let current = node;
  let path = refPath;
  for (let hops = 0; hops < 32; hops++) {
    const object = asObject(current);
    const ref = object?.$ref;
    if (typeof ref !== 'string') return { value: current, refPath: path };
    if (!ref.startsWith('#/')) return { reason: `points at \`${ref}\`, which is outside this document` };
    if (path.includes(ref)) return { reason: `is recursive through \`${ref}\`, so the document describes an infinitely deep value` };
    const target = pointer(document, ref);
    if (target === undefined) return { reason: `points at \`${ref}\`, which this document does not contain` };
    path = [...path, ref];
    current = target;
  }
  return { reason: 'follows more than 32 `$ref` hops' };
}

/** The JSON-Pointer subset OpenAPI uses, with `~0`/`~1` unescaped — a path template like
 *  `/products/{id}` is a legal component key and contains a `/`, so a document that `$ref`s one
 *  escapes it and a resolver that did not unescape would silently miss. */
function pointer(document: OpenApiDocument, ref: string): unknown {
  let current: unknown = document;
  for (const rawSegment of ref.slice(2).split('/')) {
    const segment = rawSegment.replace(/~1/g, '/').replace(/~0/g, '~');
    const object = asObject(current);
    if (!object || !(segment in object)) return undefined;
    current = object[segment];
  }
  return current;
}

// ---- `exclude` -----------------------------------------------------------------------------------

/**
 * `exclude "/vuln/**"` — a glob over route paths (`D466`).
 *
 * **This is a different matcher from the config dialect's `exclude`, and the difference is the
 * decision.** That one is *"exact relative-path equality at any depth, not a glob"* (SPEC §3.9), and
 * it is right there: it names files an author has on disk and can spell exactly. A crawl excludes from
 * a set nobody has seen yet — the routes are in a document the app generates — so the pattern has to
 * be able to say *that whole subtree* without listing it. `D450` chose the same verb for both because
 * both mean *drop things from a discovered set*; the sets differ, so the matchers differ.
 *
 * Two wildcards, the conventional reading: `*` matches within one path segment, `**` across segments.
 * A pattern is matched against the **template** (`/products/{id}`), never the filled-in path, so
 * whether a route is excluded cannot depend on the id synthesis happened to invent.
 */
export function matchesRoutePattern(template: string, pattern: string): boolean {
  const source = pattern
    .split('**')
    .map((between) =>
      between
        .split('*')
        .map((literal) => literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('[^/]*'),
    )
    .join('.*');
  return new RegExp(`^${source}$`).test(template);
}

// ---- helpers -------------------------------------------------------------------------------------

/** A document is untrusted input off the network, so every descent through it goes through here: an
 *  array is not a record, and `null` is `typeof 'object'`. */
function asObject(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}
