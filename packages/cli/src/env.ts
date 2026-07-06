// Minimal .env loader (no dependency). A gitignored .env is auto-loaded for local dev; real
// environment variables win over it (SPEC §3.4).

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** `.env` values overlaid by the real process environment (real env wins). */
export async function buildEnviron(cwd: string): Promise<NodeJS.ProcessEnv> {
  let fileVars: Record<string, string> = {};
  try {
    fileVars = parseDotenv(await readFile(join(cwd, '.env'), 'utf8'));
  } catch {
    // no .env — fine
  }
  return { ...fileVars, ...process.env };
}
