/**
 * Phrase cues (rise, level, span …) per recognised phrase, word decoder,
 * telephone, male. Needs a temporary `globalThis.TRACE_CUES?.push(...)`
 * in phraseMark (src/recognition/prosody-mark.js). Unlicense.
 * node experiments/issue-75-phrase-cues.mjs lang "text" ...
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
  globalThis.TRACE_CUES = [];
  const heard = recognize(spoken.samples, spoken.sampleRate, {
    level: levelForTier('telephone'),
  });
  console.log(text, '→', heard.text);
  for (const c of globalThis.TRACE_CUES) {
    console.log(
      '  ',
      JSON.stringify(c, (k, v) => (typeof v === 'number' ? +v.toFixed(2) : v))
    );
  }
}
