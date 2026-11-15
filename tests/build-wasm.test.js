/**
 * scripts/build-wasm.mjs without running cargo: the arguments, the size
 * budget and the "no cargo" path that keeps the JavaScript engine.
 */

import { describe, it, expect } from 'test-anywhere';

import {
  NO_CARGO_MESSAGE,
  WASM_SIZE_BUDGET,
  describeWasm,
  main,
  parseArgs,
  sizeProblem,
} from '../scripts/build-wasm.mjs';

/** Run main() with a PATH that has no cargo and collect its output. */
function runWithoutCargo(argv) {
  const out = [];
  const err = [];
  const code = main({
    argv,
    env: { PATH: '/nonexistent' },
    log: (line) => out.push(line),
    error: (line) => err.push(line),
  });
  return { code, out, err };
}

describe('build-wasm script', () => {
  it('parses its two switches and rejects anything else', () => {
    expect(parseArgs([])).toEqual({ checkSize: false, require: false });
    expect(parseArgs(['--check-size', '--require'])).toEqual({
      checkSize: true,
      require: true,
    });
    expect(() => parseArgs(['--release'])).toThrow();
    expect(runWithoutCargo(['--fast']).code).toBe(2);
  });

  it('keeps the JavaScript engine when cargo is missing', () => {
    const { code, out, err } = runWithoutCargo(['--check-size']);
    expect(code).toBe(0);
    expect(out).toEqual([NO_CARGO_MESSAGE]);
    expect(err).toEqual([]);
  });

  it('fails without cargo when the build is required', () => {
    const { code, err } = runWithoutCargo(['--require']);
    expect(code).toBe(1);
    expect(err).toEqual([NO_CARGO_MESSAGE]);
  });

  it('measures the file and checks it against the budget', () => {
    const { size, sha256 } = describeWasm(new Uint8Array([0, 97, 115, 109]));
    expect(size).toBe(4);
    expect(sha256).toBe(
      'cd5d4935a48c0672cb06407bb443bc0087aff947c6b864bac886982c73b3027f'
    );
    expect(sizeProblem(WASM_SIZE_BUDGET)).toBe(null);
    expect(sizeProblem(WASM_SIZE_BUDGET + 1).includes('over')).toBe(true);
  });
});
