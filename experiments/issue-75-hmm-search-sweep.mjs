/**
 * Round-trip metrics of the shipped HMM decoder under several search
 * settings; each sentence is rendered once and decoded per setting.
 * node experiments/issue-75-hmm-search-sweep.mjs <tier> <lang> <from> <to> <preset> '<json settings list>'
 * e.g. '[{}, {"beam": 160}, {"maxWords": 20000}]'. Unlicense.
 */
import { recognize, synthesize } from '../src/index.js';
import { hmmAudioToIpa } from '../src/recognition/hmm-stage.js';
import { roundTrip, sentences } from '../tests/helpers/roundtrip.js';

const [
  tier = 'telephone',
  lang = 'en',
  from = '0',
  to = '20',
  preset = 'male',
  list = '[{}]',
] = process.argv.slice(2);
const configs = JSON.parse(list);
const sums = configs.map(() => ({
  per: [0, 0],
  sw: [0, 0],
  lang: 0,
  n: 0,
  tone: [0, 0],
  stress: [0, 0],
  time: [0, 0],
  sec: 0,
}));
for (let i = Number(from); i < Number(to); i++) {
  const text = sentences[lang][i];
  const spoken = synthesize(text, {
    lang,
    tier,
    head: 'random',
    preset,
    seed: 1,
    markup: false,
  });
  configs.forEach((config, k) => {
    const { maxWords, ...search } = config;
    const r = roundTrip(text, {
      lang,
      tier,
      preset,
      seed: 1,
      spoken,
      recognize: (samples, rate, options) =>
        recognize(samples, rate, {
          ...options,
          stages: {
            audioToIpa: (s, sr) => hmmAudioToIpa(s, sr, { maxWords, search }),
          },
        }),
    });
    const m = sums[k];
    m.per[0] += r.per.distance;
    m.per[1] += r.per.referenceLength;
    m.sw[0] += r.soundWer.distance;
    m.sw[1] += r.soundWer.referenceLength;
    m.lang += r.languageRight;
    m.n++;
    m.sec += r.seconds;
    m.time[0] += r.timeErrors.total;
    m.time[1] += r.timeErrors.errors.length;
    if (r.toneErrors) {
      m.tone[0] += r.toneErrors.distance;
      m.tone[1] += r.toneErrors.referenceLength;
    }
    if (r.stressHits) {
      m.stress[0] += r.stressHits.hits;
      m.stress[1] += r.stressHits.count;
    }
    if (r.soundWer.distance || process.env.VERBOSE) {
      console.log(
        `#${k} ${i + 1} sw ${r.soundWer.distance}/${r.soundWer.referenceLength} ${JSON.stringify(text)} → ${JSON.stringify(r.heard.text)}`
      );
    }
  });
}
configs.forEach((config, k) => {
  const m = sums[k];
  const f = (a) => (a[0] / Math.max(1, a[1])).toFixed(3);
  console.log(
    `#${k} ${lang} ${tier} ${preset} ${JSON.stringify(config)} PER ${f(m.per)} soundWER ${f(m.sw)} lang ${(m.lang / m.n).toFixed(2)} time ${f(m.time)} tone ${f(m.tone)} stress ${f(m.stress)} sec/utt ${(m.sec / m.n).toFixed(2)}`
  );
});
