/**
 * Measured pauses after nonfinal phrases (word decoder, telephone, male)
 * next to the punctuation the recogniser wrote. Unlicense.
 * node experiments/issue-75-phrase-pauses.mjs lang "text" ...
 */
import { levelForTier, synthesize, recognize } from '../src/index.js';
const [lang, ...texts] = process.argv.slice(2);
for (const text of texts) {
  const spoken = synthesize(text, {
    lang,
    tier: 'telephone',
    head: 'random',
    preset: 'male',
    seed: 1,
  });
  const heard = recognize(spoken.samples, spoken.sampleRate, {
    level: levelForTier('telephone'),
  });
  const gaps = heard.words
    .slice(1)
    .map((w, i) => (w.start - heard.words[i].end).toFixed(2));
  console.log(text, '→', heard.text, gaps.join(' '));
}
