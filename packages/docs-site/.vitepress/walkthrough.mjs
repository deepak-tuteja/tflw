// `M259` (`D1415`, `D1418`) — the walkthrough's chapters, in the order a new user's first day runs
// them. **One list, two readers**: `config.ts` draws the *Start here* rail from it, and
// `scripts/verify-runbook.mjs` runs the chapters' fences in this order, in one directory, so each
// chapter starts from the state the one before it left. A chapter missing here would be missing
// from both, and a page under `runbook/start/` that is not here is refused by the gate.
//
// Plain `.mjs`, not `.ts`: the gate is a Node script and must read it without a compiler.
//
// Chapter 7, the page, is `M261`'s, written against the re-cut page: until it lands the numbering
// skips it rather than renumbering 8–10 twice.
export const WALKTHROUGH = [
  { text: '1. Install', link: '/runbook/start/install' },
  { text: '2. The example', link: '/runbook/start/example' },
  { text: '3. The first run and its report', link: '/runbook/start/first-run' },
  { text: '4. An API test of your own', link: '/runbook/start/api-test' },
  { text: '5. A browser test', link: '/runbook/start/browser-test' },
  { text: '6. Load and scan', link: '/runbook/start/load-and-scan' },
  { text: '8. The editor', link: '/runbook/start/editor' },
  { text: '9. CI', link: '/runbook/start/ci' },
  { text: '10. Your own service', link: '/runbook/start/your-service' },
];
