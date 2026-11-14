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

describe('Hindi questions', () => {
  const hi = (text) => textToIpa(text, { lang: 'hi' }).ipa;

  it('rises on polar questions with the particle', () => {
    for (const text of [
      'क्या तुम आओगे?',
      'क्या आप ठीक हैं?',
      'क्या यह आपकी किताब है?',
      'क्या वह घर पर है?',
    ]) {
      expect(hi(text)).not.toContain('↘');
    }
  });

  it('falls when क्या means what', () => {
    for (const text of [
      'तुम क्या खाओगे?',
      'यह क्या है?',
      'तुम्हारा नाम क्या है?',
      'क्या हुआ?',
      'क्या बात है?',
    ]) {
      expect(hi(text).endsWith('↘ ?')).toBe(true);
    }
  });

  it('falls on question words in any position', () => {
    for (const text of [
      'आप कहाँ जा रहे हैं?',
      'आप कल कहाँ जा रहे हैं?',
      'वह आदमी कौन है?',
      'तुम इतनी देर से क्यों आए?',
    ]) {
      expect(hi(text).endsWith('↘ ?')).toBe(true);
    }
  });

  it('rises on plain polar questions', () => {
    expect(hi('तुम आओगे?')).not.toContain('↘');
  });

  it('keeps a statement unchanged', () => {
    expect(hi('क्या बात है!')).not.toContain('↘');
  });
});

describe('question marking', () => {
  it('keeps question marking of other languages', () => {
    expect(
      textToIpa('Where are you going?', { lang: 'en' }).ipa.endsWith('↘ ?')
    ).toBe(true);
    expect(textToIpa('Are you coming?', { lang: 'en' }).ipa).not.toContain('↘');
    expect(textToIpa('Кто это?', { lang: 'ru' }).ipa.endsWith('↘ ?')).toBe(
      true
    );
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

describe('English weak forms', () => {
  const ipa = (text, options = {}) =>
    textToIpa(text, { lang: 'en-US', ...options }).ipa;

  it('weakens function words inside a phrase', () => {
    expect(ipa('a cup of tea for you')).toBe('ə ˈkʌp əv ˈti fɚ ju');
    expect(ipa('He was at home')).toBe('hi wəz ət ˈhoʊm');
    expect(ipa('I can do it')).toBe('aɪ kən ˈdu ɪt');
    expect(ipa('an apple')).toBe('ən ˈæpəl');
  });

  it('uses the forms before a vowel', () => {
    expect(ipa('the end')).toBe('ði ˈɛnd');
    expect(ipa('the apple and the pear')).toBe('ði ˈæpəl ənd ðə ˈpɛɹ');
    expect(ipa('to eat')).toBe('tu ˈit');
  });

  it('keeps the strong form at the end of a phrase', () => {
    expect(ipa('Yes, I can.')).toBe('ˈjɛs , aɪ ˈkæn .');
    expect(ipa('What are you looking at?')).toBe('ˈwʌt ɚ ju ˈlʊkɪŋ ˈæt ↘ ?');
  });

  it('keeps one stress in every phrase', () => {
    expect(ipa('Is it?').startsWith('ˈɪz ɪt')).toBe(true);
    expect(ipa('It is.').startsWith('ɪt ˈɪz')).toBe(true);
    expect(ipa('For you.').startsWith('fɚ ˈju')).toBe(true);
  });

  it('leaves single words alone', () => {
    for (const word of ['you', 'can', 'at', 'of', 'the']) {
      expect(ipa(word)).toBe(ipa(word, { weakForms: false }));
    }
  });

  it('fuses have to and used to', () => {
    expect(ipa('I have to go')).toBe('aɪ ˈhæf tə ˈɡoʊ');
    // `live` is the verb after `to` (the heteronym rules of issue 44).
    // eslint-disable-next-line local/no-changelog-comments -- a test sentence
    expect(ipa('I used to live there')).toBe('aɪ ˈjus tə ˈlɪv ˈðɛɹ');
    expect(ipa('It is used to make bread')).toBe('ɪt ɪz ˈjuzd tə ˈmeɪk ˈbɹɛd');
  });

  it('keeps nouns and negations strong', () => {
    expect(ipa('a can of beans')).toBe('ə ˈkæn əv ˈbinz');
    expect(ipa('my will is strong')).toBe('maɪ ˈwɪl ɪz ˈstɹɔŋ');
    expect(ipa('You must not go')).toBe('ju ˈmʌst ˈnɑt ˈɡoʊ');
  });

  it('adapts weak forms to the accent', () => {
    const british = (text) => ipa(text, { lang: 'en-GB' });
    expect(british('for a while')).toBe('fəɹ ə ˈwaɪl');
    expect(british('a cup of tea for you')).toBe('ə ˈkʌp əv ˈtiː fə ju');
    expect(british('He was at home')).toBe('hi wəz ət ˈhəʊm');
  });

  it('does not touch spelled letters', () => {
    expect(ipa('US and IT')).toBe('ˈju ˈɛs ənd ˈaɪ ˈti');
  });

  it('can be switched off', () => {
    expect(ipa('I can do it', { weakForms: false })).toBe('ˈaɪ ˈkæn ˈdu ˈɪt');
  });

  it('keeps one word item per written word', () => {
    const text = 'I have to go';
    const { words } = textToIpa(text, { lang: 'en-US' });
    const strong = textToIpa(text, { lang: 'en-US', weakForms: false });
    expect(words.map((word) => word.text)).toEqual(['I', 'have', 'to', 'go']);
    expect(words.map((word) => word.sourceStart)).toEqual(
      strong.words.map((word) => word.sourceStart)
    );
  });
});
