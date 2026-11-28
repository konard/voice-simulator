/** Phrase commits over the incremental IPA decoder. Unlicense. */
import { createIpaDecoder } from './decode.js';
import { joinSegments } from './decode-pipeline.js';
import {
  createFrameAnalyzer,
  createWordAnalyzer,
  workingRate,
} from './frontend.js';
import { HMM_LOW_SEARCH } from './hmm-decode.js';
import { HMM_LIVE_WORDS } from './hmm-network.js';
import { createLandmarkDetector } from './landmarks.js';
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
  withBatchFrames,
} from './recognizer.js';
import { aggregate, translated } from './recognizer-result.js';
import { createLiveFrames } from './recognizer-live-frames.js';
import { clipWhisperSpans } from './whisper.js';

const PAUSE = 0.3;
const COMMIT_AFTER = 5;
const MAX_WINDOW = 7;
const LEVELS = ['low', 'medium', 'high'];
const EPSILON = 1e-8;
const PREVIEW_SEARCH = Object.freeze({
  beam: 34,
  languageBeam: 100,
  maxActive: 96,
});

export function usesWordPhrases(sampleRate, settings) {
  return (
    sampleRate === 8000 &&
    settings.level === 'low' &&
    settings.languages.length === 1 &&
    usesWordDecoder(settings) &&
    !Object.keys(settings.stages).length
  );
}
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
  const { lattice } = decoded;
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
    ...boundedAcoustics(decoded, end),
  };
}

function boundedAcoustics({ frames, tracks }, end) {
  const { pitch } = tracks;
  return {
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

const WORD_FRONTEND_OPTIONS = { hop: 0.01, maxSeconds: MAX_WINDOW + 1 };

function createBatchWordFrontend(sampleRate, includeModes) {
  const input = createWordAnalyzer(
    sampleRate,
    WORD_FRONTEND_OPTIONS,
    includeModes
  );
  const { frames } = input;
  return {
    frames,
    phraseSamples: frames.samples,
    reset: input.reset,
    push(chunk) {
      input.push(chunk);
    },
    flush() {
      input.flush();
    },
  };
}

const spareWordFrontends = [];

/** The one-shot word recognizer always works on the 8 kHz phrase grid. */
export function recognizeWordPhrases(samples, sampleRate, settings) {
  const mode = Number(Boolean(settings.includeModeLabels));
  const frontend =
    spareWordFrontends[mode] ??
    createBatchWordFrontend(sampleRate, Boolean(mode));
  spareWordFrontends[mode] = undefined;
  try {
    const stream = createConfiguredRecognizer(sampleRate, settings, frontend);
    stream.on('error', (error) => {
      throw error;
    });
    stream.push(
      samples instanceof Float32Array ? samples : Float32Array.from(samples)
    );
    return stream.flush();
  } finally {
    spareWordFrontends[mode] = frontend;
  }
}

function createWordFrontend(sampleRate, options, liveSyllables) {
  const input = createFrameAnalyzer(sampleRate, WORD_FRONTEND_OPTIONS);
  const { frames } = input;
  const landmarks = createLandmarkDetector(frames);
  let phones;
  const report = (final = false) => ({
    segments: [],
    nuclei: landmarks.advance(final),
  });
  function startSyllables(samples) {
    if (phones) {
      return null;
    }
    phones = createIpaDecoder(sampleRate, options);
    return phones.push(samples);
  }
  return {
    frames,
    phraseSamples: frames.samples,
    report() {
      return phones ? null : report();
    },
    startSyllables,
    push(chunk) {
      input.push(chunk);
      if (phones) {
        return phones.push(chunk);
      }
      return liveSyllables() ? startSyllables(chunk) : null;
    },
    flush() {
      input.flush();
      return phones?.flush() ?? report(true);
    },
  };
}

function createPhraseDecoder(
  sampleRate,
  settings,
  level,
  start,
  createDecoder
) {
  const options = {
    ...decoderOptions(settings, level, start),
    maxSeconds: MAX_WINDOW + 1,
    lattice: settings.rescoring,
  };
  const decoder = createDecoder(sampleRate, options);
  const capacity = Math.ceil(MAX_WINDOW * sampleRate);
  return {
    decoder,
    buffer:
      decoder.phraseSamples?.subarray(0, capacity) ??
      new Float32Array(capacity),
    used: 0,
    scanned: 0,
    lastSpeech: -1,
    fixed: [],
    partial: null,
    nextCut: 0,
    nextPreview: Math.round(sampleRate * 0.25),
  };
}

function pushPhrase(phrase, samples) {
  if (!phrase.decoder.phraseSamples) {
    phrase.buffer.set(samples, phrase.used);
  }
  phrase.used += samples.length;
  return phrase.decoder.push(samples);
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
    has(event) {
      return Boolean(listeners.get(event)?.size);
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

export function createRecognizer(options = {}, live) {
  const { sampleRate } = options;
  validateRate(sampleRate);
  return createConfiguredRecognizer(
    sampleRate,
    recognitionSettings(options),
    undefined,
    live
  );
}

function speechGateOnly(
  settings,
  adaptive,
  { finalOnly, liveWords, onReading, onPitch }
) {
  return (
    finalOnly &&
    !adaptive &&
    !liveWords &&
    !onReading &&
    !onPitch &&
    usesWordDecoder(settings) &&
    !Object.keys(settings.stages).length
  );
}

// The phrase decoder, commit cursor and reset lifecycle share this state.
// eslint-disable-next-line max-lines-per-function
function createConfiguredRecognizer(
  sampleRate,
  settings,
  batchWordFrontend,
  {
    liveWords = false,
    liveModeReference = false,
    onReading,
    onPitch,
    previews = true,
    finalOnly = false,
  } = {}
) {
  const { nbest } = settings;
  const minVoiced =
    settings.minVoiced ?? (batchWordFrontend ? 0 : STREAM_MIN_VOICED);
  const stride = Math.max(1, Math.floor(sampleRate * 0.02));
  const wordPhrases = !liveWords && usesWordPhrases(sampleRate, settings);
  const packet = wordPhrases ? new Float32Array(stride) : null;
  const { emit, has, on, off } = createEvents();
  const liveSyllables = () => !finalOnly && has('syllable');
  const adaptive = settings.level === 'auto' && !settings.deterministic;
  // A one-shot caller without previews still needs the same pause and
  // speech gates. The final word read has its own phone alignment.
  const acousticsOnly = speechGateOnly(settings, adaptive, {
    finalOnly,
    liveWords,
    onReading,
    onPitch,
  });
  const gateWordOptions = acousticsOnly ? { framePitch: true } : undefined;
  function createDecoder(rate, options) {
    if (batchWordFrontend) {
      batchWordFrontend.reset();
      return batchWordFrontend;
    }
    if (wordPhrases) {
      return createWordFrontend(rate, options, liveSyllables);
    }
    if (liveWords) {
      return createLiveFrames(rate, options);
    }
    if (acousticsOnly) {
      return createLiveFrames(
        rate,
        { ...options, rate: workingRate(Math.min(rate, options.rate)) },
        { hop: options.hop, reportPitch: false }
      );
    }
    return createIpaDecoder(rate, options);
  }
  const load = adaptive ? createLoadMeter(sampleRate) : null;
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
  let queued;
  const initialVoice = settings.voice;
  const initialOffsets = settings.articulationOffsets;

  function openPhrase(start) {
    return createPhraseDecoder(
      sampleRate,
      settings,
      level,
      start,
      createDecoder
    );
  }

  function reset() {
    settings.voice = initialVoice;
    settings.articulationOffsets = initialOffsets;
    pending = undefined;
    level = settings.level === 'auto' ? 'medium' : settings.level;
    phrase = openPhrase(0);
    committed = emptyRecognition(nbest, settings.segments);
    offset = 0;
    nextPartial = 1;
    reportSyllables = createSyllableEvents(emit);
    syllableIndex = 0;
    ended = false;
    flushed = null;
    queued = 0;
    load?.reset();
  }

  function update(decoded) {
    if (!decoded) {
      return;
    }
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

  function read(decoded, size, final) {
    const signal = phrase.buffer.subarray(0, size);
    const readSettings = final
      ? settings
      : {
          ...settings,
          nbest: 1,
          segments: false,
          includeModeLabels: !liveWords && settings.includeModeLabels,
        };
    const wordOptions = liveWords
      ? {
          frontEnd: decoded,
          kernels: settings.kernels,
          maxWords: HMM_LIVE_WORDS,
          search: final
            ? { beam: 58, maxActive: 640 }
            : { beam: 48, maxActive: 280 },
        }
      : gateWordOptions;
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
            wordOptions
          )
        : { decoded, input: signal, rate: sampleRate };
    onReading?.(reading.decoded, offset / sampleRate, Boolean(final));
    if (liveWords && final) {
      for (const { start, end, ipa } of reading.decoded.syllables) {
        emit('syllable', {
          index: syllableIndex++,
          start: start + offset / sampleRate,
          end: end + offset / sampleRate,
          ipa,
        });
      }
    }
    const modeSettings = liveWords
      ? {
          ...readSettings,
          liveWords,
          voice: liveModeReference ? settings.voice : null,
        }
      : readSettings;
    return recognizeDecoded(
      reading.decoded,
      reading.input,
      reading.rate,
      modeSettings,
      level,
      final
    );
  }

  function readWords(size, options, consume, readSettings = settings) {
    return withBatchFrames((frameOptions) =>
      consume(
        decodeRecognitionAudio(
          phrase.buffer.subarray(0, size),
          sampleRate,
          readSettings,
          level,
          offset / sampleRate,
          { ...frameOptions, ...options, useModelWords: true }
        )
      )
    );
  }

  function wordCommit(size, finished) {
    return readWords(
      size,
      {
        analysis: finished ? phrase.decoder.frames : undefined,
        search: size > 2 * sampleRate ? HMM_LOW_SEARCH : undefined,
      },
      (reading) => {
        checkPhraseNoise(reading.decoded.frames, size);
        return phraseSpeech(reading.decoded, size)
          ? recognizeDecoded(
              reading.decoded,
              reading.input,
              reading.rate,
              settings,
              level,
              'batch'
            )
          : emptyRecognition(nbest, settings.segments);
      }
    );
  }

  function checkPhraseNoise(frames, size) {
    if (noisyFrames(frames.energy, frames.count, size / sampleRate)) {
      throw new RecognitionError(
        'too-noisy',
        'Audio has less than 5 dB of energy contrast'
      );
    }
  }

  function phoneCommit(size, finished) {
    const current = phrase.decoder.result();
    const bound = acousticsOnly ? boundedAcoustics : boundedDecode;
    const decoded = finished ? current : bound(current, size / sampleRate);
    checkPhraseNoise(decoded.frames, size);
    return phraseSpeech(decoded, size)
      ? read(decoded, size, 'stream')
      : emptyRecognition(nbest, settings.segments);
  }

  function commit(size, finishDecoder) {
    if (finishDecoder) {
      update(phrase.decoder.flush());
    } else if (wordPhrases && !batchWordFrontend && !liveSyllables()) {
      update(phrase.decoder.report());
    }
    const answer = wordPhrases
      ? wordCommit(size, finishDecoder)
      : phoneCommit(size, finishDecoder);
    if (answer.words.length) {
      const absolute = translated(
        answer,
        offset / sampleRate,
        committed.words.length
      );
      aggregate(committed, absolute, nbest - 1);
      if (has('final')) {
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
    // Only the lookahead after a word cut is replayed, with its original offset.
    // Batch reuses the old phrase's storage, so save that lookahead before reset.
    const suffix = previous.buffer.subarray(size, previous.used);
    const carried =
      batchWordFrontend && suffix.length ? suffix.slice() : suffix;
    phrase = openPhrase(offset / sampleRate);
    if (carried.length) {
      update(pushPhrase(phrase, carried));
    }
    onApplied?.();
  }

  function setVoice(voice, articulationOffsets, immediate = false, onApplied) {
    // Intermediate fits leave the current live phrase open when mode labels
    // use its own acoustic reference.
    if (liveWords && !liveModeReference && !immediate && !onApplied) {
      settings.voice = voice;
      settings.articulationOffsets = articulationOffsets;
      return;
    }
    drainPacket();
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

  function previewWords(due, pause) {
    if (!due || !has('partial')) {
      return;
    }
    // A phrase already showing words will be committed soon if the pause
    // continues. Keep its preview while waiting for speech or the commit.
    if (
      phrase.used >= phrase.nextPreview &&
      (!phrase.partial?.words.length || pause < PAUSE / 2)
    ) {
      const readSettings = {
        ...settings,
        nbest: 1,
        segments: false,
        modes: false,
        includeModeLabels: false,
      };
      readWords(
        phrase.used,
        { analysis: phrase.decoder.frames, search: PREVIEW_SEARCH },
        (reading) => {
          if (phraseSpeech(reading.decoded, phrase.used)) {
            phrase.partial = recognizeDecoded(
              reading.decoded,
              reading.input,
              reading.rate,
              readSettings,
              level,
              false
            );
          }
        },
        readSettings
      );
      phrase.nextPreview =
        phrase.used + sampleRate * (phrase.partial?.words.length ? 2 : 0.25);
    }
    const { words, ipa, text } = translated(
      phrase.partial ?? emptyRecognition(1),
      offset / sampleRate,
      0
    );
    emit('partial', { words, ipa, text });
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

  function advance(chunk) {
    const start = load && globalThis.performance.now();
    update(pushPhrase(phrase, chunk));
    const pause = trailingPause(phrase.decoder.frames, phrase);
    const total = offset + phrase.used;
    const due = total >= Math.ceil((nextPartial * sampleRate) / 4);
    if (previews && !finalOnly) {
      if (wordPhrases) {
        previewWords(due, pause);
      } else if (
        !liveWords ||
        (due && !phrase.partial?.words.length && phrase.used >= sampleRate)
      ) {
        previewPartial(due);
      }
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
    if (wordPhrases) {
      return readWords(
        phrase.used,
        { analysis: phrase.decoder.frames, search: HMM_LOW_SEARCH },
        ({ decoded }) => decoded.words
      );
    }
    return decodeRecognitionAudio(
      phrase.buffer.subarray(0, phrase.used),
      sampleRate,
      { ...settings, hmmWordSpans: true },
      level,
      offset / sampleRate,
      { framePitch: true }
    ).decoded.words;
  }

  function pushChunks(chunk) {
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
  }

  function drainPacket() {
    if (queued) {
      const size = queued;
      queued = 0;
      pushChunks(packet.subarray(0, size));
    }
  }

  function pushPackets(chunk) {
    for (let i = 0; i < chunk.length; ) {
      const end = Math.min(chunk.length, i + stride - queued);
      packet.set(chunk.subarray(i, end), queued);
      queued += end - i;
      i = end;
      if (queued === stride) {
        drainPacket();
      }
    }
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
        if (wordPhrases) {
          pushPackets(chunk);
        } else {
          pushChunks(chunk);
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
      if (offset + phrase.used + queued < 0.05 * sampleRate) {
        throw new RecognitionError(
          'empty',
          'Recognition needs at least 50 ms of audio'
        );
      }
      if (!ended) {
        drainPacket();
        if (phrase.used) {
          commit(phrase.used, true);
        }
      }
      ended = true;
      flushed = { ...committed, languages: languageShares(committed.words) };
      return globalThis.structuredClone(flushed);
    },
    reset,
    on(event, listener) {
      // Account for already confirmed nuclei before a new listener arrives.
      if (
        wordPhrases &&
        !batchWordFrontend &&
        !ended &&
        event === 'syllable' &&
        !liveSyllables()
      ) {
        update(
          phrase.decoder.startSyllables(phrase.buffer.subarray(0, phrase.used))
        );
      }
      on(event, listener);
    },
    off,
    setVoice,
    discardVoiceChange() {
      pending = undefined;
    },
  };
}
