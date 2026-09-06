// typecheck-corpus.test.mjs — `M173e`. Every workspace that ships TypeScript tests must typecheck
// them, and its own `typecheck` script must be what does it.
//
// `M155-01` was open because five of seven workspaces carried `"include": ["src/**/*.ts"]` and no
// test tsconfig, so every type-level guarantee in this repository was enforced over `src` only. The
// repair is six `tsconfig.test.json` files and six `typecheck` scripts that name them. Neither half
// is worth anything alone, which is the whole reason this file exists rather than a comment:
//
//   · a `tsconfig.test.json` no script names is `M167`'s shape exactly — a config that exists,
//     reads correctly, and guards nothing, and which nobody notices because it never runs;
//   · a `typecheck` script naming a config whose `include` stops at `src/**/*.ts` is `M141`'s —
//     an instrument that runs, passes, and was never pointed at the corpus it is credited with.
//
// So the claim graded here is the conjunction: the script names a config, and that config's
// `include` reaches `test/`. It is checked structurally rather than by running `tsc`, because the
// failure this guards against is a *wiring* change — a new package, a moved config, an `include`
// narrowed during a refactor — and those are visible in the manifests. Running `tsc` would be
// slower, would grade the code rather than the wiring, and is what `npm run typecheck` is for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PACKAGES = path.join(ROOT, 'packages');

/** tsconfig files are JSONC. Only line comments and trailing commas appear in this repository's,
 *  and a full parser would be a dependency; a mis-strip fails loudly at `JSON.parse` rather than
 *  silently, which is the direction that matters here. */
function readTsconfig(file) {
  const raw = readFileSync(file, 'utf8')
    .split('\n')
    .map((ln) => ln.replace(/(^|\s)\/\/.*$/, ''))
    .join('\n')
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(raw);
}

/** The `-p <path>` arguments a `typecheck` script names, in order. */
export function configsNamedBy(script) {
  return [...script.matchAll(/-p\s+(\S+)/g)].map((m) => m[1]);
}

/** Does an `include` list reach a workspace's `test/` directory? Deliberately narrow: it answers
 *  yes for `test/**\/*.ts` and for a whole-package glob, and no for `src/**\/*.ts`. A pattern this
 *  does not recognise is a **failure**, not a pass — an unfamiliar spelling is exactly when a human
 *  should look, and the alternative default silently certifies whatever it cannot read. */
export function includeReachesTests(include) {
  if (!Array.isArray(include)) return false;
  return include.some((p) => typeof p === 'string' && (p.startsWith('test/') || p === '**/*.ts' || p === '.'));
}

/**
 * The whole rule, over a description rather than over the disk, so the two negative controls below
 * can state a failing shape without a fixture tree.
 *
 * `{ name, hasTestTs, typecheck, configs: { '<path>': { include } } }` -> `null` when it conforms,
 * a sentence when it does not.
 */
export function whyNotCovered(w) {
  if (!w.hasTestTs) return null;
  if (!w.typecheck) return `${w.name} ships TypeScript tests and has no \`typecheck\` script at all`;
  const named = configsNamedBy(w.typecheck);
  if (named.length === 0) return `${w.name}'s \`typecheck\` script names no tsconfig with \`-p\``;
  const reaching = named.filter((c) => includeReachesTests(w.configs[c]?.include));
  if (reaching.length === 0) {
    return `${w.name}'s \`typecheck\` runs ${named.join(', ')} — none of those includes \`test/\`, so the tests are unchecked`;
  }
  return null;
}

/** Every workspace under `packages/`, described from its own manifest and configs. */
function readWorkspaces() {
  return readdirSync(PACKAGES, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(PACKAGES, d.name, 'package.json')))
    .map((d) => {
      const dir = path.join(PACKAGES, d.name);
      const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
      const typecheck = pkg.scripts?.typecheck ?? null;
      const configs = {};
      for (const c of typecheck ? configsNamedBy(typecheck) : []) {
        const f = path.join(dir, c);
        if (existsSync(f)) configs[c] = readTsconfig(f);
      }
      return { name: pkg.name ?? d.name, dir, hasTestTs: hasTypeScriptTests(path.join(dir, 'test')), typecheck, configs };
    });
}

function hasTypeScriptTests(dir) {
  if (!existsSync(dir)) return false;
  const stack = [dir];
  while (stack.length > 0) {
    for (const e of readdirSync(stack.pop(), { withFileTypes: true })) {
      if (e.name === 'node_modules') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.name.endsWith('.ts')) return true;
    }
  }
  return false;
}

test('`M155-01`: every workspace shipping TypeScript tests typechecks them, and its own `typecheck` script is what does it', () => {
  const failures = readWorkspaces().map(whyNotCovered).filter((r) => r !== null);
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('the corpus this reads is not empty, and carries the workspace `M173` was about (`D880`)', () => {
  // A guard that goes quiet when the thing it guards is absent is the failure mode, not the skip:
  // `readdirSync` against a moved `packages/` returns nothing, every `map` above returns nothing,
  // and the assertion just above passes on an empty list. So the corpus is asserted directly.
  const ws = readWorkspaces();
  const withTests = ws.filter((w) => w.hasTestTs).map((w) => w.name).sort();
  assert.ok(ws.length >= 6, `expected the seven workspaces, found ${ws.length}`);
  assert.ok(
    withTests.includes('@tflw/runtime'),
    `@tflw/runtime is the workspace this milestone turned on and must be in the checked set, got ${withTests.join(', ')}`,
  );
  assert.ok(withTests.length >= 5, `expected at least five workspaces shipping TypeScript tests, got ${withTests.join(', ')}`);
});

test('a workspace with TypeScript tests and no `typecheck` script is a failure, not a skip', () => {
  const r = whyNotCovered({ name: '@tflw/new', hasTestTs: true, typecheck: null, configs: {} });
  assert.match(r ?? '', /no `typecheck` script at all/);
  // And the same workspace without tests is silent, which is what keeps this from being a rule
  // about having tests.
  assert.equal(whyNotCovered({ name: '@tflw/new', hasTestTs: false, typecheck: null, configs: {} }), null);
});

test("`M167`'s shape: a `typecheck` that runs only the `src` config fails even though a test config exists on disk", () => {
  // The case the milestone is actually guarding. Both halves are present — there IS a
  // `tsconfig.test.json` and it DOES include `test/` — and the script never names it, so nothing
  // reads it. A rule written over the configs alone would call this conforming.
  const w = {
    name: '@tflw/runtime',
    hasTestTs: true,
    typecheck: 'tsc -p tsconfig.json --noEmit',
    configs: {
      'tsconfig.json': { include: ['src/**/*.ts'] },
      'tsconfig.test.json': { include: ['src/**/*.ts', 'test/**/*.ts'] },
    },
  };
  assert.match(whyNotCovered(w) ?? '', /the tests are unchecked/);
  // Naming it is the whole repair — same configs, one more `-p`.
  assert.equal(whyNotCovered({ ...w, typecheck: 'tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json --noEmit' }), null);
});
