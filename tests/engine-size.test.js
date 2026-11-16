/**
 * The size of the shipped engine: every src/engine/*.wasm stays within
 * WASM_SIZE_BUDGET of scripts/build-wasm.mjs, the budget its build checks.
 */

import { describe, it, expect } from 'test-anywhere';
import { readdirSync, statSync } from 'node:fs';

import { WASM_SIZE_BUDGET } from '../scripts/build-wasm.mjs';

const ENGINE_DIR = new globalThis.URL('../src/engine/', import.meta.url);

describe('engine size', () => {
  it('has a budget of 192 KiB', () => {
    expect(WASM_SIZE_BUDGET).toBe(196608);
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
});
