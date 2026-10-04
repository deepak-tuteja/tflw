// `M269` — a page's title is its own `# H1` (see `src/content.config.ts`).

/** The first `# ` line outside a code fence, or `undefined`. */
export function firstH1(text) {
  let fence = null;
  for (const line of text.split('\n')) {
    const open = /^\s*(`{3,}|~{3,})/.exec(line);
    if (open) {
      if (fence === null) fence = open[1][0];
      else if (line.trim().startsWith(fence)) fence = null;
      continue;
    }
    if (fence === null && line.startsWith('# ')) return line.slice(2).trim();
  }
  return undefined;
}

/** `{ title, titleSource }` from an H1: the plain words, and the H1 as written. */
export const titleFrom = (h1) => ({ title: h1.replace(/`([^`]+)`/g, '$1'), titleSource: h1 });
