// `M253` `F` (`D1351`) — whether tflw is on npm. **`false` until the owner's word** (`D1379`); publish
// day flips it (the publish-day checklist's step 5) and nothing else on the site has to change.
//
// Every sentence that is true only before 1.0 — "not published to npm yet", the clone-and-build
// install — sits inside `<Published :when="false">`, beside the text 1.0 day needs inside
// `<Published>`, so the published wording is written, reviewed and gated now rather than on the
// day. `scripts/published.test.mjs` holds each declared pre-1.0 sentence to that.
export const PUBLISHED = false;
