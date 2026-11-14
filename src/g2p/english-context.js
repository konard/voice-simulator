/**
 * Choose the reading of an English heteronym from the words around it.
 *
 * A few written rules look at the nearest word before (`p`) and after
 * (`n`) the heteronym inside its clause, and at the words of the whole
 * sentence; there is no tagger and no trained model (see Yarowsky 1997,
 * "Homograph disambiguation in text-to-speech synthesis", for the idea of
 * deciding by collocations).
 */

const words = (list) => new Set(list.split(' '));

export const DETERMINERS = words(
  'the a an this that these those my your his her its our their some any no each every another many few several all both two three four five six seven eight nine ten'
);
export const SUBJECTS = words('i you we they he she it who');
export const MODALS = words(
  "to will would can could shall should may might must do does did don't doesn't didn't won't can't let's"
);
export const BE = words('am is are was were be been being seem seems');
export const HAVE = words('have has had having');
export const DEGREE = words('very so too quite more most as');
export const PREPOSITIONS = words(
  'of in on at for with by from about into without'
);
export const OBJECTS = words('me him us them it this that');
export const SKIPPED = words(
  'not never always often just also really still only'
);
export const PAST_CUES = words(
  'was were yesterday ago last earlier already once'
);

const THIRD_PERSON = words('he she it');

/**
 * Pick a reading and say which tag chose it.
 * @returns {{reading: object, tag: string}}
 */
export function selectReading(readings, context = {}) {
  const before = context.before ?? [];
  const after = context.after ?? [];
  const sentence = new Set(context.sentence ?? []);
  const p = before.find((word) => !SKIPPED.has(word));
  const n = after[0];
  const has = (tag) => readings.some((reading) => reading.tags.includes(tag));
  const pick = (...tags) => {
    const tag = tags.find(has);
    return tag
      ? { reading: readings.find((r) => r.tags.includes(tag)), tag }
      : null;
  };

  // 1. A word right after the heteronym or a cue anywhere in the sentence.
  const cued = readings.find(
    (reading) =>
      (n !== undefined && reading.next?.includes(n)) ||
      reading.cues?.some((cue) => sentence.has(cue))
  );
  if (cued) {
    return { reading: cued, tag: cued.tags };
  }
  const rules = [
    // 2. `to read`, `will read`, `did you record`.
    () => MODALS.has(p) && pick('V'),
    // 3. `have read`; `is live`, `was read`.
    () => HAVE.has(p) && pick('D'),
    () => BE.has(p) && pick('A', 'D'),
    // 4. `she read`, `I read it yesterday`.
    () =>
      has('V') &&
      has('D') &&
      (THIRD_PERSON.has(p) ||
        [...PAST_CUES].some((cue) => sentence.has(cue))) &&
      pick('D'),
    // 5. `they record`, `he dove`.
    () => SUBJECTS.has(p) && pick('V', 'D'),
    // 6. `very close`.
    () => DEGREE.has(p) && pick('A'),
    // 7. `the record`, `of no use`, `John's record`, `a live show`.
    () =>
      (DETERMINERS.has(p) || PREPOSITIONS.has(p) || p?.endsWith("'s")) &&
      pick('N', 'A'),
    // 8. The imperative `Record the song`, `Close it`.
    () => (DETERMINERS.has(n) || OBJECTS.has(n)) && pick('V'),
  ];
  for (const rule of rules) {
    const chosen = rule();
    if (chosen) {
      return chosen;
    }
  }
  // 9. The default.
  return { reading: readings[0], tag: readings[0].tags };
}

/**
 * Choose the reading of a heteronym that fits its context.
 * @param {ReadonlyArray<{tags: string, ipa: string, next?: string[],
 *   cues?: string[]}>} readings the first one is the default
 * @param {{before?: string[], after?: string[], sentence?: string[]}} context
 *   lowercased words before the heteronym (nearest first) and after it in
 *   the same clause, and all words of the sentence
 * @returns {{tags: string, ipa: string}} the chosen reading
 */
export function chooseReading(readings, context) {
  return selectReading(readings, context).reading;
}
