import { describe, it, expect } from 'test-anywhere';
import { readFileSync } from 'node:fs';
import {
  CHUNK_SIZE_LIMIT_KB,
  chunkSizeGuard,
  vendorChunk,
} from '../examples/universal-app/build-chunks.js';

const viteConfig = readFileSync(
  'examples/universal-app/vite.config.js',
  'utf8'
);

function runGuard(bundle) {
  const errors = [];
  chunkSizeGuard().generateBundle.call(
    {
      error(message) {
        errors.push(message);
        throw new Error(message);
      },
    },
    {},
    bundle
  );
  return errors;
}

describe('universal app chunking', () => {
  it('splits three.js and React into their own chunks on any OS', () => {
    for (const sep of ['/', '\\']) {
      const modules = ['app', 'node_modules'].join(sep);
      expect(
        vendorChunk([modules, 'three', 'build', 'three.core.js'].join(sep))
      ).toBe('three-core');
      expect(
        vendorChunk([modules, 'three', 'build', 'three.module.js'].join(sep))
      ).toBe('three');
      expect(
        vendorChunk(
          [modules, 'three', 'examples', 'jsm', 'OrbitControls.js'].join(sep)
        )
      ).toBe('three-addons');
      expect(vendorChunk([modules, 'react-dom', 'index.js'].join(sep))).toBe(
        'react'
      );
      expect(vendorChunk([modules, 'scheduler', 'index.js'].join(sep))).toBe(
        'react'
      );
    }
    expect(vendorChunk('/repo/src/index.js')).toBe(undefined);
    expect(vendorChunk('/repo/node_modules/threejs-extra/index.js')).toBe(
      undefined
    );
  });

  it('wires the chunking and the size guard into the Vite config', () => {
    expect(viteConfig).toContain('manualChunks: vendorChunk');
    expect(viteConfig).toContain('chunkSizeGuard()');
    expect(viteConfig).toContain('chunkSizeWarningLimit: CHUNK_SIZE_LIMIT_KB');
    expect(CHUNK_SIZE_LIMIT_KB).toBe(500);
  });

  it('fails the build when a chunk or worker passes the limit', () => {
    const small = 'x'.repeat(CHUNK_SIZE_LIMIT_KB * 1000);
    const large = `${small}x`;
    expect(
      runGuard({
        'index.js': { type: 'chunk', fileName: 'index.js', code: small },
        'index.css': { type: 'asset', fileName: 'index.css', source: large },
      })
    ).toEqual([]);

    let thrown;
    try {
      runGuard({
        'index.js': { type: 'chunk', fileName: 'index.js', code: large },
        'worker.js': {
          type: 'asset',
          fileName: 'worker.js',
          source: new Uint8Array(large.length),
        },
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown.message).toContain('index.js (500.00 kB)');
    expect(thrown.message).toContain('worker.js (500.00 kB)');
    expect(thrown.message).toContain('Split them in build-chunks.js');
  });
});
