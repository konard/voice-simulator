/**
 * Test-only trace of the smoke cases. Changing one input at a time, decode
 *   blind    — all four languages, as recognize() does;
 *   known    — the spoken language only;
 *   ref      — forced alignment of the words the synthesiser spoke, i.e.
 *              reference words and their phone boundaries.
 * For each it prints the words and the acoustic + language score, then per
 * language the best blind score (language scores), and per reference word
 * the candidates that end near its end with its rank among them (aligned
 * candidates). The oracle error is the share of reference words that are
 * not among the top `TOP` candidates at their own boundaries.
 * node experiments/issue-75-smoke-diagnose.mjs [lang:index|lang:text ...] [tier] [preset|-]
 * Environment: TOP (5), MARGIN (frames, 3), SEARCH (decoder settings as
 * JSON, e.g. '{"ciBackoff":-5}'). Unlicense.
 */
import { synthesize } from '../src/index.js';
import { parseIpa } from '../src/ipa/parse.js';
import { hmmFeatures } from '../src/recognition/hmm-features.js';
import { getHmmModel, toneUnits } from '../src/recognition/hmm-model.js';
import { getNetwork } from '../src/recognition/hmm-network.js';
import { alignWords, decodeWords } from '../src/recognition/hmm-decode.js';
import { sentences } from '../tests/helpers/roundtrip.js';

const args = process.argv.slice(2);
const cases = args.filter((a) => a.includes(':'));
const [tier = 'telephone', preset = 'male'] = args.filter(
  (a) => !a.includes(':')
);
const TOP = Number(process.env.TOP ?? 5);
const MARGIN = Number(process.env.MARGIN ?? 3);
// Decoder settings over HMM_DECODE_DEFAULTS, as JSON.
const search = JSON.parse(process.env.SEARCH ?? '{}');
const LANGUAGES = ['en', 'ru', 'hi', 'zh'];
const model = getHmmModel();
const frameOf = (time) => Math.round((time * 8000 - 60) / 80);
// Tone-stream features of the current case (hmm-tone.js).
let tone = null;
const show = (words) =>
  words.map((w) => w.word || `[${w.units.join('')}]`).join(' ');

function referenceWords(spoken, lang) {
  return spoken.ipa
    .split(/[\s|.,?!]+/u)
    .filter(Boolean)
    .map((w) => {
      const tokens = parseIpa(w).tokens.filter(
        (t) => t.kind === 'vowel' || t.kind === 'consonant'
      );
      // Mandarin vowels carry their tone class, as in the network.
      const units =
        lang === 'zh' ? toneUnits(tokens) : tokens.map((t) => t.symbol);
      return { word: '', tokens, units };
    })
    .filter((w) => w.tokens.length);
}

function alignedScore(network, feats, frames, words) {
  let score = -Infinity;
  alignWords(network, feats, frames, words, {
    ...search,
    tone,
    onScore: (s) => {
      score = s;
    },
  });
  return score;
}

/** Word ends of a blind decode, grouped by end frame. */
function wordEnds(network, feats, frames) {
  const ends = new Map();
  const decoded = decodeWords(network, feats, frames, {
    ...search,
    tone,
    onWordEnd(id, score, start, end) {
      const list = ends.get(end) ?? [];
      list.push({ id, score, start });
      ends.set(end, list);
    },
  });
  return { decoded, ends };
}

function candidatesAt(network, ends, from, to) {
  const best = new Map();
  for (let end = to - MARGIN; end <= to + MARGIN; end++) {
    for (const { id, score, start } of ends.get(end) ?? []) {
      const w = network.words[id];
      if (Math.abs(start - from) > MARGIN || w.oov) {
        continue;
      }
      if (!best.has(w.word) || best.get(w.word) < score) {
        best.set(w.word, score);
      }
    }
  }
  return [...best].sort((a, b) => b[1] - a[1]);
}

let missed = 0;
let total = 0;
for (const item of cases.length ? cases : ['en:17', 'ru:1', 'zh:1']) {
  const [lang, index] = item.split(':');
  // A case is lang:index of the round-trip sentences or lang:text; the
  // preset "-" synthesises as recognizer.test.js does (default voice).
  const text = /^\d+$/u.test(index) ? sentences[lang][Number(index)] : index;
  const spoken = synthesize(
    text,
    preset === '-'
      ? { lang, tier, seed: 1 }
      : { lang, tier, preset, head: 'random', seed: 1 }
  );
  const {
    feats,
    frames,
    tone: toneFeats,
  } = hmmFeatures(spoken.samples, spoken.sampleRate, model.lda);
  tone = toneFeats;
  const blindNet = getNetwork(model, LANGUAGES);
  const knownNet = getNetwork(model, [lang]);
  const { decoded: blind, ends } = wordEnds(blindNet, feats, frames);
  const known = decodeWords(knownNet, feats, frames, { ...search, tone });
  const ref = referenceWords(spoken, lang);
  const scores = {
    blind: alignedScore(knownNet, feats, frames, blind.words),
    known: alignedScore(knownNet, feats, frames, known.words),
    ref: alignedScore(knownNet, feats, frames, ref),
  };
  console.log(`\n${lang} ${index} ${JSON.stringify(text)} ${tier} ${preset}`);
  console.log(
    `  blind  ${blind.lang} ${show(blind.words)}  acoustic ${scores.blind.toFixed(1)}`
  );
  console.log(
    `  known  ${show(known.words)}  acoustic ${scores.known.toFixed(1)}`
  );
  console.log(
    `  ref    ${ref.map((w) => w.units.join('')).join(' ')}  acoustic ${scores.ref.toFixed(1)} (${scores.ref > scores.blind ? 'search/LM error' : 'model error'} if blind is wrong)`
  );
  const languageScores = LANGUAGES.map((l) => {
    const d = decodeWords(getNetwork(model, [l]), feats, frames, {
      ...search,
      tone,
    });
    return `${l} ${d.score.toFixed(1)}`;
  });
  console.log(`  language scores ${languageScores.join(', ')}`);
  for (const w of spoken.timeline.words) {
    const key = w.text.toLowerCase().replace(/[^\p{L}\p{M}]/gu, '');
    const list = candidatesAt(blindNet, ends, frameOf(w.start), frameOf(w.end));
    const rank = list.findIndex(([word]) => word === key);
    total++;
    missed += Number(rank < 0 || rank >= TOP);
    console.log(
      `  ${key.padEnd(12)} rank ${rank < 0 ? '-' : rank}  ${list
        .slice(0, TOP)
        .map(([word, score]) => `${word}:${score.toFixed(0)}`)
        .join(' ')}`
    );
  }
}
console.log(
  `\noracle error (reference word outside top ${TOP} at its boundaries): ${missed}/${total}`
);
