// `M259` (`D1415`, `D1418`) — the walkthrough's chapters, in the order a new user's first day runs
// them. **One list, two readers**: `config.ts` draws the *Start here* rail from it, and
// `scripts/verify-runbook.mjs` runs the chapters' fences in this order, in one directory, so each
// chapter starts from the state the one before it left. A chapter missing here would be missing
// from both, and a page under `runbook/start/` that is not here is refused by the gate.
//
// Plain `.mjs`, not `.ts`: the gate is a Node script and must read it without a compiler.
export const WALKTHROUGH = [
  { text: '1. Install', link: '/runbook/start/install' },
  { text: '2. The example', link: '/runbook/start/example' },
];
