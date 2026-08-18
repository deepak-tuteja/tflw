// D332 — a runnable `.tflw` per finding, under `report/authz-repro/` and `report/input-repro/`.
//
// D22's framing, and the reason this is an emitter rather than an evidence file: the point of the
// design is *a finding you re-run*, not a mystery flag with better formatting. An evidence dump can
// never be wrong, which is exactly what makes it worth less than a file that goes red until the bug
// is fixed and green afterwards.
//
// **Named `authz-repro.ts` until M137d (D474)**, when Tier 3 grew repros of its own. One sink carrying
// a discriminated union, not a second sink: `D418a` moved `decline` out of the authorization sink
// because "a second copy of a channel is how one report comes to describe the same blind spot in two
// vocabularies", and a second repro emitter would be that mistake one milestone later.
//
// ## The assertion cannot be the matcher that found the finding
//
// This is `D471` and it is the whole shape of the input-handling half. Tier 2's templates assert
// concrete behaviour — `expect status equals 403` — and that reads like a stylistic choice until you
// try to generalise it. It is not: Tier 2's oracle compares two *principals*, and a single re-issued
// request cannot restate a comparison between two identities, so a concrete assertion was the only
// thing available.
//
// Tier 3 looks easier. Re-send the mutated request, re-assert `expect response has no input handling
// violations`, done. That file **passes against an unfixed application**. Every Tier 3 rule is
// differential against the observed request and both detector-backed rules subtract the control by
// label (`inputRules.ts:269`, `:351`); in a repro the mutated request *is* the observed request, so the
// disclosure appears in the control and is subtracted from itself. A repro that goes green on a live
// vulnerability is the artifact a maintainer closes the ticket with. So each rule gets a template that
// names its own leak (`D472`), and `DETECTOR_PATTERNS` exists to make that possible.
//
// ## What a repro may contain
//
// Authorization: method, path, principal and the leaked id — and never a body. An id is an identifier;
// a body is contents. `PLAN_REPORTS_PERF_SECURITY.md` R10's prove-without-reproducing rule is
// satisfied by exactly that split, and the redaction the run already applied travels with the finding
// rather than being re-derived here.
//
// Input handling: **R10 holds by construction here, not by care.** Every literal an input repro emits
// is either a payload tflw sent or a pattern tflw looks for — never a byte the application produced.
// The finding's `detail` carries an excerpt of the evidence; the repro deliberately does not, because
// its job is to *provoke* the leak again rather than to quote it. A body-site repro does carry a body,
// and that is the **request's** body (`D475`) — a repro that omitted it would dial a different
// endpoint than the finding describes — redacted exactly as the run already redacted it.
//
// ## Two properties of the language the templates depend on
//
// Both verified against a real `tflw check` rather than reasoned about, because both fail by emitting
// a file nobody can run:
//
//   * **A `{`-bearing payload is safe inside a tflw string.** `StringLit.parts` is built from the
//     escape-*decoded* text, so `\u{7B}` would not help — but `parseStringParts` only forms an
//     interpolation when the braces enclose something `parseRefText` accepts, and neither `{7*7` nor
//     `7*7` is. So `injection/template-expression` (`{{7*7}}`) emits as literal text. The residual
//     edge is recorded at `tflwString` below.
//   * **A regex needs its backslashes doubled.** `TF047` makes an escape outside `\" \\ \n \r \t`
//     an *error* rather than a preserved backslash, so an emitted `\s` would not merely mean the wrong
//     thing, it would refuse to parse.

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DETECTOR_PATTERNS, type AuthzFinding, type InputHandlingFinding, type ReproSubject } from '@tflw/runtime';

/** The directory names, relative to the report dir.
 *
 *  **Two directories, and not a rename to a shared `report/repro/`** (`D473`). `authz-repro/` has been
 *  published since `M130b` and `sarif.ts`'s standing argument holds: moving it breaks any consumer that
 *  globbed it, in exchange for nothing a reader can perceive. Nor one directory holding both — the name
 *  would be false about most of its own contents the first time a suite runs an input scan. */
export const AUTHZ_REPRO_DIR = 'authz-repro';
export const INPUT_REPRO_DIR = 'input-repro';

/** Which directory a subject's repro belongs in. Exhaustive over the union, so a third scan learning to
 *  emit repros is a `tsc` failure here rather than a file written to the wrong place. */
export function reproDirFor(kind: ReproSubject['kind']): string {
  switch (kind) {
    case 'authorization':
      return AUTHZ_REPRO_DIR;
    case 'input-handling':
      return INPUT_REPRO_DIR;
    default: {
      const never: never = kind;
      throw new Error(`no repro directory for ${String(never)}`);
    }
  }
}

/**
 * **The path is computed by the runtime, not here** (`D478`), and this function only exists to say so.
 *
 * It used to be `new URL(url).pathname + search`, which is wrong in a way nothing could see: an env whose
 * `api` is `https://host/v1` makes `api POST /vuln/notes` into `https://host/v1/vuln/notes`, so emitting
 * that pathname produces `api POST /v1/vuln/notes` — resolved against the base a *second* time, 404, no
 * leak in the body, and a repro that PASSES against the application it came from. Latent since `M130b`
 * for every authorization repro in any project with a base-URL path prefix.
 *
 * Only the interpreter knows the env's base URL, so `reproPathFor` inverts the one line that built the
 * URL and both arms carry the answer as `path`. What is left here is the fallback for a subject that
 * somehow carries none, and it deliberately prefers the whole URL over a *plausible* wrong path: an
 * absolute address in a repro fails loudly on `allow hosts` (`TF057`/`TF058`), where a doubled prefix
 * fails by passing.
 */
function pathFor(f: ReproSubject): string {
  return f.path || f.url;
}

/**
 * The exact command that re-runs this file (`D479`).
 *
 * **A repro is base-relative, so the env decides which application it reaches.** Nothing in the language
 * lets a file pin its own env, and the default is whichever env is marked `default` — so a repro handed to
 * somebody who runs it plainly can silently exercise a different target. It goes *green*, which is the one
 * outcome this milestone treats as unacceptable.
 *
 * Sharper for input handling than for authorization: a payload class needs an opt-in declared per target,
 * so a traversal repro run under an env that withholds `probe traversal` reaches a route that reads no
 * files and passes. That is not hypothetical — it is what happened while verifying this milestone, and it
 * looked exactly like a working fix.
 */
function rerunLine(f: ReproSubject): string {
  return `# re-run: tflw run --env ${f.env} ${reproDirFor(f.kind)}/${reproFileName(f)}\n`;
}

/**
 * `D437`'s provenance as a header line, or nothing when an author wrote the request.
 *
 * **The absent case is the common one and it stays silent deliberately.** A repro derived from a suite's
 * own `api` step needs no note saying so — the reader is holding the file that says it. Emitting
 * `# via: hand-written` on every repro would put a line on twelve files to make one file's line
 * findable, and the one that matters is the one that says tflw invented the request.
 *
 * Both arms get it, and that is not symmetry for its own sake: `D465` gates the crawl's own writes
 * behind `probe mutating`, so a crawl can issue mutating requests, and Tier 2 judges those. An
 * authorization finding on a synthesized `POST` is exactly the case where a reader most needs to know
 * the request was derived from a schema rather than observed.
 */
function viaLine(f: ReproSubject): string {
  if (f.via === undefined) return '';
  // The words are `openapi` and `traffic` — `D470`'s spelling, the same two a `.tflw` file writes after
  // `seed`. A reader who wants to re-derive this request greps their own suite for that word.
  return `# via: derived by a crawl from \`seed ${f.via}\` — tflw built this request, no test declared it\n`;
}

function slug(s: string): string {
  return s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'x';
}

/**
 * Escape a string so it survives tflw's lexer meaning exactly what it says.
 *
 * `TF047` closed the escape set to `\"`, `\\`, `\n`, `\r`, `\t` (plus `\u{…}`) and made anything else an
 * error, so this is the complete list and the backslash has to go first.
 *
 * **The one shape this cannot express is a literal `{ident}`.** Interpolation is parsed from the decoded
 * text and there is no `\{`, so a request body that genuinely contained `{id}` would emit a repro whose
 * `{id}` reads as an unbound variable. It fails **loudly** at `tflw check` rather than quietly at run
 * time, which is why it is documented here rather than worked around: a silent mis-emission would be
 * worth avoiding at some cost, and a loud one is not.
 */
function tflwString(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    // Any other C0 control character has no escape of its own; `\u{…}` is the only spelling, and an
    // unescaped one in a string literal is not something the lexer will accept. Safe as a whole range
    // because the three with their own spelling were replaced above and no longer occur.
    //
    // The range is written with `\u` escapes rather than as the characters themselves, and that is
    // not cosmetic: a literal C0 byte in a source file makes that file **binary** to git and to
    // grep — `M134`'s NUL trap — and this line cost one detour by being typed the other way first.
    // The symptom was `grep` matching nothing in a file that plainly contained the word.
    .replace(/[\u0000-\u001F]/g, (c) => `\\u{${c.codePointAt(0)!.toString(16).toUpperCase()}}`);
}

/**
 * A deterministic file name, so two identical findings collide into one identical file instead of
 * racing to write different ones. Nothing here is a hash: the name is meant to be read in a directory
 * listing and recognised.
 *
 * The trailing fields differ by arm because the two kinds are identified by different things — a
 * principal for authorization, a site (and the detector that fired there) for input handling. That is
 * the same split `D473` gives for the directories and the SARIF join key, kept in one place.
 */
export function reproFileName(f: ReproSubject): string {
  const path = slug(pathFor(f));
  if (f.kind === 'authorization') {
    return `${bound(`${slug(f.rule.replace(/^sec\/authz-/, ''))}--${slug(f.method)}--${path}--${slug(f.principal)}`)}.tflw`;
  }
  // `location` and `invariant` together, because `where` is what R8's fingerprint separates two
  // weaknesses on: one endpoint leaking a stack frame at one site and a SQL fragment at the same site
  // are two repairs and must not overwrite each other's file.
  const tail = f.invariant ? `--${slug(f.invariant)}` : '';
  return `${bound(`${slug(f.rule.replace(/^sec\//, ''))}--${slug(f.method)}--${path}--${slug(f.location)}${tail}`)}.tflw`;
}

/**
 * `NAME_MAX` is 255 bytes on every filesystem tflw targets; 195 leaves the `.tflw` suffix, a margin
 * for a field a later scan might add, and a name a terminal still prints on one line.
 *
 * **This exists because a repro's name embeds the request's own path, and a mutated path contains the
 * payload.** The reviewed corpus never tripped it — its one oversized value is 64 KiB, which Node
 * refuses with `431` before a handler sees it, so no finding and no file. The **seeded** layer
 * (`D369`) draws `256..32768` characters and targets `path`, `query` and `body` alike, so any draw
 * that is short enough for Node to pass on and long enough for the app to accept produced a filename
 * of a couple of thousand characters. `writeFile` then threw `ENAMETOOLONG` out of `writeRepros`,
 * which runs after the whole suite — so the run died having written **no `results.json` at all**, and
 * every result of a green suite was lost to a naming detail. Seed-dependent, therefore intermittent,
 * which is why it survived `M137d`'s CI and first appeared in a regression sweep five milestones on.
 *
 * The suffix is a hash and the rest of the name is not, which reads against this function's own rule
 * that "nothing here is a hash". The rule is about *recognising* a file in a listing, and a truncated
 * name still does that; what a bare truncation cannot do is stay **distinct**. Two seeded draws on one
 * endpoint differ only in the payload, i.e. only in the part being cut, so truncating alone would
 * silently collapse two findings into one file — trading a loud crash for a quiet loss, which is the
 * worse of the two failures.
 */
const STEM_MAX = 195;

function bound(stem: string): string {
  // `slug` emits `[a-z0-9-]` only, so character length is byte length and no multi-byte character can
  // be cut in half here.
  if (stem.length <= STEM_MAX) return stem;
  const digest = createHash('sha256').update(stem, 'utf8').digest('hex').slice(0, 8);
  return `${stem.slice(0, STEM_MAX - digest.length - 1)}-${digest}`;
}

/**
 * The `.tflw` source for one authorization finding.
 *
 * The `id` written into the assertion is the **owner's** resource id, which is what the probe was
 * not supposed to be able to reach — so the repro reads as the sentence the finding makes, rather
 * than as a transcript of the request that made it.
 *
 * ## Two templates, because one would emit a regression that fails after the fix
 *
 * D314's sketch asserts `expect status equals 403`. That is right for an object leak and **wrong for
 * a collection leak**, where the correct behaviour is a *filtered* `200` — so a single template
 * hands whoever fixes the bug an artifact that goes red the moment they succeed. The collection
 * template is instead, line for line, `authz.tflw`'s fourth hand-written test: the generator and the
 * hand-written control converge on the same *spelling*, not merely on the same verdict, which is
 * what makes D319's agreement invariant a stronger instrument than it would otherwise be.
 */
export function renderAuthzRepro(f: AuthzFinding): string {
  const path = pathFor(f);
  const owners = f.owners.join(', ');
  const id = f.ids[0] ?? '';
  const header =
    `# emitted by tflw M130 — ${f.rule}\n` +
    `# ${f.method} ${path} served ${owners ? `\`${owners}\`'s` : 'the owner\'s'} resource to \`${f.principal}\`\n` +
    viaLine(f) +
    rerunLine(f);

  if (f.rule.endsWith('collection-leak')) {
    // A filtered `200` is the correct answer here, so the assertion is about the *contents*, not the
    // status. Asserting `403` would go red against a correctly-fixed app.
    return (
      header +
      `test "${f.principal} must not see ${owners || 'another principal'}'s ${path}" as ${f.principal}\n` +
      `  api ${f.method} ${path}\n` +
      `  expect all body.id not equals "${id}"\n`
    );
  }
  return (
    header +
    `test "${f.principal} must not read ${owners || 'another principal'}'s ${path}" as ${f.principal}\n` +
    `  api ${f.method} ${path}\n` +
    `  expect status equals 403\n`
  );
}

/**
 * The assertion for one input-handling rule — `D472`'s table, and every arm is **green after the fix
 * and red before it**, which is the property `D471` shows the obvious template does not have.
 *
 * * `reflected-input-unescaped` → `not contains` the raw payload. The finding *is* "our bytes came back
 *   with the angle brackets intact", so the payload is the assertion.
 * * `error-detail-disclosure` and `path-traversal-read` → `not matches` the matched detector's own
 *   pattern. `invariant` carries the label and `DETECTOR_PATTERNS` turns it back into the rule.
 * * `oversized-input-accepted` → `status is greater than 399`. The rule fires **only** on a 2xx
 *   (`inputRules.ts:382`), because a `413` or a `400` is the application behaving correctly — so
 *   "refused it somehow" is exactly the repair, and asserting a *specific* status would pick a winner
 *   between `400` and `413` that the rule itself declines to pick.
 *
 * `body text` and not `body`, in every case: `BodySubject` throws on a response that is not JSON
 * (`interpreter.ts:4029`) and a disclosure very often arrives as an HTML error page, so the subject
 * that reads the body as a string is the only one that can assert about it at all.
 */
function inputAssertion(f: InputHandlingFinding): { readonly title: string; readonly assertion: string } | null {
  // The title is per-rule for the same reason the assertion is: it has to read as the sentence the
  // finding makes. A single "must not leak at <site>" was written first and is wrong on two of the four
  // — nothing *leaked* when a length bound was missing, and calling it a leak makes the one repro whose
  // finding is about absence read like the three that are about disclosure.
  switch (f.rule) {
    case 'sec/reflected-input-unescaped':
      return f.payloadText === undefined
        ? null
        : { title: `must escape what it echoes from ${f.location}`, assertion: `expect body text not contains "${tflwString(f.payloadText)}"` };
    case 'sec/error-detail-disclosure': {
      const pattern = f.invariant === undefined ? undefined : DETECTOR_PATTERNS[f.invariant];
      return pattern === undefined
        ? null
        : { title: `must not disclose ${f.invariant} for ${f.location}`, assertion: `expect body text not matches "${tflwString(pattern)}"` };
    }
    case 'sec/path-traversal-read': {
      const pattern = f.invariant === undefined ? undefined : DETECTOR_PATTERNS[f.invariant];
      return pattern === undefined
        ? null
        : { title: `must not read a file through ${f.location}`, assertion: `expect body text not matches "${tflwString(pattern)}"` };
    }
    case 'sec/oversized-input-accepted':
      return { title: `must bound the length of ${f.location}`, assertion: 'expect status is greater than 399' };
    default:
      // Deliberately not exhaustive over a `never`: `rule` is a plain string here, and a *fifth* input
      // rule should not stop the report being written. It returns null and `renderRepro` declines to
      // emit, which `writeRepros`' caller can see in the returned count.
      return null;
  }
}

/**
 * The `.tflw` source for one input-handling finding, or `null` when this rule has no template.
 *
 * The header comment carries the payload id and the site, because for an input finding those are what
 * make the request reproducible-by-reading; and it carries `via` when the request was **synthesized**
 * by a crawl, since for a request nobody wrote the repro is the only artifact that records what tflw
 * invented.
 */
export function renderInputRepro(f: InputHandlingFinding): string | null {
  const template = inputAssertion(f);
  if (template === null) return null;
  const path = pathFor(f);
  const as = f.principal ? ` as ${f.principal}` : '';
  const header =
    `# emitted by tflw M137d — ${f.rule}\n` +
    `# ${f.method} ${path} — ${f.location} carrying \`${f.payloadId}\`` +
    `${f.invariant ? ` returned ${f.invariant}` : ''}\n` +
    viaLine(f) +
    rerunLine(f);
  // `body text` + an explicit content type rather than an inline `body { … }` object: the mutated body
  // is already a JSON *string* (`applyMutation` re-stringifies it), and re-parsing it into tflw's own
  // object syntax would be a second encoder to get wrong. `body text` sets no content type of its own,
  // so the header line restores the one the observed request carried — and it is safe to state
  // unconditionally, because a body only exists here when `JSON.parse` of the observed body succeeded.
  const body =
    f.body === undefined
      ? `  api ${f.method} ${path}\n`
      : `  api ${f.method} ${path} body text "${tflwString(f.body)}"\n    header "content-type" is "application/json"\n`;
  // The whole test name goes through `tflwString`, not just the parts that look risky. `location`
  // embeds a **query-parameter name**, which is the application's data rather than the author's — a
  // parameter called `a"b` would otherwise close the string and emit a file nobody can parse.
  return header + `test "${tflwString(`${f.method} ${path} ${template.title}`)}"${as}\n` + body + `  ${template.assertion}\n`;
}

/** Dispatch on the discriminant. `null` means "this subject has no template", which only the input arm
 *  can currently answer. */
export function renderRepro(f: ReproSubject): string | null {
  switch (f.kind) {
    case 'authorization':
      return renderAuthzRepro(f);
    case 'input-handling':
      return renderInputRepro(f);
    default: {
      const never: never = f;
      throw new Error(`no repro template for ${JSON.stringify(never)}`);
    }
  }
}

/**
 * Write one file per finding under `<reportDir>/<authz-repro|input-repro>/`. No findings writes no
 * directory at all, so an ordinary run's report dir is unchanged — and a run that produced only
 * authorization findings still writes no `input-repro/`.
 *
 * Called **after** the whole run rather than at the assertion (D332): `--workers N` and forked
 * shards run files concurrently, and a mid-step writer would let two of them interleave a partial
 * file. Returns the paths written, in stable name order.
 */
export async function writeRepros(subjects: readonly ReproSubject[], reportDir: string): Promise<string[]> {
  if (subjects.length === 0) return [];
  // Keyed by directory *and* name: the two arms compute names from different fields, so nothing
  // guarantees they cannot collide, and a collision across directories is not a collision at all.
  const byPath = new Map<string, ReproSubject>();
  for (const f of subjects) byPath.set(join(reproDirFor(f.kind), reproFileName(f)), f);
  const written: string[] = [];
  const made = new Set<string>();
  for (const rel of [...byPath.keys()].sort()) {
    const subject = byPath.get(rel)!;
    const source = renderRepro(subject);
    // A rule with no template writes nothing rather than an empty file. `mkdir` is below this line on
    // purpose: a directory holding zero repros is a report claiming an artifact it does not have.
    if (source === null) continue;
    const dir = join(resolve(reportDir), reproDirFor(subject.kind));
    if (!made.has(dir)) {
      await mkdir(dir, { recursive: true });
      made.add(dir);
    }
    const path = join(resolve(reportDir), rel);
    await writeFile(path, source, 'utf8');
    written.push(path);
  }
  return written;
}
