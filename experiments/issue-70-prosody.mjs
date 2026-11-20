import { readFileSync } from 'node:fs';
import {
  render,
  measure,
  syllableTone,
  syllableNuclei,
  PRESETS,
  STRESS,
  SENTENCES,
  SENTENCE_MARKS,
} from '../tests/helpers/prosody-material.js';
import { markProsody } from '../src/recognition/prosody.js';
import {
  bestTone,
  voicedBetween,
  span,
  mean,
} from '../src/recognition/prosody-features.js';
const tones = JSON.parse(
  readFileSync(
    new globalThis.URL(
      '../tests/fixtures/recognition/tone-sentences.json',
      import.meta.url
    ),
    'utf8'
  )
);
const kind = process.argv[2];
if (!kind || kind === 'tone') {
  for (const text of ['妈', '麻', '马', '骂', '好吗', ...tones]) {
    const rows = PRESETS.map((preset) => {
      const input = render(text, 'zh', preset);
      const measured = measure(input);
      return input.result.words.flatMap(({ syllables }) =>
        syllables.map((s) => {
          const nuclei = syllableNuclei(s, measured);
          return [
            syllableTone(s.ipa) || '5',
            nuclei.map((n) => bestTone(n.tones) || '5').join('/'),
          ];
        })
      );
    });
    console.log(text, JSON.stringify(rows));
  }
}
if (!kind || kind === 'stress') {
  for (const [language, words] of Object.entries(STRESS)) {
    let right = 0;
    for (const word of words) {
      for (const preset of PRESETS) {
        const text =
          language === 'ru' ? `скажи ${word} снова` : `say ${word} again`;
        const input = render(text, language, preset);
        const measured = measure(input);
        const target = input.result.words[1];
        const scores = target.syllables.map((syllable) =>
          Math.max(
            -Infinity,
            ...syllableNuclei(syllable, measured).map((n) => n.prominence)
          )
        );
        const expected = target.syllables.findIndex((s) => s.stress === 1);
        if (
          scores.indexOf(Math.max(...scores)) === expected &&
          scores.length >= 2 &&
          scores.length <= 4
        ) {
          right++;
        } else {
          console.log(
            language,
            word,
            preset,
            target.ipa,
            expected,
            scores.map((x) => x.toFixed(2))
          );
        }
      }
    }
    console.log('stress', language, right, '/', 2 * words.length);
  }
}
if (!kind || kind === 'phrase') {
  for (const [language, texts] of Object.entries(SENTENCES)) {
    for (const [i, text] of texts.entries()) {
      for (const preset of PRESETS) {
        const input = render(text, language, preset);
        const measured = measure(input);
        const marked = markProsody(input.result, measured);
        const mark = marked.modes.filter((m) => m.tune).at(-1)?.notation ?? '.';
        if (mark !== SENTENCE_MARKS[i]) {
          const { words } = input.result;
          const head = voicedBetween(
            measured.pitch,
            words[0].start,
            words.at(-1).end
          );
          console.log(
            language,
            preset,
            text,
            mark,
            marked.text,
            measured.range,
            span(head),
            mean(head),
            words.map((w) => [w.text, w.start.toFixed(2), w.end.toFixed(2)])
          );
        }
      }
    }
  }
}
if (!kind || kind === 'focus') {
  for (const text of ['I said *red* car', 'I said red car']) {
    for (const preset of PRESETS) {
      const input = render(text, 'en', preset, { markup: true });
      const measured = measure(input);
      console.log(
        preset,
        text,
        markProsody(input.result, measured),
        input.result.words.map((w) => {
          const { pitch } = measured;
          const voices = voicedBetween(pitch, w.start, w.end);
          return [w.text, Math.max(...voices), span(voices)];
        })
      );
    }
  }
}
