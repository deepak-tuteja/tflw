// Fake implementation of the subset of the `vscode` API surface `extension.ts` touches, swapped in
// only at test time via tsconfig.test.json's `paths` remap (tsx honors tsconfig `paths` for module
// resolution, so no real `vscode` package or `@vscode/test-electron` extension host is needed).
// Every mutable piece of state is exported directly so tests can inspect/reset it between cases.

export const registeredCommands = new Map<string, (...args: unknown[]) => unknown>();
export let registeredCodeLensProvider: unknown;
export let registeredCodeLensSelector: unknown;
export const shownWarnings: string[] = [];
export const terminals: MockTerminal[] = [];
let textDocumentsState: Array<{ languageId: string; fileName: string }> = [];
let workspaceFoldersState: Array<{ uri: { fsPath: string } }> | undefined;
let activeTextEditorState: { document: { uri: unknown } } | undefined;
let configurationState: Record<string, unknown> = {};
export const controllers: MockTestController[] = [];
export let workspaceTflwFiles: string[] = [];
export function __setWorkspaceTflwFiles(files: string[]): void {
  workspaceTflwFiles = files;
}

// Plain `export let` bindings can't be reassigned from outside the module (ESM live bindings are
// read-only to importers) — these setters are the test-facing way to seed fixture state.
export function __setTextDocuments(docs: Array<{ languageId: string; fileName: string }>): void {
  textDocumentsState = docs;
}
export function __setWorkspaceFolders(folders: Array<{ uri: { fsPath: string } }> | undefined): void {
  workspaceFoldersState = folders;
}
export function __setActiveTextEditor(editor: { document: { uri: unknown } } | undefined): void {
  activeTextEditorState = editor;
}
export function __setConfiguration(config: Record<string, unknown>): void {
  configurationState = config;
}

export function __reset(): void {
  registeredCommands.clear();
  registeredCodeLensProvider = undefined;
  registeredCodeLensSelector = undefined;
  shownWarnings.length = 0;
  terminals.length = 0;
  textDocumentsState = [];
  workspaceFoldersState = undefined;
  activeTextEditorState = undefined;
  configurationState = {};
  controllers.length = 0;
  workspaceTflwFiles = [];
}

export class MockTerminal {
  public sent: string[] = [];
  public shown = false;
  constructor(public name: string) {}
  sendText(text: string): void {
    this.sent.push(text);
  }
  show(_preserveFocus?: boolean): void {
    this.shown = true;
  }
}

export const window = {
  get terminals() {
    return terminals;
  },
  get activeTextEditor() {
    return activeTextEditorState;
  },
  createTerminal(name: string): MockTerminal {
    const t = new MockTerminal(name);
    terminals.push(t);
    return t;
  },
  showWarningMessage(message: string): Thenable<undefined> {
    shownWarnings.push(message);
    return Promise.resolve(undefined);
  },
};

export const workspace = {
  async findFiles(_include: string, _exclude?: string) {
    return workspaceTflwFiles.map((p) => Uri.file(p));
  },
  onDidOpenTextDocument(_cb: unknown) {
    return { dispose() {} };
  },
  onDidSaveTextDocument(_cb: unknown) {
    return { dispose() {} };
  },
  get textDocuments() {
    return textDocumentsState;
  },
  get workspaceFolders() {
    return workspaceFoldersState;
  },
  getConfiguration(_section: string) {
    return {
      get<T>(key: string): T | undefined {
        return configurationState[key] as T | undefined;
      },
    };
  },
};

export const languages = {
  registerCodeLensProvider(selector: unknown, provider: unknown) {
    registeredCodeLensProvider = provider;
    // Captured since `M136b` (D427a): with two language ids in play, *which* one a provider is
    // registered for is a decision worth pinning rather than a detail. The CodeLens provider stays
    // test-dialect-only on purpose, and a test can only say so if the selector is visible here.
    registeredCodeLensSelector = selector;
    return { dispose() {} };
  },
};

export const commands = {
  registerCommand(id: string, callback: (...args: unknown[]) => unknown) {
    registeredCommands.set(id, callback);
    return { dispose() {} };
  },
};

export class Range {
  constructor(
    public startLine: number,
    public startChar: number,
    public endLine: number,
    public endChar: number,
  ) {}
}

export class CodeLens {
  constructor(
    public range: Range,
    public command: { title: string; command: string; arguments?: unknown[] },
  ) {}
}

// Test helpers construct plain `{ fsPath }` objects and pass them wherever a real `vscode.Uri`
// would go — `extension.ts` only ever reads `.fsPath` off a Uri, never constructs one.


// ---- `M251` `C`: the testing API, enough of it for the explorer --------------------------------

export const Uri = {
  file(fsPath: string) {
    return { fsPath, scheme: 'file', toString: () => `file://${fsPath}` };
  },
};

export class Position {
  constructor(public line: number, public character: number) {}
}
export class Location {
  constructor(public uri: unknown, public range: unknown) {}
}
export class TestMessage {
  location?: Location;
  constructor(public message: string) {}
}
export enum TestRunProfileKind {
  Run = 1,
  Debug = 2,
  Coverage = 3,
}
export class TestRunRequest {
  constructor(public include?: MockTestItem[]) {}
}
export class CancellationTokenSource {
  token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
}

export class MockTestItemCollection {
  private readonly map = new Map<string, MockTestItem>();
  get size(): number {
    return this.map.size;
  }
  get(id: string): MockTestItem | undefined {
    return this.map.get(id);
  }
  add(item: MockTestItem): void {
    this.map.set(item.id, item);
  }
  replace(items: readonly MockTestItem[]): void {
    this.map.clear();
    for (const i of items) this.map.set(i.id, i);
  }
  forEach(cb: (item: MockTestItem) => void): void {
    this.map.forEach((i) => cb(i));
  }
}

export class MockTestItem {
  children = new MockTestItemCollection();
  range?: Range;
  canResolveChildren = false;
  constructor(public id: string, public label: string, public uri?: { fsPath: string }) {}
}

export type RunCall = [string, string, ...unknown[]];
export class MockTestRun {
  calls: RunCall[] = [];
  output = '';
  ended = false;
  constructor(public request: TestRunRequest) {}
  enqueued(item: MockTestItem): void { this.calls.push(['enqueued', item.id]); }
  started(item: MockTestItem): void { this.calls.push(['started', item.id]); }
  passed(item: MockTestItem, duration?: number): void { this.calls.push(['passed', item.id, duration]); }
  skipped(item: MockTestItem): void { this.calls.push(['skipped', item.id]); }
  failed(item: MockTestItem, message: TestMessage, duration?: number): void { this.calls.push(['failed', item.id, message, duration]); }
  errored(item: MockTestItem, message: TestMessage): void { this.calls.push(['errored', item.id, message]); }
  appendOutput(text: string): void { this.output += text; }
  end(): void { this.ended = true; }
}

export class MockTestController {
  items = new MockTestItemCollection();
  runs: MockTestRun[] = [];
  profiles: { label: string; kind: TestRunProfileKind; handler: (req: TestRunRequest, token: unknown) => Promise<void>; isDefault?: boolean }[] = [];
  resolveHandler?: (item?: MockTestItem) => Promise<void>;
  constructor(public id: string, public label: string) {}
  createTestItem(id: string, label: string, uri?: { fsPath: string }): MockTestItem {
    return new MockTestItem(id, label, uri);
  }
  createRunProfile(label: string, kind: TestRunProfileKind, handler: (req: TestRunRequest, token: unknown) => Promise<void>, isDefault?: boolean) {
    const p = { label, kind, handler, ...(isDefault !== undefined ? { isDefault } : {}) };
    this.profiles.push(p);
    return p;
  }
  createTestRun(request: TestRunRequest): MockTestRun {
    const r = new MockTestRun(request);
    this.runs.push(r);
    return r;
  }
  dispose(): void {}
}

export const tests = {
  createTestController(id: string, label: string): MockTestController {
    const c = new MockTestController(id, label);
    controllers.push(c);
    return c;
  },
};
