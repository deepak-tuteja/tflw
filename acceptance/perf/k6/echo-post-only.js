// M39 (PLAN_BROWSER_PERF_SECURITY.md §2.10, D49) — k6 counterpart to
// ../profile/echo-post-only.tflw: isolated, static-body POST-only rung against the zero-latency
// echo-server harness. No auth, same ramp shape as the tflw side.

import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = 'http://127.0.0.1:4099';
const BODY = JSON.stringify({ items: [{ productId: 'prod_1', quantity: 1 }] });

export const options = {
  scenarios: {
    echo_post_only: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [{ duration: '8s', target: 30 }],
      gracefulStop: '0s',
    },
  },
};

export default function () {
  const res = http.post(`${BASE_URL}/orders`, BODY, {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'orders' },
  });
  check(res, { '201': (r) => r.status === 201 });
}
