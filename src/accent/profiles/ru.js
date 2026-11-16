/**
 * Russian as a first language: the sounds a Russian speaker brings to
 * another language (`en-x-ru`, `hi-x-ru`, `zh-x-ru`), and the units of
 * Russian when it is the language spoken (`ru-x-en`, ...).
 */
export default Object.freeze({
  language: 'ru',
  name: 'Russian',
  // The phonemes and main allophones of the Russian pronouncer, in the
  // order the nearest-unit search prefers them.
  inventory: Object.freeze(
    'p pʲ b bʲ t tʲ d dʲ k kʲ ɡ ɡʲ f fʲ v vʲ ʂ ʐ s sʲ z zʲ x xʲ m mʲ n nʲ ɫ lʲ r rʲ j t͡ɕ t͡s d͡ʐ ɕː a o u ɨ ɛ e i ʊ ə ɪ ɐ'.split(
      ' '
    )
  ),
  substitutions: Object.freeze({
    θ: 's',
    ð: 'z',
    w: 'v',
    ɹ: 'r',
    ɚ: 'ər',
    ɝ: 'ər',
    h: 'x',
    æ: 'ɛ',
    ɪ: 'i',
    ʊ: 'u',
    ʌ: 'a',
    ɑ: 'a',
    ɔ: 'o',
    oʊ: 'o',
    eɪ: 'ɛj',
    aɪ: 'aj',
    aʊ: 'au',
    ɔɪ: 'oj',
    // Sounds the literal nearest-unit search maps badly.
    d͡ʒ: 'd͡ʐ',
    ɾ: 'r',
    ɽ: 'r',
    ɦ: 'x',
    ɹ̩: 'ɨ',
    ɻ̩: 'ɨ',
    ʋ: 'v',
    ɣ: 'ɡ',
    ɽʱ: 'r',
    ɻ: 'ʐ',
    y: 'ju',
  }),
  targets: Object.freeze({
    // English ŋ is said as n + ɡ (the ɡ of Russian loanwords like ринг).
    en: Object.freeze({ substitutions: Object.freeze({ ŋ: 'nɡ' }) }),
  }),
  processes: Object.freeze([
    // Russian voiceless plosives are unaspirated.
    { match: { manner: 'plosive', voiced: false }, before: 'V', add: '˭' },
    // Final devoicing.
    {
      map: {
        b: 'p',
        d: 't',
        ɡ: 'k',
        v: 'f',
        z: 's',
        ʒ: 'ʃ',
        d͡ʒ: 't͡ʃ',
        ʐ: 'ʂ',
        d͡ʐ: 't͡ɕ',
      },
      before: '#',
    },
    // Consonants before i are palatalised.
    {
      map: { t: 'tʲ', d: 'dʲ', n: 'nʲ', l: 'lʲ', ɫ: 'lʲ', s: 'sʲ', z: 'zʲ' },
      before: 'i',
      min: 0.67,
    },
  ]),
  phonotactics: Object.freeze({
    codas: 'any',
    maxOnset: 4,
    epenthesis: 'ə',
    prothesis: null,
  }),
  prosody: Object.freeze({ tunes: 'ru' }),
});
