// M46d — a shared, proactively-refreshed token cache. Artillery's open-model arrivals have no
// persistent per-VU identity to cache a session on (unlike k6's module-level `token` or tflw's
// `sessionCache`), so a naive per-arrival login would hammer apiV2's bcrypt(cost 10)-backed
// /auth/login hundreds of times per second at this test's target throughput — turning the
// "measure checkout under DB-lock contention" test into an accidental bcrypt-CPU benchmark
// instead. `JWT_ACCESS_TTL` is a deliberately short 5s in this dev stack (see ../k6/checkout-burst.js's
// own comment), so the cache proactively refreshes every 3s (safely under the TTL) rather than
// reactively on a 401 — dedup'd via a shared in-flight promise so concurrent arrivals never trigger
// duplicate logins.
let token;
let tokenObtainedAt = 0;
let loginPromise;

const BASE_URL = 'http://localhost:4001/v1';
const REFRESH_MS = 3000;

async function login() {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: process.env.LOAD_USER_EMAIL || 'load@example.com',
      password: process.env.LOAD_USER_PW || 'load-pw-123',
    }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  const body = await res.json();
  return body.accessToken;
}

async function ensureToken(context, _events) {
  if (!token || Date.now() - tokenObtainedAt > REFRESH_MS) {
    if (!loginPromise) {
      loginPromise = login()
        .then((t) => {
          token = t;
          tokenObtainedAt = Date.now();
          loginPromise = undefined;
          return t;
        })
        .catch((err) => {
          loginPromise = undefined;
          throw err;
        });
    }
    await loginPromise;
  }
  context.vars.token = token;
}

module.exports = { ensureToken };
