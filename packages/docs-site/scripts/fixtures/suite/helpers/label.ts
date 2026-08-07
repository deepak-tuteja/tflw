// doc-truth fixture: `guide/actions.md` prints this exact helper in the block above the sample
// that `use`s it, so the two are meant to agree. Keep them in step.
export function makeLabel(ctx: { env: NodeJS.ProcessEnv }, id: string, price: number): string {
  return `widget ${id} at $${price.toFixed(2)}`;
}
