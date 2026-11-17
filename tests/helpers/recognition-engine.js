/** Small feature packets for the numerical Rust recognition ABI. */
import { float64View } from '../../src/engine/wasm-loader.js';
import {
  soundKey,
  trieNode,
  addPronunciation,
} from '../../src/recognition/lexicon.js';
import { sounds } from './ipa-recognition.js';
import { spellSounds } from '../../src/recognition/phones-to-letters.js';

const places = (
  'bilabial labiodental dental alveolar postalveolar retroflex ' +
  'alveolopalatal palatal velar uvular pharyngeal glottal labial-velar labial-palatal'
).split(' ');

/** One interning context must cover both the input and dictionary. */
export function featureEncoder(language = 'en') {
  const interned = new Map();
  const intern = (value) => {
    if (!interned.has(value)) {
      interned.set(value, interned.size + 1);
    }
    return interned.get(value);
  };
  return (token) => {
    const p = token.phoneme ?? token;
    return [
      intern(`key:${soundKey(token, language)}`),
      intern(`symbol:${token.symbol}`),
      Number(token.kind === 'vowel'),
      p.height ?? 0,
      p.backness ?? 0,
      Number(Boolean(p.rounded)),
      Number(Boolean(token.long)),
      Number(Boolean(token.nasalized)),
      intern(`manner:${token.affricate ? 'affricate' : p.manner}`),
      Math.max(0, places.indexOf(p.place)),
      Number(Boolean(token.voiced)),
      Number(Boolean(token.aspirated)),
      Number(Boolean(token.palatalized)),
      Number((token.tone ?? []).join('')),
      token.stress ?? 0,
      { i: 1, j: 2, u: 3, w: 4 }[token.base] ?? 0,
      Number(['ə', 'ʔ'].includes(token.base)),
    ];
  };
}

export function smallLexicon(records, language, pairs = []) {
  const root = trieNode();
  const counts = new Map(records.map(([word, , count]) => [word, count]));
  for (const [word, ipa, count] of records) {
    addPronunciation(root, { word, ipa, count }, language);
  }
  return {
    root,
    counts,
    total: [...counts.values()].reduce((a, b) => a + b, 0),
    bigrams: new Map(pairs),
  };
}

function entriesOf(root) {
  return [...root.entries, ...[...root.children.values()].flatMap(entriesOf)];
}

function following(entry, language) {
  if (language !== 'zh') {
    return 0;
  }
  const tone = entry.tokens.at(-1)?.tone?.join('');
  if (['一', '不'].includes(entry.word) && tone === '35') {
    return 1;
  }
  return entry.word === '一' && tone === '51' ? 2 : 0;
}

export function recognitionPacket(input, lexicon, options, nbest) {
  const encode = featureEncoder(options.language);
  const entries = entriesOf(lexicon.root);
  const words = [...lexicon.counts.keys()];
  const ids = new Map(words.map((word, i) => [word, i]));
  const unknown = [];
  for (let from = 0; from < input.tokens.length; from++) {
    for (
      let to = from + 1;
      to <= Math.min(input.tokens.length, from + 12);
      to++
    ) {
      const word = spellSounds(input.tokens.slice(from, to), options.language);
      if (!ids.has(word)) {
        ids.set(word, words.length);
        words.push(word);
      }
      unknown.push(from, to, ids.get(word));
    }
  }
  const packet = [
    options.beam,
    Number(options.given),
    nbest,
    input.tokens.length,
    entries.length,
    lexicon.counts.size,
    lexicon.bigrams.size,
    unknown.length / 3,
  ];
  for (const token of input.tokens) {
    packet.push(...encode(token));
  }
  for (let i = 0; i <= input.tokens.length; i++) {
    packet.push(Number(input.boundaries.has(i)));
  }
  packet.push(...lexicon.counts.values());
  for (const entry of entries) {
    packet.push(
      ids.get(entry.word),
      entry.tokens.length,
      following(entry, options.language)
    );
    for (const token of entry.tokens) {
      packet.push(...encode(token));
    }
  }
  for (const [pair, count] of lexicon.bigrams) {
    packet.push(...pair.split('\t').map((word) => ids.get(word)), count);
  }
  packet.push(...unknown);
  return { packet, words };
}

export function runRecognition(engine, packet) {
  const {
    vs_alloc: alloc,
    vs_free: free,
    vs_recognition_run: run,
  } = engine.exports;
  const outputCount = 32768;
  const pointer = alloc(packet.length * 8);
  const output = alloc(outputCount * 8);
  try {
    float64View(engine, pointer, packet.length).set(packet);
    const written = run(pointer, packet.length, output, outputCount);
    if (written < 0) {
      return written;
    }
    return [...float64View(engine, output, written)];
  } finally {
    free(pointer, packet.length * 8);
    free(output, outputCount * 8);
  }
}

export function unpackPaths(data, words, tokens, spell) {
  let at = 0;
  const count = data[at++];
  return Array.from({ length: count }, () => {
    const cost = data[at++];
    const length = data[at++];
    const path = Array.from({ length }, () => {
      const [from, to, word, , cost] = data.slice(at, at + 5);
      at += 5;
      return {
        from,
        to,
        cost,
        word: word < 0 ? spell(tokens.slice(from, to)) : words[word],
      };
    });
    return { cost, path };
  });
}

export function phoneFeatures(ipa, encode) {
  return sounds(ipa).map(encode).flat();
}
