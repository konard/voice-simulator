/** Round trips through the public recognize(): node experiments/issue-75-public-roundtrip.mjs <tier> <lang> [from] [to] [preset] */
import { roundTrip, sentences } from '../tests/helpers/roundtrip.js';
const [tier = 'telephone', lang = 'zh', from = '0', to = '5', preset = 'male'] =
  process.argv.slice(2);
let per = 0,
  perN = 0,
  sw = 0,
  swN = 0,
  lr = 0,
  n = 0,
  tm = 0,
  tmN = 0,
  sec = 0;
for (let i = +from; i < +to; i++) {
  const r = roundTrip(sentences[lang][i], { lang, tier, preset, seed: 1 });
  per += r.per.distance;
  perN += r.per.referenceLength;
  sw += r.soundWer.distance;
  swN += r.soundWer.referenceLength;
  lr += r.languageRight ? 1 : 0;
  n++;
  sec += r.seconds;
  if (r.toneErrors) {
    tm += r.toneErrors.distance ?? 0;
    tmN += r.toneErrors.referenceLength ?? 0;
  }
  console.log(
    i + 1,
    r.per.rate.toFixed(3),
    r.soundWer.rate.toFixed(3),
    r.languageRight,
    JSON.stringify(r.heard.text),
    `${r.seconds.toFixed(2)}s`
  );
}
console.log(
  `PER ${(per / perN).toFixed(3)} soundWER ${(sw / swN).toFixed(3)} lang ${(lr / n).toFixed(2)} tone ${tmN ? (tm / tmN).toFixed(3) : '-'} time ${sec.toFixed(1)}s`
);
