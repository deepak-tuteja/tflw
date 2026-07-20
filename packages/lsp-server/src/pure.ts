// @tflw/lsp-server/pure — the resolution/*.ts surface only: pure, offset-based functions with no
// `vscode-languageserver`/Node dependency (confirmed by their own imports — only @tflw/lang types
// and each other). A separate entry point from `.` (which also re-exports `server.ts`'s real
// connection/stdio code) so a browser bundle importing this can never pull in Node-only code,
// structurally rather than by hoping tree-shaking catches it. Consumed by packages/docs-site's
// editor-feature demo widgets (docs-site/editor/*.vue) to run the real resolver logic client-side.

export { findNodeAtOffset, spanContains } from './resolution/findNodeAtOffset.js';
export { findDefinition, type DefinitionResult } from './resolution/definition.js';
export { getHover, type HoverResult } from './resolution/hover.js';
export { getCompletions, type CompletionCandidate, type CompletionSources } from './resolution/completion.js';
export { findRenameTargets, type RenameResult } from './resolution/rename.js';
export { getSignatureHelp, type SignatureHelpResult } from './resolution/signatureHelp.js';
