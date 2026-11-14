// Audit of the current behaviour for the gap analysis of issue 11.
// Run: node experiments/issue-11-audit.mjs > experiments/issue-11-audit.txt
import { performance } from 'node:perf_hooks';
import {
  textToIpa,
  planUtterance,
  prepareUtterance,
  synthesize,
  analyzeVoice,
  AUDIO_TIERS,
  HEAD_PARAMETERS,
} from '../src/index.js';

const show = (label, value) =>
  console.log(`${label}: ${JSON.stringify(value)}`);

// 1. Mandarin tones: which pitch does each tone get (quartiles of f0 over
// the voiced frames; f0 is defined in every frame, so the frames are picked
// by the voicing channel, see issue 42)?
for (const text of [
  'mā',
  'má',
  'mǎ',
  'mà',
  'ma',
  '你好',
  '我很好',
  '银行',
  '花儿',
]) {
  const { ipa } = textToIpa(text, { lang: 'zh' });
  const { channels } = planUtterance(ipa, {});
  const voiced = Array.from(channels.f0).filter(
    (_, frame) => channels.voicing[frame] > 0.5
  );
  const pick = (quantile) =>
    Math.round(voiced[Math.floor(quantile * (voiced.length - 1))] ?? 0);
  show(`zh ${text}`, { ipa, f0: [0, 0.25, 0.5, 0.75, 1].map(pick) });
}

// 2. Words whose reading depends on the context, and stress.
for (const [lang, text] of [
  ['en', 'I read the book yesterday. Did you record the record?'],
  ['en', 'I live here. A live show. Lead pipe. They lead.'],
  ['en', 'The wind blows. Wind the clock.'],
  ['ru', 'Замок на замке. Я хочу большие города.'],
  ['ru', 'Я вижу стрелки часов. Белки едят орехи. Сорок сорок.'],
  ['hi', 'नमस्ते, आप कैसे हैं?'],
  ['hi', 'क्या तुम आओगे?'],
]) {
  show(lang, textToIpa(text, { lang }).ipa);
}

// 3. Lowest audio settings.
show(
  'tiers',
  AUDIO_TIERS.map((tier) => `${tier.name}@${tier.sampleRate}`)
);
for (const sampleRate of [8000, 11025, 16000]) {
  const out = synthesize('Hello world.', {
    tier: 'minimal',
    sampleRate,
    seed: 1,
  });
  const features = analyzeVoice(out.samples, out.sampleRate);
  show(`minimal@${sampleRate}`, {
    rate: out.sampleRate,
    f0: Math.round(features.f0),
    formants: features.formants.map(Math.round),
  });
}

// 4. Configuration.
show('head parameters', HEAD_PARAMETERS.length);

// 5. Does `breathiness` change what the analysis measures?
for (const breathiness of [0, 0.5, 1]) {
  const { samples, sampleRate } = synthesize(
    'Please call Stella and ask her to bring these things with her.',
    { tier: 'medium', seed: 1, head: { breathiness } }
  );
  const features = analyzeVoice(samples, sampleRate);
  show(`breathiness ${breathiness}`, {
    hnr: Number(features.hnr.toFixed(2)),
    h1h2: Number(features.h1h2.toFixed(2)),
  });
}

// 6. Syllable highlighting of numbers and dates.
const { timeline } = prepareUtterance('I have 25 apples on 3/4/2024.', {
  lang: 'en',
  tier: 'minimal',
});
show(
  'highlight',
  timeline.words.map((word) => ({
    text: word.text,
    syllables: word.syllables.map((syllable) => syllable.text ?? null),
  }))
);

// 7. Level of a nasal murmur against the vowel next to it, per solver.
const rms = (samples, sampleRate, from, to) => {
  const start = Math.floor(from * sampleRate);
  const end = Math.floor(to * sampleRate);
  let sum = 0;
  for (let index = start; index < end; index++) {
    sum += samples[index] ** 2;
  }
  return Math.sqrt(sum / Math.max(1, end - start));
};
for (const tier of ['medium', 'high']) {
  const out = synthesize('ˈama', { ipa: true, tier, seed: 1 });
  const middle = (kind) => {
    const segment = out.plan.segments.find((item) => item.kind === kind);
    const centre = (segment.start + segment.end) / 2;
    return rms(out.samples, out.sampleRate, centre - 0.015, centre + 0.015);
  };
  show(`nasal/vowel level ${tier}`, {
    ratio: Number((middle('consonant') / middle('vowel')).toFixed(2)),
  });
}

// 8. Sentence types: pitch (Hz) at the end of the last vowel.
for (const text of [
  'You are coming.',
  'You are coming?',
  'You are coming!',
  'Are you coming?',
  'Where are you going?',
  'Tea or coffee?',
]) {
  const { plan } = prepareUtterance(text, { lang: 'en', tier: 'minimal' });
  const vowels = plan.segments.filter((segment) => segment.kind === 'vowel');
  const frame = (time) => Math.round(time * plan.frameRate);
  const at = (time) => Math.round(plan.channels.f0[frame(time)]);
  const loudness = Math.max(...plan.channels.loudness);
  show(`en ${text}`, {
    first: at(vowels[0].start + 0.02),
    last: at(vowels.at(-1).end - 0.02),
    peakLoudness: Number(loudness.toFixed(2)),
  });
}

// 9. Real-time factor of every tier on this machine (one core).
const sentence = 'The quick brown fox jumps over the lazy dog.';
for (const tier of AUDIO_TIERS.slice(0, 5)) {
  const started = performance.now();
  const out = synthesize(sentence, { tier: tier.name, seed: 1 });
  const elapsed = (performance.now() - started) / 1000;
  show(`rtf ${tier.name}`, Number((elapsed / out.duration).toFixed(2)));
}
