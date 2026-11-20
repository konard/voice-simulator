import { createElement as h, Fragment, useMemo } from 'react';
import { ipaPieces, spokenPieces, textPieces } from './highlight.js';

function Pieces({ pieces, className, lang, recognition }) {
  const { words, committedWords, mixed } = recognition ?? {};
  const ipa = lang === 'und-fonipa';
  let previousWord = null;
  return h(
    'p',
    { className, lang },
    pieces.map((piece, index) => {
      if (piece.word === null) {
        return piece.text;
      }
      const code = words?.[piece.word].lang;
      const badge =
        mixed &&
        !ipa &&
        piece.word !== previousWord &&
        code !== words[piece.word - 1]?.lang;
      previousWord = piece.word;
      return h(
        Fragment,
        { key: index },
        badge ? h('span', { className: 'language-badge' }, code) : null,
        h(
          'span',
          {
            className: piece.word >= committedWords ? 'tentative' : undefined,
            lang: ipa && code ? `${code}-fonipa` : code,
            'data-word': piece.word,
            'data-syllable': piece.syllable ?? undefined,
            'data-syllable-last': piece.lastSyllable,
          },
          piece.text
        )
      );
    })
  );
}

/**
 * What the active verbalised word says (`twen·ty five` for 25): one group
 * per such word, shown by CSS only while `paintHighlight` marks it, so the
 * text and IPA lines above never move.
 */
function SaidWords({ timeline, lang }) {
  const said = timeline.words
    .map((word, index) => ({ index, pieces: spokenPieces(word) }))
    .filter((word) => word.pieces.length);
  if (!said.length) {
    return null;
  }
  return h(
    'p',
    { className: 'spoken-said', lang, 'aria-hidden': 'true' },
    said.map(({ index, pieces }) =>
      h(
        'span',
        { key: index, 'data-word': index },
        pieces.flatMap((piece, position) => {
          if (piece.syllable === null) {
            return [piece.text];
          }
          const joined = typeof pieces[position - 1]?.syllable === 'number';
          return [
            ...(joined ? ['·'] : []),
            h(
              'span',
              {
                key: position,
                'data-word': index,
                'data-syllable': piece.syllable,
              },
              piece.text
            ),
          ];
        })
      )
    )
  );
}

/**
 * The text of the last utterance and its IPA split into syllables, with
 * the word and syllable being spoken highlighted by `paintHighlight`.
 * Numbers, dates and sums also show the words they are read as.
 */
export function SpokenText({
  rootRef,
  text,
  lang,
  timeline,
  t,
  committedWords,
  modes,
}) {
  const pieces = useMemo(() => textPieces(text, timeline), [text, timeline]);
  const ipa = useMemo(() => ipaPieces(timeline), [timeline]);
  if (!timeline?.words.length) {
    return null;
  }
  const words = timeline.words;
  const recognition =
    committedWords === undefined
      ? null
      : {
          words,
          committedWords,
          mixed: words.some((word) => word.lang !== words[0].lang),
        };
  return h(
    'section',
    {
      ref: rootRef,
      className: 'spoken',
      'aria-label': recognition ? t.recognitionTranscript : t.spoken,
      'aria-live': 'polite',
    },
    h(Pieces, { pieces, className: 'spoken-text', lang, recognition }),
    h(SaidWords, { timeline, lang }),
    h(Pieces, {
      pieces: ipa,
      className: 'spoken-ipa',
      lang: 'und-fonipa',
      recognition,
    }),
    modes
  );
}
