import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { describe, it } from 'test-anywhere';
import {
  ipaToText,
  markProsody,
  measureProsody,
  parseIpa,
} from '../src/index.js';
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
});

describe('marks from timed prosody', () => {
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

  it('abstains without periodic pitch when whisper detection is disabled', () => {
    const input = render('{W ma ma W}', 'zh', 'male', { ipa: true });
    assert.ok(input.sounds.some(({ ipa }) => ipa === 'a'));
    const { audio, sounds } = input;
    const measured = measureProsody(audio.samples, audio.sampleRate, sounds, {
      whisperSpans: [],
    });
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

  it('uses weak energy cues and only word-based questions inside a whisper', () => {
    const input = render('[whisper] 请喝茶', 'zh', 'male', { markup: true });
    const measured = measure(input);
    assert.equal(measured.whisperSpans.length, 1);
    assert.ok(measured.pitch.semitones.every((value) => value === null));
    for (const sound of measured.sounds.filter(
      ({ ipa }) => parseIpa(ipa).tokens[0]?.kind === 'vowel'
    )) {
      assert.ok(sound.whispered && sound.tones);
      assert.ok(
        Object.values(sound.tones).every((cost) => cost >= 0.25 && cost <= 0.75)
      );
    }
    const words = input.result.words.map((word, i, all) =>
      i === all.length - 1 ? { ...word, text: '吗' } : word
    );
    const result = markProsody({ ...input.result, words }, measured);
    assert.equal(testMark(result), '?');
    assert.equal(result.modes[0].notation, 'W');
    assert.match(result.ipa, /^\{W .* W\} \?$/u);
  });
});

describe('prosody word search and abstention', () => {
  it('writes continuation only when a pause and voiced phrase tail support it', () => {
    const words = [
      {
        text: 'go',
        ipa: 'ˈɡoʊ',
        start: 0,
        end: 0.1,
        confidence: 0.8,
        syllables: [],
      },
      {
        text: 'stay',
        ipa: 'ˈsteɪ',
        start: 0.3,
        end: 0.6,
        confidence: 0.9,
        syllables: [],
      },
    ];
    const result = { words, modes: [] };
    const pitch = {
      startTime: 0,
      hop: 0.005,
      semitones: new Array(120).fill(0),
      energy: new Float64Array(120).fill(1),
    };
    const measured = { sounds: [], pitch, median: 130, range: 4 };
    const marked = markProsody(result, measured);
    assert.equal(marked.text, 'Go, stay.');
    assert.deepEqual(marked.modes, [
      {
        from: 0,
        to: 1,
        start: 0,
        end: 0.1,
        tune: 'continuation',
        notation: ',',
        confidence: 0.8,
      },
    ]);
    pitch.semitones.fill(null, 0, 20);
    const unvoiced = markProsody(result, measured);
    assert.equal(unvoiced.text, 'Go stay.');
    assert.deepEqual(unvoiced.modes, []);
  });

  it('marks an unknown word from its measured vowels and preserves prior modes', () => {
    const word = {
      text: '甲乙',
      ipa: 'mana',
      language: 'zh',
      unknown: true,
      start: 0,
      end: 0.4,
      syllables: [
        { ipa: 'ma', start: 0, end: 0.2, stress: 0 },
        { ipa: 'na', start: 0.2, end: 0.4, stress: 0 },
      ],
    };
    const prior = { from: 0, to: 1, tempo: 1.1 };
    const result = { words: [word], modes: [prior] };
    const measured = {
      sounds: [
        {
          ipa: 'a',
          start: 0.03,
          end: 0.2,
          tones: { '˧˥': 0.1 },
          prominence: 0.6,
        },
        {
          ipa: 'a',
          start: 0.23,
          end: 0.4,
          tones: { '˥˩': 0.1 },
          prominence: 1,
        },
      ],
      pitch: { startTime: 0, hop: 0.005, semitones: [], energy: [] },
      median: null,
      range: 4,
    };
    const marked = markProsody(result, measured);
    assert.equal(marked.text, '甲乙。');
    assert.equal(marked.words[0].ipa, 'ma˧˥ˈna˥˩');
    assert.deepEqual(
      marked.words[0].syllables.map(({ stress }) => stress),
      [0, 1]
    );
    assert.equal(word.ipa, 'mana');
    assert.deepEqual(marked.modes, [prior]);
    assert.deepEqual(parseIpa(marked.ipa).unknown, []);
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

describe('phrase breaks from pauses', () => {
  it('reads a Russian rise before a comma pause as a continuation', () => {
    // A comma is a weaker IK3 rise on the stressed syllable with a 0.2 s
    // pause; the same rise before a 0.42 s sentence pause asks a question.
    const syllable = (ipa, stress, start, end) => ({ ipa, stress, start, end });
    const marks = [0.2, 0.42].map((pause) => {
      const words = [
        {
          text: 'привет',
          ipa: 'prʲɪˈvʲet',
          language: 'ru',
          start: 0,
          end: 0.5,
          confidence: 0.9,
          syllables: [
            syllable('prʲɪ', 0, 0, 0.2),
            syllable('ˈvʲet', 1, 0.2, 0.5),
          ],
        },
        {
          text: 'как',
          ipa: 'kak',
          language: 'ru',
          start: 0.5 + pause,
          end: 0.8 + pause,
          confidence: 0.9,
          syllables: [syllable('kak', 0, 0.5 + pause, 0.8 + pause)],
        },
      ];
      const frames = Math.ceil((0.8 + pause) / 0.005);
      // Level, then six semitones up through the stressed vowel.
      const semitones = Array.from({ length: frames }, (_, i) => {
        const t = i * 0.005;
        if (t >= 0.5 && t < 0.5 + pause) {
          return null;
        }
        return t < 0.2 || t >= 0.5 ? 0 : (6 * (t - 0.2)) / 0.3;
      });
      const pitch = {
        startTime: 0,
        hop: 0.005,
        semitones,
        energy: new Float64Array(frames).fill(1),
      };
      const measured = { sounds: [], pitch, median: 110, range: 4 };
      return markProsody({ words, modes: [] }, measured).text;
    });
    assert.deepEqual(marks, ['Привет, как?', 'Привет? Как?']);
  });
});
