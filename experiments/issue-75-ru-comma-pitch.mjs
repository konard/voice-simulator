/**
 * Pitch around the Russian comma vs question rise: prints the cues the
 * recogniser's russianRise reads for the first phrase. Unlicense.
 * node experiments/issue-75-ru-comma-pitch.mjs "Привет, как дела?" [decoder]
 */
import {
  levelForTier,
  synthesize,
  recognize as recognizeAudio,
} from '../src/index.js';
const [text = 'Привет, как дела?', decoder] = process.argv.slice(2);
const spoken = synthesize(text, {
  lang: 'ru',
  tier: 'telephone',
  head: 'random',
  preset: 'male',
  seed: 1,
});
const heard = recognizeAudio(spoken.samples, spoken.sampleRate, {
  level: levelForTier('telephone'),
  ...(decoder && { decoder }),
});
console.log(heard.text, heard.ipa);
for (const w of heard.words) {
  console.log(
    w.text,
    w.start?.toFixed(3),
    w.end?.toFixed(3),
    JSON.stringify(
      w.syllables?.map((s) => [
        s.text ?? s.ipa,
        s.stress,
        +s.start.toFixed(3),
        +s.end.toFixed(3),
      ])
    )
  );
}
for (const w of spoken.timeline.words) {
  console.log(
    'ref',
    w.text,
    JSON.stringify(
      w.syllables?.map((s) => [
        s.ipa,
        s.stress,
        +s.start.toFixed(3),
        +s.end.toFixed(3),
      ])
    )
  );
}
