// Shared helper for the raw fetch+node:test acceptance baseline (PLAN.md decision 41). This is
// exactly the amount of shared infrastructure a competent engineer would factor out by hand —
// nothing more — so the comparison against tflw's built-in `session`/`unique(...)` stays honest.
// Memoized so repeated calls across test files don't re-authenticate every time (a tflw `session`
// block gets this for free, and reports it explicitly; here it's silent and hand-rolled).

export const BASE = process.env.API_BASE ?? 'http://localhost:3001';

let cachedToken;

export async function login() {
  if (cachedToken) return cachedToken;
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PW }),
  });
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  const { token } = await res.json();
  cachedToken = token;
  return token;
}

export async function authHeaders() {
  return { 'content-type': 'application/json', authorization: `Bearer ${await login()}` };
}

let seq = 0;
/** Not reproducible (unlike tflw's seeded `unique(...)`) — a real dev's usual fallback. */
export function uniqueName(prefix) {
  return `${prefix}-${Date.now()}-${seq++}`;
}
