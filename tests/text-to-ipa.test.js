/**
 * IPA parsing, grapheme-to-phoneme conversion and head configuration.
 */

import { describe, it, expect } from 'test-anywhere';
import { parseIpa, formatIpa } from '../src/ipa/parse.js';
import { getPhoneme } from '../src/ipa/inventory.js';
import { textToIpa, detectLanguage } from '../src/g2p/index.js';
import { ERHUA_FINALS, FINALS } from '../src/g2p/pinyin.js';
import { syllabifyTokens } from '../src/ipa/syllables.js';
import {
  HEAD_PARAMETERS,
  DEFAULT_HEAD,
  normalizeHeadConfig,
  randomHeadConfig,
  encodeHeadConfig,
  decodeHeadConfig,
} from '../src/head-config.js';

describe('parseIpa', () => {
  it('reads diacritics, length and stress into features', () => {
    const { tokens } = parseIpa('ˈtʰæ̃ː');
    expect(tokens.length).toBe(2);
    expect(tokens[0].base).toBe('t');
    expect(tokens[0].aspirated).toBe(true);
    expect(tokens[1].base).toBe('æ');
    expect(tokens[1].nasalized).toBe(true);
    expect(tokens[1].long).toBe(true);
    expect(tokens[1].stress).toBe(1);
  });

  it('keeps tie-bar affricates and tone letters', () => {
    const { tokens } = parseIpa('t͡ɕjɛ˥˩');
    expect(tokens[0].affricate).not.toBe(null);
    expect(tokens.at(-1).tone).not.toBe(null);
  });

  it('formats tokens back to IPA with stress on the nucleus', () => {
    expect(formatIpa(parseIpa('həˈloʊ').tokens)).toBe('həlˈoʊ');
    expect(formatIpa(parseIpa('kʰæts').tokens)).toBe('kʰæts');
  });

  it('knows place and manner of consonants', () => {
    const s = getPhoneme('s');
    expect(s.place).toBe('alveolar');
    expect(s.manner).toBe('fricative');
  });
});

describe('textToIpa', () => {
  it('detects the four supported languages', () => {
    expect(detectLanguage('Hello world')).toBe('en');
    expect(detectLanguage('Привет, мир')).toBe('ru');
    expect(detectLanguage('नमस्ते दुनिया')).toBe('hi');
    expect(detectLanguage('你好世界')).toBe('zh');
  });

  it('converts English with a dictionary', () => {
    expect(textToIpa('Hello world').ipa).toBe('həˈloʊ ˈwɝld');
  });

  it('expands numbers', () => {
    expect(textToIpa('3 cats').ipa).toContain('θɹi');
  });

  it('converts Russian with stress and palatalisation', () => {
    // A comma is its own break (continuation rise), distinct from a dash.
    expect(textToIpa('Привет, мир').ipa).toBe('prʲɪˈvʲet , mʲir');
  });

  it('converts Hindi with schwa deletion', () => {
    expect(textToIpa('नमस्ते').ipa).toBe('nəməst̪eː');
  });

  it('converts Chinese characters and numbered pinyin with tones', () => {
    expect(textToIpa('你好世界').ipa).toBe('ni˧˥ xɑʊ˨˩ ʂɻ̩˥˩ t͡ɕjɛ˥˩');
    expect(textToIpa('ni3 hao3', { lang: 'zh' }).ipa).toBe('ni˨˩˦ xɑʊ˨˩˦');
  });
});

describe('erhua', () => {
  const zh = (text) => textToIpa(text, { lang: 'zh' }).ipa;

  it('merges 儿 into the previous syllable', () => {
    expect(zh('花儿')).toBe('xwaɻ˥');
    expect(zh('一点儿')).toBe('i˥˩ tjaɻ˨˩˦');
    expect(zh('小孩儿')).toBe('ɕjɑʊ˨˩ xaɻ˧˥');
    expect(zh('玩儿')).toBe('waɻ˧˥');
    expect(zh('事儿')).toBe('ʂəɻ˥˩');
    expect(zh('哪儿')).toBe('naɻ˨˩˦');
  });

  it('keeps a syllabic 儿', () => {
    expect(zh('儿子').startsWith('ɚ˧˥')).toBe(true);
    expect(zh('女儿')).toBe('ny˨˩ ɚ˧˥');
    expect(zh('儿童')).toBe('ɚ˧˥ tʰʊŋ˧˥');
    expect(zh('他儿子').split(' ').length).toBe(3);
  });

  it('reads pinyin erhua', () => {
    for (const pinyin of ['huār', 'huar1', 'hua1r']) {
      expect(zh(pinyin)).toBe('xwaɻ˥');
    }
    expect(zh('yìdiǎnr')).toBe('i˥˩ tjaɻ˨˩˦');
    expect(zh('huaren').split(' ').length).toBe(2);
  });

  it('covers every final', () => {
    for (const final of Object.keys(FINALS)) {
      if (final === 'er' || final === 'ê') {
        continue;
      }
      const rime = ERHUA_FINALS[final];
      expect(typeof rime).toBe('string');
      expect(rime.endsWith('ɻ')).toBe(true);
      const tokens = parseIpa(`p${rime}˥`).tokens.filter(
        (token) => token.kind !== 'pause'
      );
      expect(syllabifyTokens(tokens, { language: 'zh' }).length).toBe(1);
    }
  });
});

describe('head configuration', () => {
  it('defines a default for every parameter', () => {
    for (const parameter of HEAD_PARAMETERS) {
      expect(typeof DEFAULT_HEAD[parameter.key]).toBe('number');
    }
  });

  it('clamps values into range', () => {
    const head = normalizeHeadConfig({ vocalTractLength: 100 });
    expect(head.vocalTractLength).toBe(20);
  });

  it('is reproducible from a seed and different across seeds', () => {
    const a = randomHeadConfig('seed-a');
    expect(randomHeadConfig('seed-a')).toEqual(a);
    expect(randomHeadConfig('seed-b')).not.toEqual(a);
  });

  it('round-trips through the URL encoding', () => {
    const head = randomHeadConfig('url');
    const decoded = decodeHeadConfig(encodeHeadConfig(head));
    for (const parameter of HEAD_PARAMETERS) {
      expect(
        Math.abs(decoded[parameter.key] - head[parameter.key])
      ).toBeLessThan(parameter.step + 1e-9);
    }
  });
});
