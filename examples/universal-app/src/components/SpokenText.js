import { createElement as h, useMemo } from 'react';
import { ipaPieces, spokenPieces, textPieces } from './highlight.js';

function Pieces({ pieces, className, lang }) {
  return h(
    'p',
    { className, lang },
    pieces.map((piece, index) =>
      piece.word === null
        ? piece.text
        : h(
            'span',
            {
              key: index,
              'data-word': piece.word,
              'data-syllable': piece.syllable ?? undefined,
              'data-syllable-last': piece.lastSyllable,
            },
            piece.text
          )
    )
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
export function SpokenText({ rootRef, text, lang, timeline, t }) {
  const pieces = useMemo(() => textPieces(text, timeline), [text, timeline]);
  const ipa = useMemo(() => ipaPieces(timeline), [timeline]);
  if (!timeline?.words.length) {
    return null;
  }
  return h(
    'section',
    {
      ref: rootRef,
      className: 'spoken',
      'aria-label': t.spoken,
      'aria-live': 'polite',
    },
    h(Pieces, { pieces, className: 'spoken-text', lang }),
    h(SaidWords, { timeline, lang }),
    h(Pieces, { pieces: ipa, className: 'spoken-ipa', lang: 'und-fonipa' })
  );
}
