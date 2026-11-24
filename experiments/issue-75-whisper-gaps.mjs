/**
 * Where does a whispered sentence split into several W spans? Prints the
 * front-end whisper spans and the heard words with their times.
 * node experiments/issue-75-whisper-gaps.mjs [tier] [lang] [sentence]
 * Unlicense.
 */
import { recognize, synthesize } from '../src/index.js';
import { sentences } from '../tests/helpers/roundtrip.js';

const [tier = 'wideband', lang = 'ru', index = '1'] = process.argv.slice(2);
const spoken = synthesize(`[whisper]${sentences[lang][index - 1]}[/whisper]`, {
  lang,
  tier,
  head: 'random',
  preset: 'male',
  seed: 1,
  markup: true,
});
const heard = recognize(spoken.samples, spoken.sampleRate, { lang });
const f = (v) => v.toFixed(2);
console.log(
  'whisper spans',
  (heard.whisperSpans ?? heard.audio?.whisperSpans ?? [])
    .map((s) => `${f(s.start)}-${f(s.end)}`)
    .join(' ')
);
console.log(
  'words',
  heard.words.map((w) => `${w.text}@${f(w.start)}-${f(w.end)}`).join(' ')
);
console.log(
  'modes',
  heard.modes.map((m) => `${m.notation}@${f(m.start)}-${f(m.end)}`).join(' ')
);
