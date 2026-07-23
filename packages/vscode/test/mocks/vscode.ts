// Fake implementation of the subset of the `vscode` API surface `extension.ts` touches, swapped in
// only at test time via tsconfig.test.json's `paths` remap (tsx honors tsconfig `paths` for module
// resolution, so no real `vscode` package or `@vscode/test-electron` extension host is needed).
// Every mutable piece of state is exported directly so tests can inspect/reset it between cases.

export const registeredCommands = new Map<string, (...args: unknown[]) => unknown>();
export let registeredCodeLensProvider: unknown;
export const shownWarnings: string[] = [];
export const terminals: MockTerminal[] = [];
let textDocumentsState: Array<{ languageId: string; fileName: string }> = [];
let workspaceFoldersState: Array<{ uri: { fsPath: string } }> | undefined;
let activeTextEditorState: { document: { uri: unknown } } | undefined;
let configurationState: Record<string, unknown> = {};

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
  shownWarnings.length = 0;
  terminals.length = 0;
  textDocumentsState = [];
  workspaceFoldersState = undefined;
  activeTextEditorState = undefined;
  configurationState = {};
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
  registerCodeLensProvider(_selector: unknown, provider: unknown) {
    registeredCodeLensProvider = provider;
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
