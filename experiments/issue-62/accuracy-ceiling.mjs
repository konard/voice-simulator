/** A necessary condition for silence/closure under the prescribed tree:
 * at least one nearby raw frame must have speech=0. Median-of-five and
 * deletion of runs shorter than 15 ms can only extend a zero by four hops.
 * This generous bound allows every other frame to be correct. */
import {
  synthesize,
  presetHeadConfig,
  analyzeFrames,
} from '../../src/index.js';
import { frameTruth } from '../../scripts/landmark-material.mjs';
const sentences = [
  ['en', 'The north wind and the sun were disputing which was the stronger.'],
  ['ru', 'Мама мыла раму.'],
  ['hi', 'नमस्ते दुनिया'],
  ['zh', '你好世界'],
];
for (const rate of [16000, 8000]) {
  let total = 0,
    impossible = 0,
    silence = 0,
    closure = 0;
  for (const [lang, text] of sentences) {
    for (const preset of ['male', 'female']) {
      const row = countImpossible(lang, text, preset, rate);
      total += row.total;
      impossible += row.impossible;
      silence += row.silence;
      closure += row.closure;
    }
  }
  console.log(
    JSON.stringify({
      rate,
      total,
      impossible,
      silence,
      closure,
      ceiling: 1 - impossible / total,
    })
  );
}

function countImpossible(lang, text, preset, rate) {
  let total = 0,
    impossible = 0,
    silence = 0,
    closure = 0;
  const out = synthesize(text, {
    lang,
    head: presetHeadConfig(preset),
    solver: 'waveguide',
    engine: 'js',
    sampleRate: rate,
    seed: 1,
  });
  const frames = analyzeFrames(out.samples, rate),
    truth = frameTruth(out.plan, frames);
  for (let t = 0; t < frames.count; t++) {
    if (truth[t] >= 0) {
      total++;
      if (truth[t] !== 0 && truth[t] !== 6) {
        continue;
      }
      let possible = false;
      for (
        let j = Math.max(0, t - 4);
        j <= Math.min(frames.count - 1, t + 4);
        j++
      ) {
        if (!frames.speech[j]) {
          possible = true;
        }
      }
      if (!possible) {
        impossible++;
        if (truth[t] === 0) {
          silence++;
        } else {
          closure++;
        }
      }
    }
  }
  return { total, impossible, silence, closure };
}
