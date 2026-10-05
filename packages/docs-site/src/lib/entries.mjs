// `M270` (`D-M270-3`, `D-M270-4`) — the reference pages as entries, not tables.
//
// The four reference pages declare their content as `v-for` tables over `spec-data.ts`, and that
// declaration stays: `gen-docs.mjs` reads it to print `tflw docs`, and a terminal table is a fine
// shape for a terminal. On the site, the same rows render as entries. Each is a heading the "On this
// page" rail can list and a link can land on, with its example as a highlighted `tflw` block that
// scrolls rather than breaking a step across three lines of a narrow cell.
//
// Each layout names the columns it draws. A page that declares a column its layout does not draw
// fails the build, so a column added to the terminal's table cannot silently go missing on the site.
//
// What is returned is mdast, not HTML: Astro collects the rail's headings and Expressive Code
// highlights fences from the tree, and both run before raw HTML is parsed. Raw HTML is used only for
// the leaves (tags, a paragraph from a manifest string, a definition list), through `inline()`, so
// the escaping rule is the one `mdCode.ts` documents.

import { inline } from './mdCode.ts';

const html = (value) => ({ type: 'html', value });

/** A manifest string's code spans without their fences — what a highlighted block shows. */
export const unfenced = (s) => s.replace(/``\s?([\s\S]+?)\s?``|`([^`]+)`/g, (_, doubled, single) => doubled ?? single);

/**
 * A manifest string as a heading's words: text and inline code, nothing else. A heading's words are
 * also the rail's, and the rail draws text; strong or emphasis there would be lost, so it is refused.
 */
export function phrasing(s) {
  const out = [];
  const re = /``\s?([\s\S]+?)\s?``|`([^`]+)`/g;
  let at = 0;
  for (let m; (m = re.exec(s)) !== null; at = re.lastIndex) {
    if (m.index > at) out.push({ type: 'text', value: s.slice(at, m.index) });
    out.push({ type: 'inlineCode', value: m[1] ?? m[2] });
  }
  if (at < s.length) out.push({ type: 'text', value: s.slice(at) });
  for (const n of out) if (n.type === 'text' && /\*|(^|\s)_\S/.test(n.value)) throw new Error(`a heading drawn from the manifest carries markdown the rail cannot show: ${s}`);
  return out;
}

const heading = (depth, words, id, className) => ({
  type: 'heading',
  depth,
  children: typeof words === 'string' ? phrasing(words) : words,
  data: { hProperties: { id, ...(className ? { className: [className] } : {}) } },
});

const tags = (items) => (items.length === 0 ? [] : [html(`<p class="tflw-tags">${items.join('')}</p>`)]);
const tag = (s) => `<span class="tflw-tag">${inline(s)}</span>`;
const badge = (s) => `<span class="tflw-tag tflw-badge">${s}</span>`;
const fence = (value, lang = 'tflw', meta = null) => ({ type: 'code', lang, meta, value });

// ---- matchers and generators -------------------------------------------------------------------

function matcher(m) {
  return [
    heading(3, m.syntax, m.id, 'tflw-entry'),
    ...tags([...m.appliesTo.split(/,\s*/).map(tag), ...(m.status === 'shipped' ? [] : [badge('planned')])]),
    fence(unfenced(m.example)),
  ];
}

const FAMILIES = { unique: 'Unique values', random: 'Random values', transform: 'Transforms' };

function generators(rows) {
  const out = [];
  let family = null;
  for (const g of rows) {
    if (g.family !== family) {
      family = g.family;
      if (FAMILIES[family] === undefined) throw new Error(`a generator family the reference page has no heading for: ${family}`);
      out.push(heading(2, FAMILIES[family], family));
    }
    out.push(heading(3, g.syntax, g.id, 'tflw-entry'), html(`<p>${inline(g.notes)}</p>`), fence(unfenced(g.example)));
  }
  return out;
}

// ---- CLI flags ---------------------------------------------------------------------------------

/** The words of a synopsis, split where a reader could break the line: spaces outside brackets. */
function synopsisWords(s) {
  const words = [];
  let depth = 0;
  let word = '';
  for (const c of s) {
    if (c === '[' || c === '(') depth++;
    if (c === ']' || c === ')') depth--;
    if (c === ' ' && depth === 0) {
      if (word) words.push(word);
      word = '';
    } else word += c;
  }
  if (word) words.push(word);
  return words;
}

/** A synopsis laid out as a terminal prints a long one: the command, then continuation lines. */
export function wrapSynopsis(s, width = 72) {
  const lines = [];
  let line = '';
  for (const w of synopsisWords(s)) {
    if (line && line.length + 1 + w.length > width) {
      lines.push(line);
      line = `  ${w}`;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

/** `--tag <name>[,<name>...]` → `--tag`; `--version, -v` → `--version`. What a synopsis must name. */
export const flagName = (flag) => /--?[\w-]+/.exec(unfenced(flag))[0];

/**
 * A subcommand's synopsis: the one the page writes, when it writes one (a paragraph that is one code
 * span starting `tflw `, straight above the table), else one generated from the heading and the
 * flags. A written one says what generation cannot (`[--env <name> | --all-envs]`), so it wins, but
 * it must name every flag of its section or the build fails.
 */
export function synopsis(rows, { written, command }) {
  const text = written ?? `${command} ${rows.map((f) => `[${unfenced(f.flag)}]`).join(' ')}`;
  const missing = rows.map((f) => flagName(f.flag)).filter((name) => !new RegExp(`(^|[\\s\\[|])${name}(?=[\\s\\]=|]|$)`).test(text));
  if (missing.length > 0) throw new Error(`the synopsis for \`${command}\` does not name ${missing.join(', ')}: ${text}`);
  return text;
}

function flags(rows, context) {
  const command = rows[0].command;
  const list = html(
    `<dl class="tflw-flags">\n${rows.map((f) => `<div><dt>${inline(f.flag)}</dt><dd>${inline(f.effect)}</dd></div>`).join('\n')}\n</dl>`,
  );
  // `global` flags stand alone (`tflw --version`), so there is no line to write for them.
  if (command === 'global') return [list];
  return [fence(wrapSynopsis(synopsis(rows, context)), 'text', 'frame="none"'), list];
}

// ---- diagnostics -------------------------------------------------------------------------------

/**
 * Where a code is reported, from the stage its meaning already opens with. A fixed map, so a new
 * prefix fails the build rather than landing in a default (`D-M270-3`).
 */
export const STAGES = {
  Lexer: 'Lexer',
  Parser: 'Parser',
  Checker: 'Checker',
  'Parser/checker': 'Checker',
  'Parser (config)': 'Config',
  'Checker (config)': 'Config',
  'Parser/checker (load)': 'Load',
  'Checker (load)': 'Load',
  'Checker and runtime': 'Runtime',
  'Runtime (browser)': 'Runtime',
};
const STAGE_ORDER = ['Lexer', 'Parser', 'Checker', 'Config', 'Load', 'Runtime'];

/**
 * A meaning → `{ prefix, stage, lead, rest }`. The lead is the heading: the bold sentence a meaning
 * opens with where it has one, else its first clause. The rest is what the entry's text says after
 * it — everything, when the lead was cut mid-sentence, because a clause alone does not read as one.
 */
export function splitMeaning(code, meaning) {
  const m = /^([^:]+?):\s*([\s\S]*)$/.exec(meaning);
  const stage = m && STAGES[m[1]];
  if (!stage) throw new Error(`${code}: the meaning opens with a stage the diagnostics page does not map: ${meaning.slice(0, 40)}`);
  const body = m[2];
  const strong = /^\*\*([\s\S]+?)\*\*\s*/.exec(body);
  if (strong) return { prefix: m[1], stage, lead: strong[1].replace(/\.$/, ''), rest: body.slice(strong[0].length) };
  const cut = /\. (?=[A-Z`(])|\.$/.exec(body);
  const clause = / — |; /.exec(body);
  if (clause && (!cut || clause.index < cut.index)) return { prefix: m[1], stage, lead: body.slice(0, clause.index), rest: body };
  if (cut) return { prefix: m[1], stage, lead: body.slice(0, cut.index), rest: body.slice(cut.index + 1).trim() };
  return { prefix: m[1], stage, lead: body, rest: '' };
}

/** A probe's source, as the whole file it is checked as (`diagnosticExamples.test.ts`'s `runProbe`). */
export function probeFile(probe) {
  if (probe.wrap === 'step') return `test "example"\n${probe.source.map((line) => `  ${line}`).join('\n')}`;
  return probe.source.join('\n');
}

/**
 * What a probe says, as the terminal prints it: literal text, its backticks included, because a
 * message is output and not markdown. `says` is the part of the message the probe test matches, so
 * it can stop mid-span (`TF052`: ``only applies alongside `matches snapshot``); there it ends in `…`.
 */
export function says(s) {
  const text = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return (s.match(/`/g) ?? []).length % 2 === 1 ? `${text}…` : text;
}

function diagnostic(d) {
  const { prefix, stage, lead, rest } = splitMeaning(d.code, d.meaning);
  const out = [
    heading(3, [{ type: 'inlineCode', value: d.code }, { type: 'text', value: ' — ' }, ...phrasing(lead.replace(/\*/g, ''))], d.code.toLowerCase(), 'tflw-entry'),
  ];
  if (prefix !== stage) out.push(...tags([tag(prefix.toLowerCase())]));
  if (rest) out.push(html(`<p>${inline(rest)}</p>`));
  if (d.probes === undefined || d.probes.length === 0) {
    out.push(html(`<p class="tflw-example"><span>Example</span> ${inline(d.example)}</p>`));
    return { stage, nodes: out };
  }
  for (const probe of d.probes) {
    if (probe.as) out.push(html(`<p class="tflw-probe-as">${inline(probe.as)}</p>`));
    out.push(probe.wrap === 'config' ? fence(probeFile(probe), 'tflw-config', 'title="tflw.config"') : fence(probeFile(probe)));
    if (probe.says) out.push(html(`<p class="tflw-says"><span>tflw check says</span> <samp>${says(probe.says)}</samp></p>`));
  }
  return { stage, nodes: out };
}

function diagnostics(rows) {
  const byStage = new Map(STAGE_ORDER.map((s) => [s, []]));
  for (const d of rows) {
    const { stage, nodes } = diagnostic(d);
    byStage.get(stage).push(...nodes);
  }
  const filter = html(
    '<p class="tflw-filter"><label for="tflw-filter-input">Filter</label> <input id="tflw-filter-input" type="search" placeholder="a code, or a word: TF041, session, timeout" autocomplete="off"> <output for="tflw-filter-input"></output></p>',
  );
  return [filter, ...[...byStage].flatMap(([stage, nodes]) => (nodes.length === 0 ? [] : [heading(2, stage, stage.toLowerCase()), ...nodes]))];
}

// ---- the layouts -------------------------------------------------------------------------------

/** Each manifest's layout, and the columns it draws: a page column not in `draws` fails the build. */
const LAYOUTS = {
  MATCHERS: { draws: ['syntax', 'appliesTo', 'example', 'status'], render: (rows) => rows.flatMap(matcher) },
  GENERATORS: { draws: ['family', 'syntax', 'notes', 'example'], render: generators },
  CLI_FLAGS: { draws: ['flag', 'effect'], render: flags },
  DIAGNOSTICS: { draws: ['code', 'meaning', 'example'], render: diagnostics },
};

/** A `parseTable` description and its rows → the entries, as mdast nodes. */
export function renderEntries({ table }, rows, context = {}) {
  const layout = LAYOUTS[table.source];
  if (layout === undefined) throw new Error(`no entry layout for a reference table over ${table.source}`);
  const dropped = table.cols.map((c) => c.key).filter((k) => !layout.draws.includes(k));
  if (dropped.length > 0) throw new Error(`a reference table over ${table.source} declares ${dropped.join(', ')}, which its entries do not draw`);
  return layout.render(rows, context);
}
