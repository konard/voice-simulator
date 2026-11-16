import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import {
  CHUNK_SIZE_LIMIT_KB,
  chunkSizeGuard,
  vendorChunk,
} from './build-chunks.js';
import {
  crossOriginIsolation,
  isolationHeaders,
  isolationWorker,
} from './cross-origin-isolation.js';

function resolveBasePath() {
  if (process.env.GITHUB_PAGES !== 'true') {
    return './';
  }

  const repository = process.env.GITHUB_REPOSITORY?.split('/').at(-1);
  return repository ? `/${repository}/` : './';
}

// With VITE_CROSS_ORIGIN_ISOLATION=1 the dev and preview servers send the
// COOP/COEP headers and the page loads public/coi-serviceworker.js (see
// cross-origin-isolation.js); without it neither.
const isolated = crossOriginIsolation();
const headers = isolationHeaders(isolated);

export default defineConfig({
  base: resolveBasePath(),
  plugins: [react(), chunkSizeGuard(), isolationWorker(isolated)],
  worker: {
    format: 'es',
    rollupOptions: {
      output: {
        manualChunks: vendorChunk,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: CHUNK_SIZE_LIMIT_KB,
    rollupOptions: {
      output: {
        manualChunks: vendorChunk,
      },
    },
  },
  server: {
    fs: {
      allow: ['../..'],
    },
    headers,
  },
  preview: {
    headers,
  },
});
