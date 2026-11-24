import { describe, it, expect } from 'test-anywhere';
import { parseIpa, formatIpa } from '../src/ipa/parse.js';
import { listSymbols } from '../src/ipa/inventory.js';
import { phoneDistance, gapCost } from '../src/recognition/phone-distance.js';
import { textToIpa } from '../src/g2p/index.js';
import { createRandom } from '../src/random.js';
import { ipaToText } from '../src/recognition/ipa-to-text.js';
import { getLexicon } from '../src/recognition/lexicon.js';
import { spellSounds } from '../src/recognition/phones-to-letters.js';
import { getCounts } from '../src/recognition/data/index.js';
import { runCli } from '../bin/voice-simulator.js';
import {
  sentences,
  sounds,
  ipaKey,
  soundWords,
  editDistance,
  nearestOther,
  withoutWords,
} from './helpers/ipa-recognition.js';

const phone = (ipa) => parseIpa(ipa).tokens[0];
// Baselines use createRandom(1) independently for each language and the
// checked-in ten-sentence fixture. Permit two percentage points of drift.
const NOISE_BASELINE = { en: 0, ru: 3 / 53, hi: 6 / 66, zh: 22 / 112 };

describe('IPA to text', () => {
  it('distance is bounded, symmetric and zero on every inventory sound', () => {
    const sounds = [
      ...listSymbols(),
      't͡ʃ',
      'd͡ʒ',
      'aː',
      'ã',
      'nʲ',
      'a˨˩˦',
      'a˧˥',
    ].map(phone);
    for (const a of sounds) {
      expect(phoneDistance(a, a)).toBe(0);
      expect(
        phoneDistance(a, {
          ...a,
          affricate: a.affricate ? { ...a.affricate } : null,
        })
      ).toBe(0);
      for (const b of sounds) {
        const distance = phoneDistance(a, b);
        expect(distance >= 0 && distance <= 1).toBe(true);
        expect(distance).toBe(phoneDistance(b, a));
      }
    }
  });

  it('uses feature flags, sandhi and reduced gap costs', () => {
    expect(phoneDistance(phone('p'), phone('b'))).toBe(0.25);
    expect(phoneDistance(phone('n'), phone('nʲ'))).toBe(0.2);
    expect(phoneDistance(phone('a˨˩˦'), phone('a˨˩'))).toBe(0);
    expect(phoneDistance(phone('a˨˩˦'), phone('a˧˥'))).toBe(0.15);
    expect(gapCost(phone('ə'))).toBe(0.5);
    expect(gapCost(phone('ʔ'))).toBe(0.5);
    expect(gapCost(phone('k'))).toBe(1);
  });

  for (const language of ['en', 'ru', 'hi', 'zh']) {
    it(`${language}: finds all 5000 vocabulary pronunciations and at least 90% of spellings`, () => {
      const start = globalThis.performance.now();
      const lexicon = getLexicon(language);
      const root = lexicon.root;
      const coldMs = globalThis.performance.now() - start;
      expect(getLexicon(language).root).toBe(root);
      expect(coldMs < 3000).toBe(true);
      let sameSounds = 0;
      let spelling = 0;
      for (const { word } of getCounts(language).words.slice(0, 5000)) {
        const ipa = textToIpa(word, { lang: language }).ipa;
        const result = ipaToText(ipa, { language });
        sameSounds += Number(ipaKey(ipa) === ipaKey(result.ipa));
        spelling += Number(word === result.text);
      }
      console.log(
        `${language}: cold trie ${coldMs.toFixed(1)} ms; vocabulary sounds ${sameSounds}/5000, spelling ${spelling}/5000`
      );
      expect(sameSounds).toBe(5000);
      expect(spelling >= 4500).toBe(true);
    });

    it(`${language}: reads ten sentences, restores boundaries and survives seeded substitutions`, () => {
      const random = createRandom(1);
      let total = 0;
      let spellingTotal = 0;
      let spellingErrors = 0;
      let boundaryErrors = 0;
      let noiseErrors = 0;
      expect(sentences[language].length).toBe(10);
      for (const sentence of sentences[language]) {
        const words = sentence.split(' ');
        expect(words.length >= 5 && words.length <= 10).toBe(true);
        const forward = textToIpa(sentence, { lang: language });
        const result = ipaToText(forward.ipa, { language });
        expect(ipaKey(result.ipa)).toBe(ipaKey(forward.ipa));
        const expectedSpelling =
          language === 'zh' ? [...sentence.replaceAll(' ', '')] : words;
        spellingTotal += expectedSpelling.length;
        spellingErrors += editDistance(
          expectedSpelling,
          language === 'zh' ? [...result.text] : result.text.split(' ')
        );
        const expected = soundWords(forward.words, language);
        total += expected.length;
        const search = ipaToText(forward.ipa.replaceAll(' ', ''), {
          language,
          boundaries: 'search',
        });
        boundaryErrors += editDistance(
          expected,
          soundWords(search.words, language)
        );
        const corrupted = sounds(forward.ipa).map((token) =>
          random() < 0.1 ? nearestOther(token) : token
        );
        const noisy = ipaToText(formatIpa(corrupted).replaceAll(' ', ''), {
          language,
          boundaries: 'search',
        });
        noiseErrors += editDistance(
          expected,
          soundWords(noisy.words, language)
        );
      }
      const wer = noiseErrors / total;
      console.log(
        `${language}: sentence spelling ${spellingTotal - spellingErrors}/${spellingTotal}; boundary sounds ${total - boundaryErrors}/${total}; corrupted WER ${(100 * wer).toFixed(2)}% (${noiseErrors}/${total})`
      );
      expect(
        1 - spellingErrors / spellingTotal >= (language === 'zh' ? 0.9 : 0.95)
      ).toBe(true);
      expect(1 - boundaryErrors / total >= 0.95).toBe(true);
      expect(wer <= NOISE_BASELINE[language] + 0.02).toBe(true);
      expect(wer < 0.3).toBe(true);
    });

    it(`${language}: rule-spells 200 held-out reverse-dictionary words`, () => {
      const heldOut = getCounts(language).words.slice(0, 200);
      let recovered = 0;
      withoutWords(
        getLexicon(language),
        new Set(heldOut.map(({ word }) => word)),
        () => {
          for (const { word } of heldOut) {
            const ipa = textToIpa(word, { lang: language }).ipa;
            const spelling = spellSounds(sounds(ipa), language);
            expect(spelling.length > 0).toBe(true);
            recovered += Number(
              ipaKey(textToIpa(spelling, { lang: language }).ipa) ===
                ipaKey(ipa)
            );
          }
        }
      );
      console.log(`${language}: held-out rule spelling ${recovered}/200`);
      expect(recovered >= (language === 'en' ? 120 : 180)).toBe(true);
    });
  }
});

describe('IPA to text metadata and CLI', () => {
  it('uses context for homophones and keeps a novel sound sequence readable', () => {
    expect(ipaToText('ˈtu ˈkæts').text).toBe('two cats');
    const unknown = ipaToText('ˈblɪk');
    expect(unknown.text.length > 0).toBe(true);
    expect(unknown.words[0].confidence <= 0.3).toBe(true);
  });

  it('prints the three documented CLI examples and supports JSON alternatives', async () => {
    for (const [ipa, language, text] of [
      ['həˈloʊ ˈwɝld', 'en', 'hello world'],
      ['prʲɪˈvʲet', 'ru', 'привет'],
      ['ni˧˥ xɑʊ˨˩˦', 'zh', '你好'],
    ]) {
      const output = [];
      const errors = [];
      const code = await runCli(['text', ipa, '--lang', language], {
        stdout: (s) => output.push(s),
        stderr: (s) => errors.push(s),
      });
      expect(code).toBe(0);
      expect(errors).toEqual([]);
      expect(output).toEqual([text]);
    }
    const output = [];
    expect(
      await runCli(
        [
          'text',
          'ˈtu',
          '--nbest',
          '2',
          '--beam',
          '8',
          '--boundaries',
          'given',
          '--json',
        ],
        { stdout: (s) => output.push(s) }
      )
    ).toBe(0);
    expect(JSON.parse(output.join('')).alternatives.length).toBe(1);
  });

  it('uses the timeline syllable spelling, stress and null string times', () => {
    const {
      words: [word],
    } = ipaToText('həˈloʊ');
    expect(word.text).toBe('hello');
    expect(word.start).toBe(null);
    expect(word.end).toBe(null);
    expect(word.syllables.map((s) => s.text)).toEqual(['hel', 'lo']);
    expect(word.syllables.map((s) => s.stress)).toEqual([0, 1]);
  });

  it('retains sound timing, confidence and pauses in search mode', () => {
    const heard = [
      { ipa: 'h', start: 0, end: 0.1, confidence: 0.8 },
      { ipa: 'ə', start: 0.1, end: 0.2, confidence: 0.6 },
      { ipa: 'ˈl', start: 0.2, end: 0.3, confidence: 1 },
      { ipa: 'o', start: 0.3, end: 0.4, confidence: 0.8 },
      { ipa: 'ʊ', start: 0.4, end: 0.5, confidence: 0.8 },
    ];
    const result = ipaToText(heard);
    expect(result.text).toBe('hello');
    expect(result.words[0].start).toBe(0);
    expect(result.words[0].end).toBe(0.5);
    expect(Math.abs(result.words[0].confidence - 0.8) < 1e-12).toBe(true);
    expect(ipaToText('ˈtu|ˈkæts', { boundaries: 'search' }).words.length).toBe(
      2
    );
    expect(ipaToText('ˈtu ˈkæts', { boundaries: 'given' }).words.length).toBe(
      2
    );
  });

  it('spells a given word of more than twelve unknown sounds', () => {
    // The HMM phone loop hands over long out-of-vocabulary words whole.
    const result = ipaToText('pɛntɑkɑlɪmɑnɛstɑsɪkɑ mɑɪn', {
      language: 'en',
      boundaries: 'given',
    });
    expect(result.words.length).toBe(2);
    expect(result.words[0].text.length > 12).toBe(true);
  });

  it('returns distinct alternatives without changing the best result', () => {
    const first = ipaToText('ˈtu');
    const result = ipaToText('ˈtu', { nbest: 3 });
    expect(result.text).toBe(first.text);
    expect(result.alternatives.length).toBe(2);
    expect(
      new Set([result.text, ...result.alternatives.map((a) => a.text)]).size
    ).toBe(3);
    for (const alternative of result.alternatives) {
      expect(alternative.confidence >= 0 && alternative.confidence <= 1).toBe(
        true
      );
    }
  });

  it('validates input and options, handles empty input and traces only on request', () => {
    expect(ipaToText('').words).toEqual([]);
    for (const options of [
      { language: 'xx' },
      { beam: 0 },
      { nbest: 1.5 },
      { boundaries: 'other' },
    ]) {
      expect(() => ipaToText('a', options)).toThrow();
    }
    expect(() =>
      ipaToText([{ ipa: 'a', start: 1, end: 0, confidence: 1 }])
    ).toThrow();
    expect(() => ipaToText('💥')).toThrow();
    let trace;
    ipaToText('həˈloʊ', {
      trace: (event) => {
        trace = event;
      },
    });
    expect(trace.sounds).toBe(5);
    expect(trace.words[0].word).toBe('hello');
  });

  it('decodes 120 unspaced sounds at beam 8 in under half a second after warmup', () => {
    const phrase = textToIpa('we know there are two cats', { lang: 'en' }).ipa;
    const input = formatIpa(
      Array.from(
        { length: 120 },
        (_, i) => sounds(phrase)[i % sounds(phrase).length]
      )
    ).replaceAll(' ', '');
    ipaToText(input, { beam: 8, boundaries: 'search' });
    const start = globalThis.performance.now();
    const result = ipaToText(input, { beam: 8, boundaries: 'search' });
    const elapsed = globalThis.performance.now() - start;
    console.log(`120 sounds, beam 8: ${elapsed.toFixed(1)} ms`);
    expect(result.words.length > 0).toBe(true);
    expect(elapsed < 500).toBe(true);
  });
});
