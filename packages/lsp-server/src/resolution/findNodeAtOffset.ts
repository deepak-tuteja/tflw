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
  AuthorizedTargetDecl,
  BinaryExpr,
  BodySubject,
  BodyTextSubject,
  CallExpr,
  CaptureStmt,
  CertDecl,
  TickStmt,
  ClickStmt,
  ConfigFile,
  DefaultsBlock,
  DownloadBlock,
  DragStmt,
  DropFileStmt,
  EnvBlock,
  ExpectStmt,
  Field,
  FileBody,
  FileDataTable,
  FillFormRow,
  FillFormStmt,
  FillStmt,
  FormBody,
  FormField,
  FormatExpr,
  GiveStmt,
  HeaderDecl,
  HeaderStmt,
  HeaderSubject,
  HookDecl,
  HoverStmt,
  ImportDecl,
  InlineBody,
  InlineDataTable,
  KeyDecl,
  LetStmt,
  Locator,
  LocatorSubject,
  LogStmt,
  Matcher,
  NetworkRequestRef,
  NetworkRequestSubject,
  ObjectLit,
  Oauth2SessionConfig,
  OpenStmt,
  PressStmt,
  Program,
  RandomLikeExpr,
  RandomNumberExpr,
  RandomOfExpr,
  RandomPasswordExpr,
  RandomStringExpr,
  ScreenshotStmt,
  ScrollStmt,
  SelectStmt,
  SessionDecl,
  HoldRpsWorkload,
  HoldUsersWorkload,
  PerVuIterationsWorkload,
  SharedIterationsWorkload,
  Stage,
  StepRpsWorkload,
  StepUsersWorkload,
  SpikeRpsWorkload,
  SpikeUsersWorkload,
  StatusSubject,
  StubStmt,
  SwitchToNewTabBlock,
  TestDecl,
  TextBody,
  TransformExpr,
  UntickStmt,
  UniqueLikeExpr,
  UniquePrefixExpr,
  UploadBody,
  UseDecl,
  WaitUntilApiStmt,
  WaitUntilUiStmt,
  WebDecl,
  WithinBlock,
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
    // `sessions` is a plain `string[]` (not a child `Node`), deliberately omitted, same as
    // always. `workload`/`thresholds` (M50, formerly `ScenarioDecl`-only) are now optional —
    // `workload` null for a functional test, present for a workload-bearing one.
    case 'TestDecl': {
      const n = node as TestDecl;
      return [n.name, ...(n.table ? [n.table] : []), ...(n.workload ? [n.workload] : []), ...n.thresholds, ...n.body];
    }
    case 'RampUsersWorkload':
    case 'RampRpsWorkload':
    case 'HoldUsersWorkload':
    case 'HoldRpsWorkload':
    case 'SharedIterationsWorkload':
    case 'PerVuIterationsWorkload':
    case 'ThresholdDecl':
    case 'PauseStmt':
    case 'Stage':
      // `users`/`rps`/`overMs`/`forMs` (workload), `iterations`/`vus` (iteration-count workload),
      // `metric`/`op`/`value` (threshold), `minMs`/`maxMs` (pause), `mode`/`target`/`durationMs`
      // (stage) are all plain numbers/enums — no child `Node` to descend into, same leaf shape as
      // `DurationLit`/`NumberLit` below.
      return [];
    case 'StepUsersWorkload':
    case 'StepRpsWorkload':
    case 'SpikeUsersWorkload':
    case 'SpikeRpsWorkload':
      return (node as StepUsersWorkload | StepRpsWorkload | SpikeUsersWorkload | SpikeRpsWorkload).stages;
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
      return [n.filePath, n.fieldName, ...(n.contentType ? [n.contentType] : []), ...n.extra];
    }
    case 'ExpectStmt': {
      const n = node as ExpectStmt;
      return [n.subject, n.matcher, ...n.masks];
    }
    case 'DurationSubject':
    case 'BodyBytesSubject':
    case 'BodyCsvSubject':
    case 'BodyPdfTextSubject':
    case 'RequestSubject':
    case 'PageSubject':
    case 'AcceptDialogStmt':
    case 'DismissDialogStmt':
    case 'SwitchToTabStmt':
    case 'CloseTabStmt':
      return [];
    case 'StatusSubject':
    case 'BodyTextSubject':
    case 'BodySubject': {
      // `of request to "…"` (M3d, SPEC §9.7) — carried on these three response-reading subjects.
      const n = node as StatusSubject | BodyTextSubject | BodySubject;
      return n.of ? [n.of] : [];
    }
    case 'HeaderSubject':
      return [(node as HeaderSubject).name];
    case 'LocatorSubject':
      return [(node as LocatorSubject).locator];
    case 'NetworkRequestSubject':
      return [(node as NetworkRequestSubject).ref];
    case 'NetworkRequestRef': {
      const n = node as NetworkRequestRef;
      return [n.urlPattern, ...(n.method ? [n.method] : [])];
    }
    case 'Locator':
      return [(node as Locator).value];
    // -- browser steps (M3a-M3e, SPEC §9) ----------------------------------
    case 'OpenStmt':
      return [(node as OpenStmt).path];
    case 'ScreenshotStmt':
      return [(node as ScreenshotStmt).name];
    case 'StubStmt': {
      const n = node as StubStmt;
      return [n.urlPattern, n.status, ...(n.body ? [n.body] : [])];
    }
    case 'ClickStmt':
    case 'HoverStmt':
    case 'ScrollStmt':
    case 'UntickStmt':
    case 'TickStmt': {
      const n = node as ClickStmt | HoverStmt | ScrollStmt | UntickStmt | TickStmt;
      return [n.locator];
    }
    case 'FillStmt': {
      const n = node as FillStmt;
      return [n.locator, n.value];
    }
    case 'FillFormStmt':
      return (node as FillFormStmt).rows;
    case 'FillFormRow': {
      const n = node as FillFormRow;
      return [n.field, n.value];
    }
    case 'SelectStmt': {
      const n = node as SelectStmt;
      return [n.locator, n.value];
    }
    case 'PressStmt': {
      const n = node as PressStmt;
      return [n.keys, ...(n.locator ? [n.locator] : [])];
    }
    case 'WithinBlock': {
      const n = node as WithinBlock;
      return [n.locator, ...n.body];
    }
    case 'WaitUntilUiStmt': {
      const n = node as WaitUntilUiStmt;
      return [n.subject, n.matcher];
    }
    case 'SwitchToNewTabBlock':
      return (node as SwitchToNewTabBlock).body;
    case 'DownloadBlock':
      // `name` is a plain `string` (findIdentifierSpans recovers its span), not a child Node.
      return (node as DownloadBlock).body;
    case 'DragStmt': {
      const n = node as DragStmt;
      return [n.from, n.to];
    }
    case 'DropFileStmt': {
      const n = node as DropFileStmt;
      return [n.filePath, n.locator];
    }
    case 'Matcher': {
      const n = node as Matcher;
      return [
        ...(n.value ? [n.value] : []),
        ...(n.schemaName ? [n.schemaName] : []),
        ...(n.schemaSource ? [n.schemaSource] : []),
        ...(n.filePath ? [n.filePath] : []),
        ...(n.snapshotName ? [n.snapshotName] : []),
      ];
    }
    case 'LetStmt':
      return [(node as LetStmt).value];
    case 'CaptureStmt':
      return [(node as CaptureStmt).subject];
    // M28 (PLAN_LOG_LSP.md): inert today — a `log` message is a plain `StringLit` with only
    // `{var}` interpolation, never a Matcher/generator/CallExpr — but kept for consistency with
    // this dispatch's own exhaustiveness invariant.
    case 'LogStmt':
      return [(node as LogStmt).message];
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
    // M133 (D24b catch-up): `authorized target "<url>" reason "<text>"` (M128b/D291). Both operands
    // are `StringLit`s, so this is the same one-line shape `AllowHostsDecl` above already has — and
    // its absence is why an offset-walk stopped dead at the decl boundary, handing hover and
    // go-to-definition the declaration when the cursor was inside the URL or the reason sentence.
    // `probeMutating` is a boolean, not a node, so it has nothing to contribute here.
    case 'AuthorizedTargetDecl': {
      const n = node as AuthorizedTargetDecl;
      return [n.target, n.reason];
    }
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
