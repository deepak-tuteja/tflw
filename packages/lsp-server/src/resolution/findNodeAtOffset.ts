// Shared "what AST node is at this offset" walker (PLAN_M13_LSP.md Phase 2) — every other
// resolution/*.ts module builds on this instead of re-deriving its own traversal. Works over
// either dialect's root (`Program` or `ConfigFile`, both extend `Node`) since it dispatches
// purely on `node.type`.

import type { Node, Span } from '@tflw/lang';
import type {
  ActionDecl,
  AllowHostsDecl,
  ApiHeader,
  ApiRequestSpec,
  ApiServiceDecl,
  ApiStep,
  ArrayLit,
  BinaryExpr,
  CallExpr,
  CaptureStmt,
  CertDecl,
  ConfigFile,
  DefaultsBlock,
  EnvBlock,
  ExpectStmt,
  Field,
  FileBody,
  FileDataTable,
  FormBody,
  FormField,
  FormatExpr,
  GiveStmt,
  HeaderDecl,
  HeaderStmt,
  HeaderSubject,
  HookDecl,
  ImportDecl,
  InlineBody,
  InlineDataTable,
  KeyDecl,
  LetStmt,
  Matcher,
  ObjectLit,
  Oauth2SessionConfig,
  Program,
  RandomLikeExpr,
  RandomNumberExpr,
  RandomOfExpr,
  RandomPasswordExpr,
  RandomStringExpr,
  SessionDecl,
  TestDecl,
  TextBody,
  TransformExpr,
  UniqueLikeExpr,
  UniquePrefixExpr,
  UploadBody,
  UseDecl,
  WaitUntilApiStmt,
  WebDecl,
} from '@tflw/lang';

export function spanContains(span: Span, offset: number): boolean {
  return span.start.offset <= offset && offset <= span.end.offset;
}

/** Every `ActionDecl`-shaped, `TestDecl`-shaped, etc. child `Node` reachable one level down from
 * `node` — exhaustive over every `ast.ts` node type. Leaf nodes (literals, keyword-only subjects,
 * …) return `[]`. */
function children(node: Node): readonly Node[] {
  switch (node.type) {
    case 'Program': {
      const n = node as Program;
      return [...n.imports, ...n.uses, ...n.actions, ...n.hooks, ...n.tests];
    }
    case 'HookDecl':
      return (node as HookDecl).body;
    case 'ImportDecl':
      return [(node as ImportDecl).path];
    case 'UseDecl':
      return [(node as UseDecl).path];
    case 'ActionDecl':
      return (node as ActionDecl).body;
    case 'TestDecl': {
      const n = node as TestDecl;
      return [n.name, ...(n.table ? [n.table] : []), ...n.body];
    }
    case 'InlineDataTable':
      return (node as InlineDataTable).rows.flat();
    case 'FileDataTable':
      return [(node as FileDataTable).path];
    case 'GiveStmt':
      return [(node as GiveStmt).value];
    case 'HeaderStmt': {
      const n = node as HeaderStmt;
      return [n.name, n.value];
    }
    case 'ApiStep':
      return apiRequestSpecChildren(node as ApiStep);
    case 'RetryAfterClause':
      return [];
    case 'WaitUntilApiStmt': {
      const n = node as WaitUntilApiStmt;
      return [...apiRequestSpecChildren(n.request), ...n.expects];
    }
    case 'ApiHeader': {
      const n = node as ApiHeader;
      return [n.name, n.value];
    }
    case 'PathExpr':
      return [];
    case 'InlineBody':
      return (node as InlineBody).object.fields;
    case 'FileBody':
      return [(node as FileBody).path];
    case 'FormBody':
      return (node as FormBody).fields;
    case 'FormField':
      return [(node as FormField).value];
    case 'TextBody':
      return [(node as TextBody).value];
    case 'UploadBody': {
      const n = node as UploadBody;
      return [n.filePath, n.fieldName, ...n.extra];
    }
    case 'ExpectStmt': {
      const n = node as ExpectStmt;
      return [n.subject, n.matcher];
    }
    case 'StatusSubject':
    case 'DurationSubject':
    case 'BodyTextSubject':
    case 'BodySubject':
      return [];
    case 'HeaderSubject':
      return [(node as HeaderSubject).name];
    case 'Matcher': {
      const n = node as Matcher;
      return [...(n.value ? [n.value] : []), ...(n.schemaName ? [n.schemaName] : []), ...(n.schemaSource ? [n.schemaSource] : [])];
    }
    case 'LetStmt':
      return [(node as LetStmt).value];
    case 'CaptureStmt':
      return [(node as CaptureStmt).subject];
    case 'CallExpr':
      return (node as CallExpr).args;
    case 'DurationLit':
    case 'DateAtom':
    case 'DateOffsetLit':
    case 'BoolLit':
    case 'NullLit':
    case 'NumberLit':
    case 'EnvRef':
    case 'StringLit':
    case 'VarRef':
    case 'Interp':
    case 'UniqueEmailExpr':
    case 'UniqueNumberExpr':
    case 'UniqueUuidExpr':
    case 'RandomDateInPastExpr':
    case 'RandomDateInFutureExpr':
    case 'RandomUuidExpr':
    case 'TimeoutDecl':
    case 'WorkersDecl':
    case 'ReportDecl':
    case 'InsecureDecl':
    case 'EvidenceDecl':
    case 'RedactDecl':
    case 'RequireDecl':
      return [];
    case 'BinaryExpr': {
      const n = node as BinaryExpr;
      return [n.left, n.right];
    }
    case 'FormatExpr': {
      const n = node as FormatExpr;
      return [n.value, n.pattern];
    }
    case 'TransformExpr':
      return [(node as TransformExpr).value];
    case 'UniquePrefixExpr':
      return [(node as UniquePrefixExpr).prefix];
    case 'UniqueLikeExpr':
      return [(node as UniqueLikeExpr).pattern];
    case 'RandomNumberExpr':
    case 'RandomDecimalExpr':
    case 'RandomDateBetweenExpr': {
      const n = node as RandomNumberExpr;
      return [n.from, n.to];
    }
    case 'RandomOfExpr':
      return (node as RandomOfExpr).choices;
    case 'RandomStringExpr':
      return [(node as RandomStringExpr).length];
    case 'RandomLikeExpr':
      return [(node as RandomLikeExpr).pattern];
    case 'RandomPasswordExpr': {
      const n = node as RandomPasswordExpr;
      return n.length ? [n.length] : [];
    }
    case 'ObjectLit':
      return (node as ObjectLit).fields;
    case 'Field':
      return [(node as Field).value];
    case 'ArrayLit':
      return (node as ArrayLit).elements;
    // -- config dialect --
    case 'ConfigFile': {
      const n = node as ConfigFile;
      return [...(n.defaults ? [n.defaults] : []), ...n.envs, ...n.requires, ...n.sessions];
    }
    case 'SessionDecl': {
      const n = node as SessionDecl;
      return [...(n.oauth2 ? [n.oauth2] : []), ...n.body];
    }
    case 'Oauth2SessionConfig': {
      const n = node as Oauth2SessionConfig;
      return [n.tokenUrl, n.clientId, n.clientSecret, ...(n.scope ? [n.scope] : [])];
    }
    case 'DefaultsBlock':
      return (node as DefaultsBlock).entries;
    case 'EnvBlock':
      return (node as EnvBlock).entries;
    case 'HeaderDecl': {
      const n = node as HeaderDecl;
      return [n.name, n.value];
    }
    case 'WebDecl':
      return [(node as WebDecl).url];
    case 'CertDecl':
      return [(node as CertDecl).path];
    case 'KeyDecl':
      return [(node as KeyDecl).path];
    case 'AllowHostsDecl':
      return (node as AllowHostsDecl).hosts;
    case 'ApiServiceDecl':
      return [(node as ApiServiceDecl).url];
    default:
      return [];
  }
}

function apiRequestSpecChildren(spec: ApiRequestSpec): readonly Node[] {
  return [spec.path, ...(spec.body ? [spec.body] : []), ...spec.headers];
}

/**
 * Walk from `root` (a `Program` or `ConfigFile`) down to the most specific node whose span
 * contains `offset`, returning the whole root-to-leaf ancestor chain (empty when `offset` falls
 * outside `root.span` entirely). Sibling spans never overlap in this grammar, so "first child that
 * contains the offset" is unambiguous except exactly at a shared boundary, where the earlier
 * sibling wins — an acceptable v1 simplification (PLAN_M13_LSP.md Phase 2).
 */
export function findNodeAtOffset(root: Node, offset: number): readonly Node[] {
  const path: Node[] = [];
  let current: Node | null = root;
  while (current && spanContains(current.span, offset)) {
    path.push(current);
    const kids = children(current);
    current = kids.find((k) => spanContains(k.span, offset)) ?? null;
  }
  return path;
}
