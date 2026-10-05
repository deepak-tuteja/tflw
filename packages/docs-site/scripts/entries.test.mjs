// `M270` — the reference pages drawn as entries (`src/lib/entries.mjs`): Diagnostics by stage with a
// heading per code, CLI flags under a synopsis, Matchers and Generators one entry each.
//
// These render the real pages through the same unified pipeline Astro runs, so what is asserted is
// what the site draws from the live manifests, not a fixture of them. Each rule that refuses
// something is run against an input that has the thing it refuses, so none of them can be vacuous.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import { CLI_FLAGS, DIAGNOSTICS, GENERATORS, MATCHERS } from '@tflw/lang';
import { flagName, probeFile, says, splitMeaning, STAGES, synopsis, wrapSynopsis } from '../src/lib/entries.mjs';
import { rehypeTflwLinks, remarkTflwPages } from '../src/lib/markdown.mjs';

const processor = await createMarkdownProcessor({
  remarkPlugins: [remarkTflwPages],
  rehypePlugins: [rehypeTflwLinks],
  smartypants: false,
  syntaxHighlight: false,
});
const page = async (name) => {
  const url = new URL(`../src/content/docs/reference/${name}.md`, import.meta.url);
  // Astro strips the frontmatter before the page reaches these plugins; so does this.
  const body = readFileSync(url, 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '');
  return (await processor.render(body, { fileURL: pathToFileURL(fileURLToPath(url)) })).code;
};

// ---- diagnostics ---------------------------------------------------------------------------------

test('every diagnostic code has a heading of its own, with the id tf0xx, in exactly one stage', async () => {
  const html = await page('diagnostics');
  const stages = [...html.matchAll(/<h2 id="([a-z]+)">/g)].map((m) => ({ id: m[1], at: m.index }));
  assert.deepEqual(stages.map((s) => s.id), ['lexer', 'parser', 'checker', 'config', 'load', 'runtime']);
  for (const d of DIAGNOSTICS) {
    const id = d.code.toLowerCase();
    const at = html.search(new RegExp(`<h3 id="${id}" class="tflw-entry"><code>${d.code}</code> — `));
    assert.ok(at > 0, `${d.code} has no entry heading`);
    assert.equal(html.split(`id="${id}"`).length - 1, 1, `${d.code}: one heading, not several`);
    const stage = stages.findLast((s) => s.at < at);
    assert.equal(stage.id, splitMeaning(d.code, d.meaning).stage.toLowerCase(), `${d.code} sits under the stage its meaning names`);
  }
  assert.equal((html.match(/<h3 /g) ?? []).length, DIAGNOSTICS.length, 'no heading that is not a code');
});

test('a meaning that opens with a stage the map does not know fails the build, not a default', () => {
  assert.throws(() => splitMeaning('TF999', 'Linker: something new.'), /TF999: the meaning opens with a stage the diagnostics page does not map/);
  assert.throws(() => splitMeaning('TF999', 'no stage at all'), /does not map/);
  // And the map covers what the manifest says today, so the refusal above is the only way to fail.
  for (const d of DIAGNOSTICS) assert.ok(STAGES[/^([^:]+?):/.exec(d.meaning)?.[1]], `${d.code}`);
});

test("a code's heading is its meaning's lead: the bold sentence where there is one, else its first clause", () => {
  // `D-M270-3`, amended in the build: the plan named `probes[0].says` as the heading, and 11 of 87 of
  // those are "did you mean …?", which is an instance and not a definition. A rail of them does not
  // index anything.
  assert.deepEqual(splitMeaning('TF001', 'Lexer: a character that cannot begin any token. Also reported for x.'), {
    prefix: 'Lexer',
    stage: 'Lexer',
    lead: 'a character that cannot begin any token',
    rest: 'Also reported for x.',
  });
  assert.equal(splitMeaning('TF084', 'Checker: **a `skip` whose reason is blank.** The reason is the record.').lead, 'a `skip` whose reason is blank');
  // Cut mid-sentence, the clause does not read alone, so the entry's text keeps the whole meaning.
  const clause = splitMeaning('TF010', 'Parser: a token appeared — the catch-all.');
  assert.equal(clause.lead, 'a token appeared');
  assert.equal(clause.rest, 'a token appeared — the catch-all.');
  for (const d of DIAGNOSTICS) assert.doesNotMatch(splitMeaning(d.code, d.meaning).lead, /^\s*$/, `${d.code} has an empty lead`);
});

test('a probe is shown as the file the probe test checks', () => {
  // `diagnosticExamples.test.ts`'s `runProbe` wraps a `step` probe in `test "example"`, indented two
  // spaces; a snippet shown any other way would not be the input that produces the message beside it.
  assert.equal(probeFile({ wrap: 'step', source: ['api GET', 'log "x"'] }), 'test "example"\n  api GET\n  log "x"');
  assert.equal(probeFile({ wrap: 'file', source: ['before file'] }), 'before file');
  assert.equal(probeFile({ wrap: 'config', source: ['defaults', '  x 1'] }), 'defaults\n  x 1');
  const runProbe = readFileSync(new URL('../../lang/test/diagnosticExamples.test.ts', import.meta.url), 'utf8');
  assert.match(runProbe, /`test "example"\\n\$\{probe\.source\.map\(\(line\) => `  \$\{line\}`\)\.join\('\\n'\)\}\\n`/, 'runProbe no longer wraps a step the way this page shows it');
});

test('what tflw says is printed literally, and a message the manifest cut mid-span ends in …', () => {
  assert.equal(says('did you mean `expect`?'), 'did you mean `expect`?');
  assert.equal(says('only applies alongside `matches snapshot'), 'only applies alongside `matches snapshot…');
  assert.equal(says('a <b> & c'), 'a &lt;b&gt; &amp; c');
});

test('every probe is on the page, with what it says, and a code with no probe shows its example', async () => {
  const html = await page('diagnostics');
  const probes = DIAGNOSTICS.flatMap((d) => d.probes ?? []);
  assert.equal((html.match(/<pre><code class="language-(?:tflw|tflw-config)"/g) ?? []).length, probes.length);
  assert.equal((html.match(/class="tflw-says"/g) ?? []).length, probes.filter((p) => p.says).length);
  const bare = DIAGNOSTICS.filter((d) => !d.probes?.length);
  assert.ok(bare.length > 0, 'every code has a probe now; this case has nothing to check');
  assert.equal((html.match(/class="tflw-example"/g) ?? []).length, bare.length);
});

// ---- CLI flags -----------------------------------------------------------------------------------

test('a synopsis names every flag of its section, written or generated', async () => {
  const html = await page('cli');
  const blocks = [...html.matchAll(/<pre><code class="language-text">([\s\S]*?)<\/code><\/pre>/g)].map((m) =>
    m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' '),
  );
  const commands = [...new Set(CLI_FLAGS.map((f) => f.command))].filter((c) => c !== 'global');
  assert.equal(blocks.length, commands.length, 'one synopsis per subcommand with flags');
  for (const command of commands) {
    const block = blocks.find((b) => b.startsWith(`tflw ${command}`));
    assert.ok(block, `no synopsis for tflw ${command}`);
    for (const f of CLI_FLAGS.filter((x) => x.command === command)) assert.ok(block.includes(flagName(f.flag)), `tflw ${command}: ${flagName(f.flag)} missing from ${block}`);
  }
});

test('a written synopsis wins, and one missing a flag fails the build', () => {
  const rows = [{ flag: '`--env <name>`' }, { flag: '`--all-envs`' }];
  assert.equal(synopsis(rows, { written: 'tflw doctor [--env <name> | --all-envs]', command: 'tflw doctor' }), 'tflw doctor [--env <name> | --all-envs]');
  assert.throws(() => synopsis(rows, { written: 'tflw doctor [--env <name>]', command: 'tflw doctor' }), /does not name --all-envs/);
  // A flag whose name is a prefix of another's is not satisfied by the longer one.
  assert.throws(() => synopsis([{ flag: '`--baseline <file>`' }], { written: 'tflw run [--baseline-write <file>]', command: 'tflw run' }), /does not name --baseline/);
  assert.equal(synopsis(rows, { command: 'tflw x' }), 'tflw x [--env <name>] [--all-envs]');
});

test('a long synopsis wraps between brackets, never inside one', () => {
  const text = wrapSynopsis('tflw run [--tag <name>[,<name>...]] [--only <name>] [--kind <kind>[,<kind>...]]', 40);
  assert.deepEqual(text.split('\n'), ['tflw run [--tag <name>[,<name>...]]', '  [--only <name>]', '  [--kind <kind>[,<kind>...]]']);
});

test('every flag is a definition, in the order the manifest lists it', async () => {
  const html = await page('cli');
  const dts = [...html.matchAll(/<dt>([\s\S]*?)<\/dt>/g)].map((m) => m[1]);
  assert.equal(dts.length, CLI_FLAGS.length);
  assert.doesNotMatch(html, /<table/);
});

// ---- matchers and generators ---------------------------------------------------------------------

test('a matcher is an entry: its name, what it applies to, its example', async () => {
  const html = await page('matchers');
  for (const m of MATCHERS) assert.match(html, new RegExp(`<h3 id="${m.id}" class="tflw-entry">`), m.id);
  assert.equal((html.match(/<p class="tflw-tags">/g) ?? []).length, MATCHERS.length);
  // A planned badge only on what is not shipped; today every matcher is.
  assert.equal((html.match(/tflw-badge/g) ?? []).length, MATCHERS.filter((m) => m.status !== 'shipped').length);
});

test('generators are grouped by family, each family once', async () => {
  const html = await page('generators');
  const families = [...new Set(GENERATORS.map((g) => g.family))];
  assert.deepEqual([...html.matchAll(/<h2 id="([a-z]+)">/g)].map((m) => m[1]), families);
  for (const g of GENERATORS) assert.match(html, new RegExp(`<h3 id="${g.id}" class="tflw-entry">`), g.id);
});

test('nothing on the four pages leaks markdown into the page (`D-M270-7`)', async () => {
  for (const name of ['diagnostics', 'cli', 'matchers', 'generators']) {
    const text = (await page(name)).replace(/<(pre|code|samp)[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, '');
    assert.doesNotMatch(text, /\*\*/, `${name}: a raw **`);
  }
});
