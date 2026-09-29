#!/usr/bin/env node
// `M249` `F` (R2) — `results.schema.json` and `events.schema.json`, generated from the TypeScript types
// that produce the two files, so the schema cannot describe a shape the code no longer writes.
//
// **Its own generator, on the TypeScript compiler API the repository already builds with**, rather
// than a schema-generator package: the types are one file's worth of interfaces and unions, and the
// walk below is the whole of what they need. Named interfaces become `$defs` (which is also what
// stops a recursive type from recursing), a union becomes `anyOf` with `true | false` folded back to
// `boolean`, an optional property is left out of `required`, and a `Record<string, T>` is an object
// whose `additionalProperties` is `T`.
//
// **Open objects, deliberately.** No object says `additionalProperties: false`: a reader written
// against this schema must keep working when a later tflw adds a field, which every milestone does
// (`sourceHash`, `mergedFrom` were added the milestone this landed). The schema pins what is there
// and what it means, not that nothing else ever will be.
//
// `--check` writes nothing and exits 1 when the committed files are not what the types produce.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const typesFile = join(root, 'packages', 'runtime', 'src', 'types.ts');
const outDir = join(here, '..', 'schema');
// The published copies: the docs site serves `public/` at its root, which is what the `$id`s name.
const publicDir = join(root, 'packages', 'docs-site', 'public', 'schema');
const BASE = 'https://deepak-tuteja.github.io/tflw/schema/';

const program = ts.createProgram([typesFile], { strict: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, skipLibCheck: true, noEmit: true });
const checker = program.getTypeChecker();
const sf = program.getSourceFile(typesFile);
if (!sf) throw new Error(`cannot read ${typesFile}`);

function exported(name) {
  const sym = checker.getSymbolAtLocation(sf).exports.get(name);
  if (!sym) throw new Error(`types.ts exports no ${name}`);
  return checker.getDeclaredTypeOfSymbol(sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym);
}

/** The JSDoc summary of a property or declaration — its first paragraph, one line. */
function docOf(symbol) {
  const text = ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim();
  if (!text) return undefined;
  return text.split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim();
}

function schemasFor(rootType, rootName) {
  const defs = {};
  const naming = new Map();
  const nameOf = (type) => {
    // A generic alias (`Readonly<Record<…>>`) names a shape, not a type: every instantiation would
    // share one `$defs` entry. Such a type is written out where it is used.
    if (type.aliasTypeArguments && type.aliasTypeArguments.length > 0) return undefined;
    const sym = type.aliasSymbol ?? type.getSymbol();
    if (!sym) return undefined;
    const name = sym.getName();
    if (name === '__type' || name === '__object' || name === 'Array' || name === 'ReadonlyArray') return undefined;
    // Two different types can share a declared name across files; the first keeps it, the next is suffixed.
    const seen = naming.get(name);
    if (seen === undefined) {
      naming.set(name, type);
      return name;
    }
    return seen === type ? name : `${name}_${[...naming.keys()].filter((k) => k.startsWith(name)).length}`;
  };

  const walk = (type, depth = 0) => {
    if (depth > 60) return {};
    const flags = type.flags;
    if (flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return {};
    if (flags & ts.TypeFlags.String) return { type: 'string' };
    if (flags & ts.TypeFlags.Number) return { type: 'number' };
    if (flags & ts.TypeFlags.Boolean) return { type: 'boolean' };
    if (flags & ts.TypeFlags.Null) return { type: 'null' };
    if (flags & ts.TypeFlags.StringLiteral) return { const: type.value };
    if (flags & ts.TypeFlags.NumberLiteral) return { const: type.value };
    if (flags & ts.TypeFlags.BooleanLiteral) return { const: checker.typeToString(type) === 'true' };
    if (type.isUnion()) {
      const members = type.types.filter((t) => !(t.flags & ts.TypeFlags.Undefined));
      const hasTrue = members.some((t) => t.flags & ts.TypeFlags.BooleanLiteral && checker.typeToString(t) === 'true');
      const hasFalse = members.some((t) => t.flags & ts.TypeFlags.BooleanLiteral && checker.typeToString(t) === 'false');
      const rest = members.filter((t) => !(t.flags & ts.TypeFlags.BooleanLiteral) || !(hasTrue && hasFalse));
      const parts = [...(hasTrue && hasFalse ? [{ type: 'boolean' }] : []), ...rest.map((t) => walk(t, depth + 1))];
      if (parts.every((p) => 'const' in p && Object.keys(p).length === 1)) return { enum: parts.map((p) => p.const) };
      return parts.length === 1 ? parts[0] : { anyOf: parts };
    }
    if (checker.isArrayType(type) || checker.isTupleType(type)) {
      const args = checker.getTypeArguments(type);
      if (checker.isTupleType(type)) return { type: 'array', prefixItems: args.map((a) => walk(a, depth + 1)), minItems: args.length, maxItems: args.length };
      return { type: 'array', items: args[0] ? walk(args[0], depth + 1) : {} };
    }
    if (flags & ts.TypeFlags.Object) {
      if (type.getCallSignatures().length > 0) return {};
      // Node's `Buffer` (a `Uint8Array`) is written by `JSON.stringify` through its `toJSON`.
      const binary = (type.aliasSymbol ?? type.getSymbol())?.getName();
      if (binary === 'Buffer' || binary === 'Uint8Array') {
        return { description: 'bytes, as JSON.stringify writes a Buffer', type: 'object', properties: { type: { const: 'Buffer' }, data: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 255 } } }, required: ['type', 'data'] };
      }
      const name = nameOf(type);
      if (name) {
        if (!(name in defs)) {
          defs[name] = {}; // placeholder: a recursive reference resolves to the $ref below
          defs[name] = objectSchema(type, depth);
        }
        return { $ref: `#/$defs/${name}` };
      }
      return objectSchema(type, depth);
    }
    if (type.isIntersection()) return { allOf: type.types.map((t) => walk(t, depth + 1)) };
    return {};
  };

  const objectSchema = (type, depth) => {
    const properties = {};
    const required = [];
    for (const prop of checker.getPropertiesOfType(type)) {
      const decl = prop.valueDeclaration ?? prop.declarations?.[0];
      if (!decl) continue;
      const propType = checker.getTypeOfSymbolAtLocation(prop, decl);
      if (propType.getCallSignatures().length > 0) continue;
      const schema = walk(propType, depth + 1);
      const description = docOf(prop);
      properties[prop.getName()] = description && !('$ref' in schema) ? { description, ...schema } : schema;
      if (!(prop.flags & ts.SymbolFlags.Optional)) required.push(prop.getName());
    }
    const index = checker.getIndexInfoOfType(type, ts.IndexKind.String);
    return {
      type: 'object',
      ...(Object.keys(properties).length > 0 ? { properties } : {}),
      ...(required.length > 0 ? { required } : {}),
      ...(index ? { additionalProperties: walk(index.type, depth + 1) } : {}),
    };
  };

  const top = walk(rootType);
  return { top, defs };
}

function document(id, title, description, rootType, rootName) {
  const { top, defs } = schemasFor(rootType, rootName);
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `${BASE}${id}`,
    title,
    description,
    ...top,
    $defs: Object.fromEntries(Object.entries(defs).sort(([a], [b]) => a.localeCompare(b))),
  };
}

const results = document(
  'results.schema.json',
  'tflw results.json',
  "One finished run: every test's verdict and steps, the scans' findings, and how the run was made. Generated from @tflw/runtime's RunReport; objects are open, so a later tflw may add fields.",
  exported('RunReport'),
  'RunReport',
);
const events = document(
  'events.schema.json',
  'tflw events.ndjson line',
  'One line of events.ndjson (tflw run --format ndjson): a run, test or step starting or ending. Generated from @tflw/runtime\'s RunEvent.',
  exported('RunEvent'),
  'RunEvent',
);

const files = { 'results.schema.json': results, 'events.schema.json': events };
const check = process.argv.includes('--check');
let stale = 0;
mkdirSync(outDir, { recursive: true });
for (const [name, doc] of Object.entries(files)) {
  const text = `${JSON.stringify(doc, null, 2)}\n`;
  for (const dir of [outDir, publicDir]) {
    const path = join(dir, name);
    if (check) {
      let committed = '';
      try {
        committed = readFileSync(path, 'utf8');
      } catch {
        /* missing counts as stale */
      }
      if (committed !== text) {
        console.error(`✗ ${path} is not what the types produce — run \`npm run schemas -w @tflw/reporter\` and commit it`);
        stale++;
      }
    } else {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path, text);
    }
  }
}
if (check && stale > 0) process.exit(1);
console.log(check ? '✓ the two schemas match the types' : `wrote ${Object.keys(files).join(', ')} to ${outDir}`);
