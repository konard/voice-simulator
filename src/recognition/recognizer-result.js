/** Merge ordered recognition results on the original time and word axes. Unlicense. */
export function translated(result, seconds, wordIndex) {
  const time = (item) => ({
    ...item,
    start: item.start + seconds,
    end: item.end + seconds,
  });
  return {
    ...result,
    words: result.words.map((word) => ({
      ...time(word),
      syllables: word.syllables.map(time),
    })),
    modes: result.modes.map((span) =>
      span.from === undefined
        ? time(span)
        : {
            ...time(span),
            from: span.from + wordIndex,
            to: span.to + wordIndex,
          }
    ),
  };
}

function joinedText(prefix, suffix, language, nextLanguage) {
  const join = language === 'zh' && nextLanguage === 'zh' ? '' : ' ';
  return prefix && suffix ? prefix + join + suffix : prefix || suffix;
}

export function aggregate(result, phrase, alternativeLimit) {
  const previous = result.words.at(-1)?.language;
  const following = phrase.words[0]?.language;
  if (result.alternatives) {
    const prior = [
      { text: result.text, ipa: result.ipa, confidence: 1 },
      ...result.alternatives,
    ];
    const next = [
      { text: phrase.text, ipa: phrase.ipa, confidence: 1 },
      ...phrase.alternatives,
    ];
    const combinations = prior.flatMap((a, i) =>
      next.flatMap((b, j) =>
        i || j
          ? [
              {
                text: joinedText(a.text, b.text, previous, following),
                ipa: [a.ipa, b.ipa].filter(Boolean).join(' '),
                confidence: a.confidence * b.confidence,
              },
            ]
          : []
      )
    );
    result.alternatives = combinations
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, alternativeLimit);
  }
  result.text = joinedText(result.text, phrase.text, previous, following);
  result.ipa = [result.ipa, phrase.ipa].filter(Boolean).join(' ');
  result.words.push(...phrase.words);
  result.modes.push(...phrase.modes);
}
