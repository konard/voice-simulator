/**
 * English as a first language (`ru-x-en`, `hi-x-en`, `zh-x-en`), and the
 * units of (General American) English when it is the language spoken.
 */
import { getPhoneme } from '../../ipa/inventory.js';

const ALVEOLAR_STOPS = Object.freeze({ false: 't', true: 'd' });

/**
 * Dental and retroflex stops become alveolar, breathy voice is dropped
 * (Cʱ → C), and the retroflex and alveolopalatal fricatives become ʃ.
 */
function substitute(unit) {
  const plain = unit.replace('ʱ', '');
  const symbol = [...plain].find((char) => getPhoneme(char));
  const phoneme = getPhoneme(symbol);
  if (phoneme?.kind !== 'consonant' || plain.includes('͡')) {
    return plain === unit ? undefined : plain;
  }
  const dental = plain.includes('̪');
  if (
    phoneme.manner === 'plosive' &&
    (dental || phoneme.place === 'retroflex')
  ) {
    return ALVEOLAR_STOPS[phoneme.voiced] + plain.replace(/[^ʰ]/gu, '');
  }
  if (symbol === 'ʂ' || symbol === 'ɕ') {
    return 'ʃ';
  }
  return plain === unit ? undefined : plain;
}

export default Object.freeze({
  language: 'en',
  name: 'English',
  inventory: Object.freeze(
    'p b t d k ɡ f v θ ð s z ʃ ʒ h t͡ʃ d͡ʒ m n ŋ l ɹ w j ɾ i ɪ eɪ ɛ ɑ æ ɔ oʊ ʊ u ʌ ə ɚ ɝ aɪ aʊ ɔɪ'.split(
      ' '
    )
  ),
  substitutions: Object.freeze({
    r: 'ɹ',
    x: 'h',
    ɨ: 'ɪ',
    y: 'u',
    ʐ: 'ʒ',
    ɐ: 'ə',
    ɾ: 'ɹ',
    ɽ: 'ɹ',
    t͡s: 'ts',
    ɹ̩: 'ə',
    ɻ̩: 'ɚ',
    ɕː: 'ʃ',
    t͡sʰ: 'ts',
    a: 'ɑ',
    e: 'ɛ',
    eː: 'eɪ',
    o: 'oʊ',
    ɦ: 'h',
    ɣ: 'ɡ',
    ɲ: 'nj',
  }),
  substitute,
  // Palatalised consonants become a consonant and j (Cʲ → Cj).
  splitPalatalized: true,
  processes: Object.freeze([
    // Voiceless plosives are aspirated before a stressed vowel.
    {
      match: { manner: 'plosive', voiced: false },
      before: 'V',
      stress: 'stressed',
      add: 'ʰ',
    },
    // Unstressed a and o (said ɑ and oʊ by the map above) become schwa.
    {
      map: { a: 'ə', o: 'ə', ɑ: 'ə', oʊ: 'ə' },
      stress: 'unstressed',
    },
  ]),
  phonotactics: Object.freeze({
    codas: 'any',
    maxOnset: 3,
    epenthesis: 'ə',
    prothesis: null,
  }),
  prosody: Object.freeze({ tunes: 'en' }),
});
