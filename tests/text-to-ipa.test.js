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
    // Typed pinyin gets the third-tone sandhi across the space (issue 49).
    expect(textToIpa('ni3 hao3', { lang: 'zh' }).ipa).toBe('ni˧˥ xɑʊ˨˩˦');
  });
});

describe('一 and 不', () => {
  const zh = (text) => textToIpa(text, { lang: 'zh' }).ipa;

  it('reads 一 and 不 by their neighbours', () => {
    expect(zh('第一名')).toBe('ti˥˩ i˥ miŋ˧˥');
    expect(zh('十一月')).toBe('ʂɻ̩˧˥ i˥ ɥɛ˥˩');
    expect(zh('一九九一')).toBe('i˥ t͡ɕjoʊ˧˥ t͡ɕjoʊ˨˩ i˥');
    expect(zh('看一看')).toBe('kʰan˥˩ i kʰan˥˩');
    expect(zh('是不是')).toBe('ʂɻ̩˥˩ pu ʂɻ̩˥˩');
  });

  it('reads reduplicated kinship terms with the neutral tone', () => {
    expect(zh('爷爷')).toBe('jɛ˧˥ jɛ');
    expect(zh('奶奶')).toBe('naɪ˨˩ naɪ');
  });

  it('keeps the old sandhi of 一 and 不', () => {
    expect(zh('一个')).toBe('i˧˥ kɤ˥˩');
    expect(zh('一天')).toBe('i˥˩ tʰjɛn˥');
    expect(zh('不是')).toBe('pu˧˥ ʂɻ̩˥˩');
    expect(zh('第一')).toBe('ti˥˩ i˥');
  });
});

describe('sandhi across spaces', () => {
  const zh = (text) => textToIpa(text, { lang: 'zh' });

  it('joins Hanzi words', () => {
    expect(zh('我 很 好').ipa).toBe(zh('我很好').ipa);
    expect(zh('你 好 吗').ipa).toBe(zh('你好吗').ipa);
    expect(zh('不 对').ipa).toBe(zh('不对').ipa);
    expect(zh('一 个').ipa).toBe(zh('一个').ipa);
  });

  it('joins typed pinyin', () => {
    expect(zh('wǒ hěn hǎo').ipa).toBe(zh('wo3hen3hao3').ipa);
    expect(zh('wo3 hen3 hao3').ipa).toBe(zh('wo3hen3hao3').ipa);
    expect(zh('nǐ hǎo').ipa).toBe(zh('ni3hao3').ipa);
  });

  it('keeps typed tones of bu and yi', () => {
    expect(zh('bu4 dui4').ipa).toBe('pu˥˩ tweɪ˥˩');
  });

  it('stops at a break', () => {
    expect(zh('我很好，你好').ipa).toBe('wo˨˩ xən˧˥ xɑʊ˨˩˦ , ni˧˥ xɑʊ˨˩˦');
  });

  it('stops at another language', () => {
    const { words } = zh('很 好 OK 你 好');
    const ipa = (list) => list.map((word) => word.ipa).join(' ');
    // `OK` is read letter by letter: its items sit between the two pairs.
    expect(words.length).toBeGreaterThan(4);
    expect(ipa(words.slice(0, 2))).toBe(zh('很好').ipa);
    expect(ipa(words.slice(-2))).toBe(zh('你好').ipa);
  });

  it('keeps the word items', () => {
    const { words } = zh('我 很 好');
    expect(
      words.map(({ text, sourceStart, sourceEnd }) => [
        text,
        sourceStart,
        sourceEnd,
      ])
    ).toEqual([
      ['我', 0, 1],
      ['很', 2, 3],
      ['好', 4, 5],
    ]);
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

  it('does not voice an affricate, ч or х before же and бы', () => {
    check([
      ['отец бы', 'ˈotʲɪt͡s bɨ'],
      ['врач бы', 'vrat͡ɕ bɨ'],
      ['смех же', 'smʲex ʐɨ'],
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
