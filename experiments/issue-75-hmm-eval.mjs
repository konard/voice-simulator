/**
 * Round-trip metrics of recognize() with the HMM word stage injected, so
 * that search settings can be swept without changing the defaults.
 * node experiments/issue-75-hmm-eval.mjs [tier] [langs] [presets] [from] [to]
 * Environment: BLIND=0 decodes with the known language; OOV=0 drops the
 * phone loop; WORDS, LMW, WIP, BEAM, OOV_START, OOV_PHONE; VERBOSE=1.
 * Unlicense.
 */
import { performance } from 'node:perf_hooks';
import { recognize } from '../src/index.js';
import { hmmAudioToIpa } from '../src/recognition/hmm-stage.js';
import { roundTrip, sentences } from '../tests/helpers/roundtrip.js';

const [
  tier = 'telephone',
  langArg = 'en,ru,hi,zh',
  presetArg = 'male',
  from = '0',
  to = '20',
] = process.argv.slice(2);
const env = process.env;
const number = (name) =>
  env[name] === undefined ? undefined : Number(env[name]);
const search = Object.fromEntries(
  [
    ['lmw', 'LMW'],
    ['wip', 'WIP'],
    ['beam', 'BEAM'],
    ['oovStart', 'OOV_START'],
    ['oovPhone', 'OOV_PHONE'],
  ]
    .map(([key, name]) => [key, number(name)])
    .filter(([, v]) => v !== undefined)
);
const all = ['en', 'ru', 'hi', 'zh'];
const totals = {};
for (const lang of langArg.split(',')) {
  const languages = env.BLIND === '0' ? [lang] : all;
  const stage = (samples, rate) =>
    hmmAudioToIpa(samples, rate, {
      languages,
      search,
      maxWords: number('WORDS'),
      oov: env.OOV !== '0',
    });
  const sum = { per: 0, sound: 0, right: 0, n: 0, seconds: 0 };
  for (const preset of presetArg.split(',')) {
    for (
      let i = Number(from);
      i < Math.min(Number(to), sentences[lang].length);
      i++
    ) {
      const text = sentences[lang][i];
      const t0 = performance.now();
      const r = roundTrip(text, {
        lang,
        tier,
        preset,
        seed: 1,
        recognize: (samples, rate, options) =>
          recognize(samples, rate, {
            ...options,
            stages: { audioToIpa: stage },
          }),
      });
      sum.seconds += (performance.now() - t0) / 1000;
      sum.per += r.per.rate;
      sum.sound += r.soundWer.rate;
      sum.right += Number(r.languageRight);
      sum.n++;
      if (env.VERBOSE || r.soundWer.rate > 0) {
        console.log(
          preset,
          i,
          r.per.rate.toFixed(2),
          r.soundWer.rate.toFixed(2),
          JSON.stringify(text),
          '→',
          JSON.stringify(r.heard.text)
        );
      }
    }
  }
  totals[lang] = sum;
  console.log(
    `${lang} ${tier} PER ${(sum.per / sum.n).toFixed(3)} soundWER ${(sum.sound / sum.n).toFixed(3)} lang ${(sum.right / sum.n).toFixed(2)} ${(sum.seconds / sum.n).toFixed(1)} s/utt`,
    JSON.stringify(search)
  );
}
