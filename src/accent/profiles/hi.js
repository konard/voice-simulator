/**
 * Hindi as a first language (`en-x-hi`, `ru-x-hi`, `zh-x-hi`), and the
 * units of Hindi when it is the language spoken.
 */
import { INDIAN_UNITS } from '../../g2p/accents.js';

export default Object.freeze({
  language: 'hi',
  name: 'Hindi',
  inventory: Object.freeze(
    'k kʰ ɡ ɡʱ ŋ t͡ʃ t͡ʃʰ d͡ʒ d͡ʒʱ ɲ ʈ ʈʰ ɖ ɖʱ ɳ t̪ t̪ʰ d̪ d̪ʱ n p pʰ b bʱ m j ɾ r l ʋ ʃ s ɦ q x ɣ z ɽ ɽʱ f ə aː ɪ iː ʊ uː eː ɛː oː ɔː ɔ ə̃ ãː ĩː ũː ẽː ɛ̃ː õː ɔ̃ː ɪ̃ ʊ̃'.split(
      ' '
    )
  ),
  substitutions: Object.freeze({
    x: 'kʰ',
    ɨ: 'i',
    ɹ̩: 'ɪ',
    ɻ̩: 'ɪ',
    v: 'ʋ',
    w: 'ʋ',
    ɻ: 'ɾ',
  }),
  // Palatalised consonants become a consonant and j (Cʲ → Cj).
  splitPalatalized: true,
  // English spoken with Hindi sounds is Indian English: the en-IN units
  // on the American transcription, on top of the en-IN pronunciation.
  targets: Object.freeze({
    en: Object.freeze({ base: 'en-IN', substitutions: INDIAN_UNITS }),
  }),
  processes: Object.freeze([]),
  phonotactics: Object.freeze({
    codas: 'any',
    maxOnset: 2,
    epenthesis: 'ə',
    prothesis: 'ɪ',
  }),
  prosody: Object.freeze({ tunes: 'hi', stressLengthening: 0.5 }),
});
