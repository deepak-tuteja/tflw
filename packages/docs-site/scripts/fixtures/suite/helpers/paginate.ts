// doc-truth fixture: `guide/patterns.md` `use`s this helper in its page-walking pattern; the real one is
// the sibling's `tests/helpers/paginate.ts`, which the page cites. Keep the signature in step.
export async function walkAllPages(_ctx: { env: NodeJS.ProcessEnv }, _q: string, _pageSize: number): Promise<number> {
  return 0;
}
