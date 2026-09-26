#!/usr/bin/env node
// `M240` `D` (`D1313`, `D1314`) — product text carries the reason or a docs link, never the
// record's identifier; and the page speaks the reader's words, not the builder's.
//
// A reader who meets `(SPEC §9.8)` or `(D285)` in an error has been handed a pointer into a
// document they cannot open — the ledger and the plans are not published, and `SPEC.md` is a
// build-side file. The rule is that a string a reader can see says *why*, and where they need the
// long form it ends in a docs-site URL. Comments and `DECISIONS.md` are the builder's and are
// untouched.
//
// **By AST, not grep**, so a template literal and JSX text count and a comment does not: the
// string literals, template pieces and JSX text of `packages/runtime/src` and `packages/ui/src`.
// Two things that are strings but never text are skipped — an import specifier and a property or
// attribute *name* (`'data-stmt-lens'` names an attribute; nobody reads it).
//
// `behind`, `construct` and `lens` are the page's vocabulary (`D1314`), so they are judged in
// `packages/ui/src` only: in the runtime *behind a load balancer* is English, not jargon.
//
// Every docs URL a string carries must name a page the docs site has, or the pointer that replaced
// `§9.8` is as dead as `§9.8` was.
//
// The allow-list (`scripts/no-internal-refs-allow.json`) is for identifiers that are data — an SVG
// path's `M20,25.9` is a moveto — and each entry carries its reason.

import ts from 'typescript';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DOCS = 'https://deepak-tuteja.github.io/tflw/';

export const EVERYWHERE = [
  ['a milestone id', /\bM\d{2,3}[a-z]?(-\d+)?\b/],
  ['a decision id', /\bD\d{1,4}\b/],
  ['a SPEC section', /§/],
  ['SPEC.md', /SPEC\.md/],
];
export const PAGE_ONLY = [
  ['`behind` (say *here* or *at a door*)', /\bbehind\b/],
  ['`construct` (say *statement*)', /\bconstructs?\b/],
  ['`lens` (say *door*)', /\blens\b/],
];

const walk = (dir, out = []) => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(n) && !n.endsWith('.d.ts')) out.push(p);
  }
  return out;
};

/** Is this literal a name rather than text — a property key, an attribute name, a module path? */
const isName = (n) => {
  const p = n.parent;
  if (p === undefined) return false;
  if ((ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p)) && p.name === n) return true;
  if (ts.isElementAccessExpression(p) && p.argumentExpression === n) return true;
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isExternalModuleReference(p)) return true;
  if (ts.isCallExpression(p) && p.expression.kind === ts.SyntaxKind.ImportKeyword) return true;
  if (ts.isLiteralTypeNode(p)) return true;
  return false;
};

/** Every piece of text a reader could see, with where it is. */
export function textsOf(file, source) {
  const src = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out = [];
  const visit = (n) => {
    let text = null;
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && !isName(n)) text = n.text;
    else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) text = n.text;
    else if (ts.isJsxText(n)) text = n.text;
    if (text !== null && text.trim() !== '') out.push({ line: src.getLineAndCharacterOfPosition(n.getStart()).line + 1, text });
    ts.forEachChild(n, visit);
  };
  visit(src);
  return out;
}

export function findings({ root = ROOT, allow = [] } = {}) {
  const out = [];
  const docsPages = new Set();
  const trees = [['packages/runtime/src', false], ['packages/ui/src', true]];
  for (const [tree, page] of trees) {
    for (const file of walk(join(root, tree))) {
      const rel = relative(root, file);
      for (const { line, text } of textsOf(file, readFileSync(file, 'utf8'))) {
        for (const [what, re] of page ? [...EVERYWHERE, ...PAGE_ONLY] : EVERYWHERE) {
          const m = re.exec(text);
          if (m === null) continue;
          if (allow.some((a) => a.file === rel && new RegExp(a.match).test(m[0]))) continue;
          out.push(`${rel}:${line}: ${what} — “${m[0]}” in “${text.replace(/\s+/g, ' ').trim().slice(0, 100)}”`);
        }
        for (const m of text.matchAll(/https:\/\/deepak-tuteja\.github\.io\/tflw\/([a-z0-9/-]*)/g)) {
          const pagePath = m[1].replace(/\/$/, '');
          docsPages.add(pagePath);
          const exists = pagePath === '' || existsSync(join(root, 'packages/docs-site', `${pagePath}.md`)) || existsSync(join(root, 'packages/docs-site', pagePath, 'index.md'));
          if (!exists) out.push(`${rel}:${line}: a docs link to a page the site does not have — ${DOCS}${pagePath}`);
        }
      }
    }
  }
  return { findings: out, docsPages: [...docsPages].sort() };
}

/** The controls (`D922`): one tree, four defects the gate must name and three look-alikes it must
 *  not — an import path, an attribute name and a comment carrying the same words. */
export function selfTest() {
  const root = mkdtempSync(join(tmpdir(), 'no-internal-refs-'));
  try {
    const put = (rel, text) => { mkdirSync(join(root, rel, '..'), { recursive: true }); writeFileSync(join(root, rel), text); };
    put('packages/docs-site/guide/config.md', '# config\n');
    put('packages/runtime/src/a.ts', [
      "import x from './D12';",
      "// a comment may say D285 and SPEC §9.8",
      "export const ok = 'set it in tflw.config (https://deepak-tuteja.github.io/tflw/guide/config)';",
      "export const lb = 'unless it sits behind a load balancer';",
      "export const bad1 = `a refusal (D1)`;",
      "export const bad2 = 'see https://deepak-tuteja.github.io/tflw/guide/nowhere';",
      '',
    ].join('\n'));
    put('packages/ui/src/b.tsx', [
      "export const B = () => <p data-x={{ 'data-stmt-lens': 1 }}>3 behind API (SPEC §3.3)</p>;",
      '',
    ].join('\n'));
    const got = findings({ root }).findings.map((f) => f.replace(/:.*?: /, ': ').split(' — ')[0]).sort();
    const want = [
      'packages/runtime/src/a.ts: a decision id',
      'packages/runtime/src/a.ts: a docs link to a page the site does not have',
      'packages/ui/src/b.tsx: `behind` (say *here* or *at a door*)',
      'packages/ui/src/b.tsx: a SPEC section',
    ].sort();
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      console.error(`verify:no-internal-refs --self-test: expected\n  ${want.join('\n  ')}\ngot\n  ${got.join('\n  ')}`);
      return false;
    }
    console.log(`verify:no-internal-refs --self-test: ${want.length} defects named, the import, the attribute name, the comment and "behind a load balancer" left alone.`);
    return true;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--self-test')) {
  process.exit(selfTest() ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url) && !process.argv.includes('--self-test')) {
  const allowFile = join(ROOT, 'scripts/no-internal-refs-allow.json');
  const allow = existsSync(allowFile) ? JSON.parse(readFileSync(allowFile, 'utf8')).allow : [];
  for (const a of allow) {
    if (typeof a.reason !== 'string' || a.reason.trim() === '') {
      console.error(`verify:no-internal-refs: allow-list entry for ${a.file} carries no reason`);
      process.exit(1);
    }
  }
  const { findings: bad, docsPages } = findings({ allow });
  if (bad.length > 0) {
    console.error(`verify:no-internal-refs: ${bad.length} string(s) a reader can see carry the builder's words:\n`);
    for (const b of bad) console.error(`  ${b}`);
    console.error(`\nSay why, or end the string in a ${DOCS} page (D1313); on the page, *here* / *at a door* / *statement* (D1314).`);
    process.exit(1);
  }
  console.log(`verify:no-internal-refs: clean — ${docsPages.length} docs page(s) linked, every one on the site.`);
}
