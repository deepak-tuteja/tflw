// doc-truth fixture: `guide/patterns.md` `use`s this helper in its outbound-call pattern; the real one is
// the sibling's `tests/helpers/webhook-receiver.ts`, which the page cites. Keep the signatures in step.
export async function startWebhookReceiver(_ctx: { env: NodeJS.ProcessEnv }): Promise<string> {
  return 'http://127.0.0.1:9/webhook';
}

export async function assertWebhookReceived(_ctx: { env: NodeJS.ProcessEnv }, _url: string, _event: string, _orderId: string, _timeoutMs: number): Promise<string> {
  return '';
}
