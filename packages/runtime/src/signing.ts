// `M246` — a request signature as a credential (`D1344`–`D1348`).
//
// Two schemes on one mechanism: the interpreter serialises the body once, hands the exact bytes and
// the request line to `signRequest`, and sends those same bytes with the headers it returns. So a
// signature always covers what went on the wire — a JSON body, a form, a multipart body with its
// boundary — and never a second serialisation that happens to look the same.
//
// Both are `node:crypto` and nothing else: HMAC is one call, and SigV4 is a canonical request, a
// date-scoped key chain and one more HMAC (`D1347`), written here rather than taken from
// `@smithy/signature-v4`, which would be the only sizeable runtime dependency tree tflw has.

import { createHash, createHmac } from 'node:crypto';
import type { HmacAlgorithm, SignatureEncoding } from '@tflw/lang';

/** What a signature is computed over. `body` is the bytes sent, or `undefined` for no body. */
export interface SigningRequest {
  readonly method: string;
  readonly url: string;
  /** The headers the request will carry, before signing — SigV4 signs some of them. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array | undefined;
  /** The signing instant: the run clock, advanced by the time the run has taken (`D1349`). */
  readonly now: Date;
}

export interface HmacSigner {
  readonly kind: 'hmac';
  readonly algorithm: HmacAlgorithm;
  readonly encoding: SignatureEncoding;
  readonly secret: string;
  /** The `signs` template, decoded — its `{…}` are this module's placeholders. */
  readonly signs: string;
  readonly headers: readonly { readonly name: string; readonly value: string }[];
}

export interface Sigv4Signer {
  readonly kind: 'sigv4';
  readonly region: string;
  readonly service: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken: string | null;
}

export type Signer = HmacSigner | Sigv4Signer;

/** The headers to add, by name. Callers set them over whatever the request already carries. */
export function signRequest(signer: Signer, req: SigningRequest): Record<string, string> {
  return signer.kind === 'hmac' ? signHmac(signer, req) : signSigv4(signer, req);
}

// ---- HMAC templates (`D1346`) --------------------------------------------------------------------

const PLACEHOLDER = /\{([^{}]*)\}/g;

/** The string to sign as bytes. `{body}` is spliced in as the raw bytes sent, so a binary or
 * multipart body is signed exactly — decoding it to text and back would not round-trip. */
export function hmacMessage(template: string, req: SigningRequest): Buffer {
  const url = new URL(req.url);
  const timestamp = unixSeconds(req.now);
  const body = req.body ?? new Uint8Array();
  const pieces: Buffer[] = [];
  let last = 0;
  for (const m of template.matchAll(PLACEHOLDER)) {
    pieces.push(Buffer.from(template.slice(last, m.index), 'utf8'));
    last = m.index! + m[0].length;
    switch (m[1]) {
      case 'body':
        pieces.push(Buffer.from(body));
        break;
      case 'body sha256':
        pieces.push(Buffer.from(sha256Hex(body), 'utf8'));
        break;
      case 'method':
        pieces.push(Buffer.from(req.method.toUpperCase(), 'utf8'));
        break;
      case 'path':
        pieces.push(Buffer.from(url.pathname, 'utf8'));
        break;
      case 'query':
        pieces.push(Buffer.from(url.search.replace(/^\?/, ''), 'utf8'));
        break;
      case 'timestamp':
        pieces.push(Buffer.from(timestamp, 'utf8'));
        break;
      default:
        // `TF087` refuses any other name before a run starts; reaching here means a config built
        // around the checker, and signing the literal text would be a wrong signature that looks
        // like a server bug.
        throw new Error(`a signer's \`signs\` template names \`{${m[1]}}\`, which is not something a signer can sign`);
    }
  }
  pieces.push(Buffer.from(template.slice(last), 'utf8'));
  return Buffer.concat(pieces);
}

function signHmac(signer: HmacSigner, req: SigningRequest): Record<string, string> {
  const signature = createHmac(signer.algorithm, signer.secret).update(hmacMessage(signer.signs, req)).digest(signer.encoding);
  const timestamp = unixSeconds(req.now);
  const out: Record<string, string> = {};
  for (const h of signer.headers) {
    out[h.name] = h.value.replace(PLACEHOLDER, (whole, name: string) => {
      if (name === 'signature') return signature;
      if (name === 'timestamp') return timestamp;
      throw new Error(`a signer's header "${h.name}" names \`${whole}\`, which is not something a signer's header can carry`);
    });
  }
  return out;
}

function unixSeconds(d: Date): string {
  return String(Math.floor(d.getTime() / 1000));
}

// ---- AWS Signature Version 4 (`D1347`) ------------------------------------------------------------

const SIGV4_ALGORITHM = 'AWS4-HMAC-SHA256';

/** `20150830T123600Z` — SigV4's ISO 8601 basic format, always UTC. */
export function amzDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** RFC 3986 unreserved characters pass; every other byte is `%XX` in upper case — SigV4's own
 * encoding, which is stricter than `encodeURIComponent` (`!'()*` are encoded too). */
export function uriEncode(s: string): string {
  let out = '';
  for (const byte of Buffer.from(s, 'utf8')) {
    const c = String.fromCharCode(byte);
    out += /[A-Za-z0-9\-._~]/.test(c) ? c : '%' + byte.toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}

function decodeComponent(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, '%20'));
  } catch {
    return s;
  }
}

/** The path as SigV4 signs it. `URL` has already removed dot segments and encoded it once, which is
 * what S3 signs; every other service signs each segment encoded a second time. */
export function canonicalUri(url: URL, service: string): string {
  const path = url.pathname || '/';
  if (service === 's3') return path;
  return path
    .split('/')
    .map((seg) => uriEncode(seg))
    .join('/');
}

/** `k=v` pairs, each side decoded and re-encoded the SigV4 way, sorted by key and then value. */
export function canonicalQuery(url: URL): string {
  const raw = url.search.replace(/^\?/, '');
  if (raw === '') return '';
  return raw
    .split('&')
    .filter((p) => p !== '')
    .map((p) => {
      const eq = p.indexOf('=');
      const k = eq === -1 ? p : p.slice(0, eq);
      const v = eq === -1 ? '' : p.slice(eq + 1);
      return [uriEncode(decodeComponent(k)), uriEncode(decodeComponent(v))] as const;
    })
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

/** Which headers are signed: `host`, `content-type` when the request has one, and every `x-amz-*`.
 * Signing fewer would let a proxy change them unnoticed; signing more (a `user-agent`, an
 * `accept-encoding` the transport rewrites) makes a correct signature fail in transit. */
function signedHeaderSet(headers: Readonly<Record<string, string>>): [string, string][] {
  const out: [string, string][] = [];
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (lower === 'host' || lower === 'content-type' || lower.startsWith('x-amz-')) {
      out.push([lower, value.trim().replace(/\s+/g, ' ')]);
    }
  }
  return out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

export function sigv4SigningKey(secretAccessKey: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = createHmac('sha256', 'AWS4' + secretAccessKey).update(dateStamp).digest();
  const kRegion = createHmac('sha256', kDate).update(region).digest();
  const kService = createHmac('sha256', kRegion).update(service).digest();
  return createHmac('sha256', kService).update('aws4_request').digest();
}

/** Every intermediate a SigV4 signature is built from, so a known-answer test can pin each stage
 * rather than only the last one — a mismatch in the final hex says nothing about where it began. */
export interface Sigv4Parts {
  readonly canonicalRequest: string;
  readonly stringToSign: string;
  readonly signature: string;
  readonly headers: Record<string, string>;
}

export function sigv4Parts(signer: Sigv4Signer, req: SigningRequest): Sigv4Parts {
  const url = new URL(req.url);
  const date = amzDate(req.now);
  const dateStamp = date.slice(0, 8);
  const payloadHash = sha256Hex(req.body ?? new Uint8Array());
  const added: Record<string, string> = { 'x-amz-date': date };
  if (signer.sessionToken !== null) added['x-amz-security-token'] = signer.sessionToken;
  // S3 refuses a request without it; every other service ignores it, so it is sent only there.
  if (signer.service === 's3') added['x-amz-content-sha256'] = payloadHash;
  const all: Record<string, string> = { ...withoutHost(req.headers), host: url.host, ...added };
  const signed = signedHeaderSet(all);
  const signedHeaders = signed.map(([n]) => n).join(';');
  const canonicalRequest = [
    req.method.toUpperCase(),
    canonicalUri(url, signer.service),
    canonicalQuery(url),
    signed.map(([n, v]) => `${n}:${v}\n`).join(''),
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${dateStamp}/${signer.region}/${signer.service}/aws4_request`;
  const stringToSign = [SIGV4_ALGORITHM, date, scope, sha256Hex(Buffer.from(canonicalRequest, 'utf8'))].join('\n');
  const signature = createHmac('sha256', sigv4SigningKey(signer.secretAccessKey, dateStamp, signer.region, signer.service)).update(stringToSign).digest('hex');
  return {
    canonicalRequest,
    stringToSign,
    signature,
    headers: { ...added, Authorization: `${SIGV4_ALGORITHM} Credential=${signer.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` },
  };
}

function signSigv4(signer: Sigv4Signer, req: SigningRequest): Record<string, string> {
  return sigv4Parts(signer, req).headers;
}

/** The transport sets `Host` from the URL; a hand-written one would be signed and then replaced. */
function withoutHost(headers: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() !== 'host') out[k] = v;
  return out;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// ---- the signing clock (`D1349`) -------------------------------------------------------------------

const wallAtClock = new WeakMap<Date, number>();

/** Records when, in wall time, a run clock was taken — `resolveRunClock` calls it once per run. */
export function markRunClock(runClock: Date): void {
  if (!wallAtClock.has(runClock)) wallAtClock.set(runClock, Date.now());
}

/** The instant a signature carries: the run clock (so `--now` pins it) advanced by the time the run
 * has taken since. A fixed run clock would stamp a request twenty minutes into a sweep with the
 * sweep's first second, which a server's five-minute tolerance refuses as a replay. */
export function signingNow(runClock: Date): Date {
  const wall = wallAtClock.get(runClock);
  return new Date(runClock.getTime() + (wall === undefined ? 0 : Date.now() - wall));
}
