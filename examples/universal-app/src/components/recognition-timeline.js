/** Map recognised spelling to source offsets for the shared syllable display. */
export function recognitionTimeline({ text, words }) {
  const source = text.toLowerCase();
  let cursor = 0;
  const mapped = words.map(({ text, language, syllables, ...timing }) => {
    const spelling = text.toLowerCase();
    const start = source.indexOf(spelling, cursor);
    const end = start < 0 ? null : start + text.length;
    cursor = end ?? cursor;
    let offset = 0;
    return {
      ...timing,
      lang: language,
      sourceStart: start < 0 ? null : start,
      sourceEnd: end,
      syllables: syllables.map(({ text, ...syllable }) => {
        const index = spelling.indexOf(text.toLowerCase(), offset);
        if (start < 0 || !text || index < 0) {
          return syllable;
        }
        offset = index + text.length;
        return {
          ...syllable,
          sourceStart: start + index,
          sourceEnd: start + offset,
        };
      }),
    };
  });
  return {
    text,
    timeline: { words: mapped, duration: words.at(-1)?.end ?? 0 },
  };
}

/** Keep the objects of committed words as the provisional suffix changes. */
export function mergeResults(finals, partial) {
  const phrases = partial ? [...finals, partial] : finals;
  const words = [];
  const modes = [];
  for (const phrase of phrases) {
    for (const mode of phrase.modes ?? []) {
      modes.push(
        mode.from === undefined
          ? mode
          : {
              ...mode,
              from: mode.from + words.length,
              to: mode.to + words.length,
            }
      );
    }
    for (const word of phrase.words) {
      words.push(word);
    }
  }
  return {
    text: phrases
      .map(({ text }) => text)
      .filter(Boolean)
      .join(' '),
    ipa: phrases
      .map(({ ipa }) => ipa)
      .filter(Boolean)
      .join(' '),
    words,
    modes,
  };
}
