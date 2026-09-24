export function stagedSetup(bring: () => Promise<void>): {
  begin: () => Promise<void>;
  settled: () => Promise<void>;
};
