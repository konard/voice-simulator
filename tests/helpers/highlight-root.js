function fakeSpan(word, syllable, lastSyllable) {
  const classes = new Set();
  const attributes = new Map();
  const dataset = { word: String(word) };
  if (syllable !== null) {
    dataset.syllable = String(syllable);
  }
  if (lastSyllable !== undefined) {
    dataset.syllableLast = String(lastSyllable);
  }
  return {
    dataset,
    classList: {
      toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
      contains: (name) => classes.has(name),
    },
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name),
    getAttribute: (name) => attributes.get(name) ?? null,
  };
}

export function fakeRoot(pieces) {
  const spans = pieces
    .filter((piece) => piece.word !== null)
    .map((piece) => fakeSpan(piece.word, piece.syllable, piece.lastSyllable));
  return { spans, querySelectorAll: () => spans };
}
