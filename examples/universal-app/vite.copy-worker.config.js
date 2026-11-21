import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import { workerBuildDir } from './offline-worker.js';

// Produce a self-contained module before bundling the page. Separate
// builds keep Vite from holding the extra worker graph in memory while
// it bundles the app and the other workers.
export default defineConfig({
  publicDir: false,
  worker: { format: 'es' },
  build: {
    outDir: workerBuildDir,
    emptyOutDir: true,
    reportCompressedSize: false,
    rollupOptions: {
      input: fileURLToPath(
        new URL('./src/engine/session-worker.js', import.meta.url)
      ),
      output: {
        entryFileNames: 'session-worker.js',
        inlineDynamicImports: true,
      },
    },
  },
});
