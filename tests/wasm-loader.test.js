import { describe, it, expect } from 'test-anywhere';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  ENGINE_ABI_VERSION,
  loadEngineModule,
} from '../src/engine/wasm-loader.js';

// (module (func (export "vs_abi_version") (result i32) i32.const 1)): the
// smallest engine the loader accepts, so the file: path is tested without
// a Rust build.
const tinyEngine = Buffer.from(
  [
    '0061736d01000000', // magic, version 1
    '0105016000017f', // type 0: () -> i32
    '03020100', // function 0 has type 0
    `0712010e${Buffer.from('vs_abi_version').toString('hex')}0000`, // export
    `0a0601040041${ENGINE_ABI_VERSION.toString(16).padStart(2, '0')}0b`, // code
  ].join(''),
  'hex'
);

describe('wasm-loader', () => {
  it('reads a file: URL without a node: import a bundler can see (issue 115)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wasm-loader-'));
    try {
      const file = join(dir, 'engine.wasm');
      writeFileSync(file, tinyEngine);
      const engine = await loadEngineModule(pathToFileURL(file));
      expect(engine?.abiVersion).toBe(ENGINE_ABI_VERSION);
      expect(
        await loadEngineModule(pathToFileURL(join(dir, 'none.wasm')))
      ).toBe(null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    // Vite replaced a literal import('node:fs/promises') with an empty
    // browser stub and warned on every example app build.
    const source = readFileSync('src/engine/wasm-loader.js', 'utf8');
    expect(/import\(\s*['"]node:/.test(source)).toBe(false);
  });
});
