import { createElement as h, useMemo } from 'react';
import { ipaPieces, textPieces } from './highlight.js';

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
            },
            piece.text
          )
    )
  );
}

/**
 * The text of the last utterance and its IPA split into syllables, with
 * the word and syllable being spoken highlighted by `paintHighlight`.
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
    h(Pieces, { pieces: ipa, className: 'spoken-ipa', lang: 'und-fonipa' })
  );
}
