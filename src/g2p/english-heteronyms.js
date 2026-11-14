/**
 * English heteronyms: words spelled one way and spoken two ways
 * (`record` ˈɹɛkɚd as a noun, ɹəˈkɔɹd as a verb).
 *
 * A word maps to a list of readings; the first reading is the default.
 * Tags: `N` noun, `A` adjective, `V` verb (base or present), `D` past
 * tense or participle. `next` lists words that select the reading when
 * they come directly after it, `cues` words that select it anywhere in
 * the sentence. `chooseReading()` in `english-context.js` picks one.
 *
 * Readings were cross-checked by hand against the variants `word(2)` of
 * the CMU Pronouncing Dictionary (https://github.com/cmusphinx/cmudict).
 */

import { pluralEnding } from './english-rules.js';

/** Noun or adjective first (default), verb second. */
const nounFirst = (noun, verb) => [
  { tags: 'NA', ipa: noun },
  { tags: 'V', ipa: verb },
];

/** Verb first (default), noun second. */
const verbFirst = (verb, noun) => [
  { tags: 'V', ipa: verb },
  { tags: 'N', ipa: noun },
];

/** The hand-written table, one entry per base word. */
const BASE_HETERONYMS = {
  record: nounFirst('ˈɹɛkɚd', 'ɹəˈkɔɹd'),
  present: nounFirst('ˈpɹɛzənt', 'pɹɪˈzɛnt'),
  object: nounFirst('ˈɑbd͡ʒɛkt', 'əbˈd͡ʒɛkt'),
  project: nounFirst('ˈpɹɑd͡ʒɛkt', 'pɹəˈd͡ʒɛkt'),
  permit: nounFirst('ˈpɝmɪt', 'pɚˈmɪt'),
  house: nounFirst('ˈhaʊs', 'ˈhaʊz'),
  conduct: nounFirst('ˈkɑndʌkt', 'kənˈdʌkt'),
  conflict: nounFirst('ˈkɑnflɪkt', 'kənˈflɪkt'),
  desert: nounFirst('ˈdɛzɚt', 'dɪˈzɝt'),
  contest: nounFirst('ˈkɑntɛst', 'kənˈtɛst'),
  contract: nounFirst('ˈkɑntɹækt', 'kənˈtɹækt'),
  rebel: nounFirst('ˈɹɛbəl', 'ɹɪˈbɛl'),
  contrast: nounFirst('ˈkɑntɹæst', 'kənˈtɹæst'),
  convict: nounFirst('ˈkɑnvɪkt', 'kənˈvɪkt'),
  survey: nounFirst('ˈsɝveɪ', 'sɚˈveɪ'),
  decrease: nounFirst('ˈdikɹis', 'dɪˈkɹis'),
  increase: nounFirst('ˈɪnkɹis', 'ɪnˈkɹis'),
  escort: nounFirst('ˈɛskɔɹt', 'ɪˈskɔɹt'),
  digest: nounFirst('ˈdaɪd͡ʒɛst', 'daɪˈd͡ʒɛst'),
  export: nounFirst('ˈɛkspɔɹt', 'ɪkˈspɔɹt'),
  address: nounFirst('ˈædɹɛs', 'əˈdɹɛs'),
  import: nounFirst('ˈɪmpɔɹt', 'ɪmˈpɔɹt'),
  insult: nounFirst('ˈɪnsʌlt', 'ɪnˈsʌlt'),
  perfect: nounFirst('ˈpɝfɪkt', 'pɚˈfɛkt'),
  progress: nounFirst('ˈpɹɑɡɹɛs', 'pɹəˈɡɹɛs'),
  protest: nounFirst('ˈpɹoʊtɛst', 'pɹəˈtɛst'),
  abuse: nounFirst('əˈbjus', 'əˈbjuz'),
  subject: nounFirst('ˈsʌbd͡ʒɛkt', 'səbˈd͡ʒɛkt'),
  suspect: nounFirst('ˈsʌspɛkt', 'səˈspɛkt'),
  wind: nounFirst('ˈwɪnd', 'ˈwaɪnd'),
  defect: nounFirst('ˈdifɛkt', 'dɪˈfɛkt'),
  transport: nounFirst('ˈtɹænspɔɹt', 'tɹænˈspɔɹt'),
  tear: nounFirst('ˈtɪɹ', 'ˈtɛɹ'),
  compound: nounFirst('ˈkɑmpaʊnd', 'kəmˈpaʊnd'),
  extract: nounFirst('ˈɛkstɹækt', 'ɪkˈstɹækt'),
  frequent: nounFirst('ˈfɹikwənt', 'fɹiˈkwɛnt'),
  absent: nounFirst('ˈæbsənt', 'æbˈsɛnt'),
  excuse: nounFirst('ɪkˈskjus', 'ɪkˈskjuz'),
  separate: nounFirst('ˈsɛpɚət', 'ˈsɛpɚˌeɪt'),
  estimate: nounFirst('ˈɛstəmət', 'ˈɛstəˌmeɪt'),
  graduate: nounFirst('ˈɡɹæd͡ʒuət', 'ˈɡɹæd͡ʒuˌeɪt'),
  alternate: nounFirst('ˈɔltɚnət', 'ˈɔltɚˌneɪt'),
  moderate: nounFirst('ˈmɑdɚət', 'ˈmɑdɚˌeɪt'),

  use: verbFirst('ˈjuz', 'ˈjus'),
  refuse: verbFirst('ɹɪˈfjuz', 'ˈɹɛfjus'),
  produce: verbFirst('pɹəˈdus', 'ˈpɹoʊdus'),
  reject: verbFirst('ɹɪˈd͡ʒɛkt', 'ˈɹid͡ʒɛkt'),
  convert: verbFirst('kənˈvɝt', 'ˈkɑnvɝt'),
  insert: verbFirst('ɪnˈsɝt', 'ˈɪnsɝt'),
  combine: verbFirst('kəmˈbaɪn', 'ˈkɑmbaɪn'),
  resume: verbFirst('ɹɪˈzum', 'ˈɹɛzəˌmeɪ'),
  sow: verbFirst('ˈsoʊ', 'ˈsaʊ'),

  read: [
    { tags: 'V', ipa: 'ˈɹid' },
    { tags: 'D', ipa: 'ˈɹɛd' },
  ],
  live: [
    { tags: 'V', ipa: 'ˈlɪv' },
    { tags: 'A', ipa: 'ˈlaɪv' },
  ],
  lives: [
    { tags: 'V', ipa: 'ˈlɪvz' },
    { tags: 'N', ipa: 'ˈlaɪvz' },
  ],
  wound: [
    { tags: 'N', ipa: 'ˈwund' },
    { tags: 'D', ipa: 'ˈwaʊnd' },
  ],
  dove: [
    { tags: 'N', ipa: 'ˈdʌv' },
    { tags: 'D', ipa: 'ˈdoʊv' },
  ],
  close: [
    { tags: 'V', ipa: 'ˈkloʊz' },
    { tags: 'A', ipa: 'ˈkloʊs', next: ['to', 'by', 'enough', 'together'] },
  ],
  content: [
    { tags: 'N', ipa: 'ˈkɑntɛnt' },
    { tags: 'A', ipa: 'kənˈtɛnt', next: ['with'] },
  ],
  invalid: [
    { tags: 'NA', ipa: 'ɪnˈvælɪd' },
    {
      tags: '',
      ipa: 'ˈɪnvəlɪd',
      cues: ['nurse', 'hospital', 'wheelchair', 'bedridden'],
    },
  ],
  minute: [
    { tags: 'N', ipa: 'ˈmɪnət' },
    {
      tags: 'A',
      ipa: 'maɪˈnut',
      next: ['detail', 'details', 'amount', 'amounts', 'quantity'],
    },
  ],
  lead: [
    { tags: 'VN', ipa: 'ˈlid' },
    {
      tags: 'N',
      ipa: 'ˈlɛd',
      cues: ['pipe', 'pipes', 'pencil', 'paint', 'poisoning', 'metal'],
    },
  ],
  bow: [
    { tags: 'VN', ipa: 'ˈbaʊ' },
    {
      tags: 'N',
      ipa: 'ˈboʊ',
      cues: ['arrow', 'arrows', 'tie', 'violin', 'ribbon', 'rainbow', 'string'],
    },
  ],
  bass: [
    { tags: 'NA', ipa: 'ˈbeɪs' },
    { tags: 'N', ipa: 'ˈbæs', cues: ['fish', 'fishing', 'lake', 'swam'] },
  ],
};

/** Words whose `-s` form is not a regular plural or third person. */
const NO_PLURAL = new Set(['house']);

/**
 * The `-s` form of an entry that has a noun and a verb reading is a
 * heteronym too (`records`, `uses`): add the ending to every reading.
 */
function pluralForms(table) {
  const forms = {};
  for (const [word, readings] of Object.entries(table)) {
    const tags = readings.map((reading) => reading.tags).join('');
    const nounAndVerb = tags.includes('N') && tags.includes('V');
    if (!nounAndVerb || NO_PLURAL.has(word) || table[`${word}s`]) {
      continue;
    }
    forms[`${word}s`] = readings.map((reading) => ({
      ...reading,
      ipa: `${reading.ipa}${pluralEnding(reading.ipa)}`,
    }));
  }
  return forms;
}

/**
 * Heteronyms by lowercase spelling: the hand-written base words and the
 * `-s` forms derived from them.
 * @type {Readonly<Record<string, ReadonlyArray<{tags: string, ipa: string,
 *   next?: string[], cues?: string[]}>>>}
 */
export const ENGLISH_HETERONYMS = Object.freeze({
  ...BASE_HETERONYMS,
  ...pluralForms(BASE_HETERONYMS),
});
