// Standalone fork target for the mTLS worker (PLAN_BROWSER_PERF_SECURITY.md M35c). Never imported
// by any other module — only ever invoked via `fork()` from `mtlsWorker.ts`'s `getChild()` — so
// this file's top-level code always means exactly one thing: be the mTLS worker process.

import { runMtlsWorkerProcess } from './mtlsWorker.js';

void runMtlsWorkerProcess();
