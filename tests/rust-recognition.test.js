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
