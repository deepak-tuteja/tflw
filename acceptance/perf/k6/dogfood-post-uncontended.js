// M39 (PLAN_BROWSER_PERF_SECURITY.md §2.10, D49) — k6 counterpart to
// ../tflw/dogfood-post-uncontended.tflw: isolated POST-uncontended rung against the real dogfood
// target (`POST /cart/items`, static body, per-user cart row — no shared lock across VUs), with
// the same login-once + retry-on-401 session handling as checkout-burst.js (D31). `productId`
// below must stay in sync with the tflw side's hardcoded id (both resolved once by hand from the
// same `GET /products?q=Load%20Test%20Widget` call). Same ramp shape as checkout-burst.js for
// apples-to-apples comparison against the contended rung.

import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = 'http://localhost:4001/v1';
const LOAD_USER_EMAIL = __ENV.LOAD_USER_EMAIL || 'load@example.com';
const LOAD_USER_PW = __ENV.LOAD_USER_PW || 'load-pw-123';
const BODY = JSON.stringify({ productId: '77a0540f-c608-433c-82f3-dc821ed5e515', quantity: 1 });

export const options = {
  scenarios: {
    dogfood_post_uncontended: {
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
  const res = authedRequest('POST', `${BASE_URL}/cart/items`, BODY, { name: 'cart-add' });
  check(res, { '201': (r) => r.status === 201 });
}
