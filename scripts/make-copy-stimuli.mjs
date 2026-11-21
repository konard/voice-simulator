#!/usr/bin/env node
/** Build the copy listening studies from the public-domain golden set. Unlicense. */
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { encodeWav } from '../src/audio/wav.js';
import { resample } from '../src/audio/resample.js';
import { createEngine } from '../src/engine/index.js';
import { DEFAULT_HEAD } from '../src/head-config.js';
import { copyRecording, renderScore } from '../src/index.js';
import { saveVoice } from '../src/voice-file.js';
import { loadGolden } from '../tests/helpers/golden.js';
import {
  TEST_DIR,
  VOLUME_SECONDS,
  STIMULUS,
  loadConfig,
  pinkNoise,
  scaleToRms,
} from './listening-test.mjs';

const { values } = parseArgs({
  options: {
    out: { type: 'string', default: 'reports/copy-stimuli' },
    engine: { type: 'string', default: 'auto' },
    tier: { type: 'string' },
  },
});
const engine = await createEngine({ engine: values.engine, threads: 1 });
const items = new Map(loadGolden().map((item) => [item.id, item]));
const encoded = new Map();
const sampleRate = STIMULUS.sampleRate;
const options = { engine, sampleRate, seed: 1, tier: values.tier };
const defaultVoice = saveVoice(DEFAULT_HEAD);
const scores = new Map();

function copy(item) {
  if (!scores.has(item.id)) {
    scores.set(item.id, copyRecording(item.samples, item.sampleRate, options));
  }
  return scores.get(item.id);
}

function stimulus(path) {
  if (encoded.has(path)) {
    return encoded.get(path);
  }
  let samples;
  if (path === 'stimuli/volume.wav') {
    samples = pinkNoise(VOLUME_SECONDS, sampleRate);
  } else {
    const [, kind, id] =
      /^stimuli\/(original|copy|default)-([a-z]+-\d+)\.wav$/u.exec(path) ?? [];
    const item = items.get(id);
    if (!item) {
      throw new Error(`Unknown copy stimulus ${path}`);
    }
    if (kind === 'original') {
      samples = resample(item.samples, item.sampleRate, sampleRate);
    } else if (kind === 'copy') {
      samples = copy(item).samples;
    } else {
      samples = renderScore(
        { ...copy(item).score, voice: defaultVoice },
        options
      ).samples;
    }
  }
  const wav = encodeWav(scaleToRms(samples), sampleRate, {
    bitDepth: STIMULUS.bitDepth,
  });
  encoded.set(path, wav);
  return wav;
}

for (const id of ['copy-abx', 'copy-similarity']) {
  const file = join(TEST_DIR, `${id}.config.js`);
  const config = loadConfig(file);
  const out = resolve(values.out, id);
  const paths = new Set([config.volume]);
  for (const trial of config.trials) {
    const files =
      trial.type === 'abx'
        ? [trial.a, trial.b]
        : [trial.reference, ...Object.values(trial.conditions)];
    files.forEach((path) => paths.add(path));
  }
  for (const path of paths) {
    const target = join(out, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, stimulus(path));
    console.log(`${id}/${path}`);
  }
  for (const name of ['index.html', 'styles.css', 'app.js']) {
    copyFileSync(join(TEST_DIR, name), join(out, name));
  }
  copyFileSync(file, join(out, 'config.js'));
}
