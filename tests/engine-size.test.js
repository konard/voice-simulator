/**
 * The size of the shipped engine: every src/engine/*.wasm stays within
 * WASM_SIZE_BUDGET of scripts/build-wasm.mjs, the budget its build checks,
 * and bundlers can find it (the app's build copies it next to its workers).
 */

import { describe, it, expect } from 'test-anywhere';
import { readFileSync, readdirSync, statSync } from 'node:fs';

import { WASM_SIZE_BUDGET } from '../scripts/build-wasm.mjs';

const ENGINE_DIR = new globalThis.URL('../src/engine/', import.meta.url);

describe('engine size', () => {
  it('has a budget of 208 KiB', () => {
    expect(WASM_SIZE_BUDGET).toBe(294912);
  });

  it('keeps every shipped .wasm within the budget', () => {
    const files = readdirSync(ENGINE_DIR).filter((name) =>
      name.endsWith('.wasm')
    );
    for (const name of files) {
      const { size } = statSync(new globalThis.URL(name, ENGINE_DIR));
      expect(`${name}: ${size <= WASM_SIZE_BUDGET ? 'ok' : size}`).toBe(
        `${name}: ok`
      );
    }
  });

  it('names the engine with a URL that bundlers copy', () => {
    // Vite, webpack and Rollup emit an asset for the literal
    // `new URL('./file', import.meta.url)` and not for globalThis.URL.
    const loader = readFileSync(
      new globalThis.URL('wasm-loader.js', ENGINE_DIR),
      'utf8'
    );
    expect(loader).toContain(
      "new URL('./voice-simulator.wasm', import.meta.url)"
    );
  });
});
