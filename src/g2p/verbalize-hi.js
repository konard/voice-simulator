/**
 * Hindi verbaliser: numbers in the Indian system (सौ, हज़ार, लाख,
 * करोड़), ordinals, years, times, dates, money, units and symbols.
 */

/** 0-99: Hindi numbers below a hundred are irregular words. */
const BELOW_HUNDRED = (
  'शून्य एक दो तीन चार पाँच छह सात आठ नौ दस ग्यारह बारह तेरह चौदह पंद्रह ' +
  'सोलह सत्रह अठारह उन्नीस बीस इक्कीस बाईस तेईस चौबीस पच्चीस छब्बीस ' +
  'सत्ताईस अट्ठाईस उनतीस तीस इकतीस बत्तीस तैंतीस चौंतीस पैंतीस छत्तीस ' +
  'सैंतीस अड़तीस उनतालीस चालीस इकतालीस बयालीस तैंतालीस चवालीस पैंतालीस ' +
  'छियालीस सैंतालीस अड़तालीस उनचास पचास इक्यावन बावन तिरपन चौवन पचपन ' +
  'छप्पन सत्तावन अट्ठावन उनसठ साठ इकसठ बासठ तिरसठ चौंसठ पैंसठ छियासठ ' +
  'सड़सठ अड़सठ उनहत्तर सत्तर इकहत्तर बहत्तर तिहत्तर चौहत्तर पचहत्तर ' +
  'छिहत्तर सतहत्तर अठहत्तर उन्यासी अस्सी इक्यासी बयासी तिरासी चौरासी ' +
  'पचासी छियासी सत्तासी अट्ठासी नवासी नब्बे इक्यानवे बानवे तिरानवे ' +
  'चौरानवे पचानवे छियानवे सत्तानवे अट्ठानवे निन्यानवे'
).split(' ');

const SCALES = [
  [1e7, 'करोड़'],
  [1e5, 'लाख'],
  [1e3, 'हज़ार'],
  [1e2, 'सौ'],
];

/**
 * Spell a non-negative integer in Hindi.
 * @param {number} value
 * @returns {string[]}
 */
export function hindiCardinal(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    return [...String(value)].flatMap((digit) => BELOW_HUNDRED[digit] ?? []);
  }
  if (value < 100) {
    return [BELOW_HUNDRED[value]];
  }
  for (const [scale, name] of SCALES) {
    if (value >= scale) {
      const rest = value % scale;
      return [
        ...hindiCardinal(Math.floor(value / scale)),
        name,
        ...(rest ? hindiCardinal(rest) : []),
      ];
    }
  }
  return [];
}

const ORDINALS = {
  1: 'पहला',
  2: 'दूसरा',
  3: 'तीसरा',
  4: 'चौथा',
  6: 'छठा',
};

function digits(text) {
  return [...text].map((digit) => BELOW_HUNDRED[Number(digit)]);
}

const MONTHS =
  'जनवरी फ़रवरी मार्च अप्रैल मई जून जुलाई अगस्त सितंबर अक्टूबर नवंबर दिसंबर'.split(
    ' '
  );

function year(value) {
  // 1100-1999 are read in hundreds: उन्नीस सौ चौरासी.
  if (value >= 1100 && value < 2000) {
    const rest = value % 100;
    return [
      BELOW_HUNDRED[Math.floor(value / 100)],
      'सौ',
      ...(rest ? [BELOW_HUNDRED[rest]] : []),
    ];
  }
  return hindiCardinal(value);
}

const CURRENCIES = {
  INR: [['रुपया', 'रुपये'], 'पैसे'],
  USD: [['डॉलर', 'डॉलर'], 'सेंट'],
  EUR: [['यूरो', 'यूरो'], 'सेंट'],
  GBP: [['पाउंड', 'पाउंड'], 'पेंस'],
  RUB: [['रूबल', 'रूबल'], 'कोपेक'],
  JPY: [['येन', 'येन']],
  CNY: [['युआन', 'युआन']],
};

const UNITS = {
  km: 'किलोमीटर',
  m: 'मीटर',
  cm: 'सेंटीमीटर',
  mm: 'मिलीमीटर',
  kg: 'किलोग्राम',
  g: 'ग्राम',
  l: 'लीटर',
  ml: 'मिलीलीटर',
  'km/h': 'किलोमीटर प्रति घंटा',
  h: 'घंटे',
  min: 'मिनट',
  s: 'सेकंड',
  '°c': 'डिग्री सेल्सियस',
  '°': 'डिग्री',
  '%': 'प्रतिशत',
  'कि॰मी॰': 'किलोमीटर',
  किमी: 'किलोमीटर',
  मी: 'मीटर',
  किग्रा: 'किलोग्राम',
};

const SYMBOLS = {
  '&': ['और'],
  '+': ['प्लस'],
  '=': ['बराबर'],
  '@': ['ऐट'],
  '#': ['नंबर'],
  '№': ['नंबर'],
  '~': ['लगभग'],
  '×': ['गुणा'],
  '%': ['प्रतिशत'],
  '°': ['डिग्री'],
};

/**
 * Question words that make a question fall at the end. क्या is not here:
 * at the start of a sentence it is the yes/no particle (see
 * `questionFalls`).
 */
const WH_WORDS = new Set([
  ...'कौन कहाँ कब क्यों कैसे कैसा कैसी कितना कितने कितनी'.split(' '),
  ...'किसका किसकी किसके किस किसे किसको किसने किन किधर कौनसा कौनसी'.split(' '),
]);

/** Polar-question particle when it opens a sentence. */
export const POLAR_PARTICLE = 'क्या';

/** After sentence-initial क्या these words make it mean "what". */
export const KYA_WHAT_NEXT = new Set([
  ...'है हैं था थी थे हुआ हुई हुए हो होगा होगी बात हाल'.split(' '),
  ...'मतलब चाहिए करूँ करें करना किया कहा कहूँ'.split(' '),
]);

/**
 * Whether a Hindi question falls at the end (`true`) or rises (`false`).
 * Hindi keeps the question word where the answer would stand, so it is
 * looked for anywhere in the sentence. क्या opening a sentence is the
 * yes/no particle (`क्या तुम आओगे?` rises) unless the next word shows it
 * means "what" (`क्या हुआ?`, `क्या बात है?` fall); क्या anywhere else
 * means "what" (`तुम क्या खाओगे?` falls).
 *
 * Known limit: a two-word question such as `क्या आओगे?` ("Will you
 * come?", subject left out) is read as a "what" question and falls. Until
 * sentence types can be marked by hand (issue 50), IPA input with `↗` is
 * the only way around it.
 * @param {string[]} words lower-cased word texts of one sentence
 * @returns {boolean}
 */
export function questionFalls(words) {
  if (words.some((word) => WH_WORDS.has(word))) {
    return true;
  }
  if (words.indexOf(POLAR_PARTICLE, 1) !== -1) {
    return true;
  }
  if (words[0] === POLAR_PARTICLE) {
    return words.length === 2 || KYA_WHAT_NEXT.has(words[1]);
  }
  return false;
}

/** Hindi text normalisation rules. */
export const HINDI = {
  lang: 'hi',
  decimalComma: false,
  cardinal: hindiCardinal,
  digits,
  minus: 'माइनस',
  range: ['से'],
  decimal(integer, fraction) {
    return [...hindiCardinal(integer), 'दशमलव', ...digits(fraction)];
  },
  ordinalSuffix: /^(?:वाँ|वां|वें|वीं)(?![\p{L}\p{M}])/u,
  ordinal(value, suffix) {
    const base = ORDINALS[value];
    if (base) {
      return [suffix?.endsWith('ीं') ? base.replace(/ा$/, 'ी') : base];
    }
    const words = hindiCardinal(value);
    words[words.length - 1] += suffix ?? 'वाँ';
    return words;
  },
  plain(number, { prev, next }) {
    if (
      !number.fraction &&
      (next === 'में' || next === 'सन्' || prev === 'सन्')
    ) {
      return year(number.integer);
    }
    return number.words;
  },
  time(hours, minutes) {
    if (minutes === 0) {
      return [...hindiCardinal(hours), 'बजे'];
    }
    return [...hindiCardinal(hours), 'बजकर', ...hindiCardinal(minutes), 'मिनट'];
  },
  date({ year: yearValue, month, day }) {
    const words = [...hindiCardinal(day), MONTHS[month - 1]];
    return yearValue ? [...words, ...year(yearValue)] : words;
  },
  money(number, code, scale) {
    const [names, minor] = CURRENCIES[code] ?? [[code, code]];
    if (scale) {
      return [...number.words, ...this.unit(number, scale).slice(-1), names[1]];
    }
    const { integer, fraction } = number;
    if (fraction && fraction.length === 2 && minor) {
      const cents = Number(fraction);
      const words = [...hindiCardinal(integer), names[integer === 1 ? 0 : 1]];
      return cents ? [...words, ...hindiCardinal(cents), minor] : words;
    }
    const single = !fraction && integer === 1;
    return [...number.words, names[single ? 0 : 1]];
  },
  unit(number, unit) {
    const key = unit.toLowerCase();
    const scales = {
      k: 'हज़ार',
      lakh: 'लाख',
      cr: 'करोड़',
      लाख: 'लाख',
      करोड़: 'करोड़',
    };
    const name = UNITS[key] ?? scales[key];
    return name ? [...number.words, ...name.split(' ')] : null;
  },
  hasUnit: (unit) => Boolean(UNITS[unit.toLowerCase()]),
  symbol: (char) => SYMBOLS[char] ?? null,
  abbreviation: () => null,
  endsSentence: () => false,
  acronym: () => null,
  spell: () => [],
  isWhWord: (text) => text === POLAR_PARTICLE || WH_WORDS.has(text),
  questionFalls,
};
