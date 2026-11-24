/**
 * Which neutral rendering matches the pitch of normal speech word by word?
 * Per-word pitch (measureWords) of sentence 1 of a language: the text at
 * normal and loud volume, the synthesiser's own IPA of the normal render,
 * the heard IPA (recognised tune spans and marks, the neutral context of
 * src/recognition/modes.js) and the bare phones with a period.
 * node experiments/issue-75-neutral-tune.mjs [langs] [tier] [preset]
 * Unlicense.
 */
import { levelForTier, recognize, synthesize } from '../src/index.js';
import { measureWords } from '../src/recognition/mode-features.js';
import { sentences } from '../tests/helpers/roundtrip.js';

const [langs = 'hi,zh,en,ru', tier = 'telephone', preset = 'male'] =
  process.argv.slice(2);
const pitches = (spoken, head) =>
  measureWords(
    spoken.samples,
    spoken.sampleRate,
    { words: spoken.timeline.words },
    head
  ).map((w) => w.pitch.toFixed(0));
for (const lang of langs.split(',')) {
  const text = sentences[lang][0];
  const render = (input, extra = {}) =>
    synthesize(input, {
      lang,
      tier,
      head: 'random',
      preset,
      seed: 1,
      ...extra,
    });
  const normal = render(text);
  const loud = render(
    `<speak><prosody volume="loud">${text}</prosody></speak>`,
    { markup: true }
  );
  const head = normal.head;
  let heardIpa = null;
  recognize(loud.samples, loud.sampleRate, {
    level: levelForTier(tier),
    voice: head,
    trace: (e) => {
      if (e.stage === 'context') {
        heardIpa = e.ipa;
      }
    },
  });
  const options = { lang, tier: 'medium', head, seed: 1, engine: 'js' };
  const rows = [
    ['text normal', normal],
    ['text loud', loud],
    ['own ipa', synthesize(normal.ipa, { ...options, ipa: true })],
    ['heard ipa', synthesize(heardIpa, { ...options, ipa: true })],
    ['text neutral', synthesize(text, options)],
  ];
  console.log(lang, text, '| own', normal.ipa, '| heard', heardIpa);
  for (const [name, spoken] of rows) {
    console.log(
      `  ${name.padEnd(12)} ${pitches(spoken, head).join(' ')}  (${spoken.timeline.words.map((w) => w.text).join(' ')})`
    );
  }
}
