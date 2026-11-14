// Quartiles of f0 (Hz) for Mandarin syllables, measured two ways (issue 42):
// - "all": every frame of the utterance, as `issue-11-audit.mjs` did before
//   issue 42 (f0 is defined in every frame, so `value > 0` kept the pauses);
// - "voiced": only frames whose voicing channel is above 0.5, as the audit
//   does now.
// Run in two checkouts to compare code versions:
//   node experiments/issue-42-tone-quartiles.mjs
import { textToIpa, planUtterance } from '../src/index.js';

const quartiles = (values) =>
  [0, 0.25, 0.5, 0.75, 1].map((quantile) =>
    Math.round(values[Math.floor(quantile * (values.length - 1))] ?? 0)
  );

for (const text of ['mā', 'má', 'mǎ', 'mà', 'ma', '你好', '我很好']) {
  const { ipa } = textToIpa(text, { lang: 'zh' });
  const { channels } = planUtterance(ipa, {});
  const all = Array.from(channels.f0);
  const voiced = all.filter((_, frame) => channels.voicing[frame] > 0.5);
  console.log(
    `zh ${text}: ${JSON.stringify({ ipa, all: quartiles(all), voiced: quartiles(voiced) })}`
  );
}
