/**
 * IPA parsing, grapheme-to-phoneme conversion and head configuration.
 */

import { describe, it, expect } from 'test-anywhere';
import { parseIpa, formatIpa } from '../src/ipa/parse.js';
import { getPhoneme } from '../src/ipa/inventory.js';
import { readFileSync } from 'node:fs';
import { textToIpa, detectLanguage } from '../src/g2p/index.js';
import { russianWordToIpa } from '../src/g2p/russian.js';
import {
  RUSSIAN_ENCLITICS,
  RUSSIAN_PROCLITICS,
} from '../src/g2p/russian-clitics.js';
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

describe('Russian clitics', () => {
  const ru = (text) => textToIpa(text, { lang: 'ru' }).ipa;
  const check = (pairs) => {
    for (const [text, ipa] of pairs) {
      expect(ru(text)).toBe(ipa);
    }
  };

  it('keeps the voiced consonant before a voiced sound', () => {
    check([
      ['из дома', 'ɪz ˈdomə'],
      ['в доме', 'v ˈdomʲə'],
      ['об этом', 'ɐb ˈɛtəm'],
      ['без меня', 'bʲɪz mʲɪˈnʲa'],
      ['под домом', 'pɐd ˈdoməm'],
    ]);
  });

  it('devoices before a voiceless sound', () => {
    check([
      ['из парка', 'ɪs ˈparkə'],
      ['в парке', 'f ˈparkʲə'],
    ]);
  });

  it('voices before a voiced obstruent', () => {
    check([
      ['с братом', 'z ˈbratəm'],
      ['от брата', 'ɐd ˈbratə'],
      ['к дому', 'ɡ ˈdomʊ'],
    ]);
  });

  it('does not voice before sonorants and в', () => {
    check([
      ['от мамы', 'ɐt ˈmamɨ'],
      ['к маме', 'k ˈmamʲə'],
      ['к вам', 'k vam'],
    ]);
  });

  it('reduces the vowels', () => {
    check([
      ['на работе', 'nə rɐˈbotʲə'],
      ['до завтра', 'dɐ ˈzaftrə'],
      ['по дороге', 'pə dɐˈroɡʲə'],
      ['для меня', 'dlʲɪ mʲɪˈnʲa'],
      ['у меня', 'ʊ mʲɪˈnʲa'],
      ['через дорогу', 't͡ɕɪrʲɪz dɐˈroɡʊ'],
      ['перед домом', 'pʲɪrʲɪd ˈdoməm'],
      ['со мной', 'sɐ mnoj'],
      ['обо мне', 'ɐbɐ mnʲe'],
    ]);
  });

  it('hardens и after a hard consonant', () => {
    check([
      ['с Иваном', 's ɨˈvanəm'],
      ['от Ивана', 'ɐt ɨˈvanə'],
    ]);
  });

  it('joins chains', () => {
    check([
      ['из-за дома', 'ɪz zɐ ˈdomə'],
      ['из-под дома', 'ɪs pɐd ˈdomə'],
      ['не для меня', 'nʲɪ dlʲɪ mʲɪˈnʲa'],
    ]);
  });

  it('reduces particles', () => {
    check([
      ['Я не знаю', 'ja nʲɪ ˈznajʊ'],
      ['Он же сказал', 'on ʐɨ skɐˈzaɫ'],
      ['знаешь ли', 'ˈznajɪʂ lʲɪ'],
    ]);
  });

  it('voices before же and бы', () => {
    check([
      ['как же', 'kaɡ ʐɨ'],
      ['вот бы', 'vod bɨ'],
      ['друг же', 'druɡ ʐɨ'],
      ['сказал бы', 'skɐˈzaɫ bɨ'],
    ]);
  });

  it('stops at a break', () => {
    check([
      ['Он сказал, в доме', 'on skɐˈzaɫ , v ˈdomʲə'],
      ['Да, на.', 'da , na .'],
    ]);
  });

  it('leaves single words alone', () => {
    check([
      ['на', 'na'],
      ['в', 'f'],
      ['не', 'nʲe'],
      ['бы', 'bɨ'],
    ]);
    for (const word of [
      ...Object.keys(RUSSIAN_PROCLITICS),
      ...Object.keys(RUSSIAN_ENCLITICS),
    ]) {
      expect(ru(word)).toBe(russianWordToIpa(word).ipa);
    }
  });

  it('keeps a typed stress mark', () => {
    check([
      ['на́ гору', 'na ˈɡorʊ'],
      ['н+а гору', 'na ˈɡorʊ'],
    ]);
  });

  it('stops at another language', () => {
    check([['в office', 'f ˈɔfɪs']]);
  });

  it('does not read a letter of a spelled abbreviation as a clitic', () => {
    // США is spelled letter by letter; its first letter с is not the preposition.
    check([['в США', 'v ɛs ʂa a']]);
  });

  it('keeps one word item per written word', () => {
    const before = textToIpa('из-за дома', { lang: 'ru' }).words;
    expect(before.map((word) => word.text)).toEqual(['из', 'за', 'дома']);
    expect(before.map((word) => word.sourceStart)).toEqual([0, 3, 6]);
  });

  it('gives the IPA of the prototype for every phrase', () => {
    const lines = readFileSync(
      new globalThis.URL(
        '../experiments/issue-11-russian-clitics-prototype.txt',
        import.meta.url
      ),
      'utf8'
    )
      .trim()
      .split('\n');
    expect(lines.length).toBe(56);
    for (const line of lines) {
      const [, text, expected] = /^ru (.*): "(.*)" {3}today/u.exec(line);
      // The prototype prints | for a break and leaves out the final break.
      const actual = ru(text)
        .replace(/ [,.?!;…] /gu, ' | ')
        .replace(/ [.?!…]$/u, '');
      expect(`${text}: ${actual}`).toBe(`${text}: ${expected}`);
    }
  });
});
