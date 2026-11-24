// Check that the HMM word decoder reports whispered spans and modes.
// Usage: node experiments/issue-75-hmm-whisper-check.mjs [lang] [index]
import { roundTrip, sentences } from '../tests/helpers/roundtrip.js';

const lang = process.argv[2] ?? 'zh';
const index = Number(process.argv[3] ?? 1);
const tier = process.argv[4] ?? 'telephone';
const text = `[whisper]${sentences[lang][index - 1]}[/whisper]`;
const r = roundTrip(text, {
  lang,
  tier,
  preset: 'male',
  seed: 1,
  mode: 'W',
  referenceText: sentences[lang][index - 1],
});
console.log(
  JSON.stringify(
    {
      seconds: r.seconds,
      per: r.per,
      soundWer: r.soundWer,
      modeSpans: r.modeSpans,
      heard: r.heard.text,
      modes: r.heard.modes.map((m) => [m.start, m.end, m.label ?? m]),
      ipa: r.heard.ipa,
    },
    null,
    1
  )
);
