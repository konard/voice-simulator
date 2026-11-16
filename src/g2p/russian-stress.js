/**
 * Whole-word Russian pronunciations. The stress of other words is in
 * `RU_FORMS`, `RU_STEMS` and `RU_GUESS` (src/g2p/lexicon/ru.js), built from
 * data/lexicon/ru-stress.txt by scripts/build-lexicon.mjs.
 */

/** Whole-word pronunciations that ordinary rules get wrong. */
export const RUSSIAN_EXCEPTIONS = {
  что: 'ʂto',
  чтобы: 'ˈʂtobɨ',
  конечно: 'kɐˈnʲeʂnə',
  скучно: 'ˈskuʂnə',
  сегодня: 'sʲɪˈvodʲnʲə',
  здравствуйте: 'ˈzdrastvʊjtʲe',
  здравствуй: 'ˈzdrastvʊj',
};
