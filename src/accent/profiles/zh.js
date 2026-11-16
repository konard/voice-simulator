/**
 * Mandarin Chinese as a first language (`en-x-zh`, `ru-x-zh`, `hi-x-zh`),
 * and the units of Mandarin when it is the language spoken.
 */
import { getPhoneme } from '../../ipa/inventory.js';

/** Voiced plosives become the unaspirated voiceless plosive of their place. */
const VOICED_PLOSIVES = Object.freeze({
  bilabial: 'p˭',
  labiodental: 'p˭',
  dental: 't˭',
  alveolar: 't˭',
  retroflex: 't˭',
  palatal: 't˭',
  velar: 'k˭',
  uvular: 'k˭',
});

const VOICELESS_PLOSIVES = Object.freeze({
  bilabial: 'pʰ',
  dental: 'tʰ',
  alveolar: 'tʰ',
  retroflex: 'tʰ',
  palatal: 'tʰ',
  velar: 'kʰ',
  uvular: 'kʰ',
});

/**
 * Plosives: voiced ones are said unaspirated, and voiceless ones aspirated
 * unless the language spoken itself tells the two apart (Hindi).
 */
function substitute(unit, { contrastsAspiration }) {
  const symbol = [...unit].find((char) => getPhoneme(char));
  const phoneme = getPhoneme(symbol);
  if (
    phoneme?.kind !== 'consonant' ||
    phoneme.manner !== 'plosive' ||
    unit.includes('͡')
  ) {
    return undefined;
  }
  if (phoneme.voiced) {
    return VOICED_PLOSIVES[phoneme.place];
  }
  if (contrastsAspiration || /[ʰ˭]/u.test(unit)) {
    return undefined;
  }
  return VOICELESS_PLOSIVES[phoneme.place];
}

export default Object.freeze({
  language: 'zh',
  name: 'Chinese',
  inventory: Object.freeze(
    'p pʰ t tʰ k kʰ m f n l x ʂ ɕ ʐ s ʈ͡ʂ ʈ͡ʂʰ t͡ɕ t͡ɕʰ t͡s t͡sʰ w j ɥ ŋ ɻ i u y a o ə ɤ ɛ ɑ ʊ ɚ aɪ eɪ oʊ ɹ̩ ɻ̩'.split(
      ' '
    )
  ),
  substitutions: Object.freeze({
    θ: 's',
    ð: 'l',
    v: 'w',
    r: 'l',
    ɹ: 'ɻ',
    ɾ: 'l',
    ɽ: 'l',
    d͡ʒ: 'ʈ͡ʂ',
    d͡ʒʱ: 'ʈ͡ʂ',
    z: 's',
    e: 'ɛ',
    ɦ: 'x',
    ɣ: 'x',
  }),
  substitute,
  processes: Object.freeze([]),
  phonotactics: Object.freeze({
    codas: Object.freeze(['n', 'ŋ']),
    maxOnset: 1,
    epenthesis: 'ə',
    prothesis: null,
  }),
  prosody: Object.freeze({ tunes: 'zh', stressLengthening: 0.5 }),
});
