/**
 * Russian homographs (issue 48): spellings with two stresses, chosen from
 * the words around them (Yarowsky 1997, cue words near the homograph).
 *
 * `RUSSIAN_HOMOGRAPHS` lists rows `[forms, kind, cues]`:
 * - `forms`: `default/other` pairs of one spelling, `+` before the stressed
 *   vowel; a `ё` without `+` is stressed (`все/всё`).
 * - `kind` and `cues` (space-separated word beginnings; a cue of one or two
 *   letters, a preposition, must be the whole word):
 *   - `near`: `other` when a cue is among the 4 words before or after.
 *   - `before` / `after`: `other` when a cue is the word just before /
 *     just after.
 *   - `infinitive`: `other` when the next word ends in `ть`, `ться` or
 *     `чь` (`стоит попробовать`).
 *   - `case`: the pair is genitive singular / nominative plural, and `cues`
 *     names the case of the default, `genitive` or `plural`. Genitive when
 *     one of the two words before is in `GENITIVE_BEFORE` or the word just
 *     before ends in `ого`, `его`, `ой` or `ей` (`нашей страны`); plural
 *     when one of them is in `PLURAL_BEFORE` or ends in `ые` or `ие`;
 *     otherwise the default.
 *
 * A spelling may have several rows; the first that chooses `other` wins.
 * `context` is `{before, after, sentence}` of `wordContexts()` in
 * src/g2p/index.js: lowercased words of the clause, `before` nearest first.
 *
 * Limits: the cues are a few words each, so a homograph far from its cue
 * or with a cue of the other reading keeps the wrong stress; write the
 * stress mark (`з+амок`) to choose.
 */

export const GENITIVE_BEFORE =
  'два две три четыре оба обе полтора из от до у без для около после нет';
export const PLURAL_BEFORE = 'все эти те мои твои наши ваши их многие';

const CASE = (pairs, defaultCase) =>
  pairs.split(' ').map((pair) => [[pair], 'case', defaultCase]);

const LOCK = ['ок', 'а', 'у', 'ом', 'е', 'и', 'ов', 'ам', 'ами', 'ах'].map(
  (ending) =>
    ending === 'ок'
      ? 'з+амок/зам+ок'
      : `з+амк${ending}/замк${ending.replace(/[аеиоу]/u, '+$&')}`
);

/** @type {[string[], 'near'|'before'|'after'|'infinitive'|'case', string][]} */
export const RUSSIAN_HOMOGRAPHS = [
  [LOCK, 'near', 'ключ двер откр закр запер навесн щёлк щелк сломал'],
  [['сто+ит/ст+оит'], 'near', 'скольк дорог дёшев дешев рубл цен доллар'],
  [['сто+ит/ст+оит'], 'infinitive', ''],
  [['нач+ало/н+ачало'], 'infinitive', ''],
  [['пл+ачу/плач+у'], 'near', 'за деньг счёт счет налог рубл штраф зарплат'],
  [['мук+а/м+ука'], 'near', 'адск ужас страш невыносим тяжк творчеств'],
  [['уж+е/+уже'], 'before', 'гораздо намного значительно чуть'],
  [['с+орок/сор+ок'], 'near', 'птиц белобок трещ хвост гнезд воровк'],
  [['б+елки/белк+и'], 'near', 'жир углевод аминокисл витамин'],
  [['больш+ая/б+ольшая'], 'after', 'часть половин дол'],
  [['г+оре/гор+е'], 'before', 'на в по'],
  [['п+олноте/полнот+е'], 'before', 'в во о'],
  [['ч+аса/час+а'], 'before', 'два три четыре полтора оба'],
  [
    ['все/всё'],
    'after',
    'равно ещё еще время это было стало будет понятно ясно хорошо правильно',
  ],
  [['все/всё'], 'before', 'это вот'],
  [
    ['бер+ет/берёт'],
    'near',
    'он она оно кто никто каждый себ рук трубк слово верх',
  ],
  [['н+ебо/нёбо'], 'near', 'язык рот рт зуб тверд мягк'],
  [['слёз/сл+ез'], 'near', 'крыш дерев лошад кон печ лестниц машин'],
  ...CASE(
    'город+а/г+орода дом+а/д+ома лес+а/л+еса г+убы/губ+ы колокол+а/к+олокола',
    'plural'
  ),
  ...CASE('вод+ы/в+оды рук+и/р+уки ног+и/н+оги', 'genitive'),
  ...CASE(
    'голов+ы/г+оловы сторон+ы/ст+ороны окн+а/+окна сл+ова/слов+а ' +
      'м+еста/мест+а м+оря/мор+я рек+и/р+еки стран+ы/стр+аны ' +
      'сестр+ы/сёстры стен+ы/ст+ены гор+ы/г+оры зим+ы/з+имы душ+и/д+уши ' +
      'доск+и/д+оски спин+ы/сп+ины земл+и/з+емли звезд+ы/звёзды ' +
      'жен+ы/жёны +озера/озёра войн+ы/в+ойны волн+ы/в+олны ' +
      'в+ека/век+а +острова/остров+а',
    'genitive'
  ),
  ...CASE(
    'дел+а/д+ела ц+ены/цен+ы п+исьма/письм+а зеркал+а/з+еркала ' +
      'берег+а/б+ерега голос+а/г+олоса поезд+а/п+оезда глаз+а/гл+аза ' +
      'номер+а/н+омера вечер+а/в+ечера учител+я/уч+ителя',
    'plural'
  ),
];

const words = (list) => new Set(list.split(' '));
const GENITIVE = words(GENITIVE_BEFORE);
const PLURAL = words(PLURAL_BEFORE);

/** Spelling → its rows `{pair, kind, cues}`, built on first use. */
let index;

function spellingIndex() {
  if (!index) {
    index = new Map();
    for (const [forms, kind, cues] of RUSSIAN_HOMOGRAPHS) {
      for (const pair of forms) {
        const [first, other] = pair.split('/');
        const spelling = first.replaceAll('+', '').replaceAll('ё', 'е');
        const rows = index.get(spelling) ?? [];
        rows.push({ pair: [first, other], kind, cues: cues.split(' ') });
        index.set(spelling, rows);
      }
    }
  }
  return index;
}

const isCue = (word, cues) =>
  word !== undefined &&
  cues.some((cue) =>
    cue.length <= 2 ? word === cue : cue !== '' && word.startsWith(cue)
  );

function caseOf(before) {
  const two = before.slice(0, 2);
  if (
    two.some((word) => GENITIVE.has(word)) ||
    /(?:ого|его|ой|ей)$/u.test(two[0] ?? '')
  ) {
    return 'genitive';
  }
  if (two.some((word) => PLURAL.has(word) || /(?:ые|ие)$/u.test(word))) {
    return 'plural';
  }
  return undefined;
}

/** Whether `row` chooses its other form in `context`. */
function choosesOther({ kind, cues }, { before = [], after = [] }) {
  switch (kind) {
    case 'near':
      return [...before.slice(0, 4), ...after.slice(0, 4)].some((word) =>
        isCue(word, cues)
      );
    case 'before':
      return isCue(before[0], cues);
    case 'after':
      return isCue(after[0], cues);
    case 'infinitive':
      return /(?:ть|ться|чь)$/u.test(after[0] ?? '');
    case 'case': {
      const found = caseOf(before);
      return found !== undefined && found !== cues[0];
    }
    default:
      return false;
  }
}

/** Whether a lower-case spelling (`е` for `ё`) is a homograph. */
export function isRussianHomograph(spelling) {
  return spellingIndex().has(spelling);
}

/**
 * The marked form (`зам+ок`, `всё`) of a homograph in its context, or
 * undefined when the spelling is not a homograph.
 * @param {string} spelling lower case, `е` for `ё`
 * @param {{before?: string[], after?: string[]}} [context]
 * @returns {string|undefined}
 */
export function russianHomograph(spelling, context = {}) {
  const rows = spellingIndex().get(spelling);
  if (!rows) {
    return undefined;
  }
  const other = rows.find((row) => choosesOther(row, context));
  return other ? other.pair[1] : rows[0].pair[0];
}
