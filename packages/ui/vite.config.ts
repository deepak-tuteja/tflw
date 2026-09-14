import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { metafilePlugin } from './scripts/metafile-plugin.ts';

// The page is a static bundle served by `tflw ui` from the CLI's own `dist/` (`M192` §3), so the
// build lands there and the CLI's tarball (`files: ["dist"]`) carries it. `base: './'` because
// the server mounts it wherever it likes; the page assumes no origin path.
export default defineConfig({
  plugins: [react(), metafilePlugin()],
  base: './',
  build: {
    outDir: '../cli/dist/ui',
    emptyOutDir: true,
    sourcemap: false,
  },
  server: { host: '127.0.0.1' },
});
