/**
 * Punctuation of Mandarin round trips with the default word decoder: the
 * heard text, whether its sentence mark is right, and the gaps between
 * decoded words (s) that phraseRanges of prosody-mark.js turns into
 * commas from 0.15 s.
 * node experiments/issue-75-zh-marks.mjs [tier] [presets] [from] [to] [lang]
 * Unlicense.
 */
import { recognize } from '../src/index.js';
import {
  roundTrip,
  sentenceMark,
  sentences,
} from '../tests/helpers/roundtrip.js';

const [
  tier = 'telephone',
  presets = 'male,female',
  from = '0',
  to = '20',
  lang = 'zh',
] = process.argv.slice(2);
let right = 0;
let total = 0;
for (const preset of presets.split(',')) {
  for (
    let i = Number(from);
    i < Math.min(Number(to), sentences[lang].length);
    i++
  ) {
    const text = sentences[lang][i];
    let gaps = [];
    const r = roundTrip(text, {
      lang,
      tier,
      preset,
      seed: 1,
      recognize: (samples, rate, options) => {
        const out = recognize(samples, rate, options);
        const words = out.words ?? [];
        gaps = words
          .slice(1)
          .map((w, j) => (w.start - words[j].end).toFixed(2));
        return out;
      },
    });
    const ok = sentenceMark(r.heard.text) === sentenceMark(text);
    right += Number(ok);
    total++;
    console.log(
      preset,
      i,
      ok ? 'ok ' : 'BAD',
      text,
      '→',
      r.heard.text,
      'gaps',
      gaps.join(' ')
    );
  }
}
console.log(`${lang} ${tier} mark right ${right}/${total}`);
