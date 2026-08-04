// The `allow hosts` pattern rule (SPEC §3.7), stated once for the two halves of the tool that both
// have to know it: the checker, which decides *statically* whether a config's own base URLs can
// ever satisfy its own allowlist (M85, C1/`A4-10`), and the runtime, which decides *per request*
// whether a host may be connected to (`@tflw/runtime`'s `allowHosts.ts`, which imports this).
//
// It lives in `lang` rather than in the runtime because `lang` is the dependency direction that
// already exists — and because two copies of a matching rule is how a checker comes to bless a
// config the runtime then refuses, which is the shape of the finding this closes, one level down.

/** A pattern starting with `*.` matches that suffix (any subdomain) or the bare domain itself
 * (`*.example.com` matches both `api.example.com` and `example.com`); anything else must match the
 * hostname exactly. */
export function hostMatchesAllowPattern(hostname: string, pattern: string): boolean {
  if (pattern.startsWith('*.')) {
    const base = pattern.slice(2);
    return hostname === base || hostname.endsWith(`.${base}`);
  }
  return hostname === pattern;
}
