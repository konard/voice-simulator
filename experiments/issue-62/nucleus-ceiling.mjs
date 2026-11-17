/** Upper bound: every voiced local sonority maximum is permitted, ignoring
 * noise, separation and dip gates. A true nucleus without any such maximum
 * within 50 ms cannot be recovered by tuning those gates. */
import {
  synthesize,
  presetHeadConfig,
  analyzeFrames,
  syllabifyTokens,
} from '../../src/index.js';
import { sonorityOf } from '../../scripts/landmark-material.mjs';
const sentences = [
  ['en', 'The north wind and the sun were disputing which was the stronger.'],
  ['ru', 'Мама мыла раму.'],
  ['hi', 'नमस्ते दुनिया'],
  ['zh', '你好世界'],
];
let total = 0,
  possible = 0;
for (const [lang, text] of sentences) {
  for (const preset of ['male', 'female']) {
    for (const rate of [16000, 8000]) {
      const row = measure(lang, text, preset, rate);
      total += row.total;
      possible += row.possible;
    }
  }
}
console.log(
  JSON.stringify({ total, possible, recallCeiling: possible / total })
);

function measure(lang, text, preset, rate) {
  let total = 0,
    possible = 0;
  const out = synthesize(text, {
    lang,
    head: presetHeadConfig(preset),
    solver: 'waveguide',
    engine: 'js',
    sampleRate: rate,
    seed: 1,
  });
  const frames = analyzeFrames(out.samples, rate),
    s = sonorityOf(frames);
  const peaks = [];
  for (let t = 0; t < frames.count; t++) {
    if (frames.periodicity[t] < 0.45) {
      continue;
    }
    let max = true;
    for (
      let j = Math.max(0, t - 8);
      j <= Math.min(frames.count - 1, t + 8);
      j++
    ) {
      if (s[j] > s[t]) {
        max = false;
      }
    }
    if (max) {
      peaks.push(t * frames.hop);
    }
  }
  const truth = syllabifyTokens(out.plan.tokens, {
    language: lang,
  }).flatMap((tokens) => {
    const segments = out.plan.segments.filter(
      (seg) => seg.kind === 'vowel' && tokens.includes(seg.token)
    );
    return segments.length
      ? [(segments[0].start + segments.at(-1).end) / 2]
      : [];
  });
  let matched = 0;
  for (const target of truth) {
    if (peaks.some((t) => Math.abs(t - target) <= 0.05)) {
      matched++;
    }
  }
  total += truth.length;
  possible += matched;
  console.log(`${lang}:${preset}@${rate}: ${matched}/${truth.length}`);
  return { total, possible };
}
