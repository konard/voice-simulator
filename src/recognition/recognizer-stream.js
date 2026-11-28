/** Phrase commits over the incremental IPA decoder. Unlicense. */
import { createIpaDecoder } from './decode.js';
import { joinSegments } from './decode-pipeline.js';
import { languageShares } from './language-id.js';
import {
  decodeRecognitionAudio,
  decoderOptions,
  emptyRecognition,
  heardSpeech,
  noisyFrames,
  recognizeDecoded,
  RecognitionError,
  recognitionSettings,
  validateRate,
  validateSamples,
  usesWordDecoder,
} from './recognizer.js';
import { aggregate, translated } from './recognizer-result.js';
import { createLiveFrames } from './recognizer-live-frames.js';
import { HMM_LIVE_WORDS } from './hmm-network.js';
import { clipWhisperSpans } from './whisper.js';

const PAUSE = 0.3;
const COMMIT_AFTER = 5;
const MAX_WINDOW = 7;
const LEVELS = ['low', 'medium', 'high'];
const EPSILON = 1e-8;
/**
 * Seconds of pitched audio a phrase needs before it can produce words, unless
 * the caller sets minVoiced: a live microphone hears noise between phrases,
 * and noise alone decoded as strings of fricatives (issue 170).
 */
export const STREAM_MIN_VOICED = 0.1;

export function adaptiveLevel(level, recentLoad, sustainedLoad) {
  if (level > 0 && recentLoad > 0.8) {
    return level - 1;
  }
  if (level < 2 && sustainedLoad < 0.3) {
    return level + 1;
  }
  return level;
}

function createLoadMeter(sampleRate) {
  let windows = [];
  return {
    add(samples, seconds) {
      windows.push({ samples, seconds });
      let remaining = 10 * sampleRate;
      for (let i = windows.length - 1; i >= 0; i--) {
        remaining -= windows[i].samples;
        if (remaining <= 0) {
          windows = windows.slice(i);
          break;
        }
      }
    },
    charge(seconds) {
      const latest = windows.at(-1);
      if (latest) {
        latest.seconds += seconds;
      }
    },
    choose(level) {
      const index = LEVELS.indexOf(level);
      return LEVELS[adaptiveLevel(index, factor(2), factor(10))];
    },
    reset() {
      windows = [];
    },
  };

  function factor(duration) {
    let remaining = duration * sampleRate;
    let elapsed = 0;
    for (let i = windows.length - 1; i >= 0; i--) {
      const { samples, seconds } = windows[i];
      const used = Math.min(remaining, samples);
      remaining -= used;
      elapsed += seconds * (used / samples);
      if (remaining <= 0) {
        return elapsed / duration;
      }
    }
    return NaN;
  }
}

function boundedDecode(decoded, end) {
  const phones = (segments) =>
    segments.filter((segment) => segment.end <= end + EPSILON);
  const { frames, lattice, tracks } = decoded;
  const { pitch } = tracks;
  const times = lattice?.times.filter((time) => time <= end + EPSILON);
  return {
    ...decoded,
    whisperSpans: clipWhisperSpans(decoded.whisperSpans, end),
    segments: phones(decoded.segments),
    ipa: joinSegments(phones(decoded.segments)),
    syllables: decoded.syllables.filter(
      (syllable) => syllable.end <= end + EPSILON
    ),
    nbest: decoded.nbest.map((reading) => {
      const segments = phones(reading.segments);
      return { ...reading, segments, ipa: joinSegments(segments) };
    }),
    ...(lattice && {
      lattice: {
        times,
        edges: lattice.edges.filter((edge) => edge.to < times.length),
      },
    }),
    frames: {
      ...frames,
      count: Math.min(frames.count, Math.ceil(end / frames.hop)),
      sampleCount: Math.min(frames.sampleCount, Math.round(end * frames.rate)),
    },
    tracks: {
      ...tracks,
      pitch: {
        ...pitch,
        count: Math.min(pitch.count, Math.ceil(end / pitch.hop)),
      },
    },
  };
}

function trailingPause(frames, state) {
  while (state.scanned < frames.count) {
    if (frames.speech[state.scanned]) {
      state.lastSpeech = state.scanned;
    }
    state.scanned++;
  }
  return (state.scanned - state.lastSpeech - 1) * frames.hop;
}

function createPhraseDecoder(sampleRate, settings, level, start, liveWords) {
  const createDecoder = liveWords ? createLiveFrames : createIpaDecoder;
  const decoder = createDecoder(sampleRate, {
    ...decoderOptions(settings, level, start),
    maxSeconds: MAX_WINDOW + 1,
    lattice: settings.rescoring,
  });
  return {
    decoder,
    buffer: new Float32Array(Math.ceil(MAX_WINDOW * sampleRate)),
    used: 0,
    scanned: 0,
    lastSpeech: -1,
    fixed: [],
    partial: null,
    nextCut: 0,
  };
}

export function createEvents() {
  const listeners = new Map();
  return {
    emit(event, value) {
      for (const listener of [...(listeners.get(event) ?? [])]) {
        listener(value);
      }
    },
    on(event, listener) {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event).add(listener);
    },
    off(event, listener) {
      listeners.get(event)?.delete(listener);
    },
  };
}

function createSyllableEvents(emit) {
  let lastNucleus = -Infinity;
  let index = 0;
  return ({ segments, nuclei }, fixed, offset) => {
    fixed.push(...segments);
    for (const nucleus of nuclei) {
      if (nucleus.time + offset <= lastNucleus + EPSILON) {
        continue;
      }
      lastNucleus = nucleus.time + offset;
      const end = nucleus.end ?? nucleus.time;
      emit('syllable', {
        index: index++,
        start: nucleus.start + offset,
        end: end + offset,
        ipa: joinSegments(
          fixed.filter(
            (phone) => phone.start >= nucleus.start && phone.end <= end
          )
        ),
      });
    }
  };
}

// The phrase decoder, commit cursor and reset lifecycle share this state.
// eslint-disable-next-line max-lines-per-function
export function createRecognizer(
  options = {},
  { liveWords = false, liveModeReference = false, onReading, onPitch } = {}
) {
  const { sampleRate } = options;
  validateRate(sampleRate);
  const settings = recognitionSettings(options);
  const { nbest } = settings;
  const minVoiced = settings.minVoiced ?? STREAM_MIN_VOICED;
  const stride = Math.max(1, Math.floor(sampleRate * 0.02));
  const { emit, on, off } = createEvents();
  const load =
    settings.level === 'auto' && !settings.deterministic
      ? createLoadMeter(sampleRate)
      : null;
  let phrase;
  let level;
  let committed;
  let offset;
  let nextPartial;
  let reportSyllables;
  let syllableIndex;
  let ended;
  let flushed;
  let pending;
  const initialVoice = settings.voice;
  const initialOffsets = settings.articulationOffsets;

  function reset() {
    settings.voice = initialVoice;
    settings.articulationOffsets = initialOffsets;
    pending = undefined;
    level = settings.level === 'auto' ? 'medium' : settings.level;
    phrase = openPhrase();
    committed = emptyRecognition(nbest, settings.segments);
    offset = 0;
    nextPartial = 1;
    reportSyllables = createSyllableEvents(emit);
    syllableIndex = 0;
    ended = false;
    flushed = null;
    load?.reset();
  }

  function openPhrase(start) {
    return createPhraseDecoder(sampleRate, settings, level, start, liveWords);
  }

  function update(decoded) {
    if (!liveWords) {
      reportSyllables(decoded, phrase.fixed, offset / sampleRate);
    }
    for (const { time, f0 } of decoded.voiced ?? []) {
      onPitch?.({ time: time + offset / sampleRate, f0 });
    }
  }

  // Whispered spans the caller marked inside the phrase count as speech.
  // An injected audioToIpa stage replaces the acoustic evidence.
  function phraseSpeech(decoded, size) {
    if (settings.stages.audioToIpa) {
      return true;
    }
    const { whisper } = decoderOptions(settings, level, offset / sampleRate);
    return heardSpeech(
      decoded,
      minVoiced,
      Array.isArray(whisper) ? clipWhisperSpans(whisper, size / sampleRate) : []
    );
  }

  function reportAlignedSyllables(syllables, elapsed) {
    for (const { start, end, ipa } of syllables) {
      emit('syllable', {
        index: syllableIndex++,
        start: start + elapsed,
        end: end + elapsed,
        ipa,
      });
    }
  }

  function read(decoded, size, final) {
    const signal = phrase.buffer.subarray(0, size);
    let readSettings = final
      ? settings
      : {
          ...settings,
          nbest: 1,
          segments: false,
          includeModeLabels: !liveWords && settings.includeModeLabels,
        };
    if (liveWords) {
      readSettings = {
        ...readSettings,
        liveWords,
        maxWords: HMM_LIVE_WORDS,
        search: final
          ? { beam: 58, maxActive: 640 }
          : { beam: 48, maxActive: 280 },
      };
    }
    // A test can supply snapshot IPA while the decoder maintains live timing.
    // Committed phrases take the word decoder, like recognize(); previews
    // keep the incremental phone decoder, which is cheap per chunk.
    const reading =
      liveWords ||
      settings.stages.audioToIpa ||
      (final && usesWordDecoder(settings))
        ? decodeRecognitionAudio(
            signal,
            sampleRate,
            readSettings,
            level,
            offset / sampleRate,
            liveWords ? decoded : undefined
          )
        : { decoded, input: signal, rate: sampleRate };
    onReading?.(reading.decoded, offset / sampleRate, Boolean(final));
    if (liveWords && final) {
      reportAlignedSyllables(reading.decoded.syllables, offset / sampleRate);
    }
    return recognizeDecoded(
      reading.decoded,
      reading.input,
      reading.rate,
      // Use relative labels in the default live mode. A caller can request
      // reference-based labels even when the word stream has a bounded beam.
      liveWords && !liveModeReference
        ? { ...readSettings, voice: null }
        : readSettings,
      level,
      final
    );
  }

  function commit(size, finishDecoder) {
    if (finishDecoder) {
      update(phrase.decoder.flush());
    }
    const current = phrase.decoder.result();
    const decoded = finishDecoder
      ? current
      : boundedDecode(current, size / sampleRate);
    if (
      noisyFrames(
        decoded.frames.energy,
        decoded.frames.count,
        size / sampleRate
      )
    ) {
      throw new RecognitionError(
        'too-noisy',
        'Audio has less than 5 dB of energy contrast'
      );
    }
    const answer = phraseSpeech(decoded, size)
      ? read(decoded, size, 'stream')
      : emptyRecognition(nbest, settings.segments);
    if (answer.words.length) {
      const absolute = translated(
        answer,
        offset / sampleRate,
        committed.words.length
      );
      aggregate(committed, absolute, nbest - 1);
      const { ipa, text, languages, words, modes, segments } = translated(
        answer,
        offset / sampleRate,
        0
      );
      emit('final', {
        ipa,
        text,
        languages,
        words,
        modes,
        ...(segments && { segments }),
      });
    }
    offset += size;
  }

  function applyVoice() {
    const { voice, articulationOffsets, onApplied } = pending;
    settings.voice = voice;
    settings.articulationOffsets = articulationOffsets;
    pending = undefined;
    return onApplied;
  }

  function restart(size, adapt = false) {
    const start = load && globalThis.performance.now();
    const previous = phrase;
    commit(size, size === previous.used);
    if (load) {
      load.charge((globalThis.performance.now() - start) / 1000);
      const next = load.choose(level);
      if (next !== level) {
        level = next;
        load.reset();
      }
    }
    const onApplied = adapt ? applyVoice() : undefined;
    phrase = openPhrase(offset / sampleRate);
    // Only the lookahead after a word cut is replayed, with its original offset.
    const suffix = previous.buffer.subarray(size, previous.used);
    if (suffix.length) {
      phrase.buffer.set(suffix);
      phrase.used = suffix.length;
      update(phrase.decoder.push(suffix));
    }
    onApplied?.();
  }

  function setVoice(voice, articulationOffsets, immediate = false, onApplied) {
    // Only reference-based mode analysis uses the voice in the live HMM.
    // Without it, intermediate fit passes need no new phrase.
    if (liveWords && !liveModeReference && !immediate && !onApplied) {
      settings.voice = voice;
      settings.articulationOffsets = articulationOffsets;
      return;
    }
    pending = { voice, articulationOffsets, onApplied };
    const pause = trailingPause(phrase.decoder.frames, phrase);
    if (immediate || pause >= 0.2 - EPSILON || phrase.used === 0) {
      if (phrase.used) {
        restart(phrase.used, true);
      } else {
        applyVoice();
        phrase = openPhrase(offset / sampleRate);
        onApplied?.();
      }
    }
  }

  function previewPartial(due) {
    const awaitingFirstWords =
      phrase.partial &&
      !phrase.partial.words.length &&
      !phrase.partial.gated &&
      !settings.stages.audioToIpa;
    if (!due && !awaitingFirstWords) {
      return;
    }
    const preview = phrase.decoder.result();
    if (!due && !preview.ipa) {
      return;
    }
    phrase.partial = phraseSpeech(preview, phrase.used)
      ? read(preview, phrase.used, false)
      : // Below the speech gate, look again at the next quarter second.
        { ...emptyRecognition(1), gated: true };
    const { words, ipa, text } = translated(
      phrase.partial,
      offset / sampleRate,
      0
    );
    if (due || words.length) {
      emit('partial', { words, ipa, text });
    }
  }

  function previewDue(due) {
    return (
      !liveWords ||
      (due && !phrase.partial?.words.length && phrase.used >= sampleRate)
    );
  }

  function advance(chunk) {
    const start = load && globalThis.performance.now();
    phrase.buffer.set(chunk, phrase.used);
    phrase.used += chunk.length;
    update(phrase.decoder.push(chunk));
    const pause = trailingPause(phrase.decoder.frames, phrase);
    const total = offset + phrase.used;
    const due = total >= Math.ceil((nextPartial * sampleRate) / 4);
    // A live phrase needs one word preview before its bounded final read.
    if (previewDue(due)) {
      previewPartial(due);
    }
    if (due) {
      nextPartial++;
    }
    load?.add(chunk.length, (globalThis.performance.now() - start) / 1000);
    commitAtPause(pause);
  }

  function commitAtPause(pause) {
    if (pending && pause >= 0.2 - EPSILON) {
      restart(phrase.used, true);
    } else if (
      pause >= PAUSE - EPSILON &&
      (phrase.lastSpeech >= 0 || phrase.used >= COMMIT_AFTER * sampleRate)
    ) {
      restart(phrase.used);
    } else if (liveWords) {
      if (phrase.used > COMMIT_AFTER * sampleRate && pause >= 0.12 - EPSILON) {
        restart(phrase.used);
      }
    } else if (phrase.used > COMMIT_AFTER * sampleRate) {
      const word = longPhraseWords()?.findLast(
        ({ end }) => end > 0 && end <= phrase.used / sampleRate - 1
      );
      if (word) {
        restart(Math.ceil(word.end * sampleRate - EPSILON));
      }
    }
  }

  // Words to cut a long phrase after. The word decoder only ends words at the
  // last frame of its input, so its phrases are cut at its own word ends,
  // read at most once a second; the phone decoder's preview words otherwise.
  function longPhraseWords() {
    if (settings.stages.audioToIpa || !usesWordDecoder(settings)) {
      return phrase.partial?.words;
    }
    if (phrase.used < phrase.nextCut) {
      return null;
    }
    phrase.nextCut = phrase.used + sampleRate;
    return decodeRecognitionAudio(
      phrase.buffer.subarray(0, phrase.used),
      sampleRate,
      {
        ...settings,
        modes: false,
        includeModeLabels: false,
        hmmWordSpans: true,
      },
      level,
      offset / sampleRate
    ).decoded.words;
  }

  reset();
  return {
    push(chunk) {
      try {
        if (ended) {
          throw new RangeError(
            'Reset the recognizer before pushing after flush'
          );
        }
        if (!(chunk instanceof Float32Array)) {
          throw new TypeError('Expected a Float32Array');
        }
        validateSamples(chunk);
        for (let i = 0; i < chunk.length; ) {
          if (phrase.used === phrase.buffer.length) {
            restart(phrase.used);
          }
          const size = Math.min(
            stride,
            phrase.buffer.length - phrase.used,
            Math.ceil((nextPartial * sampleRate) / 4) - (offset + phrase.used)
          );
          const end = Math.min(chunk.length, i + size);
          advance(chunk.subarray(i, end));
          i = end;
        }
      } catch (error) {
        ended = true;
        emit('error', error);
      }
    },
    flush() {
      if (flushed) {
        return globalThis.structuredClone(flushed);
      }
      if (offset + phrase.used < 0.05 * sampleRate) {
        throw new RecognitionError(
          'empty',
          'Recognition needs at least 50 ms of audio'
        );
      }
      if (!ended && phrase.used) {
        commit(phrase.used, true);
      }
      ended = true;
      flushed = { ...committed, languages: languageShares(committed.words) };
      return globalThis.structuredClone(flushed);
    },
    reset,
    on,
    off,
    setVoice,
    discardVoiceChange() {
      pending = undefined;
    },
  };
}
