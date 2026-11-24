/**
 * One smoke case with its sound tokens: node experiments/issue-75-smoke-trace.mjs ru 1
 * Unlicense.
 */
import { roundTrip, sentences } from '../tests/helpers/roundtrip.js';
const [lang = 'ru', index = '1', tier = 'telephone', preset = 'male'] =
  process.argv.slice(2);
const text = sentences[lang][Number(index)];
const r = roundTrip(text, { lang, tier, preset, seed: 1 });
console.log(
  JSON.stringify(
    {
      text,
      heard: r.heard.text,
      lang: r.heard.languages[0],
      per: r.per.rate,
      soundWer: r.soundWer,
      seconds: r.seconds,
    },
    null,
    1
  )
);
console.log('ref ', r.spoken.ipa);
console.log('heard', r.heard.ipa);
