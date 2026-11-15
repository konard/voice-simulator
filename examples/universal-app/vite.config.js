import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import {
  CHUNK_SIZE_LIMIT_KB,
  chunkSizeGuard,
  vendorChunk,
} from './build-chunks.js';

function resolveBasePath() {
  if (process.env.GITHUB_PAGES !== 'true') {
    return './';
  }

  const repository = process.env.GITHUB_REPOSITORY?.split('/').at(-1);
  return repository ? `/${repository}/` : './';
}

/**
 * With VITE_CROSS_ORIGIN_ISOLATION=1 the dev and preview servers send the
 * COOP/COEP headers that make the page cross-origin isolated, so the audio
 * player shares a SharedArrayBuffer ring with its AudioWorklet
 * ('worklet-shared'); without them it posts the samples ('worklet-port').
 */
const isolationHeaders =
  process.env.VITE_CROSS_ORIGIN_ISOLATION === '1'
    ? {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      }
    : undefined;

export default defineConfig({
  base: resolveBasePath(),
  plugins: [react(), chunkSizeGuard()],
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
    headers: isolationHeaders,
  },
  preview: {
    headers: isolationHeaders,
  },
});
