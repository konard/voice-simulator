/**
 * Issue 168: the blind word cues of a neutral sentence followed by a loud
 * one. Prints each word's pitch, alpha ratio and effort estimate against
 * the utterance-median baseline, and the pooled difference of the halves.
 * node experiments/issue-168-relative-trace.mjs [tier] [langs]
 * Unlicense.
 */
import { levelForTier, recognize, synthesize } from '../src/index.js';
import { summarize } from '../src/recognition/mode-features.js';
import { semitones } from '../src/recognition/mode-rules.js';
import { sentences } from '../tests/helpers/roundtrip.js';

const [tier = 'telephone', langs = 'en,ru,hi,zh'] = process.argv.slice(2);
const r = (v) => (Number.isFinite(v) ? v.toFixed(1) : String(v));
for (const lang of langs.split(',')) {
  const [first, second] = sentences[lang];
  const spoken = synthesize(
    `<speak>${first} <prosody volume="loud">${second}</prosody></speak>`,
    { lang, tier, head: 'random', preset: 'male', seed: 1, markup: true }
  );
  const loudStart = spoken.plan.modes.find((m) => m.effort > 0.5)?.start;
  let last;
  const heard = recognize(spoken.samples, spoken.sampleRate, {
    level: levelForTier(tier),
    trace: (e) => {
      if (e.stage === 'words') {
        last = e;
      }
    },
  });
  const { baseline: base, features, labels } = last;
  const halves = [[], []];
  features.forEach((w, i) => {
    if (w.vowels) {
      halves[Number(heard.words[i].start >= loudStart - 0.05)].push(w);
    }
  });
  const [a, b] = halves.map((h) => summarize(h));
  console.log(lang, tier, heard.text);
  console.log(
    `  base pitch ${r(base.pitch)} alpha ${r(base.alpha)};` +
      ` neutral half pitch ${r(a.pitch)} alpha ${r(a.alpha)};` +
      ` loud half pitch ${r(b.pitch)} alpha ${r(b.alpha)}` +
      ` (${r(semitones(b.pitch, a.pitch))} st, ${r(b.alpha - a.alpha)} dB)`
  );
  console.log(
    '  words',
    heard.words
      .map(
        (w, i) =>
          `${w.start >= loudStart - 0.05 ? '*' : ''}${w.ipa}:${r(features[i].pitch)}Hz/${r(features[i].alpha)}dB/E${r(labels[i].E)}/${labels[i].effort}`
      )
      .join(' ')
  );
}
