// JS escape hatch demo (P#11): a plain TS helper, exported and called from m2-features.tflw as
// `audit note(...)` (camelCase → `auditNote`). Test context in (`ctx.env`), a value out.

export function auditNote(ctx: { env: NodeJS.ProcessEnv }, productId: string, price: number): string {
  return `deleted ${productId} at $${price.toFixed(2)} by ${ctx.env.ADMIN_EMAIL ?? 'unknown'}`;
}
