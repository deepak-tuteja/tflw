// Fake `vscode-languageclient/node` swapped in at test time (see mocks/vscode.ts's header comment)
// so `extension.ts`'s LanguageClient wiring can be asserted without a real Extension Host.

export const TransportKind = { stdio: 0 } as const;

export const constructedClients: MockLanguageClient[] = [];

export class MockLanguageClient {
  public started = false;
  public stopped = false;
  constructor(
    public id: string,
    public name: string,
    public serverOptions: unknown,
    public clientOptions: unknown,
  ) {
    constructedClients.push(this);
  }
  start(): Promise<void> {
    this.started = true;
    return Promise.resolve();
  }
  stop(): Promise<void> {
    this.stopped = true;
    return Promise.resolve();
  }
}

export { MockLanguageClient as LanguageClient };

export function __reset(): void {
  constructedClients.length = 0;
}
