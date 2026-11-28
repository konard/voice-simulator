/** Rank-ordered pronunciations for the shipped HMM vocabulary. Unlicense. */
const TONES = ['', '˩', '˨', '˧', '˦', '˥'];

/** IPA of a lexicon token with its stress mark and tone letters. */
export function tokenIpa(token) {
  const tones = (token.tone ?? []).map((n) => TONES[n]).join('');
  const stress = token.stress === 1 ? 'ˈ' : token.stress === 2 ? 'ˌ' : '';
  return `${stress}${token.symbol}${tones}`;
}

/** Intern the fields the HMM needs, keeping spoken phones only. */
export function spokenTokenSelector() {
  const tokens = new Map();
  return (parsed) => {
    const spoken = [];
    for (const { kind, symbol, stress, tone } of parsed) {
      if (kind !== 'vowel' && kind !== 'consonant') {
        continue;
      }
      const token = { kind, symbol, stress, tone };
      const key = tokenIpa(token);
      if (!tokens.has(key)) {
        tokens.set(key, token);
      }
      spoken.push(tokens.get(key));
    }
    return spoken;
  };
}

// The vocabulary reuses the ranked words and priors already held by the
// lexicon. OOV records have no rank and carry a begin/continue flag.
export function packHmmWords(words, ranked) {
  const ranks = new Map(ranked.map(({ word }, i) => [word, i]));
  const rows = new Uint32Array(words.length);
  const offsets = new Uint32Array(words.length + 1);
  const flags = new Uint8Array(words.length);
  const symbols = [];
  const ids = new Map();
  const phones = [];
  for (const [id, word] of words.entries()) {
    rows[id] = ranks.get(word.word) ?? 0;
    flags[id] = word.oov ? (word.begin ? 0x10 : 0x20) : (word.before ?? 0);
    offsets[id] = phones.length;
    for (const token of word.tokens) {
      const key = tokenIpa(token);
      if (!ids.has(key)) {
        ids.set(key, symbols.length);
        symbols.push(token);
      }
      phones.push(ids.get(key));
    }
  }
  offsets[words.length] = phones.length;
  const Type = symbols.length > 65536 ? Uint32Array : Uint16Array;
  return { rows, offsets, flags, symbols, phones: Type.from(phones) };
}

export function openHmmWords(data, ranked, lang, first, copy = true) {
  // Drop the source archive after its topology is appended to a shared network.
  const column = (values) => (copy ? values.slice() : values);
  const rows = column(data.rows);
  const offsets = column(data.offsets);
  const flags = column(data.flags);
  const phones = column(data.phones);
  const { symbols } = data;
  const index = (id) => id - first;
  const flag = (id) => flags[index(id)];
  const entry = (id) => ranked[rows[index(id)]];
  const name = (id) => (flag(id) >= 0x10 ? '' : entry(id).word);
  return {
    name,
    count(id) {
      const word = entry(id);
      return word.prior ?? word.count;
    },
    before: (id) => flag(id) & 0xf,
    oov: (id) => flag(id) >= 0x10,
    begin: (id) => flag(id) === 0x10,
    phone: (id) => symbols[phones[offsets[index(id)]]].symbol,
    read(id) {
      const tokens = [];
      const i = index(id);
      for (let at = offsets[i]; at < offsets[i + 1]; at++) {
        tokens.push(symbols[phones[at]]);
      }
      const word = { word: name(id), lang, tokens };
      if (flag(id) >= 0x10) {
        word.oov = true;
        word.begin = flag(id) === 0x10;
      } else {
        const { prior, count } = entry(id);
        word.count = prior ?? count;
        if (flag(id)) {
          word.before = flag(id);
        }
      }
      return word;
    },
  };
}
