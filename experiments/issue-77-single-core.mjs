/** Reproduce issue 77's cold, one-core CLI acceptance check on Linux. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { encodeWav } from '../src/audio/wav.js';
import { resample } from '../src/audio/resample.js';
import { synthesize } from '../src/index.js';

export function measureSingleCoreRecognition() {
  const allowed = readFileSync('/proc/self/status', 'utf8');
  const [, core] = /^Cpus_allowed_list:\s*(\d+)/m.exec(allowed);
  const rate = 8000;
  const speech = synthesize('The quick brown fox jumps over the lazy dog.', {
    engine: 'js',
    tier: 'minimal',
    seed: 1,
  });
  const samples = resample(speech.samples, speech.sampleRate, rate);
  const duration = samples.length / rate;
  const folder = mkdtempSync(join(tmpdir(), 'voice-simulator-fox-'));
  try {
    const wav = join(folder, 'fox.wav');
    writeFileSync(wav, encodeWav(samples, rate));
    return ['rust', 'js'].map((engine) => {
      const args = [
        process.execPath,
        'bin/voice-simulator.js',
        'recognize',
        wav,
        '--level',
        'low',
        '--engine',
        engine,
        '--threads',
        '1',
      ];
      const start = performance.now();
      const result = spawnSync('taskset', ['-c', core, ...args], {
        encoding: 'utf8',
      });
      const elapsed = (performance.now() - start) / 1000;
      if (result.status !== 0) {
        throw result.error ?? new Error(result.stderr);
      }
      return {
        engine,
        duration,
        elapsed,
        rtf: elapsed / duration,
        text: result.stdout.trim(),
      };
    });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}
