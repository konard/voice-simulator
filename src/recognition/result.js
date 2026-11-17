/** Build recognition words using the same spelling spans as the timeline. */
import { parseIpa, formatIpa } from '../ipa/parse.js';
import { syllabifyTokens, syllableIpa } from '../ipa/syllables.js';
import { phoneCounts, syllableSpans } from '../g2p/orthography.js';

export function recognitionWord(candidate, tokens, language) {
  const heard = tokens.slice(candidate.from, candidate.to);
  const mean = heard.reduce((sum, t) => sum + t.confidence, 0) / heard.length;
  const confidence = Math.min(
    candidate.unknown ? 0.3 : 1,
    Math.exp(-candidate.cost / heard.length) * mean
  );
  const spoken = parseIpa(candidate.ipa).tokens.filter(
    (t) => t.kind !== 'pause'
  );
  const syllables = syllabifyTokens(spoken, { language });
  const spans = syllableSpans(candidate.word, syllables.map(phoneCounts));
  let used = 0;
  const mapped = syllables.map((syllable, i) => {
    const from = Math.floor((used / Math.max(1, spoken.length)) * heard.length);
    used += syllable.length;
    const to = Math.max(
      from + 1,
      Math.ceil((used / Math.max(1, spoken.length)) * heard.length)
    );
    const span = spans?.[i];
    return {
      text: span
        ? candidate.word.slice(span.start, span.end)
        : i === 0
          ? candidate.word
          : '',
      ipa: syllableIpa(syllable),
      stress: syllable.find((t) => t.stress)?.stress ?? 0,
      start: heard[Math.min(from, heard.length - 1)].start,
      end: heard[Math.min(to, heard.length) - 1].end,
      confidence,
    };
  });
  return {
    text: candidate.word,
    ipa: candidate.ipa,
    language,
    start: heard[0].start,
    end: heard.at(-1).end,
    confidence,
    syllables: mapped,
  };
}

export function resultFromPath(path, tokens, language) {
  const words = path.map((c) =>
    recognitionWord(c, tokens, c.language ?? language)
  );
  return {
    text: words
      .map(
        (w, i) =>
          `${i && !(w.language === 'zh' && words[i - 1].language === 'zh') ? ' ' : ''}${w.text}`
      )
      .join(''),
    ipa: words.map((w) => w.ipa).join(' '),
    words,
  };
}

export function heardIpa(tokens) {
  return formatIpa(tokens);
}
