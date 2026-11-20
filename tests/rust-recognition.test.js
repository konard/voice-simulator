/** Numerical parity: exact/edit searches, count scoring and all phone pairs. */
import { describe, expect } from 'test-anywhere';
import { listSymbols } from '../src/ipa/inventory.js';
import { float64View } from '../src/engine/wasm-loader.js';
import { phoneDistance } from '../src/recognition/phone-distance.js';
import { recognitionInput } from '../src/recognition/input.js';
import { decode } from '../src/recognition/ipa-to-text.js';
import { spellSounds } from '../src/recognition/phones-to-letters.js';
import { loadRustEngine, noRust } from './helpers/rust-engine.js';
import { itUnless } from './helpers/skip.js';
import { sounds } from './helpers/ipa-recognition.js';
import {
  featureEncoder,
  smallLexicon,
  recognitionPacket,
  runRecognition,
  unpackPaths,
} from './helpers/recognition-engine.js';

const languageRecords = [
  [
    ['θæŋk', 9],
    ['bʊk', 3],
  ],
  [
    ['prʲɪvʲet', 8],
    ['dom', 5],
  ],
  [
    ['ɡʱəɾ', 7],
    ['kɪt̪aːb', 3],
  ],
  [
    ['ni˧˥', 12],
    ['xɑʊ˨˩˦', 10],
  ],
];

const it = itUnless(noRust);
const cases = [
  {
    language: 'en',
    records: [
      ['to', 'ˈtu', 200],
      ['two', 'ˈtu', 100],
      ['too', 'ˈtu', 50],
      ['cats', 'ˈkæts', 100],
      ['cat', 'ˈkæt', 40],
      ['hello', 'həˈloʊ', 150],
    ],
    pairs: [['two\tcats', 80]],
    inputs: [
      'ˈtu ˈkæts',
      'tukæts',
      'həˈloʊ',
      'həˈlo',
      'həlˈloʊ',
      'ˈblɪk',
      'blɪkkæts',
    ],
  },
  {
    language: 'ru',
    records: [
      ['в', 'v', 200],
      ['в', 'f', 200],
      ['кот', 'kot', 40],
      ['код', 'kot', 20],
      ['дом', 'dom', 100],
    ],
    inputs: ['f kot', 'vkot', 'kom', 'dom'],
  },
  {
    language: 'hi',
    records: [
      ['कमल', 'kəməl', 50],
      ['कमल', 'kəml', 50],
      ['घर', 'ɡʱəɾ', 100],
    ],
    inputs: ['kəməl', 'kəml', 'ɡʱəɾ', 'kəməlɡʱəɾ'],
  },
  {
    language: 'zh',
    records: [
      ['你', 'ni˨˩˦', 100],
      ['好', 'xɑʊ˨˩˦', 100],
      ['一', 'i˥', 200],
      ['一', 'i˧˥', 200],
      ['一', 'i˥˩', 200],
      ['个', 'kɤ˥˩', 50],
    ],
    inputs: ['ni˧˥xɑʊ˨˩˦', 'i˧˥kɤ˥˩', 'i˥˩xɑʊ˨˩˦', 'ni˨˩˦', 'ni˧˥'],
  },
];

describe('Rust whisper lexical recognition', () => {
  it('matches lexical paths with whispered voicing and tone evidence', async () => {
    const engine = await loadRustEngine();
    const cases = [
      {
        language: 'en',
        records: [
          ['bat', 'bæt', 100],
          ['pat', 'pæt', 100],
        ],
        sounds: [
          { ipa: 'p', whispered: true, voicing: 0.95 },
          { ipa: 'æ' },
          { ipa: 't' },
        ],
        winner: 'bat',
      },
      {
        language: 'zh',
        records: [
          ['妈', 'ma˥', 100],
          ['马', 'ma˨˩˦', 100],
        ],
        sounds: [
          { ipa: 'm' },
          {
            ipa: 'a',
            tones: { '˥': 0.65, '˧˥': 0.5, '˨˩˦': 0.25, '˥˩': 0.5, '': 0.5 },
          },
        ],
        winner: '马',
      },
    ];
    for (const { language, records, sounds, winner } of cases) {
      const input = recognitionInput(
        sounds.map((sound, index) => ({
          ...sound,
          start: index * 0.1,
          end: (index + 1) * 0.1,
          confidence: 1,
        })),
        'search'
      );
      const lexicon = smallLexicon(records, language);
      const options = { language, given: false, beam: 32 };
      const { packet, words } = recognitionPacket(input, lexicon, options, 2);
      const actual = unpackPaths(
        runRecognition(engine, packet),
        words,
        input.tokens,
        (tokens) => spellSounds(tokens, language)
      );
      const expected = decode(input, lexicon, options, false).slice(0, 2);
      expect(actual[0].path[0].word).toBe(winner);
      for (const [i, path] of actual.entries()) {
        expect(path.path.map(({ word }) => word)).toEqual(
          expected[i].path.map(({ word }) => word)
        );
        expect(Math.abs(path.cost - expected[i].cost)).toBeLessThan(1e-9);
      }
    }
  });
});

describe('Rust IPA recognition', () => {
  it('matches every inventory phone-distance pair and extra feature flags', async () => {
    const engine = await loadRustEngine();
    const encode = featureEncoder('zh');
    const phones = [
      ...listSymbols(),
      't͡ʃ',
      'd͡ʒ',
      'aː',
      'ã',
      'nʲ',
      'a˨˩˦',
      'a˨˩',
      'a˧˥',
      'ˈa',
    ].map((ipa) => sounds(ipa)[0]);
    const pointer = engine.exports.vs_alloc(34 * 8);
    try {
      for (const a of phones) {
        for (const b of phones) {
          float64View(engine, pointer, 34).set([...encode(a), ...encode(b)]);
          expect(
            Math.abs(
              engine.exports.vs_phone_distance(pointer) - phoneDistance(a, b)
            ) < 1e-12
          ).toBe(true);
        }
      }
      expect(Number.isNaN(engine.exports.vs_phone_distance(1))).toBe(true);
    } finally {
      engine.exports.vs_free(pointer, 34 * 8);
    }
  });

  for (const { language, records, pairs, inputs } of cases) {
    it(`${language}: matches candidate edits, boundaries, unknowns and distinct n-best paths`, async () => {
      const engine = await loadRustEngine();
      const lexicon = smallLexicon(records, language, pairs);
      for (const ipa of inputs) {
        for (const given of [false, true]) {
          const input = recognitionInput(ipa, given ? 'given' : 'search');
          const options = { language, given, beam: 32 };
          const nbest = 3;
          const exact = decode(input, lexicon, options, true);
          const texts = new Set(exact.map((path) => path.text));
          const expected = [
            ...exact,
            ...decode(input, lexicon, options, false).filter(
              (path) => !texts.has(path.text)
            ),
          ].slice(0, nbest);
          const { packet, words } = recognitionPacket(
            input,
            lexicon,
            options,
            nbest
          );
          const actual = unpackPaths(
            runRecognition(engine, packet),
            words,
            input.tokens,
            (tokens) => spellSounds(tokens, language)
          );
          expect(actual.length).toBe(expected.length);
          for (let i = 0; i < actual.length; i++) {
            if (Math.abs(actual[i].cost - expected[i].cost) >= 1e-10) {
              console.log(
                JSON.stringify({
                  language,
                  ipa,
                  given,
                  i,
                  actual: actual[i],
                  expected: expected[i],
                })
              );
            }
            expect(Math.abs(actual[i].cost - expected[i].cost) < 1e-10).toBe(
              true
            );
            expect(
              actual[i].path.map(({ from, to, word }) => ({ from, to, word }))
            ).toEqual(
              expected[i].path.map(({ from, to, word }) => ({ from, to, word }))
            );
            expect(actual[i].path.map((c) => c.cost)).toEqual(
              expected[i].path.map((c) => c.cost)
            );
          }
        }
      }
    });
  }

  it('rejects truncated, nonfinite and oversized packets without allocating from claimed counts', async () => {
    const engine = await loadRustEngine();
    for (const packet of [
      [],
      [32, 0, 1, 1000000, 0, 1, 0],
      [NaN],
      [Infinity],
      [-1],
      [0, 0, 1, 0, 0, 0, 0],
    ]) {
      expect(runRecognition(engine, packet) < 0).toBe(true);
    }
  });
});

// Numerical language-ID and mixed-language decoding use small deterministic
// lexicons, so parity never needs a corpus download or an audio render.
describe('Rust language identification and mixed decoding', () => {
  it('matches weighted model scores, tones, pause switches, smoothing, confidence and shares', async () => {
    const { countPronunciations, phoneProbability, languagePath } =
      await import('../src/recognition/language-model.js');
    const { syllabifyTokens } = await import('../src/ipa/syllables.js');
    const engine = await loadRustEngine();
    const codes = ['en', 'ru', 'hi', 'zh'];
    const ids = new Map([['#', 0]]);
    const id = (symbol) => {
      if (!ids.has(symbol)) {
        ids.set(symbol, ids.size);
      }
      return ids.get(symbol);
    };
    for (const ipa of [
      'θæŋk | prʲɪvʲet ni˧˥ xɑʊ˨˩˦',
      'kat',
      'ɡʱəɾ kɪt̪aːb',
      '',
    ]) {
      const input = recognitionInput(ipa, 'given');
      const models = languageRecords.map((entries) =>
        countPronunciations(
          entries.map(([ipa, count]) => ({
            symbols: sounds(ipa).map((t) => t.symbol),
            count,
          }))
        )
      );
      const units = [];
      const ends = [...input.boundaries].sort((a, b) => a - b);
      for (let j = 1; j < ends.length; j++) {
        let from = ends[j - 1];
        for (const syllable of syllabifyTokens(
          input.tokens.slice(from, ends[j])
        )) {
          units.push({
            from,
            to: from + syllable.length,
            pause: input.pauses.has(from),
          });
          from += syllable.length;
        }
      }
      const scores = units.map((unit) => {
        const row = Object.fromEntries(codes.map((code) => [code, 0]));
        for (let i = unit.from; i < unit.to; i++) {
          const boundary = [...input.boundaries].filter((b) => b <= i).at(-1);
          const a = i - 2 >= boundary ? input.tokens[i - 2].symbol : '#';
          const b = i - 1 >= boundary ? input.tokens[i - 1].symbol : '#';
          for (let l = 0; l < codes.length; l++) {
            row[codes[l]] += Math.log(
              phoneProbability(models[l], a, b, input.tokens[i].symbol)
            );
          }
        }
        if (
          input.tokens.slice(unit.from, unit.to).some((t) => t.tone?.length)
        ) {
          row.zh += 3;
        }
        return row;
      });
      const path = languagePath(
        units.map((u, i) => ({ ...u, scores: scores[i] })),
        codes,
        6
      );
      const packet = [
        4,
        3,
        languageRecords.flat().length,
        input.tokens.length,
        units.length,
        6,
        8,
      ];
      for (let l = 0; l < languageRecords.length; l++) {
        for (const [ipa, count] of languageRecords[l]) {
          const tokens = sounds(ipa);
          packet.push(
            l,
            tokens.length,
            count,
            ...tokens.map((t) => id(t.symbol))
          );
        }
      }
      for (let i = 0; i < input.tokens.length; i++) {
        const token = input.tokens[i];
        packet.push(
          id(token.symbol),
          Number(Boolean(token.tone?.length)),
          Number(input.boundaries.has(i)),
          i % 2 ? 0.2 : 0.1
        );
      }
      for (const unit of units) {
        packet.push(unit.from, unit.to, Number(unit.pause));
      }
      const expected = codes.map(
        (code) =>
          scores.reduce((s, row) => s + row[code], 0) /
          Math.max(1, input.tokens.length)
      );
      expected.push(
        ...scores.flatMap((row) => codes.map((code) => row[code])),
        ...path.map((code) => codes.indexOf(code))
      );
      const confidence = [];
      const weights = codes.map(() => 0);
      for (let u = 0; u < units.length; ) {
        const start = u;
        const sums = codes.map(() => 0);
        while (u < units.length && path[u] === path[start]) {
          codes.forEach((code, l) => {
            sums[l] += scores[u][code];
          });
          for (let i = units[u].from; i < units[u].to; i++) {
            weights[codes.indexOf(path[u])] += i % 2 ? 0.2 : 0.1;
          }
          u++;
        }
        sums.sort((a, b) => b - a);
        const value =
          (1 - Math.exp(-(sums[0] - sums[1]) / 4)) *
          Math.min(1, (units[u - 1].to - units[start].from) / 8);
        confidence.push(...Array(u - start).fill(value));
      }
      expected.push(
        ...confidence,
        ...weights.map((w) => w / (weights.reduce((a, b) => a + b, 0) || 1))
      );
      const actual = runRecognition(engine, packet, 'vs_language_run');
      expect(actual.length).toBe(expected.length);
      expect(actual.every((v, i) => Math.abs(v - expected[i]) < 1e-10)).toBe(
        true
      );
    }
  });
});

describe('Rust mixed decoding', () => {
  it('matches joint exact/edit paths, language penalties, count resets and pause exemptions', async () => {
    const engine = await loadRustEngine();
    const languages = ['en', 'ru'];
    const lexicons = new Map([
      [
        'en',
        smallLexicon(
          [
            ['a', 'a', 100],
            ['book', 'bʊk', 30],
            ['to', 'tu', 50],
          ],
          'en',
          [['a\tbook', 20]]
        ),
      ],
      [
        'ru',
        smallLexicon(
          [
            ['а', 'a', 50],
            ['дом', 'dom', 30],
            ['ту', 'tu', 100],
          ],
          'ru',
          [['а\tдом', 20]]
        ),
      ],
    ]);
    for (const ipa of [
      'a bʊk dom tu',
      'abʊkdomtu',
      'abʊk|domtu',
      'bʊɡ dom',
      'blɪkbʊk',
    ]) {
      for (const given of [false, true]) {
        const input = recognitionInput(ipa, given ? 'given' : 'search');
        const mid = Math.min(4, input.tokens.length);
        const spans = [
          { language: 'en', from: 0, to: mid },
          ...(mid < input.tokens.length
            ? [{ language: 'ru', from: mid, to: input.tokens.length }]
            : []),
        ];
        const options = { language: 'en', given, beam: 16, lexicons, spans };
        const exact = decode(input, lexicons.get('en'), options, true);
        const texts = new Set(exact.map((p) => p.text));
        const expected = [
          ...exact,
          ...decode(input, lexicons.get('en'), options, false).filter(
            (p) => !texts.has(p.text)
          ),
        ].slice(0, 3);
        const packet = [2, input.tokens.length];
        for (let i = 0; i < input.tokens.length; i++) {
          packet.push(i < mid ? 0 : 1);
        }
        for (let i = 0; i <= input.tokens.length; i++) {
          packet.push(Number(input.pauses.has(i)));
        }
        const wordLists = [];
        for (const language of languages) {
          const { packet: single, words } = recognitionPacket(
            input,
            lexicons.get(language),
            { ...options, language },
            3
          );
          packet.push(single.length, ...single);
          wordLists.push(words);
        }
        const data = runRecognition(engine, packet, 'vs_recognition_mixed');
        let at = 1;
        expect(data[0]).toBe(expected.length);
        for (const path of expected) {
          expect(Math.abs(data[at++] - path.cost) < 1e-10).toBe(true);
          expect(data[at++]).toBe(path.path.length);
          for (const candidate of path.path) {
            const [language, from, to, word, cost] = data.slice(at, at + 5);
            at += 5;
            expect({
              language: languages[language],
              from,
              to,
              word: wordLists[language][word],
              cost,
            }).toEqual({
              language: candidate.language,
              from: candidate.from,
              to: candidate.to,
              word: candidate.word,
              cost: candidate.cost,
            });
          }
        }
      }
    }
  });

  it('rejects malformed language and mixed packets before allocating claimed sizes', async () => {
    const engine = await loadRustEngine();
    for (const name of ['vs_language_run', 'vs_recognition_mixed']) {
      for (const packet of [
        [],
        [NaN],
        [Infinity],
        [1000000, 1000000],
        [4, 3, 1000000, 1000000, 1000000, 6, 8],
      ]) {
        expect(runRecognition(engine, packet, name) < 0).toBe(true);
      }
    }
  });
});
