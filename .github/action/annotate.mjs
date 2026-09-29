#!/usr/bin/env node
// `M252` `C` (`D1378`) — one GitHub annotation per failing test, read off tflw's `junit.xml`.
//
// Written here rather than taken from a marketplace JUnit action: the file is tflw's own format
// (`packages/reporter/src/junit.ts`), a testcase's `classname` IS the `.tflw` file relative to the
// project, and forty lines need no dependency to audit. The annotation names the file, not a line
// — `junit.xml` carries none, and inventing line 1 would put the mark somewhere it is not true.
//
//   node annotate.mjs <junit.xml> [<project dir, relative to the repository>]
//
// No junit.xml (a usage error before any test ran) is not an error here: the run's own exit code
// already says what happened, and this step must not replace it with a second failure.
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const unxml = (s) =>
  s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(lt|gt|quot|apos|amp));/gi, (_, dec, hex, name) =>
    dec ? String.fromCodePoint(Number(dec)) : hex ? String.fromCodePoint(parseInt(hex, 16)) : { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }[name]);
// Workflow-command escaping: data escapes `%`, CR and LF; a property also escapes `:` and `,`.
const data = (s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const prop = (s) => data(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

/** Every failing testcase in `xml`, as `{ file, name, message }`, `file` joined onto `dir`. */
export function failures(xml, dir = '.') {
  const out = [];
  for (const m of xml.matchAll(/<testcase ([^>]*?)>\s*<failure message="([^"]*)"/g)) {
    const attr = (k) => unxml(new RegExp(`${k}="([^"]*)"`).exec(m[1])?.[1] ?? '');
    const file = attr('classname');
    out.push({ file: dir === '.' || file === '' ? file : join(dir, file).split('\\').join('/'), name: attr('name'), message: unxml(m[2]) });
  }
  return out;
}

/** The `::error` workflow command for one failure. */
export function annotation({ file, name, message }) {
  return `::error ${file ? `file=${prop(file)},` : ''}title=${prop(name)}::${data(message)}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [junit, dir = '.'] = process.argv.slice(2);
  if (!junit || !existsSync(junit)) {
    console.log(`tflw: no ${junit ?? 'junit.xml'} to annotate from`);
  } else {
    const found = failures(readFileSync(junit, 'utf8'), dir);
    for (const f of found) console.log(annotation(f));
    const line = found.length === 0 ? 'tflw: no failing tests' : `tflw: ${found.length} failing test${found.length === 1 ? '' : 's'} — see the annotations and the uploaded report`;
    console.log(line);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
  }
}
