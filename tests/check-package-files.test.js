/**
 * scripts/check-package-files.mjs: the published package must list the Rust
 * engine, its recognition data and the worker.
 */

import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, it, expect } from 'test-anywhere';
import { parse } from 'yaml';

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
      'src/engine/voice-simulator-oral-codebook.bin'
    );
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

  it('uploads every generated engine file using literal paths', () => {
    const workflow = parse(
      readFileSync(
        new URL('../.github/workflows/release.yml', import.meta.url),
        'utf8'
      )
    );
    const upload = workflow.jobs.rust.steps.find(
      (step) => step.with?.name === 'voice-simulator-wasm'
    );
    expect(upload.with.path.trim().split(/\s+/).sort()).toEqual(
      REQUIRED_FILES.filter((path) => !path.endsWith('.js')).sort()
    );
  });

  it('names the files a listing lacks', () => {
    expect(
      missingFiles(listing(['src/index.js', 'src/engine/worker.js']))
    ).toEqual([
      'src/engine/voice-simulator.wasm',
      'src/engine/voice-simulator-oral-codebook.bin',
      'src/engine/voice-simulator-recognition-models.json.gz',
      'src/engine/voice-simulator-recognition-en.json.gz',
      'src/engine/voice-simulator-recognition-ru.json.gz',
      'src/engine/voice-simulator-recognition-hi.json.gz',
      'src/engine/voice-simulator-recognition-zh.json.gz',
      'src/engine/voice-simulator-word-transitions-en.bin.gz',
      'src/engine/voice-simulator-word-transitions-ru.bin.gz',
      'src/engine/voice-simulator-word-transitions-hi.bin.gz',
      'src/engine/voice-simulator-word-transitions-zh.bin.gz',
      'src/engine/worker-protocol.js',
    ]);
  });
});
