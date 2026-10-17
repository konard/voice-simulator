// Print the word and syllable timeline of each language sample.
// Usage: node experiments/issue-5-timeline.mjs [lang text...]
import { LANGUAGES } from '../src/g2p/index.js';
import { prepareUtterance } from '../src/synthesize.js';
import { utteranceTimeline } from '../src/articulation/timeline.js';

const samples =
  process.argv.length > 3
    ? [[process.argv[2], process.argv.slice(3).join(' ')]]
    : Object.values(LANGUAGES).map((language) => [
        language.code,
        language.sample,
      ]);

const time = (seconds) => seconds.toFixed(3);

for (const [lang, text] of samples) {
  const prepared = prepareUtterance(text, { lang });
  const timeline = utteranceTimeline(prepared.plan, {
    words: prepared.words,
    ipa: prepared.ipa,
    language: prepared.lang,
  });
  console.log(`\n${text}  (${time(timeline.duration)} s)`);
  for (const word of timeline.words) {
    const syllables = word.syllables
      .map(
        (syllable) =>
          `${syllable.ipa}[${syllable.text ?? '?'}]@${time(syllable.start)}`
      )
      .join(' ');
    console.log(
      `  ${time(word.start)}-${time(word.end)} ${JSON.stringify(text.slice(word.sourceStart, word.sourceEnd))} ${word.text} /${word.ipa}/ ${syllables}`
    );
  }
}
