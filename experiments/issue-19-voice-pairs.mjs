// Issue 19: MCD between two synthetic voices (female and male preset heads,
// minimal tier, seed 1) saying the same sentence, after the 60 dB floor and
// the silent-reference rule, to re-measure the README claim about the scale.
//
//   node experiments/issue-19-voice-pairs.mjs
import {
  compareRecordings,
  presetHeadConfig,
  synthesize,
} from '../src/index.js';

const SENTENCES = [
  ['en', 'Hello.'],
  ['en', 'The quick brown fox jumps over the dog.'],
  ['en', 'She sells sea shells by the sea shore.'],
  ['ru', 'Доброе утро, как дела?'],
  ['hi', 'आज मौसम बहुत अच्छा है।'],
  ['zh', '今天天气很好。'],
];
for (const [lang, text] of SENTENCES) {
  const render = (sex, seed) =>
    synthesize(text, {
      lang,
      tier: 'minimal',
      seed,
      head: presetHeadConfig(sex),
    });
  const female = render('female', 1);
  const male = render('male', 1);
  const seed2 = render('female', 2);
  const fm = compareRecordings(female, male, { formants: false });
  const ff = compareRecordings(female, seed2, { formants: false });
  console.log(
    `${lang} ${JSON.stringify(text)}: female/male MCD ${fm.mcd.toFixed(1)} LSD ${fm.lsd.toFixed(1)}; seed 1/2 MCD ${ff.mcd.toFixed(1)}`
  );
}
