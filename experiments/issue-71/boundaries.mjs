/** Bounded diagnostics for word boundaries and neutral recordings. Unlicense. */
import { recognizeModes } from '../../src/index.js';
import { loadGolden } from '../../tests/helpers/golden.js';
import { goldenWords } from '../../tests/helpers/mode-recordings.js';
import { render, recognize } from '../../tests/helpers/recognition-modes.js';
const audio = render('en', null, 'one two three [loud] four five six [/loud]');
let trace;
const result = recognize(audio, 'en', {
  trace: (e) => {
    if (e.stage === 'words') {
      trace = e;
    }
  },
});
console.log(
  JSON.stringify({
    id: 'boundary',
    modes: result.modes,
    words: audio.timeline.words,
    trace,
  })
);
for (const item of loadGolden()) {
  const result = recognizeModes(
    item.samples,
    item.sampleRate,
    { words: goldenWords(item), ipa: item.ipa, language: item.lang },
    {
      trace: (e) => {
        if (e.stage === 'words') {
          trace = e;
        }
      },
    }
  );
  console.log(JSON.stringify({ id: item.id, modes: result.modes, trace }));
}
