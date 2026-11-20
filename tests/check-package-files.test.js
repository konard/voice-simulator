/**
 * scripts/check-package-files.mjs: the published package must list the Rust
 * engine, its recognition data and the worker.
 */

import { describe, it, expect } from 'test-anywhere';

import {
  REQUIRED_FILES,
  missingFiles,
} from '../scripts/check-package-files.mjs';

const listing = (paths) => [
  { files: paths.map((path) => ({ path, size: 1 })) },
];

describe('check-package-files', () => {
  it('requires the engine, recognition data and the worker', () => {
    expect(REQUIRED_FILES).toContain('src/engine/voice-simulator.wasm');
    expect(REQUIRED_FILES).toContain(
      'src/engine/voice-simulator-recognition-models.json.gz'
    );
    expect(REQUIRED_FILES).toContain('src/engine/worker.js');
  });

  it('accepts a listing with every required file', () => {
    expect(missingFiles(listing([...REQUIRED_FILES, 'src/index.js']))).toEqual(
      []
    );
  });

  it('names the files a listing lacks', () => {
    expect(
      missingFiles(listing(['src/index.js', 'src/engine/worker.js']))
    ).toEqual([
      'src/engine/voice-simulator.wasm',
      'src/engine/voice-simulator-recognition-models.json.gz',
      'src/engine/voice-simulator-recognition-en.json.gz',
      'src/engine/voice-simulator-recognition-ru.json.gz',
      'src/engine/voice-simulator-recognition-hi.json.gz',
      'src/engine/voice-simulator-recognition-zh.json.gz',
      'src/engine/worker-protocol.js',
    ]);
  });
});
