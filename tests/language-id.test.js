/** Fixed acceptance measurements for issue 69; all inputs come from forward IPA. */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'test-anywhere';
import {
  identifyLanguage,
  languageShares,
  ipaToText,
  textToIpa,
} from '../src/index.js';
import { parseIpa, formatIpa } from '../src/ipa/parse.js';
import { syllabifyTokens } from '../src/ipa/syllables.js';
import { getCounts } from '../src/recognition/data/index.js';
import { createRandom } from '../src/random.js';
import { runCli } from '../bin/voice-simulator.js';
import {
  sentences,
  sounds,
  ipaKey,
  nearestOther,
  editDistance,
  soundKey,
} from './helpers/ipa-recognition.js';
import {
  countPronunciations,
  phoneProbability,
  languagePath,
} from '../src/recognition/language-model.js';

const languages = ['en', 'ru', 'hi', 'zh'];
const mixed = JSON.parse(
  readFileSync(
    new globalThis.URL(
      './fixtures/recognition/mixed-sentences.json',
      import.meta.url
    ),
    'utf8'
  )
);

function expectedWords(forward) {
  let from = 0;
  return forward.words
    .filter((w) => sounds(w.ipa).length)
    .map((word) => {
      const to = from + sounds(word.ipa).length;
      const result = { ...word, from, to };
      from = to;
      return result;
    });
}
function wordLabels(words) {
  return words.flatMap((word) =>
    word.language === 'zh'
      ? syllabifyTokens(sounds(word.ipa), { language: 'zh' }).map(
          (syllable) => `zh:${soundKey(syllable)}`
        )
      : [`${word.language}:${ipaKey(word.ipa)}`]
  );
}
function correctLanguages(words, spans) {
  return words.filter(
    (word) =>
      spans.find((span) => span.from <= word.from && word.from < span.to)
        ?.language === word.lang
  ).length;
}
function exactWordMatches(words, decoded) {
  const expected = words.map((w) => `${w.lang}:${ipaKey(w.ipa)}`);
  const actual = decoded.map((w) => `${w.language}:${ipaKey(w.ipa)}`);
  return Math.max(0, expected.length - editDistance(expected, actual));
}

// Preserve word-boundary pauses and tone placement while corrupting only sounds.
function corruptedIpa(ipa, random) {
  return formatIpa(
    parseIpa(ipa).tokens.map((token) =>
      token.kind !== 'pause' && random() < 0.1
        ? {
            ...nearestOther(token),
            word: token.word,
            stress: token.stress,
            syllableStart: token.syllableStart,
          }
        : token
    )
  );
}

describe('IPA language identification', () => {
  it('names the language of all 40 fixed sentences', () => {
    let correct = 0;
    for (const language of languages) {
      for (const text of sentences[language]) {
        const result = identifyLanguage(
          textToIpa(text, { lang: language }).ipa
        );
        correct += Number(result.languages[0].language === language);
      }
    }
    console.log(`language sentences: ${correct}/40`);
    expect(correct).toBe(40);
  });

  it('names the language of the first 2000 words with at least four sounds per language', () => {
    const matrix = [];
    for (const language of languages) {
      const row = [0, 0, 0, 0];
      let count = 0;
      for (const { word } of getCounts(language).words) {
        const ipa = textToIpa(word, { lang: language }).ipa;
        if (sounds(ipa).length < 4) {
          continue;
        }
        row[languages.indexOf(identifyLanguage(ipa).languages[0].language)]++;
        if (++count === 2000) {
          break;
        }
      }
      expect(count).toBe(2000);
      expect(
        row[languages.indexOf(language)] / count >=
          (language === 'zh' ? 0.97 : 0.9)
      ).toBe(true);
      matrix.push(row);
    }
    console.log(
      'word confusion matrix (rows/columns en ru hi zh):',
      JSON.stringify(matrix)
    );
  });

  it('works without Mandarin tone letters', () => {
    let correct = 0;
    for (const text of sentences.zh) {
      const ipa = textToIpa(text, { lang: 'zh' }).ipa.replace(/[˥˦˧˨˩]/gu, '');
      correct += Number(identifyLanguage(ipa).languages[0].language === 'zh');
    }
    console.log(`Mandarin without tones: ${correct}/10`);
    expect(correct >= 9).toBe(true);
  });

  it('finds switches and writes mixed text on all twelve fixtures', () => {
    let correct = 0;
    let total = 0;
    let recovered = 0;
    let decodedTotal = 0;
    let exactWords = 0;
    const pairs = new Map();
    for (const { text, language } of mixed) {
      const forward = textToIpa(text, { lang: language });
      const words = expectedWords(forward);
      const pair = [...new Set(words.map((w) => w.lang))].sort().join('+');
      pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
      const result = identifyLanguage(forward.ipa);
      correct += correctLanguages(words, result.spans);
      total += words.length;
      const trueSpans = words.filter(
        (w, i) => !i || w.lang !== words[i - 1].lang
      ).length;
      expect(result.spans.length <= trueSpans + 1).toBe(true);
      const decoded = ipaToText(forward.ipa, { spans: result.spans });
      exactWords += exactWordMatches(words, decoded.words);
      const expected = wordLabels(
        words.map((w) => ({ ...w, language: w.lang }))
      );
      const actual = wordLabels(decoded.words);
      recovered += Math.max(
        0,
        expected.length - editDistance(expected, actual)
      );
      decodedTotal += expected.length;
    }
    expect([...pairs.entries()].sort()).toEqual([
      ['en+hi', 3],
      ['en+ru', 3],
      ['en+zh', 3],
      ['ru+zh', 3],
    ]);
    console.log(
      `mixed word languages: ${correct}/${total} (${((100 * correct) / total).toFixed(2)}%); exact decoded words: ${exactWords}/${total} (${((100 * exactWords) / total).toFixed(2)}%); mixed decoded sounds/languages: ${recovered}/${decodedTotal} (${((100 * recovered) / decodedTotal).toFixed(2)}%)`
    );
    expect(correct / total >= 0.9).toBe(true);
    expect(exactWords / total >= 0.85).toBe(true);
    expect(recovered / decodedTotal >= 0.85).toBe(true);
  });

  it('does not flicker on thirty English syllables and is unsure on three sounds', () => {
    const ipa = textToIpa(
      'we can see the bright moon above the trees '.repeat(3),
      { lang: 'en' }
    ).ipa;
    const count = ipa
      .split(' ')
      .reduce((sum, word) => sum + syllabifyTokens(sounds(word)).length, 0);
    expect(count).toBe(30);
    expect(identifyLanguage(ipa).spans.map((s) => s.language)).toEqual(['en']);
    const short = identifyLanguage('kat');
    console.log(
      `flicker: ${count} syllables, 1 span; three-sound confidence: ${short.spans[0].confidence}`
    );
    expect(short.spans[0].confidence < 0.5).toBe(true);
  });

  it('survives ten percent seeded nearest-sound substitutions', () => {
    const random = createRandom(1);
    let correct = 0;
    let total = 0;
    for (const { text, language } of mixed) {
      const forward = textToIpa(text, { lang: language });
      const words = expectedWords(forward);
      const result = identifyLanguage(corruptedIpa(forward.ipa, random));
      correct += correctLanguages(words, result.spans);
      total += words.length;
    }
    console.log(
      `seed-1 noisy mixed word languages: ${correct}/${total} (${((100 * correct) / total).toFixed(2)}%)`
    );
    expect(correct / total >= 0.75).toBe(true);
    // Seed 1 measured 67/75 (89.33%); allow two percentage points of regression.
    expect(correct / total >= 67 / 75 - 0.02).toBe(true);
  });

  it('scores 120 sounds within fifty milliseconds after warmup without lexical checks', () => {
    const ipa = 'θæŋk '.repeat(30);
    expect(sounds(ipa).length).toBe(120);
    identifyLanguage(ipa);
    let lexicalChecks;
    const start = globalThis.performance.now();
    identifyLanguage(ipa, {
      trace: (event) => {
        lexicalChecks = event.lexicalChecks;
      },
    });
    const ms = globalThis.performance.now() - start;
    console.log(
      `warmed 120 sounds: ${ms.toFixed(3)} ms; lexical checks: ${lexicalChecks}`
    );
    expect(lexicalChecks).toBe(0);
    expect(ms < 50).toBe(true);
  });
});

describe('language metadata, numerical rules and CLI', () => {
  it('counts weighted symbols and applies the specified interpolation and pause penalty', () => {
    const model = countPronunciations([{ symbols: ['a', 'b', 'a'], count: 2 }]);
    expect(model.total).toBe(10);
    expect(model.singles.get('#')).toBe(4);
    expect(model.pairs.get('a\tb')).toBe(2);
    expect(model.triples.get('#\ta\tb')).toBe(2);
    expect(
      Math.abs(phoneProbability(model, '#', 'a', 'b') - (0.6 + 0.15 + 0.02)) <
        1e-12
    ).toBe(true);
    expect(phoneProbability(model, 'x', 'y', 'z')).toBe(0.00001);
    const units = [
      { scores: { en: 0, ru: -10 } },
      { scores: { en: -5, ru: 0 }, pause: false },
    ];
    expect(languagePath(units, ['en', 'ru'], 6)).toEqual(['en', 'en']);
    expect(
      languagePath([units[0], { ...units[1], pause: true }], ['en', 'ru'], 6)
    ).toEqual(['en', 'ru']);
    expect(
      languagePath([{ scores: { en: 0, ru: 0 } }], ['en', 'ru'], 6)
    ).toEqual(['en']);
  });

  it('handles empty input, subsets, confidence scaling, and validates options', () => {
    expect(identifyLanguage('')).toEqual({
      languages: [],
      spans: [],
      scores: {},
    });
    expect(identifyLanguage([])).toEqual({
      languages: [],
      spans: [],
      scores: {},
    });
    expect(identifyLanguage('|')).toEqual({
      languages: [],
      spans: [],
      scores: {},
    });
    const single = identifyLanguage('θæŋk', { languages: ['en'] });
    expect(Object.keys(single.scores)).toEqual(['en']);
    expect(single.spans[0].confidence).toBe(0.5);
    expect(
      identifyLanguage('θæŋk', { languages: ['en'], minSounds: 0 }).spans[0]
        .confidence
    ).toBe(1);
    for (const options of [
      { languages: [] },
      { languages: ['fr'] },
      { languages: ['en', 'en'] },
      { switchPenalty: -1 },
      { switchPenalty: Infinity },
      { minSounds: NaN },
    ]) {
      expect(() => identifyLanguage('kat', options)).toThrow();
    }
    expect(() => identifyLanguage({ ipa: 'a' })).toThrow();
    expect(() => identifyLanguage('☃')).toThrow();
  });

  it('keeps sound offsets and times, excludes pauses and silence from shares', () => {
    const ipa = 'θæŋk | prʲɪˈvʲet';
    const plain = identifyLanguage(ipa);
    expect(plain.spans[0].from).toBe(0);
    expect(plain.spans.at(-1).to).toBe(10);
    expect(plain.spans.every((s) => s.start === null && s.end === null)).toBe(
      true
    );
    let at = 0;
    const timed = parseIpa(ipa).tokens.map((token) => {
      const start = at;
      at += token.kind === 'pause' ? 2 : token.word === 0 ? 0.4 : 0.1;
      return { ipa: formatIpa([token]), start, end: at, confidence: 1 };
    });
    const result = identifyLanguage(timed);
    expect(result.spans.map((s) => s.language)).toEqual(['en', 'ru']);
    expect(result.spans[0].start).toBe(0);
    expect(result.spans.at(-1).end).toBe(at);
    expect(result.languages[0].language).toBe('en');
    expect(Math.abs(result.languages[0].share - 1.6 / 2.2) < 1e-12).toBe(true);
    const decoded = ipaToText(timed, { spans: result.spans });
    expect(
      languageShares(decoded.words).reduce((sum, l) => sum + l.share, 0)
    ).toBe(1);
    expect(languageShares([])).toEqual([]);
    expect(
      languageShares([
        { language: 'en', ipa: 'kat' },
        { language: 'ru', ipa: 'a' },
      ])
    ).toEqual([
      { language: 'en', share: 0.75 },
      { language: 'ru', share: 0.25 },
    ]);
  });

  it('preserves monolingual decoding and validates supplied spans', () => {
    const ipa = 'həˈloʊ ˈwɝld';
    const spans = identifyLanguage(ipa, { languages: ['en'] }).spans;
    expect(ipaToText(ipa, { spans })).toEqual(
      ipaToText(ipa, { language: 'en' })
    );
    for (const spans of [
      {},
      [{ language: 'fr', from: 0, to: 8 }],
      [{ language: 'en', from: 1, to: 8 }],
      [{ language: 'en', from: 0, to: 1 }],
    ]) {
      expect(() => ipaToText(ipa, { spans })).toThrow();
    }
  });

  it('prints the acceptance example as ru, en, ru and supports JSON/options/help', async () => {
    const ipa = 'ɐˈna skɐˈzaɫə ˈθæŋk ˈju i ˈuʂɫə';
    const output = [];
    expect(
      await runCli(['language', ipa], { stdout: (s) => output.push(s) })
    ).toBe(0);
    expect(output.map((s) => s.split(' ')[0])).toEqual(['ru', 'en', 'ru']);
    console.log('language CLI:', output.join('; '));
    const json = [];
    expect(
      await runCli(
        [
          'language',
          'θæŋk',
          '--languages',
          'en,ru',
          '--switch-penalty',
          '0',
          '--min-sounds',
          '4',
          '--json',
        ],
        { stdout: (s) => json.push(s) }
      )
    ).toBe(0);
    expect(JSON.parse(json[0]).languages[0].language).toBe('en');
    const help = [];
    expect(await runCli(['--help'], { stdout: (s) => help.push(s) })).toBe(0);
    expect(help.join('\n').includes('language <ipa>')).toBe(true);
  });
});
