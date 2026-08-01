// M39 (PLAN_BROWSER_PERF_SECURITY.md §2.10, D49) — k6 counterpart to
// ../tflw/dogfood-get-only.tflw: isolated GET-only rung against the real dogfood target
// (`GET /health`), with the same login-once + retry-on-401 session handling as checkout-burst.js
// (D31) so both sides pay the same per-VU auth overhead. Same ramp shape as checkout-burst.js for
// apples-to-apples comparison against the contended rung.

import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = 'http://localhost:4001/v1';
const LOAD_USER_EMAIL = __ENV.LOAD_USER_EMAIL || 'load@example.com';
const LOAD_USER_PW = __ENV.LOAD_USER_PW || 'load-pw-123';

export const options = {
  scenarios: {
    dogfood_get_only: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [{ duration: '20s', target: 60 }],
      gracefulStop: '0s',
    },
  },
};

function login() {
  const res = http.post(`${BASE_URL}/auth/login`, JSON.stringify({ email: LOAD_USER_EMAIL, password: LOAD_USER_PW }), {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'login' },
  });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${res.body}`);
  return res.json('accessToken');
}

let token;

function authedRequest(method, url, body, tags) {
  if (!token) token = login();
  const attempt = () => {
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    return method === 'GET' ? http.get(url, { headers, tags }) : http.post(url, body, { headers, tags });
  };
  let res = attempt();
  if (res.status === 401) {
    token = login();
    res = attempt();
  }
  return res;
}

export default function () {
  const res = authedRequest('GET', `${BASE_URL}/health`, null, { name: 'health' });
  check(res, { '200': (r) => r.status === 200 });
}
