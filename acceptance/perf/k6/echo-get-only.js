// M39 (PLAN_BROWSER_PERF_SECURITY.md §2.10, D49) — k6 counterpart to
// ../profile/echo-get-only.tflw: isolated GET-only rung against the zero-latency echo-server
// harness. No auth (echo-server.mjs has none), same ramp shape as the tflw side.

import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = 'http://127.0.0.1:4099';

export const options = {
  scenarios: {
    echo_get_only: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [{ duration: '8s', target: 30 }],
      gracefulStop: '0s',
    },
  },
};

export default function () {
  const res = http.get(`${BASE_URL}/products`, { tags: { name: 'products' } });
  check(res, { '200': (r) => r.status === 200 });
}
