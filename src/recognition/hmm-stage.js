/**
 * Audio to timed IPA with the Gaussian HMM word recogniser: features,
 * token passing over the lexicon trees of the requested languages, and a
 * forced alignment for phone times. The result has the shape of the
 * phone decoder's (`audioToIpa` in decode.js), with the words' language.
 * Unlicense.
 */
import { analyzeFrames } from './frontend.js';
import { trackPitch } from './pitch.js';
import { hmmFeatures, hmmFrameTime } from './hmm-features.js';
import { getHmmModel } from './hmm-model.js';
import { getNetwork, tokenIpa } from './hmm-network.js';
import { alignWords, decodeWords } from './hmm-decode.js';
import { syllablesWithWhisper } from './decode-pipeline.js';
import { clipWhisperSpans, findWhisper } from './whisper.js';
import {
  whisperModeSpans,
  whisperVoicing,
  wrapWhisperIpa,
} from './whisper-result.js';

/** Pauses of at least this length between words become "|". */
const PAUSE = 0.3;

function timedSegments(aligned) {
  const segments = [];
  let lastEnd = 0;
  let lastWord = -1;
  for (const a of aligned) {
    if (a.from > a.to) {
      continue;
    }
    const start = hmmFrameTime(a.from);
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
    const end = Math.max(start + 0.005, hmmFrameTime(a.to));
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
 * @param {{languages?: string[], maxWords?: number,
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
  const network = getNetwork(model, languages, {
    maxWords: options.maxWords,
  });
  const { feats, frames } = hmmFeatures(samples, sampleRate, model.lda);
  const decoded = frames
    ? decodeWords(network, feats, frames, options.search)
    : { words: [], lang: null };
  const aligned = decoded.words.length
    ? alignWords(network, feats, frames, decoded.words, options.search)
    : [];
  const segments = timedSegments(aligned);
  const analysis = analyzeFrames(samples, sampleRate, { hop: 0.01 });
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
    words: decoded.words.map(({ word, lang, start, end }) => ({
      text: word,
      language: lang,
      start: hmmFrameTime(start),
      end: hmmFrameTime(end),
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

function whisperSpansOf(samples, sampleRate, analysis, pitch, { whisper }) {
  if (whisper === false) {
    return [];
  }
  return Array.isArray(whisper)
    ? clipWhisperSpans(whisper, samples.length / sampleRate)
    : findWhisper(samples, sampleRate, analysis, pitch);
}
