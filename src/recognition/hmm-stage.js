/**
 * Audio to timed IPA with the Gaussian HMM word recogniser: features,
 * token passing over the lexicon trees of the requested languages, and a
 * forced alignment for phone times. The result has the shape of the
 * phone decoder's (`audioToIpa` in decode.js), with the words' language.
 * Unlicense.
 */
import { analyzeFrames } from './frontend.js';
import { trackPitch } from './pitch.js';
import { hmmBoundaryTime, hmmFeatures } from './hmm-features.js';
import { getHmmModel } from './hmm-model.js';
import { getNetwork, tokenIpa } from './hmm-network.js';
import { alignWords, decodeWords } from './hmm-decode.js';
import { syllablesWithWhisper } from './decode-pipeline.js';
import { spellSounds } from './phones-to-letters.js';
import { parseIpa } from '../ipa/parse.js';
import { clipWhisperSpans, findWhisper } from './whisper.js';
import {
  whisperModeSpans,
  whisperVoicing,
  wrapWhisperIpa,
} from './whisper-result.js';

/** Pauses of at least this length between words become "|". */
const PAUSE = 0.3;

/** Vowels that are only unstressed in a language's pronunciations. */
const REDUCED = {
  en: new Set(['ə', 'ɚ']),
  ru: new Set(['ɐ', 'ə', 'ɪ', 'ʊ']),
};

/**
 * Primary stress of the words from the phone loop: the longest full vowel
 * (any vowel when none is full). Russian marks words of two or more
 * vowels and English every word, like their pronunciations; Hindi none.
 */
export function stressOutOfVocabulary(words, aligned) {
  words.forEach((w, wi) => {
    const reduced = REDUCED[w.lang];
    if (!w.oov || !reduced) {
      return;
    }
    const vowels = aligned.filter(
      (a) => a.word === wi && a.token.kind === 'vowel'
    );
    if (vowels.length < (w.lang === 'ru' ? 2 : 1)) {
      return;
    }
    const full = vowels.filter((a) => !reduced.has(a.token.symbol));
    let best = null;
    for (const a of full.length ? full : vowels) {
      if (!best || a.to - a.from > best.to - best.from) {
        best = a;
      }
    }
    best.token.stress = 1;
  });
}

function timedSegments(aligned) {
  const segments = [];
  let lastEnd = 0;
  let lastWord = -1;
  for (const a of aligned) {
    if (a.from > a.to) {
      continue;
    }
    const start = hmmBoundaryTime(a.from);
    if (a.word !== lastWord && start - lastEnd >= PAUSE && segments.length) {
      segments.push({
        ipa: '|',
        kind: 'pause',
        start: lastEnd,
        end: start,
        confidence: 1,
        modelWord: lastWord,
      });
    }
    const end = Math.max(start + 0.005, hmmBoundaryTime(a.to));
    segments.push({
      ipa: tokenIpa(a.token),
      kind: a.token.kind,
      start,
      end,
      confidence: 0.9,
      modelWord: a.word,
    });
    lastEnd = end;
    lastWord = a.word;
  }
  return segments;
}

/**
 * Decode speech into words of the given languages and return their phones
 * with times, the pitch track and the frame energies.
 * @param {ArrayLike<number>} samples
 * @param {number} sampleRate
 * @param {{languages?: string[], maxWords?: number, oov?: boolean,
 *   whisper?: 'auto'|false|{start: number, end: number}[],
 *   search?: Partial<typeof import('./hmm-decode.js').HMM_DECODE_DEFAULTS>}}
 *   [options] `search` tunes the beam and weights; `whisper` finds
 *   whispered spans ('auto'), skips them (false) or takes them as given;
 *   other decoder options (the phone decoder's beam, hop and rate) do not
 *   apply.
 */
export function hmmAudioToIpa(samples, sampleRate, options = {}) {
  const model = getHmmModel();
  const languages = options.languages ?? ['en', 'ru', 'hi', 'zh'];
  const analysis = analyzeFrames(samples, sampleRate, { hop: 0.01 });
  const { feats, frames, tone } = hmmFeatures(samples, sampleRate, model.lda);
  const search = { ...options.search, tone };
  // Features are normalised per input, so silence alone would decode as
  // words: decode only inputs with frames the front end calls speech.
  const network =
    frames && hasSpeech(analysis)
      ? getNetwork(model, languages, {
          maxWords: options.maxWords,
          oov: options.oov,
        })
      : null;
  const decoded = network
    ? decodeWords(network, feats, frames, search)
    : { words: [], lang: null };
  // Words from the phone loop get their own tokens to take a stress.
  decoded.words = decoded.words.map((w) =>
    w.oov ? { ...w, tokens: w.tokens.map((t) => ({ ...t })) } : w
  );
  const aligned = decoded.words.length
    ? alignWords(network, feats, frames, decoded.words, search)
    : [];
  stressOutOfVocabulary(decoded.words, aligned);
  const segments = timedSegments(aligned);
  const pitch = trackPitch(analysis);
  const whisperSpans = whisperSpansOf(samples, sampleRate, analysis, pitch, {
    whisper: options.whisper ?? 'auto',
  });
  whisperVoicing(segments, analysis, whisperSpans);
  const modes = whisperModeSpans(segments, whisperSpans);
  const plain = segments.map((s) => s.ipa).join('');
  const ipa = modes.length ? wrapWhisperIpa(segments, modes) : plain;
  const language = decoded.lang ?? languages[0];
  return {
    ipa,
    segments,
    syllables: syllablesWithWhisper(segments, language, whisperSpans, analysis),
    nbest: [{ ipa, segments, cost: 0, confidence: 1 }],
    words: decoded.words.map(({ word, lang, oov, tokens }, i) => ({
      text: oov
        ? spellSounds(parseIpa(tokens.map(tokenIpa).join('')).tokens, lang)
        : word,
      language: lang,
      ...wordSpan(aligned, i),
    })),
    tracks: { pitch },
    // Energies only: the noise check reads them, prosody and modes
    // analyse the audio at their own hops.
    frames: { energy: analysis.energy, count: analysis.count },
    whisperSpans,
    modes,
    language,
    ...(decoded.lang && { modelLanguage: decoded.lang }),
  };
}

function hasSpeech(analysis) {
  for (let t = 0; t < analysis.count; t++) {
    if (analysis.speech[t]) {
      return true;
    }
  }
  return false;
}

/** Start and end of word i: its first and last aligned phone. */
function wordSpan(aligned, i) {
  let from = Infinity;
  let to = -Infinity;
  for (const a of aligned) {
    if (a.word === i && a.from < a.to) {
      from = Math.min(from, a.from);
      to = Math.max(to, a.to);
    }
  }
  return { start: hmmBoundaryTime(from), end: hmmBoundaryTime(to) };
}

function whisperSpansOf(samples, sampleRate, analysis, pitch, { whisper }) {
  if (whisper === false) {
    return [];
  }
  return Array.isArray(whisper)
    ? clipWhisperSpans(whisper, samples.length / sampleRate)
    : findWhisper(samples, sampleRate, analysis, pitch);
}
