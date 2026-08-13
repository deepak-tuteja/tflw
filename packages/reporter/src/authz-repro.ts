// D332 — a runnable `.tflw` per authorization finding, under `report/authz-repro/`.
//
// D22's framing, and the reason this is an emitter rather than an evidence file: the point of the
// design is *a finding you re-run*, not a mystery flag with better formatting. An evidence dump can
// never be wrong, which is exactly what makes it worth less than a file that goes red until the bug
// is fixed and green afterwards.
//
// ## Two templates, because one would emit a regression that fails after the fix
//
// D314's sketch asserts `expect status equals 403`. That is right for an object leak and **wrong for
// a collection leak**, where the correct behaviour is a *filtered* `200` — so a single template
// hands whoever fixes the bug an artifact that goes red the moment they succeed. The collection
// template is instead, line for line, `authz.tflw`'s fourth hand-written test: the generator and the
// hand-written control converge on the same *spelling*, not merely on the same verdict, which is
// what makes D319's agreement invariant a stronger instrument than it would otherwise be.
//
// ## What a repro may contain
//
// Method, path, principal and the leaked id — and never a body. An id is an identifier; a body is
// contents. `PLAN_REPORTS_PERF_SECURITY.md` R10's prove-without-reproducing rule is satisfied by
// exactly that split, and the redaction the run already applied travels with the finding rather than
// being re-derived here.

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { AuthzFinding } from '@tflw/runtime';

/** The directory name, relative to the report dir. */
export const AUTHZ_REPRO_DIR = 'authz-repro';

/** Path-and-query, or the whole URL if it will not parse — a repro that named an unparseable
 *  address is still more useful than one that silently named nothing. */
function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

/**
 * A deterministic file name from rule + method + path + principal, so two identical findings collide
 * into one identical file instead of racing to write different ones. Nothing here is a hash: the
 * name is meant to be read in a directory listing and recognised.
 */
export function reproFileName(f: AuthzFinding): string {
  const slug = (s: string): string => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'x';
  const rule = f.rule.replace(/^sec\/authz-/, '');
  return `${slug(rule)}--${slug(f.method)}--${slug(pathOf(f.url))}--${slug(f.principal)}.tflw`;
}

/**
 * The `.tflw` source for one finding.
 *
 * The `id` written into the assertion is the **owner's** resource id, which is what the probe was
 * not supposed to be able to reach — so the repro reads as the sentence the finding makes, rather
 * than as a transcript of the request that made it.
 */
export function renderAuthzRepro(f: AuthzFinding): string {
  const path = pathOf(f.url);
  const owners = f.owners.join(', ');
  const id = f.ids[0] ?? '';
  const header =
    `# emitted by tflw M130 — ${f.rule}\n` +
    `# ${f.method} ${path} served ${owners ? `\`${owners}\`'s` : 'the owner\'s'} resource to \`${f.principal}\`\n`;

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
 * Write one file per finding under `<reportDir>/authz-repro/`. No findings writes no directory at
 * all, so an ordinary run's report dir is unchanged.
 *
 * Called **after** the whole run rather than at the assertion (D332): `--workers N` and forked
 * shards run files concurrently, and a mid-step writer would let two of them interleave a partial
 * file. Returns the paths written, in stable name order.
 */
export async function writeAuthzRepros(findings: readonly AuthzFinding[], reportDir: string): Promise<string[]> {
  if (findings.length === 0) return [];
  const byName = new Map<string, AuthzFinding>();
  for (const f of findings) byName.set(reproFileName(f), f);
  const outDir = join(resolve(reportDir), AUTHZ_REPRO_DIR);
  await mkdir(outDir, { recursive: true });
  const written: string[] = [];
  for (const name of [...byName.keys()].sort()) {
    const path = join(outDir, name);
    await writeFile(path, renderAuthzRepro(byName.get(name)!), 'utf8');
    written.push(path);
  }
  return written;
}
