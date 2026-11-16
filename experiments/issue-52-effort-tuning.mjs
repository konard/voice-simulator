// Measure what the effort modes of issue 52 change: level, median f0,
// alpha ratio, H1-H2, F1 of `ˈa` and vowel and consonant durations, each
// against plain speech. Used to tune TENSION_PER_DB and JAW_PER_DB of
// src/articulation/effort.js.
// Usage: node experiments/issue-52-effort-tuning.mjs [source]
import { analyzeVoice, synthesize } from '../src/index.js';
import { alphaRatio, levelDb } from '../src/analysis/mode-features.js';

const source = process.argv[2] ?? 'lf';
const base = { tier: 'medium', seed: 1, markup: true, headroom: 20, source };
const text = 'Please call Stella.';

function durations(plan) {
  let vowels = 0;
  let consonants = 0;
  for (const segment of plan.segments) {
    if (segment.kind === 'vowel') {
      vowels += segment.duration;
    } else if (segment.token && segment.kind !== 'pause') {
      consonants += segment.duration;
    }
  }
  return { vowels, consonants };
}

function measure(input, options = {}) {
  const r = synthesize(input, { ...base, ...options });
  const n = r.samples.length;
  const voice = analyzeVoice(r.samples, r.sampleRate);
  return {
    level: levelDb(r.samples, 0, n),
    alpha: alphaRatio(r.samples, r.sampleRate, 0, n),
    f0: voice.f0,
    h1h2: voice.h1h2,
    f1: voice.formants[0],
    ...durations(r.plan),
  };
}

const plain = measure(text);
console.log('plain', JSON.stringify(plain));
for (const tag of ['soft', 'loud', 'shout', 'lombard']) {
  const m = measure(`[${tag}]${text}[/${tag}]`);
  console.log(
    tag.padEnd(8),
    `level ${(m.level - plain.level).toFixed(2)} dB`,
    `f0 ${(12 * Math.log2(m.f0 / plain.f0)).toFixed(2)} st`,
    `alpha ${(m.alpha - plain.alpha).toFixed(2)} dB`,
    `h1h2 ${(m.h1h2 - plain.h1h2).toFixed(2)} dB`,
    `vowels x${(m.vowels / plain.vowels).toFixed(3)}`,
    `consonants x${(m.consonants / plain.consonants).toFixed(3)}`
  );
}
const gain = measure(
  '<speak><prosody vs:gain="-6dB">Please call Stella.</prosody></speak>'
);
console.log(
  'gain-6  ',
  `level ${(gain.level - plain.level).toFixed(2)} dB`,
  `alpha ${(gain.alpha - plain.alpha).toFixed(2)} dB`
);
const a = measure('ˈa', { ipa: true, markup: false });
for (const ipa of ['{p ˈa p}', '{f ˈa f}', '{ff ˈa ff}']) {
  const m = measure(ipa, { ipa: true, markup: false });
  console.log(
    ipa.padEnd(10),
    `F1 ${a.f1.toFixed(0)} -> ${m.f1.toFixed(0)} (${(m.f1 - a.f1).toFixed(1)} Hz)`,
    `f0 ${(12 * Math.log2(m.f0 / a.f0)).toFixed(2)} st`
  );
}
