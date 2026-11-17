// Unlicense. Compare deferred diagnostics with the pre-change implementation.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, URL } from 'node:url';
import { deepStrictEqual } from 'node:assert';
import { synthesize } from '../../src/synthesize.js';
import { fitVoice } from '../../src/analysis/voice-fit.js';
import {
  analyzeLegacyVoice,
  prepareLegacyVoice,
} from '../../src/analysis/voice-features.js';

const directory = mkdtempSync(join(tmpdir(), 'voice-fit-diagnostics-'));
try {
  function previousModule(name) {
    const originalUrl = new URL(
      `../../src/analysis/${name}.js`,
      import.meta.url
    );
    const original = execFileSync(
      'git',
      ['show', `75cd6c7:src/analysis/${name}.js`],
      { encoding: 'utf8' }
    );
    const file = join(directory, `${name}.mjs`);
    writeFileSync(
      file,
      original.replace(
        /from '([^']+)'/g,
        (_, ref) => `from '${new URL(ref, originalUrl).href}'`
      )
    );
    return import(pathToFileURL(file).href);
  }
  const baseline = await previousModule('voice-features');
  const previousFit = await previousModule('voice-fit');
  for (const head of [
    { vocalTractLength: 14, pitch: 210, tenseness: 0.45, speechRate: 1.15 },
    { vocalTractLength: 18.5, pitch: 100, tenseness: 0.75, speechRate: 0.9 },
  ]) {
    const audio = synthesize('The north wind and the sun.', {
      head,
      sampleRate: 16000,
      solver: 'waveguide',
      seed: 1,
      engine: 'js',
    });
    for (const diagnosticsOnly of [false, true]) {
      const events = [];
      const options = {
        diagnosticsOnly,
        trace: (event) => events.push(event),
      };
      const deferred = prepareLegacyVoice(
        audio.samples,
        audio.sampleRate,
        options
      );
      const partial = { ...deferred.rateFeatures };
      const peakFrames = events.at(-1).evaluated;
      const activeFrames = events.at(-1).activeFrames;
      deepStrictEqual(
        deferred.features,
        baseline.analyzeLegacyVoice(audio.samples, audio.sampleRate, {
          ...options,
          sourceDiagnostics: false,
        })
      );
      const expected = baseline.analyzeLegacyVoice(
        audio.samples,
        audio.sampleRate,
        options
      );
      deepStrictEqual(
        partial,
        Object.fromEntries(
          Object.keys(partial).map((key) => [key, expected[key]])
        )
      );
      deepStrictEqual(deferred.complete(), expected);
      deepStrictEqual(
        analyzeLegacyVoice(audio.samples, audio.sampleRate, options),
        expected
      );
      console.log(
        JSON.stringify({
          head,
          diagnosticsOnly,
          peakFrames,
          activeFrames,
          equal: true,
        })
      );
    }
    const options = {
      transcript: 'The north wind and the sun.',
      maxRenders: 2,
    };
    const before = previousFit.fitVoice(
      audio.samples,
      audio.sampleRate,
      options
    );
    const after = fitVoice(audio.samples, audio.sampleRate, options);
    deepStrictEqual({ ...before, renders: after.renders }, after);
    deepStrictEqual([before.renders, after.renders], [2, 1]);
    console.log(
      JSON.stringify({
        head,
        fitEqual: true,
        rendersBefore: before.renders,
        rendersAfter: after.renders,
      })
    );
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
