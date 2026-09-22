// Types for `tflw-corpus.mjs`, which is plain JavaScript because `scripts/` is — and is imported
// by tests in three typechecked packages, which is why this exists at all (`M215-01`, `D1274`).
export declare const SKIP_DIR: RegExp;
export declare function tflwIn(dir: string): string[];
export declare function tflwFiles(roots: readonly string[] | string): string[];
