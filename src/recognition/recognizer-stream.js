/** Phrase commits over the incremental IPA decoder. Unlicense. */
import { createIpaDecoder } from './decode.js';
import { joinSegments } from './decode-pipeline.js';
import { languageShares } from './language-id.js';
import {
  decodeRecognitionAudio,
  decoderOptions,
  emptyRecognition,
  noisyFrames,
  recognizeDecoded,
  RecognitionError,
  recognitionSettings,
  validateRate,
  validateSamples,
} from './recognizer.js';
import { clipWhisperSpans } from './whisper.js';

const PAUSE = 0.3;
const COMMIT_AFTER = 5;
const MAX_WINDOW = 7;
const LEVELS = ['low', 'medium', 'high'];
const EPSILON = 1e-8;

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
  const times = lattice.times.filter((time) => time <= end + EPSILON);
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
    lattice: {
      times,
      edges: lattice.edges.filter((edge) => edge.to < times.length),
    },
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

function translated(result, seconds, wordIndex) {
  const time = (item) => ({
    ...item,
    start: item.start + seconds,
    end: item.end + seconds,
  });
  return {
    ...result,
    words: result.words.map((word) => ({
      ...time(word),
      syllables: word.syllables.map(time),
    })),
    modes: result.modes.map((span) =>
      span.from === undefined
        ? time(span)
        : {
            ...time(span),
            from: span.from + wordIndex,
            to: span.to + wordIndex,
          }
    ),
  };
}

function joinedText(prefix, suffix, language, nextLanguage) {
  const join = language === 'zh' && nextLanguage === 'zh' ? '' : ' ';
  return prefix && suffix ? prefix + join + suffix : prefix || suffix;
}

function aggregate(result, phrase, alternativeLimit) {
  const previous = result.words.at(-1)?.language;
  const following = phrase.words[0]?.language;
  if (result.alternatives) {
    const prior = [
      { text: result.text, ipa: result.ipa, confidence: 1 },
      ...result.alternatives,
    ];
    const next = [
      { text: phrase.text, ipa: phrase.ipa, confidence: 1 },
      ...phrase.alternatives,
    ];
    const combinations = prior.flatMap((a, i) =>
      next.flatMap((b, j) =>
        i || j
          ? [
              {
                text: joinedText(a.text, b.text, previous, following),
                ipa: [a.ipa, b.ipa].filter(Boolean).join(' '),
                confidence: a.confidence * b.confidence,
              },
            ]
          : []
      )
    );
    result.alternatives = combinations
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, alternativeLimit);
  }
  result.text = joinedText(result.text, phrase.text, previous, following);
  result.ipa = [result.ipa, phrase.ipa].filter(Boolean).join(' ');
  result.words.push(...phrase.words);
  result.modes.push(...phrase.modes);
}

function trailingPause(frames, state) {
  while (state.scanned < frames.count) {
    if (frames.speech[state.scanned]) {
      state.lastSpeech = state.scanned;
    }
    state.scanned++;
  }
  return (state.scanned - state.lastSpeech - 1) * frames.hop >= PAUSE - EPSILON;
}

function createPhraseDecoder(sampleRate, settings, level, start) {
  const decoder = createIpaDecoder(sampleRate, {
    ...decoderOptions(settings, level, start),
    maxSeconds: MAX_WINDOW + 1,
  });
  return {
    decoder,
    buffer: new Float32Array(Math.ceil(MAX_WINDOW * sampleRate)),
    used: 0,
    scanned: 0,
    lastSpeech: -1,
    fixed: [],
    partial: null,
  };
}

function createEvents() {
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
export function createRecognizer(options = {}) {
  const { sampleRate } = options;
  validateRate(sampleRate);
  const settings = recognitionSettings(options);
  const { nbest } = settings;
  const stride = Math.max(1, Math.floor(sampleRate * 0.02));
  const { emit, on, off } = createEvents();
  const load = createLoadMeter(sampleRate);
  let phrase;
  let level;
  let committed;
  let offset;
  let nextPartial;
  let reportSyllables;
  let ended;
  let flushed;

  function reset() {
    level = settings.level === 'auto' ? 'medium' : settings.level;
    phrase = createPhraseDecoder(sampleRate, settings, level);
    committed = emptyRecognition(nbest);
    offset = 0;
    nextPartial = 1;
    reportSyllables = createSyllableEvents(emit);
    ended = false;
    flushed = null;
    load.reset();
  }

  function update(decoded) {
    reportSyllables(decoded, phrase.fixed, offset / sampleRate);
  }

  function read(decoded, size, final) {
    const signal = phrase.buffer.subarray(0, size);
    const readSettings = final ? settings : { ...settings, nbest: 1 };
    // A test can supply snapshot IPA while the decoder maintains live timing.
    const reading = settings.stages.audioToIpa
      ? decodeRecognitionAudio(
          signal,
          sampleRate,
          readSettings,
          level,
          offset / sampleRate
        )
      : { decoded, input: signal, rate: sampleRate };
    return recognizeDecoded(
      reading.decoded,
      reading.input,
      reading.rate,
      readSettings,
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
    const answer = read(decoded, size, 'stream');
    if (answer.words.length) {
      const absolute = translated(
        answer,
        offset / sampleRate,
        committed.words.length
      );
      aggregate(committed, absolute, nbest - 1);
      const { ipa, text, languages, words, modes } = translated(
        answer,
        offset / sampleRate,
        0
      );
      emit('final', { ipa, text, languages, words, modes });
    }
    offset += size;
  }

  function restart(size) {
    const start = globalThis.performance.now();
    const previous = phrase;
    commit(size, size === previous.used);
    load.charge((globalThis.performance.now() - start) / 1000);
    if (settings.level === 'auto') {
      const next = load.choose(level);
      if (next !== level) {
        level = next;
        load.reset();
      }
    }
    phrase = createPhraseDecoder(
      sampleRate,
      settings,
      level,
      offset / sampleRate
    );
    // Only the lookahead after a word cut is replayed, with its original offset.
    const suffix = previous.buffer.subarray(size, previous.used);
    if (suffix.length) {
      phrase.buffer.set(suffix);
      phrase.used = suffix.length;
      update(phrase.decoder.push(suffix));
    }
  }

  function previewPartial(due) {
    const awaitingFirstWords =
      phrase.partial &&
      !phrase.partial.words.length &&
      !settings.stages.audioToIpa;
    if (!due && !awaitingFirstWords) {
      return;
    }
    const preview = phrase.decoder.result();
    if (!due && !preview.ipa) {
      return;
    }
    phrase.partial = read(preview, phrase.used, false);
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
    const start = globalThis.performance.now();
    phrase.buffer.set(chunk, phrase.used);
    phrase.used += chunk.length;
    update(phrase.decoder.push(chunk));
    const pause = trailingPause(phrase.decoder.frames, phrase);
    const total = offset + phrase.used;
    const due = total >= Math.ceil((nextPartial * sampleRate) / 4);
    previewPartial(due);
    if (due) {
      nextPartial++;
    }
    load.add(chunk.length, (globalThis.performance.now() - start) / 1000);
    if (
      pause &&
      (phrase.lastSpeech >= 0 || phrase.used >= COMMIT_AFTER * sampleRate)
    ) {
      restart(phrase.used);
    } else if (phrase.used > COMMIT_AFTER * sampleRate && phrase.partial) {
      const word = phrase.partial.words.findLast(
        ({ end }) => end > 0 && end <= phrase.used / sampleRate - 1
      );
      if (word) {
        restart(Math.ceil(word.end * sampleRate - EPSILON));
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
  };
}
