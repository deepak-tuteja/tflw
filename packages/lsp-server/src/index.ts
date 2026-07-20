// @tflw/lsp-server — public surface. Phase 2's pure, offset-based resolution functions (no I/O, no
// vscode-languageserver) plus Phase 3's protocol wiring (`startServer()`) and I/O layer
// (`src/workspace/`), per PLAN_M13_LSP.md.

export { findNodeAtOffset, spanContains } from './resolution/findNodeAtOffset.js';
export { findDefinition, type DefinitionResult } from './resolution/definition.js';
export { getHover, type HoverResult } from './resolution/hover.js';
export { getCompletions, type CompletionCandidate, type CompletionSources } from './resolution/completion.js';
export { findRenameTargets, type RenameResult } from './resolution/rename.js';
export { getSignatureHelp, type SignatureHelpResult } from './resolution/signatureHelp.js';

export { startServer, type StartServerOptions } from './server.js';
export { findProjectRoot } from './workspace/project.js';
export { loadProjectConfig, resolutionErrorDiagnostic, type ProjectConfig } from './workspace/configResolution.js';
export { DocumentStore, type DocumentAnalysis, type DocumentKind } from './workspace/documentStore.js';
export { CrossFileResolver, type ImportedActionLocation } from './workspace/crossFile.js';
export { discoverProjectFiles, findCrossFileRenameEdits, type CrossFileRenameEdit } from './workspace/workspaceIndex.js';
