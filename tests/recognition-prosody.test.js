import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it } from 'test-anywhere';
import { ipaToText, markProsody, parseIpa } from '../src/index.js';
import { bestTone } from '../src/recognition/prosody-features.js';
import { recognitionInput } from '../src/recognition/input.js';
import { decode } from '../src/recognition/ipa-to-text.js';
import { smallLexicon } from './helpers/recognition-engine.js';
import {
  measure,
  PRESETS,
  render,
  SENTENCE_MARKS,
  SENTENCES,
  STRESS,
  syllableNuclei,
  syllableTone,
} from './helpers/prosody-material.js';

const toneSentences = JSON.parse(
  readFileSync(
    new globalThis.URL(
      './fixtures/recognition/tone-sentences.json',
      import.meta.url
    ),
    'utf8'
  )
);
const toneClasses = ['˥', '˧˥', '˨˩˦', '˥˩', ''];
const toneClass = (tone) => toneClasses.indexOf(tone === '˨˩' ? '˨˩˦' : tone);
const strongest = (sounds) =>
  sounds.reduce(
    (best, sound) =>
      sound.prominence > (best?.prominence ?? -Infinity) ? sound : best,
    undefined
  );
const testMark = (marked) => marked.ipa.match(/(?:[↗↘] )?[.?!,]$/u)?.[0];

function hearTones(input, rate) {
  const measured = measure(input, rate);
  return input.result.words.flatMap(({ syllables }) =>
    syllables.map((syllable) => {
      const heard = strongest(syllableNuclei(syllable, measured))?.tones;
      return [
        toneClass(syllableTone(syllable.ipa)),
        heard ? toneClass(bestTone(heard)) : -1,
      ];
    })
  );
}

function countTones(sentences, preset, rate, report) {
  assert.equal(toneSentences.length, 10);
  for (const sentence of sentences) {
    const tones = hearTones(render(sentence, 'zh', preset), rate);
    assert.ok(tones.length >= 6 && tones.length <= 10, sentence);
    for (const [expected, actual] of tones) {
      assert.ok(expected >= 0);
      if (actual < 0) {
        report.abstained[expected]++;
      } else {
        report.matrix[expected][actual]++;
      }
      report.correct += Number(expected === actual);
      report.total++;
    }
  }
}

function reportTones(rate, threshold, { matrix, abstained, correct, total }) {
  console.log(
    `Mandarin ${rate ?? 'minimal'} ${correct}/${total}; rows/columns T1/T2/T3/T4/T5 ${JSON.stringify(matrix)}; abstained ${JSON.stringify(abstained)}`
  );
  assert.ok(total > 0 && correct / total >= threshold);
}

function checkStress(language, words) {
  let correct = 0;
  for (const word of words) {
    for (const preset of PRESETS) {
      const input = render(
        language === 'en' ? `say ${word} again` : `скажи ${word} снова`,
        language,
        preset
      );
      const measured = measure(input);
      const syllables = input.result.words[1].syllables;
      assert.ok(syllables.length >= 2 && syllables.length <= 4, word);
      const expected = syllables.findIndex(({ stress }) => stress === 1);
      assert.ok(expected >= 0, word);
      const nuclei = syllables.map((syllable) =>
        strongest(syllableNuclei(syllable, measured))
      );
      const heard = strongest(nuclei.filter(Boolean));
      correct += Number(
        heard !== undefined && nuclei.indexOf(heard) === expected
      );
    }
  }
  return correct;
}

function checkSentences(language, sentences) {
  const counts = Object.fromEntries(
    ['.', '?', '↘ ?', '!'].map((label) => [label, [0, 0]])
  );
  let particleFree = 0;
  assert.equal(sentences.length, 10);
  for (const [i, sentence] of sentences.entries()) {
    for (const preset of PRESETS) {
      const input = render(sentence, language, preset);
      const marked = markProsody(input.result, measure(input));
      assert.deepEqual(parseIpa(marked.ipa).unknown, [], marked.ipa);
      const mark = testMark(marked);
      const expected = SENTENCE_MARKS[i];
      const correct = Number((mark === '↗ ?' ? '?' : mark) === expected);
      if (language === 'zh' && expected === '?' && !sentence.includes('吗')) {
        particleFree += correct;
      } else {
        counts[expected][0] += correct;
        counts[expected][1]++;
      }
      if (sentence === 'It is yours?') {
        assert.equal(mark, '↗ ?');
      }
    }
  }
  console.log(`Sentence type ${language} ${JSON.stringify(counts)}`);
  if (language === 'zh') {
    console.log(
      `Mandarin particle-free polar questions ${particleFree}/${PRESETS.length}`
    );
  }
  return Object.values(counts);
}

describe('prosody recognition with timeline phones', () => {
  it('hears the tone of single syllables', () => {
    for (const preset of PRESETS) {
      for (const [i, text] of ['妈', '麻', '马', '骂', '好吗'].entries()) {
        assert.deepEqual(
          hearTones(render(text, 'zh', preset)).at(-1),
          [i, i],
          `${preset} ${text}`
        );
      }
    }
  });

  for (const [rate, threshold] of [
    [undefined, 0.9],
    [8000, 0.85],
  ]) {
    const report = {
      matrix: toneClasses.map(() => toneClasses.map(() => 0)),
      abstained: toneClasses.map(() => 0),
      correct: 0,
      total: 0,
    };
    for (const preset of PRESETS) {
      it(`hears tones in sentences at ${rate ?? 'minimal'} with the ${preset} preset`, () =>
        countTones(toneSentences, preset, rate, report));
    }
    it(`meets the tone accuracy threshold at ${rate ?? 'minimal'}`, () =>
      reportTones(rate, threshold, report));
  }

  for (const [language, words] of Object.entries(STRESS)) {
    const batches = [];
    for (let i = 0; i < words.length; i += 10) {
      it(`finds the stressed syllable in ${language} carrier words ${i + 1}–${i + 10}`, () => {
        batches.push(checkStress(language, words.slice(i, i + 10)));
      });
    }
    it(`meets the ${language} stress accuracy threshold`, () => {
      assert.equal(new Set(words).size, 40);
      assert.equal(batches.length, 4);
      const correct = batches.reduce((sum, count) => sum + count, 0);
      const total = words.length * PRESETS.length;
      console.log(`Lexical stress ${language} ${correct}/${total}`);
      assert.ok(correct / total >= 0.9);
    });
  }

  const marks = [];
  for (const [language, sentences] of Object.entries(SENTENCES)) {
    it(`tells ${language} sentence types apart and speaks its own marks`, () => {
      marks.push(...checkSentences(language, sentences));
    });
  }
  it('meets the sentence type accuracy threshold', () => {
    assert.equal(marks.length, 16);
    const right = marks.reduce((sum, [count]) => sum + count, 0);
    const total = marks.reduce((sum, [, count]) => sum + count, 0);
    assert.ok(right / total >= 0.9, `${right}/${total}`);
  });

  it('hears emphasis', () => {
    for (const preset of PRESETS) {
      for (const [text, focus] of [
        ['I said *red* car', [2]],
        ['I said red car', []],
      ]) {
        const input = render(text, 'en', preset, { markup: true });
        const marked = markProsody(input.result, measure(input));
        assert.deepEqual(
          marked.modes
            .filter(({ emphasis }) => emphasis)
            .map(({ from }) => from),
          focus
        );
        assert.equal(marked.ipa.includes('ˈˈ'), focus.length > 0);
        assert.deepEqual(parseIpa(marked.ipa).unknown, []);
      }
    }
  });

  it('writes text while preserving word text', () => {
    for (const preset of PRESETS) {
      for (const [text, language] of [
        ['Are you coming?', 'en'],
        ['Ты идёшь домой?', 'ru'],
      ]) {
        const input = render(text, language, preset);
        const marked = markProsody(input.result, measure(input));
        assert.equal(marked.text, text);
        assert.equal(marked.modes.at(-1)?.tune, 'yesno');
        assert.deepEqual(
          marked.words.map((word) => word.text),
          input.result.words.map((word) => word.text)
        );
      }
    }
  });

  it('leaves out what it cannot hear in whispered speech', () => {
    const input = render('{W ma ma W}', 'zh', 'male', { ipa: true });
    assert.ok(input.sounds.some(({ ipa }) => ipa === 'a'));
    const measured = measure(input);
    assert.ok(measured.sounds.some((sound) => sound.tones === null));
    assert.ok(
      measured.sounds.every(
        (sound) => sound.tones === null || sound.tones === undefined
      )
    );
    const words = [{ ...input.result.words[0], text: '吗', language: 'zh' }];
    assert.equal(
      testMark(markProsody({ ...input.result, words }, measured)),
      '.'
    );
  });

  it('lets measured tones and stress disambiguate word candidates', () => {
    const mandarin = render('马', 'zh', 'male');
    const horse = ipaToText(measure(mandarin).sounds, { language: 'zh' });
    assert.equal(horse.text, '马');
    assert.match(horse.words[0].syllables[0].ipa, /˨˩˦/u);
    const russian = smallLexicon(
      [
        ['за́мок', 'ˈzamək', 100],
        ['замо́к', 'zaˈmək', 100],
      ],
      'ru'
    );
    const sounds = [
      { ipa: 'z' },
      { ipa: 'a', prominence: -1 },
      { ipa: 'm' },
      { ipa: 'ə', prominence: 1 },
      { ipa: 'k' },
    ].map((sound, i) => ({
      ...sound,
      confidence: 1,
      start: i / 10,
      end: (i + 1) / 10,
    }));
    const heard = decode(
      recognitionInput(sounds, 'search'),
      russian,
      { language: 'ru', beam: 32 },
      true
    );
    assert.equal(heard[0].path[0].word, 'замо́к');
  });
});
