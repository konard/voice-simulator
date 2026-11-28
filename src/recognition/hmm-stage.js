/**
 * Audio to timed IPA with the Gaussian HMM word recogniser: features,
 * token passing over the lexicon trees of the requested languages, and a
 * forced alignment for phone times. The result has the shape of the
 * phone decoder's (`audioToIpa` in decode.js), with the words' language.
 * Unlicense.
 */
import { analyzeFrames, analyzeWordFrames } from './frontend.js';
import { trackPitch, trackPitchFrames } from './pitch.js';
import { hmmBoundaryTime, hmmFeatures } from './hmm-features.js';
import { getHmmModel } from './hmm-model.js';
import { getNetwork, tokenIpa } from './hmm-network.js';
import { alignWords, decodeWords } from './hmm-decode.js';
import { syllablesWithWhisper } from './decode-pipeline.js';
import { spellSounds } from './phones-to-letters.js';
import { parseIpa } from '../ipa/parse.js';
import { measure } from './profile.js';
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

function preferVowel(phone, previous, reduced) {
  if (!previous) {
    return true;
  }
  const full = !reduced.has(phone.token.symbol);
  const previousFull = !reduced.has(previous.token.symbol);
  return full === previousFull
    ? phone.to - phone.from > previous.to - previous.from
    : full;
}

/**
 * Primary stress of the words from the phone loop: the longest full vowel
 * (any vowel when none is full). Russian marks words of two or more
 * vowels and English every word, like their pronunciations; Hindi none.
 */
export function stressOutOfVocabulary(words, aligned) {
  if (!words.some(({ oov, lang }) => oov && REDUCED[lang])) {
    return;
  }
  const counts = new Uint32Array(words.length);
  const best = new Array(words.length);
  for (const phone of aligned) {
    const index = phone.word;
    const word = words[index];
    const reduced = word?.oov && REDUCED[word.lang];
    if (!reduced || phone.token.kind !== 'vowel') {
      continue;
    }
    counts[index]++;
    if (preferVowel(phone, best[index], reduced)) {
      best[index] = phone;
    }
  }
  for (let index = 0; index < words.length; index++) {
    if (counts[index] >= (words[index].lang === 'ru' ? 2 : 1)) {
      best[index].token.stress = 1;
    }
  }
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
 * @param {{languages?: string[], maxWords?: number, oov?: boolean, framePitch?: boolean,
 *   includeWords?: boolean, includeSyllables?: boolean, includeModeFrames?: boolean,
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
  const { analysis, pitch } = hmmFrontEnd(samples, sampleRate, options);
  const { feats, frames, tone } = hmmFeatures(
    samples,
    sampleRate,
    model.lda,
    pitch,
    {
      includeTone: languages.includes('zh'),
      framePitch: true,
      storage: options.frameStorage,
    }
  );
  const search = { ...options.search, tone };
  // Features are normalised per input, so silence alone would decode as
  // words: decode only inputs with frames the front end calls speech.
  const network =
    frames && hasSpeech(analysis)
      ? measure(options.profile, 'HMM network', () =>
          getNetwork(model, languages, {
            maxWords: options.maxWords,
            oov: options.oov,
          })
        )
      : null;
  const decoded = network
    ? measure(options.profile, 'HMM search', () =>
        decodeWords(network, feats, frames, search, options.workspaces)
      )
    : { words: [], lang: null };
  // Words from the phone loop get their own tokens to take a stress.
  decoded.words = decoded.words.map((w) =>
    w.oov ? { ...w, tokens: w.tokens.map((t) => ({ ...t })) } : w
  );
  const aligned = decoded.words.length
    ? measure(options.profile, 'HMM alignment', () =>
        alignWords(network, feats, frames, decoded.words, search)
      )
    : [];
  stressOutOfVocabulary(decoded.words, aligned);
  const segments = timedSegments(aligned);
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
    syllables:
      options.includeSyllables === false
        ? []
        : syllablesWithWhisper(segments, language, whisperSpans, analysis),
    nbest: [{ ipa, segments, cost: 0, confidence: 1 }],
    useModelWords: options.useModelWords,
    words:
      options.includeWords === false ? [] : timedWords(decoded.words, aligned),
    tracks: { pitch },
    ...resultFrames(analysis, options),
    whisperSpans,
    modes,
    language,
    ...(decoded.lang && { modelLanguage: decoded.lang }),
  };
}

function resultFrames(
  analysis,
  { frontEnd, useModelWords, includeModeFrames }
) {
  return {
    // Batch callers need the energies here for the noise check.
    frames: frontEnd
      ? analysis
      : { energy: analysis.energy, count: analysis.count },
    // Live word decoding and batch mode classification can share analysis.
    modeFrames: useModelWords || includeModeFrames ? analysis : undefined,
  };
}

function hmmFrontEnd(samples, sampleRate, options) {
  if (options.frontEnd) {
    return {
      analysis: options.frontEnd.frames,
      pitch: options.frontEnd.tracks.pitch,
    };
  }
  const analysis =
    options.analysis ?? wordAnalysis(samples, sampleRate, options);
  const pitch = options.framePitch
    ? trackPitchFrames(analysis, {
        percentiles: true,
        kernels: options.kernels,
      })
    : trackPitch(analysis, { kernels: options.kernels });
  return { analysis, pitch };
}

function wordAnalysis(samples, sampleRate, options) {
  const { includeSyllables, includeModeFrames, frameStorage } = options;
  if (includeSyllables !== false) {
    return analyzeFrames(samples, sampleRate, { hop: 0.01 }, frameStorage);
  }
  return analyzeWordFrames(
    samples,
    sampleRate,
    frameStorage,
    includeModeFrames
  );
}

function hasSpeech(analysis) {
  for (let t = 0; t < analysis.count; t++) {
    if (analysis.speech[t]) {
      return true;
    }
  }
  return false;
}

/** The alignment lists each word's phones in order. */
function timedWords(words, aligned) {
  let next = 0;
  return words.map(({ word, lang, oov, tokens }, index) => {
    let from = Infinity;
    let to = -Infinity;
    while (aligned[next]?.word === index) {
      const phone = aligned[next++];
      if (phone.from < phone.to) {
        from = Math.min(from, phone.from);
        to = Math.max(to, phone.to);
      }
    }
    return {
      text: oov
        ? spellSounds(parseIpa(tokens.map(tokenIpa).join('')).tokens, lang)
        : word,
      language: lang,
      ...(oov && { unknown: true }),
      start: hmmBoundaryTime(from),
      end: hmmBoundaryTime(to),
    };
  });
}

function whisperSpansOf(samples, sampleRate, analysis, pitch, { whisper }) {
  if (whisper === false) {
    return [];
  }
  return Array.isArray(whisper)
    ? clipWhisperSpans(whisper, samples.length / sampleRate)
    : findWhisper(samples, sampleRate, analysis, pitch);
}
