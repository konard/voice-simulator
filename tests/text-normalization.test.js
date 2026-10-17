/**
 * Text normalisation: numbers, dates, times, money, units, symbols,
 * abbreviations and punctuation breaks per language, with source ranges.
 */

import { describe, it, expect } from 'test-anywhere';
import { textToIpa } from '../src/g2p/index.js';
import { normalizeText } from '../src/g2p/normalize.js';
import { parseIpa } from '../src/ipa/parse.js';

/** The spoken words of a text, joined by spaces. */
/** An all-numeric date written year, month, day with hyphens. */
const NUMERIC_DATE = ['2024', '03', '05'].join('-');

function spoken(text, lang) {
  return textToIpa(text, { lang })
    .words.map((word) => word.text)
    .join(' ');
}

describe('English normalisation', () => {
  it('reads cardinals, decimals, grouping and signs', () => {
    expect(spoken('1,234,567', 'en')).toBe(
      'one million two hundred thirty four thousand five hundred sixty seven'
    );
    expect(spoken('2.5', 'en')).toBe('two point five');
    expect(spoken('-3', 'en')).toBe('minus three');
    expect(spoken('5-7', 'en')).toBe('five to seven');
    expect(spoken('007', 'en')).toBe('zero zero seven');
  });

  it('reads ordinals, years and decades', () => {
    expect(spoken('the 21st and 30th', 'en')).toBe(
      'the twenty first and thirtieth'
    );
    expect(spoken('in 1984', 'en')).toBe('in nineteen eighty four');
    expect(spoken('in 2005', 'en')).toBe('in two thousand five');
    expect(spoken('the 1990s', 'en')).toBe('the nineteen nineties');
    expect(spoken('1984 cats', 'en')).toBe(
      'one thousand nine hundred eighty four cats'
    );
  });

  it('reads dates and times', () => {
    expect(spoken(NUMERIC_DATE, 'en')).toBe('March fifth twenty twenty four');
    expect(spoken('on Jan. 5, 2024', 'en')).toBe(
      'on January fifth twenty twenty four'
    );
    expect(spoken('at 5:30 pm', 'en')).toBe('at five thirty p m');
    expect(spoken('at 7:05', 'en')).toBe('at seven oh five');
    expect(spoken('at 10:00', 'en')).toBe("at ten o'clock");
  });

  it('reads money, percentages, units and symbols', () => {
    expect(spoken('$3.50', 'en')).toBe('three dollars and fifty cents');
    expect(spoken('$1', 'en')).toBe('one dollar');
    expect(spoken('£5m', 'en')).toBe('five million pounds');
    expect(spoken('20%', 'en')).toBe('twenty percent');
    expect(spoken('2.5 kg', 'en')).toBe('two point five kilograms');
    expect(spoken('1 km', 'en')).toBe('one kilometer');
    expect(spoken('salt & pepper', 'en')).toBe('salt and pepper');
    expect(spoken('2 + 2', 'en')).toBe('two plus two');
  });

  it('expands abbreviations and spells acronyms', () => {
    expect(spoken('Dr. Smith', 'en')).toBe('doctor Smith');
    expect(spoken('i.e. this', 'en')).toBe('that is this');
    expect(spoken('No. 5', 'en')).toBe('number five');
    expect(spoken('the BBC and NASA', 'en')).toBe('the b b c and NASA');
    expect(spoken('U.S.A.', 'en')).toBe('u s a');
  });

  it('ends a sentence after a final abbreviation', () => {
    expect(textToIpa('cats etc. Dogs', { lang: 'en' }).ipa).toContain(' . ');
  });
});

describe('Russian normalisation', () => {
  it('agrees numbers with gender and case', () => {
    expect(spoken('1 500 руб.', 'ru')).toBe('тысяча пятьсот рублей');
    expect(spoken('2,5 кг', 'ru')).toBe('две целых пять десятых килограмма');
    expect(spoken('в 2024 году', 'ru')).toBe(
      'в две тысячи двадцать четвёртом году'
    );
    expect(spoken('25%', 'ru')).toBe('двадцать пять процентов');
  });

  it('reads dates, ordinals and abbreviations', () => {
    expect(spoken('15 марта', 'ru')).toBe('пятнадцатого марта');
    expect(spoken('сегодня 15 марта', 'ru')).toBe('сегодня пятнадцатое марта');
    expect(spoken('2-го', 'ru')).toBe('второго');
    expect(spoken('т.е. МГУ', 'ru')).toBe('то есть м г у');
  });

  it('keeps stress marks for generated words', () => {
    const word = textToIpa('5', { lang: 'ru' }).words[0];
    expect(word.text).toBe('пять');
    expect(word.ipa).toBe('pʲatʲ');
  });
});

describe('Hindi and Chinese normalisation', () => {
  it('reads Hindi numbers, years, units and money', () => {
    expect(spoken('2024 में', 'hi')).toBe('दो हज़ार चौबीस में');
    expect(spoken('15 किमी', 'hi')).toBe('पंद्रह किलोमीटर');
    expect(spoken('₹500', 'hi')).toBe('पाँच सौ रुपये');
    expect(spoken('३', 'hi')).toBe('तीन');
  });

  it('reads Chinese numbers, years, times and percentages', () => {
    expect(spoken('2个', 'zh')).toBe('两 个');
    expect(spoken('2024年', 'zh')).toBe('二零二四 年');
    expect(spoken('3:05', 'zh')).toBe('三点零五分');
    expect(spoken('30%', 'zh')).toBe('百分之三十');
  });

  it('keeps Chinese IPA and splits Hanzi into highlightable words', () => {
    const result = textToIpa('你好世界', { lang: 'zh' });
    expect(result.ipa).toBe('ni˧˥ xɑʊ˨˩ ʂɻ̩˥˩ t͡ɕjɛ˥˩');
    expect(result.words.map((word) => word.original).join('')).toBe('你好世界');
  });
});

describe('punctuation breaks', () => {
  it('keeps distinct break symbols', () => {
    const ipa = textToIpa('One, two; three — four (five) "six"... Seven!', {
      lang: 'en',
    }).ipa;
    for (const symbol of [',', ';', '|', '(', ')', '"', '…', '!']) {
      expect(ipa).toContain(symbol);
    }
  });

  it('merges adjacent breaks to the strongest', () => {
    expect(textToIpa('Really?!', { lang: 'en' }).ipa).toBe('ˈɹɪli ?');
    expect(textToIpa('Wait,.', { lang: 'en' }).ipa).toBe('ˈweɪt .');
  });

  it('marks questions that start with a question word as falling', () => {
    expect(textToIpa('What is it?', { lang: 'en' }).ipa).toContain('↘ ?');
    expect(textToIpa('Is it?', { lang: 'en' }).ipa).not.toContain('↘');
    expect(textToIpa('Где ты?', { lang: 'ru' }).ipa).toContain('↘ ?');
  });

  it('parses the new breaks into boundary classes', () => {
    const { tokens, unknown } = parseIpa(
      textToIpa('A (b), c! What?', { lang: 'en' }).ipa
    );
    expect(unknown).toEqual([]);
    const boundaries = tokens
      .filter((token) => token.kind === 'pause' && token.strength > 0)
      .map((token) => token.boundary);
    expect(boundaries).toEqual(['paren', 'comma', 'exclamation', 'question']);
    const contour = tokens.find((token) => token.contour);
    expect(contour.contour).toBe('fall');
    const inside = tokens.filter((token) => token.parenthetical);
    expect(inside.length > 0).toBe(true);
  });
});

describe('source ranges', () => {
  it('maps every word back to the source text', () => {
    const text = `Dr. Smith paid $3.50 on ${NUMERIC_DATE}, i.e. 20% more!`;
    const { words } = textToIpa(text, { lang: 'en' });
    for (const word of words) {
      expect(text.slice(word.sourceStart, word.sourceEnd)).toBe(word.original);
    }
    const money = words.filter((word) => word.original === '$3.50');
    expect(money.map((word) => word.text).join(' ')).toBe(
      'three dollars and fifty cents'
    );
    for (let index = 1; index < words.length; index++) {
      expect(words[index].sourceStart >= words[index - 1].sourceStart).toBe(
        true
      );
    }
  });

  it('returns break items with their source range', () => {
    const items = normalizeText('Hi, you.', {
      lang: 'en',
      wordLanguage: () => 'en',
    });
    expect(items.map((item) => item.symbol ?? item.text)).toEqual([
      'Hi',
      ',',
      'you',
      '.',
    ]);
    expect(items[1].sourceStart).toBe(2);
  });
});
