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
import {
  fillSonority,
  sonorityFilters,
} from '../../src/recognition/landmark-signals.js';
const sentences = [
  ['en', 'The north wind and the sun were disputing which was the stronger.'],
  ['ru', 'Мама мыла раму.'],
  ['hi', 'नमस्ते दुनिया'],
  ['zh', '你好世界'],
];
let total = 0,
  possible = 0;
const sensitivity = new Map();
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
for (const [smoothing, count] of sensitivity) {
  console.log(
    JSON.stringify({
      smoothing,
      total,
      possible: count,
      recallCeiling: count / total,
    })
  );
}

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
  const matched = recoverable(frames, s, truth);
  if (process.argv.includes('--smoothing-sensitivity')) {
    const raw = new Float32Array(frames.count);
    fillSonority(frames, raw, 0, sonorityFilters(frames));
    for (const [label, left, right] of [
      ['centred-9', 4, 4],
      ['trailing-8', 7, 0],
      ['leading-8', 0, 7],
    ]) {
      const variant = Float32Array.from(raw, (_, t) => {
        const lo = Math.max(0, t - left),
          hi = Math.min(raw.length - 1, t + right);
        let sum = 0;
        for (let j = lo; j <= hi; j++) {
          sum += raw[j];
        }
        return sum / (hi - lo + 1);
      });
      sensitivity.set(
        label,
        (sensitivity.get(label) ?? 0) + recoverable(frames, variant, truth)
      );
    }
  }
  total += truth.length;
  possible += matched;
  console.log(`${lang}:${preset}@${rate}: ${matched}/${truth.length}`);
  return { total, possible };
}

function recoverable(frames, s, truth) {
  const peaks = [];
  for (let t = 0; t < frames.count; t++) {
    if (frames.periodicity[t] < 0.45) {
      continue;
    }
    let max = true;
    const radius = Math.round(0.04 / frames.hop);
    for (
      let j = Math.max(0, t - radius);
      j <= Math.min(frames.count - 1, t + radius);
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
  return truth.filter((target) =>
    peaks.some((t) => Math.abs(t - target) <= 0.05)
  ).length;
}
