// doc-truth fixture: `guide/patterns.md` `use`s this helper in its branching pattern; the real one is
// the sibling's `tests/helpers/find-category.ts`, which the page cites. Keep the signature in step.
export function findCategoryId(_ctx: { env: NodeJS.ProcessEnv }, categories: unknown, name: string): string {
  const match = (categories as { id: string; name: string }[]).find((c) => c.name === name);
  if (!match) throw new Error(`category "${name}" not found`);
  return match.id;
}
