/**
 * English accents. The dictionary is General American; other accents are
 * derived word by word with lexical-set rules (Wells) that look at the
 * spelling where the American vowel merges several sets:
 *
 * - `en-US` General American: rhotic, T/D flapped between a vowel and an
 *   unstressed vowel (`water` ˈwɔɾɚ).
 * - `en-GB` Southern British (modern RP): non-rhotic with a linking r,
 *   BATH ɑː (`bath`, `dance`), LOT ɒ, THOUGHT ɔː, GOAT əʊ, NURSE ɜː,
 *   START ɑː, NEAR ɪə, SQUARE ɛə, CURE ʊə, yod after t/d/n (`tune`),
 *   long FLEECE and GOOSE, `z` is "zed", no flapping.
 * - `en-AU` General Australian: non-rhotic, flapped, BATH ɐː except
 *   before a nasal, START ɐː, LOT ɔ, THOUGHT oː, GOAT əʉ, FACE æɪ,
 *   PRICE ɑe, MOUTH æɔ, GOOSE ʉː, SQUARE eː.
 * - `en-IN` Indian English: rhotic with a tapped r, retroflex t/d,
 *   dental TH stops, ʋ for v/w, monophthong FACE eː and GOAT oː,
 *   STRUT ə, no flapping.
 *
 * Regional and foreign accents of every language (`en-CA`, `ru-x-south`,
 * `en-x-ru`, ...) are in src/accent/ (issue 57).
 */

import { alignVowels, ipaUnits, isVowelUnit } from './spelling.js';

/**
 * One entry of ACCENTS: `kind` is `standard` (the default of a language,
 * and the other standard Englishes), `regional` or `foreign` (the language
 * spoken with the sounds of a first language, `<target>-x-<first>`).
 */
function entry(code, name, native, kind) {
  return Object.freeze({ code, name, native, kind });
}

/**
 * Accents per language, the first one is the default. The rules of every
 * accent but the four English standards are in src/accent/ (issue 57).
 */
export const ACCENTS = Object.freeze({
  en: Object.freeze([
    entry('en-US', 'American', 'American', 'standard'),
    entry('en-GB', 'British', 'British', 'standard'),
    entry('en-AU', 'Australian', 'Australian', 'standard'),
    entry('en-IN', 'Indian', 'Indian', 'standard'),
    entry('en-CA', 'Canadian', 'Canadian', 'regional'),
    entry('en-x-ru', 'Russian accent', 'Russian accent', 'foreign'),
    entry('en-x-hi', 'Hindi accent', 'Hindi accent', 'foreign'),
    entry('en-x-zh', 'Chinese accent', 'Chinese accent', 'foreign'),
  ]),
  ru: Object.freeze([
    entry('ru-RU', 'Standard', 'Литературный', 'standard'),
    entry('ru-x-north', 'Northern', 'Северный (оканье)', 'regional'),
    entry('ru-x-south', 'Southern', 'Южный (фрикативное г)', 'regional'),
    entry('ru-x-en', 'English accent', 'Английский акцент', 'foreign'),
    entry('ru-x-hi', 'Hindi accent', 'Акцент хинди', 'foreign'),
    entry('ru-x-zh', 'Chinese accent', 'Китайский акцент', 'foreign'),
  ]),
  hi: Object.freeze([
    entry('hi-IN', 'Standard', 'मानक', 'standard'),
    entry('hi-x-east', 'Eastern', 'पूर्वी', 'regional'),
    entry('hi-x-en', 'English accent', 'अंग्रेज़ी लहजा', 'foreign'),
    entry('hi-x-ru', 'Russian accent', 'रूसी लहजा', 'foreign'),
    entry('hi-x-zh', 'Chinese accent', 'चीनी लहजा', 'foreign'),
  ]),
  zh: Object.freeze([
    entry('zh-CN', 'Standard (Putonghua)', '普通话', 'standard'),
    entry('zh-TW', 'Taiwan', '台湾国语', 'regional'),
    entry('zh-x-south', 'Southern', '南方口音', 'regional'),
    entry('zh-x-en', 'English accent', '英语口音', 'foreign'),
    entry('zh-x-ru', 'Russian accent', '俄语口音', 'foreign'),
    entry('zh-x-hi', 'Hindi accent', '印地语口音', 'foreign'),
  ]),
});

/**
 * The ACCENTS entry of an accent code (`en-GB`) or region (`GB`) of a
 * language, or null.
 * @param {string} lang
 * @param {string} [accent]
 */
export function findAccent(lang, accent) {
  const list = ACCENTS[lang];
  if (!list || accent === undefined || accent === null) {
    return null;
  }
  const wanted = String(accent).toLowerCase();
  return (
    list.find(
      ({ code }) =>
        code.toLowerCase() === wanted ||
        code.slice(lang.length + 1).toLowerCase() === wanted
    ) ?? null
  );
}

/**
 * Resolve an accent option for a language: an accent code (`en-GB`), a
 * region (`GB`), or nothing for the default. An unknown code of the
 * language itself (`ru-south`) throws a RangeError; anything else that is
 * unknown, such as a code of another language, gives the default.
 * @param {string} lang
 * @param {string} [accent]
 * @returns {string|null} null for a language without accents.
 */
export function resolveAccent(lang, accent) {
  const list = ACCENTS[lang];
  if (!list) {
    return null;
  }
  const found = findAccent(lang, accent);
  if (found) {
    return found.code;
  }
  if (
    String(accent ?? '')
      .toLowerCase()
      .startsWith(`${lang}-`)
  ) {
    throw new RangeError(
      `Unknown accent "${accent}" for ${lang} (use ${list.map(({ code }) => code).join(', ')})`
    );
  }
  return list[0].code;
}

/** Words with an æ that is ɑː in southern England (BATH). */
const BATH_WORDS = new Set(
  `ask asked asking asks basket baskets bask cask flask mask masks task tasks
  clasp grasp gasp rasp after afternoon afterwards craft crafts draft draught
  graft raft shaft daft laugh laughed laughing laughter half halves calf
  calves path paths bath baths class classes classic glass glasses grass
  pass passed passing passage past last lasted lasting fast faster cast
  casting mast vast blast contrast nasty master masters plaster castle
  fasten rather chance chances dance danced dancing dancer glance lance trance
  advance advanced france answer answers answered can't shan't chant grant
  granted plant plants slant command commander demand demands example
  examples sample samples branch branches staff aunt banana bananas
  disaster ghastly lather`.split(/\s+/)
);

/** Whole-word pronunciations that the rules cannot derive. */
const OVERRIDES = {
  'en-GB': {
    what: 'ˈwɒt',
    was: 'wɒz',
    because: 'bɪˈkɒz',
    of: 'ɒv',
    from: 'fɹɒm',
    tomato: 'təˈmɑːtəʊ',
    schedule: 'ˈʃɛdjuːl',
    again: 'əˈɡɛn',
    either: 'ˈaɪðə',
    neither: 'ˈnaɪðə',
    z: 'ˈzɛd',
  },
  'en-AU': {
    what: 'ˈwɔt',
    was: 'wɔz',
    because: 'bəˈkɔz',
    of: 'ɔv',
    from: 'fɹɔm',
    tomato: 'təˈmɐːtəʉ',
    z: 'ˈzɛd',
  },
  'en-IN': { z: 'ˈzɛd' },
};

const VOWEL_START = (unit) => Boolean(unit) && isVowelUnit(unit);

/** Indices of nuclei that carry primary or secondary stress. */
function stressedNuclei(units) {
  const stressed = new Set();
  let pending = false;
  units.forEach((unit, index) => {
    if (unit === 'ˈ' || unit === 'ˌ') {
      pending = true;
    } else if (isVowelUnit(unit)) {
      if (pending) {
        stressed.add(index);
      }
      pending = false;
    }
  });
  return stressed;
}

/** The unit after `index`, skipping stress marks. */
function following(units, index) {
  for (let next = index + 1; next < units.length; next++) {
    if (units[next] !== 'ˈ' && units[next] !== 'ˌ') {
      return units[next];
    }
  }
  return undefined;
}

/** Letters right after the vowel group of a nucleus. */
function lettersAfter(spelling, group) {
  return group ? spelling.toLowerCase().slice(group.end, group.end + 2) : '';
}

/**
 * Non-rhotic vowels before r: START, NORTH, NEAR, SQUARE, CURE, NURSE.
 * Returns the replacement for `vowel + ɹ`, or null to keep both.
 */
function rhoticVowel(vowel, context) {
  const rule = NON_RHOTIC[RHOTIC_ALIASES[vowel] ?? vowel];
  return rule ? rule(context, context.beforeVowel ? 'ɹ' : '') : null;
}

const RHOTIC_ALIASES = { o: 'ɔ', e: 'ɛ', i: 'ɪ', u: 'ʊ' };

/** Non-rhotic vowel per American vowel before r; `tail` is a linking ɹ. */
const NON_RHOTIC = {
  ɑ: ({ beforeVowel, group }, tail) =>
    group?.letters.includes('o') && beforeVowel ? 'ɒɹ' : `ɑː${tail}`,
  ɔ: (context, tail) => `ɔː${tail}`,
  ɛ: ({ beforeVowel, group, after }, tail) => {
    if (beforeVowel && (group?.letters === 'e' || after.startsWith('rr'))) {
      return group?.letters === 'a' ? 'æɹ' : 'ɛɹ';
    }
    return `ɛə${tail}`;
  },
  ɪ: ({ beforeVowel, after }, tail) =>
    beforeVowel && after.startsWith('rr') ? 'ɪɹ' : `ɪə${tail}`,
  ʊ: (context, tail) => `ʊə${tail}`,
};

/** LOT, PALM and THOUGHT/CLOTH vowels by their spelling. */
function backVowel(unit, group, spelling) {
  const letters = group?.letters ?? spelling.toLowerCase();
  const before = group ? spelling.toLowerCase()[group.start - 1] : '';
  if (unit === 'ɑ') {
    const lotA = letters === 'a' && (before === 'w' || before === 'u');
    return letters.includes('o') || lotA ? 'ɒ' : 'ɑː';
  }
  const cloth = group ? letters === 'o' : /o(?![uaow])/.test(letters);
  return cloth ? 'ɒ' : 'ɔː';
}

/** Turn General American units into Southern British ones. */
function britishUnits(units, spelling) {
  const aligned = alignVowels(spelling, units) ?? [];
  const stressed = stressedNuclei(units);
  const bath = BATH_WORDS.has(spelling.toLowerCase());
  const out = [];
  let bathDone = false;
  for (let index = 0; index < units.length; index++) {
    const unit = units[index];
    const group = aligned[index];
    const next = following(units, index);
    const replaced =
      isVowelUnit(unit) && units[index + 1] === 'ɹ'
        ? rhoticVowel(unit, {
            beforeVowel: VOWEL_START(following(units, index + 1)),
            group,
            after: lettersAfter(spelling, group),
          })
        : null;
    if (replaced) {
      out.push(replaced);
      index++;
      continue;
    }
    if (needsYod(unit, group, out)) {
      out.push('j');
    }
    const bathVowel = bath && unit === 'æ' && !bathDone && stressed.has(index);
    bathDone ||= bathVowel;
    out.push(
      bathVowel
        ? 'ɑː'
        : britishVowel(unit, { group, next, spelling, stressed, index })
    );
  }
  return dropFinalR(out);
}

function britishVowel(unit, { group, next, spelling, stressed, index }) {
  switch (unit) {
    case 'oʊ':
      return 'əʊ';
    case 'ɝ':
      return VOWEL_START(next) ? 'ʌɹ' : 'ɜː';
    case 'ɚ':
      return VOWEL_START(next) ? 'əɹ' : 'ə';
    case 'ɑ':
    case 'ɔ':
      return backVowel(unit, group, spelling);
    case 'i':
    case 'u':
      return stressed.has(index) ? `${unit}ː` : unit;
    default:
      return unit;
  }
}

/** Yod after t, d, n where the spelling has u, ew, ue or eu (`tune`). */
function needsYod(unit, group, out) {
  if (unit !== 'u' || !/^(?:u|ue|ew|eu)$/.test(group?.letters ?? '')) {
    return false;
  }
  const previous = out.filter((item) => item !== 'ˈ' && item !== 'ˌ').at(-1);
  return ['t', 'd', 'n'].includes(previous);
}

/** Drop an r that is not followed by a vowel. */
function dropFinalR(units) {
  return units.filter(
    (unit, index) => unit !== 'ɹ' || VOWEL_START(following(units, index))
  );
}

/** Flap t and d between a vowel (or r) and an unstressed vowel. */
function flapUnits(units) {
  return units.map((unit, index) => {
    if (unit !== 't' && unit !== 'd') {
      return unit;
    }
    const previous = units[index - 1];
    const before = units[index - 2];
    const next = units[index + 1];
    const vowelBefore =
      VOWEL_START(previous) ||
      ((previous === 'ɹ' || previous === 'ɚ') && VOWEL_START(before));
    const unstressedAfter = VOWEL_START(next) && next !== 'ɝ';
    return vowelBefore && unstressedAfter ? 'ɾ' : unit;
  });
}

const AUSTRALIAN_VOWELS = {
  ɑː: 'ɐː',
  ɒ: 'ɔ',
  ɒɹ: 'ɔɹ',
  ɔː: 'oː',
  əʊ: 'əʉ',
  eɪ: 'æɪ',
  aɪ: 'ɑe',
  aʊ: 'æɔ',
  uː: 'ʉː',
  u: 'ʉ',
  ɛə: 'eː',
  ɛəɹ: 'eːɹ',
};

function australianUnits(units, spelling) {
  const nasalBath = /a(?:n|m)/.test(spelling.toLowerCase());
  const british = britishUnits(units, spelling);
  return flapUnits(
    british.map((unit) => {
      if (unit === 'ɑː' && units.includes('æ') && nasalBath) {
        return 'æ';
      }
      return AUSTRALIAN_VOWELS[unit] ?? unit;
    })
  );
}

/** Indian English sounds of the American units (idempotent). */
export const INDIAN_UNITS = Object.freeze({
  t: 'ʈ',
  d: 'ɖ',
  θ: 't̪ʰ',
  ð: 'd̪',
  v: 'ʋ',
  w: 'ʋ',
  ɹ: 'ɾ',
  oʊ: 'oː',
  eɪ: 'eː',
  ʌ: 'ə',
  ɝ: 'əɾ',
  ɚ: 'əɾ',
  ɑ: 'ɑ',
  ɔ: 'ɔ',
});

function indianUnits(units) {
  return units.map((unit) => INDIAN_UNITS[unit] ?? unit);
}

const CONVERTERS = {
  'en-US': (units) => flapUnits(units),
  'en-GB': britishUnits,
  'en-AU': australianUnits,
  'en-IN': indianUnits,
};

/**
 * Adapt the General American IPA of one English word to an accent.
 * @param {string} ipa General American IPA (as from `englishWordToIpa`).
 * @param {string} spelling The written word, used for lexical sets.
 * @param {string} accent Accent code, e.g. `en-GB`.
 * @returns {string}
 */
export function adaptEnglishWord(ipa, spelling, accent) {
  const key = String(spelling ?? '').toLowerCase();
  const override = OVERRIDES[accent]?.[key];
  if (override) {
    return override;
  }
  const convert = CONVERTERS[accent];
  if (!convert || !ipa) {
    return ipa;
  }
  return ipa
    .split(' ')
    .map((part) => convert(ipaUnits(part), key).join(''))
    .join(' ');
}

/**
 * Whether a word ends in an r that a non-rhotic accent pronounces before
 * a vowel (`far away` → fɑːɹ əˈweɪ).
 * @param {string} americanIpa
 */
export function hasLinkingR(americanIpa) {
  return /(?:ɹ|ɚ|ɝ)$/u.test(americanIpa ?? '');
}

/** Non-rhotic accents that link a final r to a following vowel. */
export function isNonRhotic(accent) {
  return accent === 'en-GB' || accent === 'en-AU';
}
